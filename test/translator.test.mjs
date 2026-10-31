import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  protect,
  restore,
  detectLanguage,
  translateText,
  saveTranslatorSettings,
  readTranslatorState,
  translateRequestInput,
  translateAssistantMessage,
  translateResponsesSseStream
} from '../translator.mjs';

test('protect and restore preserve Markdown tables, code blocks, inline code, paths, URLs, and identifiers', () => {
  const sample = [
    'Проверь файл `E:\\Codex translate\\cli.mjs` и функцию `translate_request_input`.',
    '',
    '| Пакет | Статус |',
    '| --- | --- |',
    '| `codex_translate` | Online |',
    '',
    '```js',
    'const x = "не переводить внутри кода";',
    '```',
    'Ссылка: https://chatgpt.com/backend-api/codex'
  ].join('\n');

  const protectedPart = protect(sample);
  assert.doesNotMatch(protectedPart.masked, /translate_request_input/);
  assert.doesNotMatch(protectedPart.masked, /не переводить внутри кода/);

  const simulatedTranslated = protectedPart.masked
    .replace('Проверь файл', 'Check file')
    .replace('и функцию', 'and function')
    .replace('Ссылка:', 'Link:');

  const restored = restore(simulatedTranslated, protectedPart, true);
  assert.match(restored, /Check file `E:\\Codex translate\\cli\.mjs` and function `translate_request_input`\./);
  assert.match(restored, /const x = "не переводить внутри кода";/);
  assert.match(restored, /\| --- \| --- \|/);
  assert.match(restored, /https:\/\/chatgpt\.com\/backend-api\/codex/);
});

