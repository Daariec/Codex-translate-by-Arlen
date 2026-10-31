import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  protect,
  restore,
  hasTargetLanguage,
  saveTranslatorSettings,
  translateRequestInput,
  translateResponsesSseStream
} from '../translator.mjs';
import { createGatewayServer } from '../gateway.mjs';

test('protect preserves Windows attachment paths with spaces and Cyrillic filenames', () => {
  const input =
    '# Files pasted by the user:\n\n' +
    '## "# SYSTEM ROLE & CORE DIRECTIVE…": C:\\Users\\developer\\.codex/attachments/31f5cf99-a4b6-4dee-93b5-92b5f32c2f48/Вставленный текст.txt\n\n' +
    '## My request:\nОцени инструкцию во вложении.';
  const p = protect(input);
  assert.ok(
    !p.masked.includes('текст.txt'),
    `Expected attachment path with spaces to be masked by placeholder, got: ${p.masked}`
  );
  const simulatedTranslated = p.masked.replace('Оцени инструкцию во вложении.', 'Evaluate the attached instruction.');
  const restored = restore(simulatedTranslated, p);
  assert.ok(restored.includes('C:\\Users\\developer\\.codex/attachments/31f5cf99-a4b6-4dee-93b5-92b5f32c2f48/Вставленный текст.txt'));

  // Inline attachment path followed by Russian prose on the same line must not swallow the prose
  const inlineInput = 'Проверь C:\\Users\\developer\\.codex\\attachments\\1\\файл.txt и исправь ошибку.';
  const pInline = protect(inlineInput);
  assert.ok(!pInline.masked.includes('файл.txt'));
  assert.ok(pInline.masked.includes('и исправь ошибку'));
});

test('hasTargetLanguage accepts Russian translation containing heavy CamelCase and Latin technical identifiers', () => {
  const techHeavyRu =
    'В модуле TokenEconomicsEngine для OpenAI Responses API, Anthropic Messages API и ChatGPT Desktop App ' +
    'добавлена поддержка PromptCachingTracker, StreamingSseInterceptor и DPAPICredentialStore.';
  assert.equal(hasTargetLanguage(techHeavyRu, 'ru'), true);
});

