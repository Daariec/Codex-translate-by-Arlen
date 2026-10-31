import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveCodexExe, defaultCodexHome, defaultDataDir, jsonRead } from './lib.mjs';
import { createGatewayServer } from './gateway.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

async function runConfiguredLiveTest() {
  const realCodexHome = defaultCodexHome();
  const realDataDir = defaultDataDir('codex-translate');
  const codexExe = resolveCodexExe(realCodexHome);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-translate-live-configured-'));
  const probeHome = path.join(tmp, 'codex');
  const workDir = path.join(tmp, 'work');
  fs.mkdirSync(probeHome, { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });

  for (const f of ['auth.json', 'models_cache.json']) {
    const src = path.join(realCodexHome, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(probeHome, f));
  }

  const sourceConfig = fs.readFileSync(path.join(realCodexHome, 'config.toml'), 'utf8');
  let skipSection = false;
  const filteredLines = sourceConfig.split(/\r?\n/).filter(line => {
    if (/^\s*\[/.test(line)) {
      skipSection = /^\s*\[(?:mcp_servers|plugins|marketplaces|hooks)\b/.test(line);
    }
    if (!skipSection && /^\s*notify\s*=/.test(line)) return false;
    return !skipSection;
  });
  const config =
    filteredLines.join('\n') +
    `\n[projects.${JSON.stringify(workDir)}]\ntrust_level = "trusted"\n`;
  fs.writeFileSync(path.join(probeHome, 'config.toml'), config);

  const prompt = 'Привет! Объясни в одном коротком предложении, для чего нужен файл `package.json` и поле `main_entry` в Node.js. Не используй инструменты.';
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--ephemeral',
    '--sandbox',
    'read-only',
    '-c',
    'approval_policy="never"',
    '-c',
    'windows.sandbox="unelevated"',
    '--json',
    '--color',
    'never',
    '-C',
    workDir,
    prompt
  ];

  const { code, stdout, stderr } = await new Promise((resolve, reject) => {
    const child = spawn(codexExe, args, {
      cwd: workDir,
      env: { ...process.env, CODEX_HOME: probeHome },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    let err = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    const timer = setTimeout(() => child.kill(), 90000);
    child.on('error', e => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', exitCode => {
      clearTimeout(timer);
      resolve({ code: exitCode, stdout: out, stderr: err });
    });
  });

  const events = stdout.split(/\r?\n/).flatMap(l => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
  const finalReply = events
    .filter(e => e.type === 'item.completed' && e.item?.type === 'agent_message')
    .map(e => e.item.text)
    .join('\n');

  const tState = jsonRead(path.join(realDataDir, 'translator-state.json'), {});
  const recent = (tState.recentTranslations || []).slice(-2);

  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

  console.log(
    JSON.stringify(
      {
        mode: 'live-configured',
        exitCode: code,
        passed: code === 0 && finalReply.includes('Codex Translate'),
        userPromptSent: prompt,
        finalReplyReceivedByUser: finalReply,
        translatorStatus: tState.status,
        recentTranslationsLog: recent,
        events,
        ...(code !== 0 ? { stderr: stderr.slice(-800) } : {})
      },
      null,
      2
    )
  );
  if (code !== 0 || !finalReply.includes('Codex Translate')) {
    process.exitCode = 1;
  }
}

async function runIsolatedNativeVerification() {
  const realCodexHome = defaultCodexHome();
  const codexExe = resolveCodexExe(realCodexHome);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-translate-native-e2e-'));
  const dataDir = path.join(tmp, 'data');
  const codexHome = path.join(tmp, 'codex');
  fs.mkdirSync(codexHome, { recursive: true });

  for (const f of ['auth.json', 'models_cache.json']) {
    const src = path.join(realCodexHome, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(codexHome, f));
    }
  }

  let capturedAgentPrompt = null;

  const transSrv = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          data: [{ id: 'translator/fast-en-ru', name: 'Fast Translator', capabilities: { tool_calling: true } }]
        })
      );
      return;
    }
    let raw = '';
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    const payload = JSON.parse(body.input.at(-1).content[0].text);
    const parts = payload.parts.map(p =>
      payload.targetLanguage === 'en'
        ? p.replace('Привет! Проверь статус модуля', 'Hello! Check the status of module')
        : p.replace('Module status is healthy:', 'Статус модуля в норме:')
    );
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  sourceLanguage: payload.targetLanguage === 'en' ? 'ru' : 'en',
                  parts
                })
              }
            ]
          }
        ]
      })
    );
  });
  await new Promise(r => transSrv.listen(0, '127.0.0.1', r));

  const agentSrv = http.createServer(async (req, res) => {
    if (req.url.includes('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      const modelsCache = path.join(codexHome, 'models_cache.json');
      res.end(fs.existsSync(modelsCache) ? fs.readFileSync(modelsCache) : JSON.stringify({ models: [] }));
      return;
    }
    let raw = '';
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    const userMsg = (body.input || []).filter(i => i.role === 'user').at(-1);
    capturedAgentPrompt = userMsg?.content?.find(c => c.type === 'input_text')?.text || '';

    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const reply = 'Module status is healthy: `core_engine_v1`';
    const evs = [
      { type: 'response.created', sequence_number: 1, response: { id: 'r_1', status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', sequence_number: 2, output_index: 0, item: { id: 'm_1', type: 'message', role: 'assistant', status: 'in_progress', content: [] } },
      { type: 'response.content_part.added', sequence_number: 3, item_id: 'm_1', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
      { type: 'response.output_text.delta', sequence_number: 4, item_id: 'm_1', output_index: 0, content_index: 0, delta: reply },
      { type: 'response.output_text.done', sequence_number: 5, item_id: 'm_1', output_index: 0, content_index: 0, text: reply },
      { type: 'response.content_part.done', sequence_number: 6, item_id: 'm_1', output_index: 0, content_index: 0, part: { type: 'output_text', text: reply, annotations: [] } },
      { type: 'response.output_item.done', sequence_number: 7, output_index: 0, item: { id: 'm_1', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: reply, annotations: [] }] } },
      { type: 'response.completed', sequence_number: 8, response: { id: 'r_1', status: 'completed', output: [{ id: 'm_1', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: reply, annotations: [] }] }] } }
    ];
    for (const ev of evs) res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    res.end();
  });
  await new Promise(r => agentSrv.listen(0, '127.0.0.1', r));

  const gw = await createGatewayServer({
    dataDir,
    codexHome,
    port: 0,
    upstreamBaseUrl: `http://127.0.0.1:${agentSrv.address().port}/backend-api/codex`,
    keyCodec: { protect: (id, k) => `${id}:${k}`, read: f => f.split(':')[1] }
  });

  try {
    fs.writeFileSync(
      path.join(codexHome, 'config.toml'),
      `model = "gpt-6.1-sol"\nopenai_base_url = "http://127.0.0.1:${gw.port}/v1"\n`
    );

    await gw.dispatch('saveConnection', {
      id: 'default',
      name: 'Local Trans',
      kind: 'omniroute',
      baseUrl: `http://127.0.0.1:${transSrv.address().port}/v1`,
      apiKey: 'k1',
      primary: true
    });
    await gw.dispatch('refreshModels', { id: 'default' });
    await gw.dispatch('saveTranslator', {
      enabled: true,
      connectionId: 'default',
      model: 'translator/fast-en-ru',
      autoLanguage: true,
      targetLanguage: 'ru'
    });

    const codexOut = await new Promise((resolve, reject) => {
      const child = spawn(
        codexExe,
        ['exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', 'Привет! Проверь статус модуля `core_engine_v1`'],
        {
          cwd: root,
          env: { ...process.env, CODEX_HOME: codexHome },
          stdio: ['ignore', 'pipe', 'pipe']
        }
      );
      let out = '';
      let err = '';
      child.stdout.on('data', d => (out += d));
      child.stderr.on('data', d => (err += d));
      child.on('close', code => (code === 0 ? resolve(out.trim()) : reject(new Error(err))));
    });

    assert.equal(capturedAgentPrompt, 'Hello! Check the status of module `core_engine_v1`');
    assert.match(codexOut, /^Статус модуля в норме: `core_engine_v1`/);
    assert.match(codexOut, /🌐 \*\*Codex Translate\*\* · Translated RU → EN · Translated EN → RU/);
    console.log(
      JSON.stringify(
        {
          ok: true,
          codexExe,
          userSent: 'Привет! Проверь статус модуля `core_engine_v1`',
          agentReceivedInEnglish: capturedAgentPrompt,
          agentRepliedInEnglish: 'Module status is healthy: `core_engine_v1`',
          userReceivedInRussianWithIndicator: codexOut
        },
        null,
        2
      )
    );
  } finally {
    await gw.close();
    transSrv.closeAllConnections();
    agentSrv.closeAllConnections();
    await new Promise(r => transSrv.close(r));
    await new Promise(r => agentSrv.close(r));
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

if (process.argv.includes('--configured')) {
  runConfiguredLiveTest().catch(err => {
    console.error(err);
    process.exit(1);
  });
} else {
  runIsolatedNativeVerification().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
