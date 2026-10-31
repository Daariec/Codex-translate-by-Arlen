import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  routingStatus,
  switchRoute,
  ensurePluginEnabledInCodex,
  ensureTrayRunning,
  openControlPanel
} from './routing.mjs';
import {
  translateBridgeConfig,
  jsonRead,
  writeJSON,
  defaultDataDir,
  defaultCodexHome,
  psPath,
  credential,
  discover,
  normalizeModel
} from './lib.mjs';
import { ensureGatewayDaemon, DEFAULT_GATEWAY_PORT } from './gateway.mjs';
import { readTranslatorSettings, saveTranslatorSettings, translateText } from './translator.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const pkg = jsonRead(path.join(root, 'package.json'), { name: 'codex-translate', version: '1.0.0' });
const kind = pkg.name;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--data-dir' && argv[i + 1]) out.dataDir = argv[++i];
    else if (argv[i] === '--codex-home' && argv[i + 1]) out.codexHome = argv[++i];
  }
  return out;
}

const cliOpt = parseArgs(process.argv.slice(2));
const dataDir = path.resolve(cliOpt.dataDir ?? defaultDataDir(kind));
const codexHome = path.resolve(cliOpt.codexHome ?? defaultCodexHome());
const stateFile = path.join(dataDir, 'state.json');
const helper = path.join(root, 'Credential.ps1');

function loadState() {
  const state = jsonRead(stateFile, { version: 1, selected: null, desiredRoute: 'translate', connections: {} });
  for (const conn of Object.values(state.connections ?? {})) {
    if (Array.isArray(conn.models)) conn.models = conn.models.map(normalizeModel);
  }
  return state;
}

function saveState(state) {
  writeJSON(stateFile, state);
}

const isLiveUser = !cliOpt.dataDir && !cliOpt.codexHome;
let liveStartupStarted = false;

function reconcileOnStartup() {
  try {
    ensurePluginEnabledInCodex({ codexHome, pluginRoot: root, dataDir, version: pkg.version });
    const state = loadState();
    let status = routingStatus(dataDir, codexHome);
    if (!isLiveUser && state.desiredRoute !== 'base') {
      const gwUrl = `http://127.0.0.1:${DEFAULT_GATEWAY_PORT}/v1`;
      if (!status.interceptActive || !status.managed) {
        status = switchRoute({
          route: 'translate',
          dataDir,
          codexHome,
          gatewayBaseUrl: gwUrl,
          generated: translateBridgeConfig(gwUrl),
          force: true
        });
      }
    }
    if (isLiveUser && !liveStartupStarted) {
      liveStartupStarted = true;
      ensureTrayRunning(root, { minimizePanelToTray: true, dataDir, codexHome });
      void ensureGatewayDaemon({ dataDir, codexHome })
        .then(async gw => {
          if (gw?.running && loadState().desiredRoute !== 'base') {
            const curStatus = routingStatus(dataDir, codexHome);
            const cfgFile = path.join(codexHome, 'config.toml');
            const rawBuf = fs.existsSync(cfgFile) ? fs.readFileSync(cfgFile) : Buffer.alloc(0);
            const rawStr = rawBuf.toString('utf8');
            const alreadyHealthy =
              !rawBuf.includes(0) &&
              curStatus.interceptActive &&
              curStatus.managed &&
              rawStr.includes(gw.baseUrl);
            if (!alreadyHealthy) {
              try {
                await fetch(`http://127.0.0.1:${gw.port}/api/action`, {
                  method: 'POST',
                  headers: {
                    'content-type': 'application/json',
                    ...(gw.adminToken ? { 'x-codex-translate-token': gw.adminToken } : {})
                  },
                  body: JSON.stringify({ action: 'switchRoute', payload: { route: 'translate' } })
                });
              } catch {}
            }
          }
        })
        .catch(() => {});
    }
    return {
      status,
      selected: state.selected,
      desiredRoute: state.desiredRoute ?? 'translate',
      translator: readTranslatorSettings(dataDir)
    };
  } catch (err) {
    return { error: err.message };
  }
}

