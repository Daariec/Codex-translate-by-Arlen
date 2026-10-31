import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGatewayServer } from '../gateway.mjs';

test('gateway intercepts User -> Translator -> Base Agent -> Translator -> User when ON, and passes through when OFF', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-translate-gw-'));
  let mockTranslatorServer;
  let mockBaseAgentServer;
  let gw;

  try {
    const dataDir = path.join(tmp, 'data');
    const codexHome = path.join(tmp, 'codex');
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(path.join(codexHome, 'config.toml'), 'model = "gpt-6.1-sol"\n');

    const agentReceivedPrompts = [];
    const agentReceivedBodies = [];
    const agentReceivedHeaders = [];

    // 1. Mock Translator API Provider Server
    mockTranslatorServer = http.createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            data: [
              {
                id: 'translator/gemini-3.8-flash',
                name: 'Gemini 3.8 Flash Translator',
                capabilities: { tool_calling: true, reasoning: true }
              }
            ]
          })
        );
        return;
      }
      if (req.method === 'POST' && req.url === '/v1/responses') {
        let raw = '';
        for await (const c of req) raw += c;
        const body = JSON.parse(raw);
        const userText = body.input?.at(-1)?.content?.[0]?.text || '';
        if (userText === 'Reply OK.') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] }));
          return;
        }
        const payload = JSON.parse(userText);
        const target = payload.targetLanguage;
        const translatedParts = payload.parts.map(p => {
          if (target === 'en') {
            return p
              .replace('Объясни работу функции', 'Explain how the function')
              .replace('в двух словах.', 'works in two words.');
          }
          return p
            .replace('The function', 'Функция')
            .replace('validates user tokens.', 'проверяет токены пользователя.');
        });
        const replyJson = JSON.stringify({
          sourceLanguage: target === 'en' ? 'ru' : 'en',
          parts: translatedParts
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'completed',
            output: [{ type: 'message', content: [{ type: 'output_text', text: replyJson }] }]
          })
        );
        return;
      }
      res.writeHead(404).end();
    });

    await new Promise(r => mockTranslatorServer.listen(0, '127.0.0.1', r));
    const transPort = mockTranslatorServer.address().port;

    // 2. Mock Official Base ChatGPT / Codex Backend Server
    mockBaseAgentServer = http.createServer(async (req, res) => {
      let raw = '';
      for await (const c of req) raw += c;
      agentReceivedHeaders.push(req.headers);
      const body = JSON.parse(raw);
      agentReceivedBodies.push(body);
      const promptText = body.input?.[0]?.content?.[0]?.text || '';
      agentReceivedPrompts.push(promptText);

      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const englishReply = 'The function `verify_token` validates user tokens.';
      const events = [
        { type: 'response.created', response: { id: 'resp_base_1', status: 'in_progress', output: [] } },
        { type: 'response.output_item.added', output_index: 0, item: { id: 'msg_base_1', type: 'message', role: 'assistant', content: [] } },
        { type: 'response.output_text.delta', item_id: 'msg_base_1', output_index: 0, content_index: 0, delta: englishReply },
        {
          type: 'response.output_item.done',
          output_index: 0,
          item: { id: 'msg_base_1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: englishReply }] }
        },
        {
          type: 'response.completed',
          response: {
            id: 'resp_base_1',
            status: 'completed',
            output: [{ id: 'msg_base_1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: englishReply }] }]
          }
        }
      ];
      for (const ev of events) {
        res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
      }
      res.end();
    });

    await new Promise(r => mockBaseAgentServer.listen(0, '127.0.0.1', r));
    const baseAgentPort = mockBaseAgentServer.address().port;

    // 3. Start Codex Translate Gateway
    gw = await createGatewayServer({
      dataDir,
      codexHome,
      port: 0,
      upstreamBaseUrl: `http://127.0.0.1:${baseAgentPort}/backend-api/codex`,
      keyCodec: {
        protect: (id, key) => `mock:${id}:${key}`,
        read: cred => cred.split(':').slice(2).join(':')
      }
    });

    // Configure Translator Provider & Model and turn Translator ON
    await gw.dispatch('saveConnection', {
      id: 'trans_srv',
      name: 'Translator Server',
      kind: 'omniroute',
      baseUrl: `http://127.0.0.1:${transPort}/v1`,
      apiKey: 'trans_key_123',
      primary: true
    });
    const refreshed = await gw.dispatch('refreshModels', { id: 'trans_srv' });
    assert.equal(refreshed.count, 1);

    await gw.dispatch('saveTranslator', {
      enabled: true,
      connectionId: 'trans_srv',
      model: 'translator/gemini-3.8-flash',
      autoLanguage: true,
      targetLanguage: 'ru'
    });

    // Test zstd-compressed request from official ChatGPT/Codex when Translator is ON
    const reqPayload = {
      model: 'gpt-6.1-sol',
      stream: true,
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Объясни работу функции `verify_token` в двух словах.' }]
        }
      ]
    };
    const compressed = zlib.zstdCompressSync(Buffer.from(JSON.stringify(reqPayload), 'utf8'));

    const resOn = await fetch(`http://127.0.0.1:${gw.port}/v1/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'zstd',
        authorization: 'Bearer eyJ_chatgpt_native_jwt',
        'chatgpt-account-id': 'acct_test_123'
      },
      body: compressed
    });
    assert.equal(resOn.status, 200);
    const sseTextOn = await resOn.text();

    // Verify 1: The Base Agent received the English-translated prompt (and original ChatGPT auth headers!)
    assert.equal(agentReceivedPrompts[0], 'Explain how the function `verify_token` works in two words.');
    assert.equal(agentReceivedHeaders[0].authorization, 'Bearer eyJ_chatgpt_native_jwt');
    assert.equal(agentReceivedHeaders[0]['chatgpt-account-id'], 'acct_test_123');

    // Verify 2: The User received the Russian-translated response with `verify_token` preserved AND health tracking indicator!
    assert.match(sseTextOn, /Функция `verify_token` проверяет токены пользователя\./);
    assert.match(sseTextOn, /🌐 \*\*Codex Translate\*\* · Translated RU → EN · Translated EN → RU/);

    // Verify snapshot exposes recentTranslations log for both user->agent and agent->user
    const snapAfterTurn1 = await gw.dispatch('snapshot');
    assert.equal(snapAfterTurn1.translator.recentTranslations.length, 2);
    assert.ok(snapAfterTurn1.translator.recentTranslations.some(r => r.direction === 'user->agent' && r.targetLanguage === 'en'));
    assert.ok(snapAfterTurn1.translator.recentTranslations.some(r => r.direction === 'agent->user' && r.targetLanguage === 'ru'));

    // 3b. Verify Turn 2: Assistant's translated Russian history (Even with the 🌐 Codex Translate footer attached!) is stripped and restored to original English for the Base Agent
    const turn2Payload = {
      model: 'gpt-6.1-sol',
      stream: true,
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Объясни работу функции `verify_token` в двух словах.' }]
        },
        {
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text:
                'Функция `verify_token` проверяет токены пользователя.\n\n---\n*🌐 **Codex Translate** · Перевод подтверждён (`translator/gemini-3.8-flash` · 0.1с) · Запрос (RU → EN): «Explain how the function `verify_token` works in two words.» · Ответ: EN → RU*'
            }
          ]
        },
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Объясни работу функции `refresh_session` в двух словах.' }]
        }
      ]
    };

    const resTurn2 = await fetch(`http://127.0.0.1:${gw.port}/v1/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer eyJ_chatgpt_native_jwt',
        'chatgpt-account-id': 'acct_test_123'
      },
      body: JSON.stringify(turn2Payload)
    });
    assert.equal(resTurn2.status, 200);
    await resTurn2.text();
    assert.equal(
      agentReceivedBodies[1].input[1].content[0].text,
      'The function `verify_token` validates user tokens.'
    );
    assert.equal(
      agentReceivedBodies[1].input[2].content[0].text,
      'Explain how the function `refresh_session` works in two words.'
    );

    // Verify testTranslator live action
    const probeRes = await gw.dispatch('testTranslator', {
      sampleText: 'Объясни работу функции `verify_token` в двух словах.'
    });
    assert.equal(probeRes.status, 'online');
    assert.match(probeRes.translatedSample, /Explain how the function `verify_token` works in two words\./);

    // 4. Turn Translator OFF via toggleTranslator and verify direct pass-through without translation
    const toggled = await gw.dispatch('toggleTranslator', { enabled: false });
    assert.equal(toggled.translator.enabled, false);

    const resOff = await fetch(`http://127.0.0.1:${gw.port}/v1/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer eyJ_chatgpt_native_jwt',
        'chatgpt-account-id': 'acct_test_123'
      },
      body: JSON.stringify(reqPayload)
    });
    assert.equal(resOff.status, 200);
    const sseTextOff = await resOff.text();

    // When OFF, Base Agent receives the raw untranslated Russian prompt and user receives raw English reply
    assert.equal(agentReceivedPrompts.at(-1), 'Объясни работу функции `verify_token` в двух словах.');
    assert.match(sseTextOff, /The function `verify_token` validates user tokens\./);

    // 5. Verify /api/action security: reject foreign Origin, reject text/plain, reject missing token, allow valid token
    const badOriginRes = await fetch(`http://127.0.0.1:${gw.port}/api/action`, {
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
        'content-type': 'application/json',
        'x-codex-translate-token': gw.adminToken
      },
      body: JSON.stringify({ action: 'snapshot' })
    });
    assert.equal(badOriginRes.status, 403);

    const badContentTypeRes = await fetch(`http://127.0.0.1:${gw.port}/api/action`, {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        'x-codex-translate-token': gw.adminToken
      },
      body: JSON.stringify({ action: 'snapshot' })
    });
    assert.equal(badContentTypeRes.status, 415);

    const noTokenRes = await fetch(`http://127.0.0.1:${gw.port}/api/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'snapshot' })
    });
    assert.equal(noTokenRes.status, 403);

    const validActionRes = await fetch(`http://127.0.0.1:${gw.port}/api/action`, {
      method: 'POST',
      headers: {
        origin: `http://127.0.0.1:${gw.port}`,
        'content-type': 'application/json',
        'x-codex-translate-token': gw.adminToken
      },
      body: JSON.stringify({ action: 'snapshot' })
    });
    assert.equal(validActionRes.status, 200);
    const validActionData = await validActionRes.json();
    assert.equal(validActionData.ok, true);

    // 6. Verify readiness honesty: removing the connection disables translator and blocks turning ON without provider/model
    await gw.dispatch('removeConnection', { id: 'trans_srv' });
    const snapWithoutProvider = await gw.dispatch('snapshot');
    assert.equal(snapWithoutProvider.translator.enabled, false);
    assert.equal(snapWithoutProvider.translator.hasProvider, false);
    assert.equal(snapWithoutProvider.translator.hasModel, false);
    assert.equal(snapWithoutProvider.translator.ready, false);
    assert.equal(snapWithoutProvider.routing.interceptActive, false);

    await assert.rejects(
      () => gw.dispatch('saveTranslator', { enabled: true }),
      /API провайдер/
    );
    const snapAfterRejectedOn = await gw.dispatch('snapshot');
    assert.equal(snapAfterRejectedOn.translator.enabled, false);
    assert.equal(snapAfterRejectedOn.translator.ready, false);
    assert.equal(snapAfterRejectedOn.routing.interceptActive, false);
  } finally {
    if (gw) await gw.close();
    if (mockTranslatorServer) {
      mockTranslatorServer.closeAllConnections?.();
      await new Promise(r => mockTranslatorServer.close(r));
    }
    if (mockBaseAgentServer) {
      mockBaseAgentServer.closeAllConnections?.();
      await new Promise(r => mockBaseAgentServer.close(r));
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