test('protect, restore, and translateRequestInput preserve POSIX paths and alias non-ASCII attachments on Linux and macOS', async () => {
  const posixSample = [
    'Проверь файлы /Users/alice/project/src/server.mjs и /home/dev/.codex/config.toml и ~/app/main.py.',
    'Ссылка на файл: [server.mjs](</Users/alice/My Project/server.mjs:42>)',
    '## "Конфигурация": /etc/nginx/nginx.conf'
  ].join('\n');

  const protectedPart = protect(posixSample);
  assert.doesNotMatch(protectedPart.masked, /\/Users\/alice/);
  assert.doesNotMatch(protectedPart.masked, /\/home\/dev/);
  assert.doesNotMatch(protectedPart.masked, /\/etc\/nginx/);

  const simulatedTranslated = protectedPart.masked
    .replace('Проверь файлы', 'Check files')
    .replace('Ссылка на файл:', 'File link:')
    .replace('"Конфигурация":', '"Configuration":');

  const restored = restore(simulatedTranslated, protectedPart, true);
  assert.match(restored, /Check files \/Users\/alice\/project\/src\/server\.mjs и \/home\/dev\/\.codex\/config\.toml и ~\/app\/main\.py\./);
  assert.match(restored, /\[server\.mjs\]\(<\/Users\/alice\/My Project\/server\.mjs:42>\)/);
  assert.match(restored, /## "Configuration": \/etc\/nginx\/nginx\.conf/);

  // Verify POSIX non-ASCII attachment aliasing in translateRequestInput
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-translate-posix-attach-'));
  try {
    saveTranslatorSettings(tmp, {
      enabled: true,
      connectionId: 'conn1',
      model: 'gemini-flash',
      autoLanguage: true,
      targetLanguage: 'ru'
    });

    const mockFetch = async (_url, init) => {
      const reqBody = JSON.parse(init.body);
      const userPayload = JSON.parse(reqBody.input[0].content[0].text);
      const parts = userPayload.parts.map(p => p.replace('Оцени лог', 'Evaluate log'));
      return new Response(
        JSON.stringify({
          output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ sourceLanguage: 'ru', parts }) }] }]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };

    const out = await translateRequestInput({
      body: {
        model: 'gpt-6.1-sol',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Оцени лог /Users/alice/.codex/attachments/uuid-1/Отчёт_ошибок.txt' }]
          }
        ]
      },
      threadId: 'thread_posix',
      dataDir: tmp,
      resolveRoute: async () => ({
        connection: { id: 'conn1', kind: 'responses', baseURL: 'https://api.example.com/v1' },
        apiKey: 'secret',
        model: 'gemini-flash'
      }),
      fetchImpl: mockFetch
    });

    assert.doesNotMatch(out.input[0].content[0].text, /Отчёт_ошибок/);
    assert.match(out.input[0].content[0].text, /Evaluate log \/Users\/alice\/\.codex\/attachments\/uuid-1\/attachment_[0-9a-f]{8}\.txt/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('translateRequestInput translates user text to English while keeping images/files and system context untouched', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-translate-input-'));
  try {
    saveTranslatorSettings(tmp, {
      enabled: true,
      connectionId: 'conn1',
      model: 'gemini-flash',
      autoLanguage: true,
      targetLanguage: 'ru'
    });

    const mockFetch = async (_url, init) => {
      const reqBody = JSON.parse(init.body);
      const userPayload = JSON.parse(reqBody.input[0].content[0].text);
      const translatedParts = userPayload.parts.map(p =>
        p.replace('Исправь ошибку в модуле', 'Fix the bug in module')
      );
      return new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: JSON.stringify({ sourceLanguage: 'ru', parts: translatedParts }) }]
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };

    const body = {
      model: 'gpt-6.1-sol',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '# AGENTS.md instructions\n<INSTRUCTIONS>Do not translate this</INSTRUCTIONS>' }]
        },
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: 'Исправь ошибку в модуле `auth_service`' },
            { type: 'input_image', image_url: 'data:image/png;base64,AAAA' }
          ]
        }
      ]
    };

    const out = await translateRequestInput({
      body,
      threadId: 'thread_1',
      dataDir: tmp,
      resolveRoute: async () => ({
        connection: { id: 'conn1', kind: 'responses', baseURL: 'http://127.0.0.1:20128/v1' },
        apiKey: 'secret',
        model: 'gemini-flash'
      }),
      fetchImpl: mockFetch
    });

    // AGENTS.md instructions remain untouched
    assert.match(out.input[0].content[0].text, /^# AGENTS\.md/);
    // User prompt is translated to English while keeping `auth_service`
    assert.equal(out.input[1].content[0].text, 'Fix the bug in module `auth_service`');
    // Image attachment is untouched
    assert.deepEqual(out.input[1].content[1], { type: 'input_image', image_url: 'data:image/png;base64,AAAA' });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('translateResponsesSseStream streams tool calls immediately and translates assistant message to user language', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-translate-sse-'));
  try {
    saveTranslatorSettings(tmp, {
      enabled: true,
      connectionId: 'conn1',
      model: 'gemini-flash',
      autoLanguage: true,
      targetLanguage: 'ru'
    });

    const mockFetch = async (_url, init) => {
      const reqBody = JSON.parse(init.body);
      const userPayload = JSON.parse(reqBody.input[0].content[0].text);
      const translatedParts = userPayload.parts.map(p =>
        p.replace('The bug in', 'Ошибка в').replace('has been fixed.', 'была исправлена.')
      );
      return new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: JSON.stringify({ sourceLanguage: 'en', parts: translatedParts }) }]
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };

    const upstreamEvents = [
      { type: 'response.created', response: { id: 'r1', status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: { id: 'fc_1', type: 'function_call', name: 'exec_command', arguments: '{}' } },
      { type: 'response.output_item.done', output_index: 0, item: { id: 'fc_1', type: 'function_call', name: 'exec_command', arguments: '{}' } },
      { type: 'response.output_item.added', output_index: 1, item: { id: 'msg_1', type: 'message', role: 'assistant', content: [] } },
      { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 1, content_index: 0, delta: 'The bug in `auth_service` has been fixed.' },
      { type: 'response.output_item.done', output_index: 1, item: { id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'The bug in `auth_service` has been fixed.' }] } },
      {
        type: 'response.completed',
        response: {
          id: 'r1',
          status: 'completed',
          output: [
            { id: 'fc_1', type: 'function_call', name: 'exec_command', arguments: '{}' },
            { id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'The bug in `auth_service` has been fixed.' }] }
          ]
        }
      }
    ];

    const ssePayload = upstreamEvents.map(ev => `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`).join('');
    const emitted = [];

    await translateResponsesSseStream(new Response(ssePayload).body, {
      threadId: 'thread_1',
      dataDir: tmp,
      resolveRoute: async () => ({
        connection: { id: 'conn1', kind: 'responses', baseURL: 'http://127.0.0.1:20128/v1' },
        apiKey: 'secret',
        model: 'gemini-flash'
      }),
      fetchImpl: mockFetch,
      writeSse: ev => emitted.push(ev)
    });

    const toolDone = emitted.find(e => e.type === 'response.output_item.done' && e.item?.type === 'function_call');
    assert.ok(toolDone);
    const msgDone = emitted.find(e => e.type === 'response.output_item.done' && e.item?.type === 'message');
    assert.match(msgDone.item.content[0].text, /^Ошибка в `auth_service` была исправлена\./);
    assert.match(msgDone.item.content[0].text, /🌐 \*\*Codex Translate\*\* · Translated RU → EN · Translated EN → RU/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('translator retains >40 threads and >150 messages per thread and reuses cache across forked threads', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-translate-unlimited-'));
  try {
    saveTranslatorSettings(tmp, {
      enabled: true,
      connectionId: 'conn1',
      model: 'gemini-flash',
      autoLanguage: true,
      targetLanguage: 'ru'
    });

    const routeResolver = async () => ({
      connection: { id: 'conn1', kind: 'responses', baseURL: 'http://127.0.0.1:20128/v1' },
      apiKey: 'secret',
      model: 'gemini-flash'
    });

    let networkCalls = 0;
    const mockFetch = async (_url, init) => {
      networkCalls++;
      const reqBody = JSON.parse(init.body);
      const userPayload = JSON.parse(reqBody.input[0].content[0].text);
      const isToEn = userPayload.targetLanguage === 'en';
      const translatedParts = userPayload.parts.map(p =>
        isToEn
          ? p
              .replace('Сообщение номер один', 'Message number one')
              .replace('Сообщение номер два', 'Message number two')
          : p.replace('Assistant reply one', 'Ответ ассистента один')
      );
      return new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({ sourceLanguage: isToEn ? 'ru' : 'en', parts: translatedParts })
                }
              ]
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };

    // Seed 45 threads and 160 messages in thread_0
    const seedState = {
      version: 1,
      revision: 'seed',
      status: { state: 'idle', reason: null, updatedAt: null },
      stats: { userTranslatedCount: 0, agentTranslatedCount: 0 },
      recentTranslations: [],
      threads: {}
    };
    for (let t = 0; t < 45; t++) {
      seedState.threads[`thread_${t}`] = {
        initialLanguage: 'ru',
        lastUserLanguage: 'ru',
        messages: {}
      };
    }
    for (let m = 0; m < 160; m++) {
      seedState.threads.thread_0.messages[`msg_seed_${m}`] = {
        key: `msg_seed_${m}`,
        kind: 'user',
        originalText: `Запрос ${m}`,
        translatedText: `Request ${m}`,
        sourceLanguage: 'ru',
        targetLanguage: 'en',
        status: 'translated'
      };
    }
    fs.writeFileSync(path.join(tmp, 'translator-state.json'), JSON.stringify(seedState, null, 2));

    // Translate a new user message and assistant message in thread_0
    await translateRequestInput({
      body: {
        model: 'gpt-6.1-sol',
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Сообщение номер один' }] }]
      },
      threadId: 'thread_0',
      dataDir: tmp,
      resolveRoute: routeResolver,
      fetchImpl: mockFetch
    });

    await translateAssistantMessage({
      text: 'Assistant reply one',
      threadId: 'thread_0',
      itemId: 'msg_a1',
      contentIndex: 0,
      dataDir: tmp,
      resolveRoute: routeResolver,
      fetchImpl: mockFetch
    });

    const afterState = readTranslatorState(tmp);
    assert.equal(Object.keys(afterState.threads).length, 45);
    assert.ok(Object.keys(afterState.threads.thread_0.messages).length >= 162);

    // Fork into thread_forked_new: historical user + assistant messages from thread_0 must resolve from cross-thread cache
    const callsBeforeFork = networkCalls;
    const forkedOut = await translateRequestInput({
      body: {
        model: 'gpt-6.1-sol',
        input: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Сообщение номер один' }] },
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Ответ ассистента один' }] },
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Сообщение номер два' }] }
        ]
      },
      threadId: 'thread_forked_new',
      dataDir: tmp,
      resolveRoute: routeResolver,
      fetchImpl: mockFetch
    });

    // Historical user message (turn 1) and assistant message (turn 1) were restored to English from thread_0 cache
    assert.equal(forkedOut.input[0].content[0].text, 'Message number one');
    assert.equal(forkedOut.input[1].content[0].text, 'Assistant reply one');
    assert.equal(forkedOut.input[2].content[0].text, 'Message number two');
    // Only the new turn-2 user message triggered a network call
    assert.equal(networkCalls - callsBeforeFork, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('translateText strictly rejects when inline code placeholder (e.g. verify_token) is dropped on all retry attempts', async () => {
  let attempts = 0;
  const brokenFetch = async () => {
    attempts++;
    return new Response(
      JSON.stringify({
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: JSON.stringify({ sourceLanguage: 'ru', parts: ['Explain now.'] }) }]
          }
        ]
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  await assert.rejects(
    () =>
      translateText({
        text: 'Объясни `verify_token` сейчас.',
        targetLanguage: 'en',
        connection: { id: 'c1', kind: 'responses', baseURL: 'http://127.0.0.1:20128/v1' },
        apiKey: 'k',
        model: 'gemini-flash',
        fetchImpl: brokenFetch
      }),
    /literal_integrity/
  );
  assert.equal(attempts, 2);
});

test('detectLanguage accurately identifies diacritic-free Romance, Germanic, and other Latin languages instead of defaulting to English', async () => {
  assert.equal(detectLanguage('Bonjour, pouvez-vous expliquer cette erreur?'), 'fr');
  assert.equal(detectLanguage('Hola, puedes explicar este error?'), 'es');
  assert.equal(detectLanguage('Ciao, puoi spiegare questo errore?'), 'it');
  assert.equal(detectLanguage('Ola, voce pode explicar este erro?'), 'pt');
  assert.equal(detectLanguage('Hallo, kannst du diesen Fehler erklaren?'), 'de');
  assert.equal(detectLanguage('Hallo, kun je deze fout uitleggen?'), 'nl');
  assert.equal(detectLanguage('Merhaba, bu hatayi aciklayabilir misiniz?'), 'tr');
  assert.equal(detectLanguage('Czesc, czy mozesz wyjasnic ten blad?'), 'pl');
  assert.equal(detectLanguage('Halo, bisakah anda menjelaskan kesalahan ini?'), 'id');
  assert.equal(detectLanguage('Hello, can you explain this error in the file?'), 'en');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-translate-fr-'));
  try {
    saveTranslatorSettings(tmp, {
      enabled: true,
      connectionId: 'conn1',
      model: 'gemini-flash',
      autoLanguage: true,
      targetLanguage: 'ru'
    });

    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({ sourceLanguage: 'fr', parts: ['Hello, can you explain this error?'] })
                }
              ]
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );

    const out = await translateRequestInput({
      body: {
        model: 'gpt-6.1-sol',
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Bonjour, pouvez-vous expliquer cette erreur?' }] }]
      },
      threadId: 'thread_fr',
      dataDir: tmp,
      resolveRoute: async () => ({
        connection: { id: 'conn1', kind: 'responses', baseURL: 'http://127.0.0.1:20128/v1' },
        apiKey: 'secret',
        model: 'gemini-flash'
      }),
      fetchImpl: mockFetch
    });

    assert.equal(out.input[0].content[0].text, 'Hello, can you explain this error?');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('translateResponsesSseStream preserves multi-part messages (content_index 0 and 1), annotations, and logprobs', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-translate-multipart-sse-'));
  try {
    saveTranslatorSettings(tmp, {
      enabled: true,
      connectionId: 'conn1',
      model: 'gemini-flash',
      autoLanguage: true,
      targetLanguage: 'ru'
    });

    const mockFetch = async (_url, init) => {
      const reqBody = JSON.parse(init.body);
      const userPayload = JSON.parse(reqBody.input[0].content[0].text);
      const translatedParts = userPayload.parts.map(p =>
        p.replace('First part of the answer.', 'Первая часть ответа.').replace('Second part of the answer.', 'Вторая часть ответа.')
      );
      return new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: JSON.stringify({ sourceLanguage: 'en', parts: translatedParts }) }]
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };

    const citation = { type: 'url_citation', url: 'https://example.com/spec', title: 'Spec' };
    const upstreamEvents = [
      { type: 'response.created', response: { id: 'r_multi', status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: { id: 'msg_m1', type: 'message', role: 'assistant', content: [] } },
      { type: 'response.content_part.added', item_id: 'msg_m1', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [citation], logprobs: [{ token: 'First' }] } },
      { type: 'response.output_text.delta', item_id: 'msg_m1', output_index: 0, content_index: 0, delta: 'First part of the answer.' },
      { type: 'response.content_part.done', item_id: 'msg_m1', output_index: 0, content_index: 0, part: { type: 'output_text', text: 'First part of the answer.', annotations: [citation], logprobs: [{ token: 'First' }] } },
      { type: 'response.content_part.added', item_id: 'msg_m1', output_index: 0, content_index: 1, part: { type: 'output_text', text: '', annotations: [], logprobs: [] } },
      { type: 'response.output_text.delta', item_id: 'msg_m1', output_index: 0, content_index: 1, delta: 'Second part of the answer.' },
      { type: 'response.content_part.done', item_id: 'msg_m1', output_index: 0, content_index: 1, part: { type: 'output_text', text: 'Second part of the answer.', annotations: [], logprobs: [] } },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          id: 'msg_m1',
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'output_text', text: 'First part of the answer.', annotations: [citation], logprobs: [{ token: 'First' }] },
            { type: 'output_text', text: 'Second part of the answer.', annotations: [], logprobs: [] }
          ]
        }
      },
      {
        type: 'response.completed',
        response: {
          id: 'r_multi',
          status: 'completed',
          output: [
            {
              id: 'msg_m1',
              type: 'message',
              role: 'assistant',
              content: [
                { type: 'output_text', text: 'First part of the answer.', annotations: [citation], logprobs: [{ token: 'First' }] },
                { type: 'output_text', text: 'Second part of the answer.', annotations: [], logprobs: [] }
              ]
            }
          ]
        }
      }
    ];

    const ssePayload = upstreamEvents.map(ev => `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`).join('');
    const emitted = [];

    await translateResponsesSseStream(new Response(ssePayload).body, {
      threadId: 'thread_multi',
      dataDir: tmp,
      resolveRoute: async () => ({
        connection: { id: 'conn1', kind: 'responses', baseURL: 'http://127.0.0.1:20128/v1' },
        apiKey: 'secret',
        model: 'gemini-flash'
      }),
      fetchImpl: mockFetch,
      writeSse: ev => emitted.push(ev)
    });

    const msgDone = emitted.find(e => e.type === 'response.output_item.done' && e.item?.id === 'msg_m1');
    assert.ok(msgDone);
    assert.equal(msgDone.item.content.length, 2);
    assert.equal(msgDone.item.content[0].text, 'Первая часть ответа.');
    assert.deepEqual(msgDone.item.content[0].annotations, [citation]);
    assert.deepEqual(msgDone.item.content[0].logprobs, [{ token: 'First' }]);
    assert.match(msgDone.item.content[1].text, /^Вторая часть ответа\./);
    assert.match(msgDone.item.content[1].text, /🌐 \*\*Codex Translate\*\*/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