const TOOLS = [
  {
    name: 'translator_status',
    description: 'Show current Codex Translate status (ON/OFF), active translator model, target language, and saved translator API connections.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: 'translator_toggle',
    description: 'Turn the User <-> Agent translator ON or OFF.',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description: 'Set true to turn ON the translator, or false to turn OFF the translator.'
        }
      },
      required: ['enabled'],
      additionalProperties: false
    }
  },
  {
    name: 'translator_configure',
    description: 'Configure the User <-> Agent translator (ON/OFF, auto language detection, translator connection ID, model, and effort).',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: 'Enable or disable the intermediary translator.' },
        autoLanguage: { type: 'boolean', description: 'Priority #1: automatically translate responses into the language of the user request.' },
        targetLanguage: { type: 'string', description: 'Priority #2 fallback BCP-47 language code.' },
        connectionId: { type: 'string', description: 'Connection ID for the translator model.' },
        model: { type: 'string', description: 'Model ID to use for translation.' },
        effort: { type: 'string', description: 'Optional reasoning effort for the translator model.' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'translator_list_models',
    description: 'List eligible models from the saved translator API provider with context window and supported reasoning efforts.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Optional saved connection ID (defaults to selected connection).' },
        search: { type: 'string', description: 'Optional search substring to filter models by ID or name.' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'translator_sync_models',
    description: 'Refresh the model list from the saved translator API server /v1/models endpoint.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Optional connection ID.' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'translator_translate_text',
    description: 'Translate text using the configured translator model while protecting Markdown tables, code blocks, file paths, URLs, and identifiers.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to translate.' },
        targetLanguage: { type: 'string', description: 'Target BCP-47 language code (e.g. "en").' }
      },
      required: ['text', 'targetLanguage'],
      additionalProperties: false
    }
  },
  {
    name: 'translator_open_panel',
    description: 'Open the Codex Translate control panel window (ON/OFF toggle, Translator settings, API Providers, and Models).',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  }
];