test('translateRequestInput translates steered/historical uncached user messages (i < lastNonUserIndex) and uncached Russian assistant messages', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-leak-input-'));
  try {
    saveTranslatorSettings(tmp, {
      enabled: true,
      translateInput: true,
      connectionId: 'c1',
      model: 'mock-trans',
      autoLanguage: true,
      targetLanguage: 'ru'
    });

    const mockFetch = async (_url, init) => {
      const reqBody = JSON.parse(init.body);
      const payload = JSON.parse(reqBody.input.at(-1).content[0].text);
      const parts = payload.parts.map(p =>
        p
          .replace('Первый пропущенный запрос на русском.', 'First missed request in Russian.')
          .replace('Второй запрос в режиме steer перед вызовом инструмента.', 'Second steered request before tool call.')
          .replace('Ответ ассистента на русском из прошлого сбоя.', 'Assistant reply in English restored from fallback.')
      );
      return new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: JSON.stringify({ sourceLanguage: 'ru', parts }) }]
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };

    // Simulate a request where:
    // 1. User message 1 failed to translate on an earlier turn (not in cache)
    // 2. Assistant message 1 was generated in Russian during a temporary outage (not in cache)
    // 3. User message 2 was steered mid-turn BEFORE a completing function_call_output (so i < lastNonUserIndex!)
    const body = {
      model: 'gpt-6.1-sol',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Первый пропущенный запрос на русском.' }]
        },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Ответ ассистента на русском из прошлого сбоя.' }]
        },
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Второй запрос в режиме steer перед вызовом инструмента.' }]
        },
        {
          type: 'function_call_output',
          call_id: 'call_1',
          output: 'ok'
        }
      ]
    };

    const out = await translateRequestInput({
      body,
      threadId: 'thread_steer',
      dataDir: tmp,
      resolveRoute: async () => ({
        connection: { kind: 'responses', baseURL: 'http://127.0.0.1:9999/v1', model: 'mock-trans' },
        apiKey: 'k',
        model: 'mock-trans'
      }),
      fetchImpl: mockFetch
    });

    assert.equal(out.input[0].content[0].text, 'First missed request in Russian.');
    assert.equal(out.input[1].content[0].text, 'Assistant reply in English restored from fallback.');
    assert.equal(out.input[2].content[0].text, 'Second steered request before tool call.');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('translateResponsesSseStream translates request_user_input_async tool call questions to user language', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-tool-question-'));
  try {
    saveTranslatorSettings(tmp, {
      enabled: true,
      translateInput: true,
      connectionId: 'c1',
      model: 'mock-trans',
      autoLanguage: false,
      targetLanguage: 'ru'
    });

    const mockFetch = async (_url, init) => {
      const reqBody = JSON.parse(init.body);
      const payload = JSON.parse(reqBody.input.at(-1).content[0].text);
      const parts = payload.parts.map(p =>
        p
          .replace('Which mode should the gateway use?', 'Какой режим должен использовать шлюз?')
          .replace('Local bridge (Recommended)', 'Локальный мост (Рекомендуется)')
          .replace('Direct connection', 'Прямое соединение')
      );
      return new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: JSON.stringify({ sourceLanguage: 'en', parts }) }]
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };

    const toolArgs = JSON.stringify({
      questions: [
        {
          title: 'Which mode should the gateway use?',
          options: ['Local bridge (Recommended)', 'Direct connection']
        }
      ]
    });
    const sseInput = [
      `event: response.created\ndata: ${JSON.stringify({ type: 'response.created', response: { id: 'r1', status: 'in_progress', output: [] } })}\n\n`,
      `event: response.output_item.added\ndata: ${JSON.stringify({ type: 'response.output_item.added', output_index: 0, item: { id: 'fc_1', type: 'function_call', call_id: 'call_q1', name: 'request_user_input_async', arguments: '' } })}\n\n`,
      `event: response.function_call_arguments.delta\ndata: ${JSON.stringify({ type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: toolArgs })}\n\n`,
      `event: response.function_call_arguments.done\ndata: ${JSON.stringify({ type: 'response.function_call_arguments.done', item_id: 'fc_1', output_index: 0, arguments: toolArgs })}\n\n`,
      `event: response.output_item.done\ndata: ${JSON.stringify({ type: 'response.output_item.done', output_index: 0, item: { id: 'fc_1', type: 'function_call', call_id: 'call_q1', name: 'request_user_input_async', arguments: toolArgs } })}\n\n`,
      `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { id: 'r1', status: 'completed', output: [{ id: 'fc_1', type: 'function_call', call_id: 'call_q1', name: 'request_user_input_async', arguments: toolArgs }] } })}\n\n`
    ];

    const emitted = [];
    await translateResponsesSseStream(sseInput, {
      threadId: 't_q1',
      dataDir: tmp,
      resolveRoute: async () => ({
        connection: { kind: 'responses', baseURL: 'http://127.0.0.1:9999/v1', model: 'mock-trans' },
        apiKey: 'k',
        model: 'mock-trans'
      }),
      fetchImpl: mockFetch,
      writeSse: ev => emitted.push(ev)
    });

    const doneItemEv = emitted.find(e => e.type === 'response.output_item.done' && e.item?.type === 'function_call');
    assert.ok(doneItemEv);
    const translatedArgs = JSON.parse(doneItemEv.item.arguments);
    assert.equal(translatedArgs.questions[0].title, 'Какой режим должен использовать шлюз?');
    assert.equal(translatedArgs.questions[0].options[0], 'Локальный мост (Рекомендуется)');

    // Now verify that when the user selects the translated option in <send_user_message_question_reply>,
    // translateRequestInput restores the exact original English question and option for the Agent!
    const replyText =
      '<send_user_message_question_reply>\n' +
      JSON.stringify([
        {
          questionItemId: '["request_user_input_async","call_q1",0]',
          question: 'Какой режим должен использовать шлюз?',
          answer: 'Локальный мост (Рекомендуется)'
        }
      ]) +
      '\n</send_user_message_question_reply>\n';

    const replyOut = await translateRequestInput({
      body: {
        model: 'gpt-6.1-sol',
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: replyText }] }]
      },
      threadId: 't_q1',
      dataDir: tmp,
      resolveRoute: async () => ({
        connection: { kind: 'responses', baseURL: 'http://127.0.0.1:9999/v1', model: 'mock-trans' },
        apiKey: 'k',
        model: 'mock-trans'
      }),
      fetchImpl: mockFetch
    });

    const restoredReplyText = replyOut.input[0].content[0].text;
    assert.match(restoredReplyText, /Which mode should the gateway use\?/);
    assert.match(restoredReplyText, /Local bridge \(Recommended\)/);

    // Multi-select array answer in <send_user_message_question_reply>
    const multiReplyText =
      '<send_user_message_question_reply>\n' +
      JSON.stringify([
        {
          questionItemId: '["request_user_input_async","call_q1",0]',
          question: 'Какой режим должен использовать шлюз?',
          answer: ['Локальный мост (Рекомендуется)', 'Прямое соединение']
        }
      ]) +
      '\n</send_user_message_question_reply>\n';
    const multiReplyOut = await translateRequestInput({
      body: {
        model: 'gpt-6.1-sol',
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: multiReplyText }] }]
      },
      threadId: 't_q1',
      dataDir: tmp,
      resolveRoute: async () => ({
        connection: { kind: 'responses', baseURL: 'http://127.0.0.1:9999/v1', model: 'mock-trans' },
        apiKey: 'k',
        model: 'mock-trans'
      }),
      fetchImpl: mockFetch
    });
    const restoredMulti = JSON.parse(
      multiReplyOut.input[0].content[0].text
        .replace(/^<send_user_message_question_reply>\s*/, '')
        .replace(/\s*<\/send_user_message_question_reply>\s*$/, '')
    );
    assert.deepEqual(restoredMulti[0].answer, ['Local bridge (Recommended)', 'Direct connection']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('gateway sanitizes compaction input to English without translating compaction/subagent/auto-review output to Russian', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-compaction-subagent-'));
  let mockTranslator;
  let mockAgent;
  let gw;

  try {
    const dataDir = path.join(tmp, 'data');
    const codexHome = path.join(tmp, 'codex');
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(path.join(codexHome, 'config.toml'), 'model = "gpt-6.1-sol"\n');

    const agentRequests = [];

    mockTranslator = http.createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'trans/fast', name: 'Fast', capabilities: { tool_calling: true } }] }));
        return;
      }
      if (req.method === 'POST' && req.url === '/v1/responses') {
        let raw = '';
        for await (const c of req) raw += c;
        const body = JSON.parse(raw);
        const payload = JSON.parse(body.input.at(-1).content[0].text);
        const target = payload.targetLanguage;
        const parts = payload.parts.map(p => {
          if (target === 'en') {
            return p.replace('Проверь конфигурацию сервера.', 'Check the server configuration.');
          }
          return p.replace('Compaction summary in English.', 'Сводка компакции на русском.');
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'completed',
            output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ sourceLanguage: target === 'en' ? 'ru' : 'en', parts }) }] }]
          })
        );
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise(r => mockTranslator.listen(0, '127.0.0.1', r));

    mockAgent = http.createServer(async (req, res) => {
      let raw = '';
      for await (const c of req) raw += c;
      const body = JSON.parse(raw);
      agentRequests.push({ url: req.url, body });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const reply = 'Compaction summary in English.';
      const events = [
        { type: 'response.created', response: { id: 'r1', status: 'in_progress', output: [] } },
        { type: 'response.output_item.added', output_index: 0, item: { id: 'm1', type: 'message', role: 'assistant', content: [] } },
        { type: 'response.output_text.delta', item_id: 'm1', output_index: 0, content_index: 0, delta: reply },
        { type: 'response.output_item.done', output_index: 0, item: { id: 'm1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: reply }] } },
        { type: 'response.completed', response: { id: 'r1', status: 'completed', output: [{ id: 'm1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: reply }] }] } }
      ];
      for (const ev of events) res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
      res.end();
    });
    await new Promise(r => mockAgent.listen(0, '127.0.0.1', r));

    gw = await createGatewayServer({
      dataDir,
      codexHome,
      port: 0,
      upstreamBaseUrl: `http://127.0.0.1:${mockAgent.address().port}/backend-api/codex`,
      keyCodec: {
        protect: (id, key) => `mock:${id}:${key}`,
        read: cred => cred.split(':').slice(2).join(':')
      }
    });

    await gw.dispatch('saveConnection', {
      id: 'c1',
      name: 'Translator',
      kind: 'omniroute',
      baseUrl: `http://127.0.0.1:${mockTranslator.address().port}/v1`,
      apiKey: 'k1',
      primary: true
    });
    await gw.dispatch('refreshModels', { id: 'c1' });
    await gw.dispatch('saveTranslator', {
      enabled: true,
      connectionId: 'c1',
      model: 'trans/fast',
      autoLanguage: true,
      targetLanguage: 'ru'
    });

    // Send a Compaction request containing Russian user history
    const compactRes = await fetch(`http://127.0.0.1:${gw.port}/v1/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer eyJ_test',
        'x-codex-turn-metadata': JSON.stringify({ thread_id: 't_comp', request_kind: 'compaction', compaction: true })
      },
      body: JSON.stringify({
        model: 'gpt-6.1-sol',
        stream: true,
        input: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Проверь конфигурацию сервера.' }] },
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'You are performing a CONTEXT CHECKPOINT COMPACTION. Summarize the progress.' }] }
        ]
      })
    });
    assert.equal(compactRes.status, 200);
    const compactSse = await compactRes.text();

    // 1. Upstream agent MUST receive the sanitized English user message during compaction
    assert.equal(agentRequests[0].body.input[0].content[0].text, 'Check the server configuration.');
    // 2. Compaction output MUST stay in English (not translated to Russian)
    assert.match(compactSse, /Compaction summary in English\./);
    assert.doesNotMatch(compactSse, /Сводка компакции на русском\./);

    // 3. Sub-agent turn (subagent_kind: 'thread_spawn') translates input to English if needed,
    //    but keeps sub-agent output in English so Russian never leaks into the parent agent
    const subagentRes = await fetch(`http://127.0.0.1:${gw.port}/v1/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer eyJ_test',
        'x-codex-turn-metadata': JSON.stringify({
          thread_id: 't_sub',
          parent_thread_id: 't_parent',
          subagent_kind: 'thread_spawn',
          agent_name: '/root/reviewer'
        })
      },
      body: JSON.stringify({
        model: 'gpt-6.1-sol',
        stream: true,
        input: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Проверь конфигурацию сервера.' }] }
        ]
      })
    });
    assert.equal(subagentRes.status, 200);
    const subagentSse = await subagentRes.text();
    assert.equal(agentRequests[1].body.input[0].content[0].text, 'Check the server configuration.');
    assert.match(subagentSse, /Compaction summary in English\./);
    assert.doesNotMatch(subagentSse, /Сводка компакции на русском\./);

    // 4. codex-auto-review passes through without translating output or making 39 transcript translation calls
    const reviewRes = await fetch(`http://127.0.0.1:${gw.port}/v1/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer eyJ_test'
      },
      body: JSON.stringify({
        model: 'codex-auto-review',
        stream: true,
        input: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'The following is the Codex agent history whose request action you are assessing.' }] }
        ]
      })
    });
    assert.equal(reviewRes.status, 200);
    const reviewSse = await reviewRes.text();
    assert.match(reviewSse, /Compaction summary in English\./);
    assert.doesNotMatch(reviewSse, /Сводка компакции на русском\./);

    // 5. Verify Base Agent reasoning.effort forwarding and mid-thread Codex UI effort update
    const cfgPath = path.join(codexHome, 'config.toml');
    fs.writeFileSync(cfgPath, 'model = "gpt-6.1-sol"\nmodel_reasoning_effort = "xhigh"\n');
    const turn1Res = await fetch(`http://127.0.0.1:${gw.port}/v1/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer eyJ_test',
        'x-codex-turn-metadata': JSON.stringify({ thread_id: 't_effort_check' })
      },
      body: JSON.stringify({
        model: 'gpt-6.1-sol',
        reasoning: { effort: 'xhigh', summary: 'auto' },
        stream: true,
        input: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Проверь конфигурацию сервера.' }] }
        ]
      })
    });
    assert.equal(turn1Res.status, 200);
    await turn1Res.text();
    assert.equal(agentRequests.at(-1).body.reasoning?.effort, 'xhigh');
    assert.equal(agentRequests.at(-1).body.reasoning?.summary, 'auto');

    const snap1 = await gw.dispatch('snapshot');
    assert.equal(snap1.economics.codexReasoningEffort, 'xhigh');

    // User changes effort in Codex UI to "low" (config/batchWrite updates config.toml)
    fs.writeFileSync(cfgPath, 'model = "gpt-6.1-sol"\nmodel_reasoning_effort = "low"\n');
    const snap2 = await gw.dispatch('snapshot');
    assert.equal(snap2.economics.codexReasoningEffort, 'low');

    // Next turn on t_effort_check even if client sent stale "xhigh" is upgraded to current "low"
    const turn2Res = await fetch(`http://127.0.0.1:${gw.port}/v1/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer eyJ_test',
        'x-codex-turn-metadata': JSON.stringify({ thread_id: 't_effort_check' })
      },
      body: JSON.stringify({
        model: 'gpt-6.1-sol',
        reasoning: { effort: 'xhigh', summary: 'auto' },
        stream: true,
        input: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Проверь конфигурацию сервера.' }] }
        ]
      })
    });
    assert.equal(turn2Res.status, 200);
    await turn2Res.text();
    assert.equal(agentRequests.at(-1).body.reasoning?.effort, 'low');
  } finally {
    if (gw) await gw.close();
    if (mockTranslator) await new Promise(r => mockTranslator.close(r));
    if (mockAgent) await new Promise(r => mockAgent.close(r));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('zero-leakage across tool calls (function_call, tool_use, tool_calls, outputs), system envelopes, helper requests, attachments, inline code, and fail-closed errors', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-zero-leak-all-'));
  try {
    saveTranslatorSettings(tmp, {
      enabled: true,
      translateInput: true,
      connectionId: 'c1',
      model: 'mock-trans',
      autoLanguage: true,
      targetLanguage: 'ru'
    });

    const attachDir = path.join(tmp, 'attachments', 'uuid-1');
    fs.mkdirSync(attachDir, { recursive: true });
    const cyrillicAttachPath = path.join(attachDir, 'Вставленный текст.txt');
    fs.writeFileSync(cyrillicAttachPath, 'sample content', 'utf8');

    const mockFetch = async (_url, init) => {
      const reqBody = JSON.parse(init.body);
      const payload = JSON.parse(reqBody.input.at(-1).content[0].text);
      const isToEn = payload.targetLanguage === 'en';
      const parts = payload.parts.map(p => {
        if (!isToEn) {
          return p
            .replace('Which mode should the gateway use?', 'Какой режим должен использовать шлюз?')
            .replace('Local bridge (Recommended)', 'Локальный мост (Рекомендуется)')
            .replace('Direct connection', 'Прямое соединение');
        }
        return p
          .replace('Всегда отвечай кратко.', 'Always answer concisely.')
          .replace('Пользователь предпочитает тёмную тему.', 'User prefers dark theme.')
          .replace('Исправь `ошибку авторизации` в модуле.', 'Fix `authorization error` in the module.')
          .replace('комментарий на русском языке', 'comment in Russian language')
          .replace('Создай таблицу пользователей', 'Create users table')
          .replace('Оцени вложение', 'Evaluate attachment')
          .replace('Свой вариант ответа', 'Custom answer option');
      });
      return new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: JSON.stringify({ sourceLanguage: isToEn ? 'ru' : 'en', parts }) }]
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };

    const resolveRoute = async () => ({
      connection: { kind: 'responses', baseURL: 'http://127.0.0.1:9999/v1', model: 'mock-trans' },
      apiKey: 'k',
      model: 'mock-trans'
    });

    // 1. Stream a request_user_input_async tool call so its original English arguments and optionMappings are cached
    const origToolArgs = JSON.stringify({
      questions: [
        {
          title: 'Which mode should the gateway use?',
          options: ['Local bridge (Recommended)', 'Direct connection']
        }
      ]
    });
    const sseEvents = [
      `event: response.output_item.added\ndata: ${JSON.stringify({ type: 'response.output_item.added', output_index: 0, item: { id: 'fc_u1', type: 'function_call', call_id: 'call_u1', name: 'request_user_input_async', arguments: '' } })}\n\n`,
      `event: response.function_call_arguments.done\ndata: ${JSON.stringify({ type: 'response.function_call_arguments.done', item_id: 'fc_u1', output_index: 0, arguments: origToolArgs })}\n\n`,
      `event: response.output_item.done\ndata: ${JSON.stringify({ type: 'response.output_item.done', output_index: 0, item: { id: 'fc_u1', type: 'function_call', call_id: 'call_u1', name: 'request_user_input_async', arguments: origToolArgs } })}\n\n`
    ];
    const emitted = [];
    await translateResponsesSseStream(sseEvents, {
      threadId: 't_zero',
      dataDir: tmp,
      resolveRoute,
      fetchImpl: mockFetch,
      writeSse: ev => emitted.push(ev)
    });
    const translatedToolCallItem = emitted.find(e => e.type === 'response.output_item.done').item;
    assert.match(translatedToolCallItem.arguments, /Какой режим должен использовать шлюз\?/);

    // 2. Next turn: verify function_call, Anthropic tool_use/tool_result, Chat Completions tool_calls/tool,
    //    system envelopes (AGENTS.md, RETAINED USER INSTRUCTIONS, Title prompt), inline backticks, code comments,
    //    attachment path aliasing, and MCP tool filtering
    const nextTurnBody = {
      model: 'gpt-6.1-sol',
      tools: [
        { type: 'function', name: 'mcp__codex_translate__translator_status' },
        { type: 'function', name: 'exec_command' }
      ],
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '# AGENTS.md\n<INSTRUCTIONS>\nВсегда отвечай кратко.\n</INSTRUCTIONS>' }]
        },
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '>>> RETAINED USER INSTRUCTIONS START\nПользователь предпочитает тёмную тему.\n>>> RETAINED USER INSTRUCTIONS END' }]
        },
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'You are a helpful assistant. You will be presented with a user prompt:\nСоздай таблицу пользователей' }]
        },
        translatedToolCallItem,
        {
          type: 'function_call_output',
          call_id: 'call_u1',
          output: JSON.stringify({ answer: 'Локальный мост (Рекомендуется)', note: 'Свой вариант ответа' })
        },
        {
          type: 'message',
          role: 'assistant',
          tool_calls: [
            { id: 'call_u1', type: 'function', function: { name: 'request_user_input', arguments: translatedToolCallItem.arguments } }
          ],
          content: [
            { type: 'tool_use', id: 'call_u1', name: 'request_user_input', input: JSON.parse(translatedToolCallItem.arguments) }
          ]
        },
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'call_u1', content: 'Локальный мост (Рекомендуется)' },
            {
              type: 'input_text',
              text:
                `Оцени вложение ${cyrillicAttachPath}\n` +
                'Исправь `ошибку авторизации` в модуле.\n' +
                '```js\n// комментарий на русском языке\nconst ok = true;\n```'
            }
          ]
        }
      ]
    };

    const sanitized = await translateRequestInput({
      body: nextTurnBody,
      threadId: 't_zero',
      dataDir: tmp,
      resolveRoute,
      fetchImpl: mockFetch
    });

    // MCP translator tools filtered from body.tools
    assert.equal(sanitized.tools.length, 1);
    assert.equal(sanitized.tools[0].name, 'exec_command');

    // AGENTS.md inner non-English content translated while preserving tags
    assert.match(sanitized.input[0].content[0].text, /<INSTRUCTIONS>\s*Always answer concisely\.\s*<\/INSTRUCTIONS>/);
    // RETAINED USER INSTRUCTIONS inner content translated while preserving markers
    assert.match(sanitized.input[1].content[0].text, />>> RETAINED USER INSTRUCTIONS START\s*User prefers dark theme\.\s*>>> RETAINED USER INSTRUCTIONS END/);
    // Title prompt user segment translated to English
    assert.match(sanitized.input[2].content[0].text, /Create users table/);
    // OpenAI Responses function_call arguments restored to English
    assert.equal(sanitized.input[3].arguments, origToolArgs);
    // OpenAI Responses function_call_output restored to English
    assert.deepEqual(JSON.parse(sanitized.input[4].output), {
      answer: 'Local bridge (Recommended)',
      note: 'Custom answer option'
    });
    // Chat Completions tool_calls and Anthropic tool_use restored to English
    assert.equal(sanitized.input[5].tool_calls[0].function.arguments, origToolArgs);
    assert.deepEqual(sanitized.input[5].content[0].input, JSON.parse(origToolArgs));
    // Anthropic tool_result restored to English
    assert.equal(sanitized.input[6].content[0].content, 'Local bridge (Recommended)');

    // User prompt with attachment path, inline backticks, and code comment
    const finalUserText = sanitized.input[6].content[1].text;
    assert.doesNotMatch(finalUserText, /Вставленный текст\.txt/);
    assert.match(finalUserText, /attachment_[0-9a-f]{8}\.txt/);
    assert.match(finalUserText, /Fix `authorization error` in the module\./);
    assert.match(finalUserText, /\/\/ comment in Russian language/);

    // Verify fail-closed error handling when translator fails on non-English input
    await assert.rejects(
      () =>
        translateRequestInput({
          body: {
            model: 'gpt-6.1-sol',
            input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Непереведённый запрос при сбое сети' }] }]
          },
          threadId: 't_fail_closed',
          dataDir: tmp,
          resolveRoute,
          fetchImpl: async () => new Response('Upstream error', { status: 500 })
        }),
      /blocking request to preserve language neutrality/
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