async function handleToolCall(name, args = {}) {
  const state = loadState();
  const id = args.id ?? args.connectionId ?? state.selected ?? Object.keys(state.connections ?? {})[0] ?? 'default';
  const getConn = () => {
    const c = state.connections?.[id];
    if (!c) throw Error(`No saved translator connection: ${id}`);
    return c;
  };
  const sanitizeTranslatorForMcp = t => {
    if (!t || typeof t !== 'object') return t;
    return { ...t, targetLanguage: 'auto' };
  };

  if (name === 'translator_status') {
    return {
      package: kind,
      selected: state.selected,
      desiredRoute: state.desiredRoute ?? 'translate',
      routing: routingStatus(dataDir, codexHome),
      translator: sanitizeTranslatorForMcp(readTranslatorSettings(dataDir)),
      connections: Object.entries(state.connections ?? {}).map(([cid, c]) => ({
        id: cid,
        kind: c.kind || 'omniroute',
        url: c.baseURL,
        model: c.model,
        effort: c.effort ?? 'auto',
        models: c.models?.length ?? 0,
        fetchedAt: c.fetchedAt
      })),
      dataDir
    };
  }

  if (name === 'translator_toggle' || name === 'translator_configure') {
    const current = readTranslatorSettings(dataDir);
    const cid = args.connectionId || current.connectionId || state.selected || Object.keys(state.connections ?? {})[0] || null;
    const conn = cid ? state.connections?.[cid] : null;
    const model = args.model || current.model || conn?.model || conn?.models?.find(m => m.eligible)?.id || '';
    const saved = saveTranslatorSettings(dataDir, {
      ...args,
      ...(cid && !current.connectionId ? { connectionId: cid } : {}),
      ...(model && !current.model ? { model } : {})
    });
    if (saved.enabled) {
      const gwInfo = jsonRead(path.join(dataDir, 'gateway.json'), null);
      const gwUrl = gwInfo?.baseUrl || `http://127.0.0.1:${DEFAULT_GATEWAY_PORT}/v1`;
      switchRoute({
        route: 'translate',
        dataDir,
        codexHome,
        gatewayBaseUrl: gwUrl,
        generated: translateBridgeConfig(gwUrl),
        force: true
      });
      state.desiredRoute = 'translate';
      saveState(state);
    }
    return { saved: true, translator: sanitizeTranslatorForMcp(saved), routing: routingStatus(dataDir, codexHome) };
  }

  if (name === 'translator_open_panel') {
    const gw = await ensureGatewayDaemon({ dataDir, codexHome });
    ensureTrayRunning(root);
    openControlPanel({ pluginRoot: root, uiUrl: gw.uiUrl, dataDir, codexHome, async: true });
    return { opened: true, uiUrl: gw.uiUrl };
  }

  if (name === 'translator_list_models') {
    const c = getConn();
    const q = (args.search ?? '').toLowerCase();
    const matched = (c.models ?? []).filter(m => m.eligible && (m.id + ' ' + m.name).toLowerCase().includes(q));
    return {
      connection: id,
      selectedModel: c.model,
      totalMatching: matched.length,
      models: matched.slice(0, 100).map(m => ({
        id: m.id,
        name: m.name,
        context: m.context,
        efforts: m.efforts
      }))
    };
  }

  if (name === 'translator_sync_models') {
    const c = getConn();
    const models = await discover(c.baseURL, credential(helper, 'Read', c.credentialFile), c.kind || 'omniroute');
    if (!models.some(m => m.id === c.model && m.eligible)) {
      c.model = models.find(m => m.eligible)?.id ?? c.model;
    }
    c.models = models;
    c.fetchedAt = new Date().toISOString();
    state.selected = id;
    saveState(state);
    return { synced: true, connection: id, modelsCount: models.length, selectedModel: c.model };
  }

  if (name === 'translator_translate_text') {
    const t = readTranslatorSettings(dataDir);
    const cid = t.connectionId || state.selected || Object.keys(state.connections ?? {})[0];
    const conn = cid ? state.connections?.[cid] : null;
    if (!conn) throw Error('No translator API connection configured.');
    const model = t.model || conn.model || conn.models?.find(m => m.eligible)?.id;
    if (!model) throw Error('No translator model selected.');
    const apiKey = conn.credentialFile ? credential(helper, 'Read', conn.credentialFile) : '';
    const res = await translateText({
      text: args.text,
      targetLanguage: args.targetLanguage || t.targetLanguage || 'ru',
      connection: { ...conn, model },
      apiKey,
      model,
      effort: t.effort || ''
    });
    return res;
  }

  throw Error(`Unknown tool: ${name}`);
}

reconcileOnStartup();

function sendMessage(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handleRpc(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.method === 'initialize') {
    reconcileOnStartup();
    sendMessage({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'codex-translate', version: pkg.version ?? '1.0.0' }
      }
    });
    return;
  }
  if (msg.method === 'notifications/initialized' || msg.method === 'initialized') {
    return;
  }
  if (msg.method === 'ping') {
    sendMessage({ jsonrpc: '2.0', id: msg.id, result: {} });
    return;
  }
  if (msg.method === 'tools/list') {
    sendMessage({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
    return;
  }
  if (msg.method === 'resources/list') {
    sendMessage({ jsonrpc: '2.0', id: msg.id, result: { resources: [] } });
    return;
  }
  if (msg.method === 'resources/templates/list') {
    sendMessage({ jsonrpc: '2.0', id: msg.id, result: { resourceTemplates: [] } });
    return;
  }
  if (msg.method === 'tools/call') {
    try {
      const out = await handleToolCall(msg.params?.name, msg.params?.arguments ?? {});
      sendMessage({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(out, null, 2) }]
        }
      });
    } catch (err) {
      sendMessage({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          isError: true,
          content: [{ type: 'text', text: err.message }]
        }
      });
    }
    return;
  }
  if ('id' in msg) {
    sendMessage({
      jsonrpc: '2.0',
      id: msg.id,
      error: { code: -32601, message: `Method not found: ${msg.method}` }
    });
  }
}

let inputBuffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  inputBuffer += chunk;
  const lines = inputBuffer.split(/\r?\n/);
  inputBuffer = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^Content-Length:/i.test(trimmed)) continue;
    try {
      const parsed = JSON.parse(trimmed);
      void handleRpc(parsed);
    } catch {}
  }
});
