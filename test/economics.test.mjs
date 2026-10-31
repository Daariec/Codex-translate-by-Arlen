import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  countTokens,
  resolveOpenAiEncoding,
  parseApiUsage,
  calculateTurnEconomics,
  TokenEconomicsEngine,
  inferDefaultModelRate,
  parseOpenAiPricingHtml
} from '../economics.mjs';
import http from 'node:http';
import { createGatewayServer } from '../gateway.mjs';

test('local BPE tokenizer counts Cyrillic vs English tokens and preserves code block behavior', () => {
  const ruPrompt =
    'Пожалуйста, внимательно проанализируй архитектуру этого модуля и объясни причину ошибки при авторизации пользователя:\n```js\nfunction verifyToken(token) {\n  return token && token.length > 10;\n}\n```';
  const enPrompt =
    'Please carefully analyze the architecture of this module and explain the cause of the user authorization error:\n```js\nfunction verifyToken(token) {\n  return token && token.length > 10;\n}\n```';

  const ruO200k = countTokens(ruPrompt, 'o200k_base');
  const enO200k = countTokens(enPrompt, 'o200k_base');
  assert.ok(ruO200k > enO200k, `Expected Russian o200k tokens (${ruO200k}) > English (${enO200k})`);

  const ruCl100k = countTokens(ruPrompt, 'cl100k_base');
  const enCl100k = countTokens(enPrompt, 'cl100k_base');
  assert.ok(ruCl100k > enCl100k * 1.4, `Expected Russian cl100k tokens (${ruCl100k}) > 1.4x English (${enCl100k})`);

  // Verify OpenAI model-to-encoding resolution and special token handling (<|endoftext|>, <|im_start|>)
  assert.equal(resolveOpenAiEncoding('gpt-6.1-sol'), 'o200k_base');
  assert.equal(resolveOpenAiEncoding('gpt-6-astra'), 'o200k_base');
  assert.equal(resolveOpenAiEncoding('gpt-5.3-codex'), 'o200k_base');
  assert.equal(resolveOpenAiEncoding('gpt-4.1-mini'), 'o200k_base');
  assert.equal(resolveOpenAiEncoding('gpt-4o'), 'o200k_base');
  assert.equal(resolveOpenAiEncoding('o3-mini'), 'o200k_base');
  assert.equal(resolveOpenAiEncoding('gpt-oss-120b'), 'o200k_harmony');
  assert.equal(resolveOpenAiEncoding('gpt-4-turbo'), 'cl100k_base');
  assert.equal(resolveOpenAiEncoding('gpt-3.5-turbo'), 'cl100k_base');
  assert.equal(countTokens('Check <|endoftext|> token', 'o200k_base'), 4);
  assert.equal(countTokens('Check <|endoftext|> token', 'gpt-6.1-sol'), 4);
});

test('calculateTurnEconomics matches exact specification formulas for Actual, Virtual, Net Saved, and Cache Saved', () => {
  // Spec parameters:
  // T_in_uncached = 1000, T_in_cached = 4000, T_out_en = 500
  // History_native = 10000 tokens, History_en = 5000 tokens -> K_ratio = 2.0
  // T_virtual_cached = 4000 * 2.0 = 8000
  // T_virtual_uncached = 1000 * 2.0 = 2000
  // T_virtual_in = 10000, T_virtual_out = 900
  // Pricing (GPT-4o): P_in = $2.50/1M, P_cached = $1.25/1M, P_out = $10.00/1M, C_trans = $0.0005
  const res = calculateTurnEconomics({
    inUncached: 1000,
    inCached: 4000,
    outEn: 500,
    historyNativeTokens: 10000,
    historyEnTokens: 5000,
    virtualOutTokens: 900,
    pricing: {
      presetId: 'custom',
      priceInPerMillion: 2.5,
      priceCachedPerMillion: 1.25,
      priceOutPerMillion: 10.0,
      translatorCostPerRequest: 0.0005,
      translatorPricePerMillion: 0
    }
  });

  assert.equal(res.kRatio, 2.0);
  assert.equal(res.virtualCached, 8000);
  assert.equal(res.virtualUncached, 2000);
  assert.equal(res.virtualIn, 10000);
  assert.equal(res.virtualOut, 900);

  // Cost_actual = (1000 * 2.5 + 4000 * 1.25 + 500 * 10) / 1e6 + 0.0005
  //             = (2500 + 5000 + 5000) / 1e6 + 0.0005 = 0.0125 + 0.0005 = 0.0130
  assert.equal(res.modelActualCost, 0.0125);
  assert.equal(res.translationCost, 0.0005);
  assert.equal(res.costActual, 0.013);

  // Cost_virtual = (2000 * 2.5 + 8000 * 1.25 + 900 * 10) / 1e6
  //              = (5000 + 10000 + 9000) / 1e6 = 0.0240
  assert.equal(res.costVirtual, 0.024);

  // Saved_tokens = (10000 + 900) - (1000 + 4000 + 500) = 10900 - 5500 = 5400
  assert.equal(res.savedTokens, 5400);
  assert.equal(res.inputSavedTokens, 5000);
  assert.equal(res.outputSavedTokens, 400);

  // Saved_USD = 0.0240 - 0.0130 = 0.0110
  assert.equal(res.savedUsd, 0.011);

  // CacheSaved_USD = 4000 * (2.5 - 1.25) / 1e6 = 0.0050
  assert.equal(res.cacheSavedUsd, 0.005);
  assert.equal(res.cacheHitRate, 80.0);
});

test('parseApiUsage extracts OpenAI Responses, Chat Completions, and Anthropic cache metrics', () => {
  const oaiResp = parseApiUsage({
    input_tokens: 2000,
    output_tokens: 300,
    input_tokens_details: { cached_tokens: 1500 }
  });
  assert.equal(oaiResp.hasApiUsage, true);
  assert.equal(oaiResp.hasApiCache, true);
  assert.equal(oaiResp.inCached, 1500);
  assert.equal(oaiResp.inUncached, 500);
  assert.equal(oaiResp.outEn, 300);

  const oaiChat = parseApiUsage({
    prompt_tokens: 1200,
    completion_tokens: 250,
    prompt_tokens_details: { cached_tokens: 800 }
  });
  assert.equal(oaiChat.inCached, 800);
  assert.equal(oaiChat.inUncached, 400);
  assert.equal(oaiChat.outEn, 250);

  const anthropic = parseApiUsage({
    input_tokens: 300,
    cache_read_input_tokens: 900,
    output_tokens: 200
  });
  assert.equal(anthropic.hasApiCache, true);
  assert.equal(anthropic.inCached, 900);
  assert.equal(anthropic.inUncached, 300);
  assert.equal(anthropic.totalIn, 1200);
  assert.equal(anthropic.outEn, 200);
});

test('TokenEconomicsEngine computes local prefix cache fallback, persists state across restarts, and exports CSV/JSON', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-translate-econ-'));
  try {
    const engine1 = new TokenEconomicsEngine({ dataDir: tmp });
    engine1.setPricing({ presetId: 'claude-3.7-sonnet' });

    // Turn 1: Initial Russian user message -> translated to English
    const rawTurn1 = {
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Привет! Объясни подробно, как работает кэширование префиксов в больших языковых моделях.' }] }
      ]
    };
    const enTurn1 = {
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hello! Explain in detail how prefix caching works in large language models.' }] }
      ]
    };
    const ctx1 = engine1.prepareTurnContext({
      threadId: 'thread_A',
      rawRequestBody: rawTurn1,
      translatedRequestBody: enTurn1
    });
    assert.equal(ctx1.localCachedTokens, 0);
    assert.ok(ctx1.historyNativeTokens > ctx1.historyEnTokens);

    const rec1 = engine1.recordTurn({
      threadId: 'thread_A',
      model: 'claude-3.7-sonnet',
      turnContext: ctx1,
      apiUsage: null, // Force local token & cache calculation
      replyEnText: 'Prefix caching stores KV-cache states for shared prompt prefixes.',
      replyNativeText: 'Кэширование префиксов сохраняет состояния KV-кэша для общих префиксов запроса.'
    });
    assert.equal(rec1.step, 1);
    assert.equal(rec1.inCached, 0);
    assert.ok(rec1.inUncached > 0);
    assert.ok(rec1.savedTokens > 0);
    assert.ok(rec1.savedUsd > 0);

    // Turn 2: Multi-turn request where API omits cached_tokens -> local prefix matcher detects cached prefix!
    const rawTurn2 = {
      input: [
        ...rawTurn1.input,
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Кэширование префиксов сохраняет состояния KV-кэша для общих префиксов запроса.' }] },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Приведи пример расчёта экономии на втором шаге диалога.' }] }
      ]
    };
    const enTurn2 = {
      input: [
        ...enTurn1.input,
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Prefix caching stores KV-cache states for shared prompt prefixes.' }] },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Give an example of calculating savings on the second dialogue step.' }] }
      ]
    };
    const ctx2 = engine1.prepareTurnContext({
      threadId: 'thread_A',
      rawRequestBody: rawTurn2,
      translatedRequestBody: enTurn2
    });
    assert.ok(ctx2.localCachedTokens > 0, 'Expected local prefix matcher to detect cached tokens from Turn 1');

    const rec2 = engine1.recordTurn({
      threadId: 'thread_A',
      model: 'claude-3.7-sonnet',
      turnContext: ctx2,
      apiUsage: { prompt_tokens: ctx2.fullEnTokens, completion_tokens: 18 }, // No cached_tokens field from API
      replyEnText: 'On the second step, the first two messages are read from cache at a 90% discount.',
      replyNativeText: 'На втором шаге первые два сообщения читаются из кэша со скидкой 90%.'
    });
    assert.equal(rec2.step, 2);
    assert.equal(rec2.cacheSource, 'local_prefix');
    assert.equal(rec2.inCached, ctx2.localCachedTokens);
    assert.ok(rec2.cacheSavedUsd > 0);

    // Verify persistence by instantiating a new TokenEconomicsEngine on the same directory
    const engine2 = new TokenEconomicsEngine({ dataDir: tmp });
    const dash = engine2.getDashboardData();
    assert.equal(dash.kpi.turnsCount, 2);
    assert.equal(dash.pricing.presetId, 'claude-3.7-sonnet');
    assert.equal(dash.series.length, 2);
    assert.ok(dash.kpi.totalSavedTokens > 0 || dash.kpi.tokensSavedTotal > 0);
    assert.ok(dash.daily.length >= 1);

    // Verify CSV and JSON export
    const csvExport = engine2.exportData('csv');
    assert.equal(csvExport.format, 'csv');
    assert.match(csvExport.content, /step,at,threadId,model,inCached/);
    assert.equal(csvExport.content.trim().split('\n').length, 3);

    const jsonExport = engine2.exportData('json');
    assert.equal(jsonExport.format, 'json');
    const parsedExport = JSON.parse(jsonExport.content);
    assert.equal(parsedExport.kpi.turnsCount, 2);

    // Verify Reset Session Stats
    const afterReset = engine2.resetSession();
    assert.equal(afterReset.kpi.turnsCount, 0);
    assert.equal(afterReset.recentTurns.length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('gateway automatically records token economics on intercepted turns and serves dashboard actions', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-translate-gw-econ-'));
  let mockTranslator;
  let mockAgent;
  let gw;

  try {
    const dataDir = path.join(tmp, 'data');
    const codexHome = path.join(tmp, 'codex');
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(path.join(codexHome, 'config.toml'), 'model = "gpt-5-codex"\n');

    mockTranslator = http.createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'translator/fast', name: 'Fast Translator', capabilities: { tool_calling: true } }] }));
        return;
      }
      if (req.method === 'POST' && req.url === '/v1/responses') {
        let raw = '';
        for await (const c of req) raw += c;
        const body = JSON.parse(raw);
        const payload = JSON.parse(body.input?.at(-1)?.content?.[0]?.text || '{}');
        const target = payload.targetLanguage;
        const parts = (payload.parts || []).map(p =>
          target === 'en'
            ? 'Explain how prompt caching reduces token costs in large models.'
            : 'Кэширование промптов снижает стоимость входных токенов на 90 процентов при повторных запросах.'
        );
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
      for await (const _ of req) {}
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const reply = 'Prompt caching reduces input token costs by 90 percent on repeated requests.';
      const events = [
        { type: 'response.created', response: { id: 'r1', status: 'in_progress', output: [] } },
        { type: 'response.output_item.added', output_index: 0, item: { id: 'm1', type: 'message', role: 'assistant', content: [] } },
        { type: 'response.output_text.delta', item_id: 'm1', output_index: 0, content_index: 0, delta: reply },
        { type: 'response.output_item.done', output_index: 0, item: { id: 'm1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: reply }] } },
        {
          type: 'response.completed',
          response: {
            id: 'r1',
            status: 'completed',
            usage: {
              input_tokens: 1500,
              output_tokens: 120,
              input_tokens_details: { cached_tokens: 1000 }
            },
            output: [{ id: 'm1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: reply }] }]
          }
        }
      ];
      for (const ev of events) {
        res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
      }
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
      model: 'translator/fast',
      autoLanguage: true,
      targetLanguage: 'ru'
    });

    const res = await fetch(`http://127.0.0.1:${gw.port}/v1/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer eyJ_test'
      },
      body: JSON.stringify({
        model: 'gpt-5-codex',
        stream: true,
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Объясни подробно, как кэширование промптов снижает затраты на токены в больших моделях.' }]
          }
        ]
      })
    });
    assert.equal(res.status, 200);
    await res.text();

    const snap = await gw.dispatch('snapshot');
    assert.ok(snap.economics);
    assert.equal(snap.economics.kpi.turnsCount, 1);
    assert.equal(snap.economics.kpi.totalInCached, 1000);
    assert.equal(snap.economics.kpi.totalInUncached, 500);
    assert.equal(snap.economics.kpi.totalOutEn, 120);
    assert.ok(snap.economics.kpi.tokensSavedTotal > 0);
    assert.ok(snap.economics.kpi.netSavedUsd > 0);

    const updatedPricing = await gw.dispatch('saveEconomicsPricing', { presetId: 'claude-3.7-sonnet' });
    assert.equal(updatedPricing.pricing.presetId, 'claude-3.7-sonnet');
    assert.equal(updatedPricing.economics.kpi.turnsCount, 1);

    const exportedCsv = await gw.dispatch('exportEconomics', { format: 'csv' });
    assert.equal(exportedCsv.format, 'csv');
    assert.match(exportedCsv.content, /gpt-5-codex/);

    const resetRes = await gw.dispatch('resetEconomicsSession', {});
    assert.equal(resetRes.economics.kpi.turnsCount, 0);
  } finally {
    if (gw) await gw.close();
    if (mockTranslator) await new Promise(r => mockTranslator.close(r));
    if (mockAgent) await new Promise(r => mockAgent.close(r));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('TokenEconomicsEngine auto-detects Codex models (gpt-6.1-sol, gpt-6-astra, gpt-6-luna), supports per-model custom pricing, and separates 4 scenario blocks + consolidated total', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-translate-codex-models-'));
  try {
    const dataDir = path.join(tmp, 'data');
    const codexHome = path.join(tmp, 'codex');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(codexHome, { recursive: true });

    fs.writeFileSync(
      path.join(codexHome, 'config.toml'),
      'model = "gpt-6.1-sol"\nmodel_reasoning_effort = "medium"\nservice_tier = "priority"\n'
    );
    fs.writeFileSync(
      path.join(codexHome, 'models_cache.json'),
      JSON.stringify({
        models: [
          { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', description: 'Latest workhorse model', context_window: 500000 },
          { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', description: 'Frontier intelligence', context_window: 272000 },
          { slug: 'gpt-6-luna', display_name: 'GPT-6-Luna', description: 'Fast and affordable', context_window: 272000 }
        ]
      })
    );

    const engine = new TokenEconomicsEngine({ dataDir, codexHome });
    const initialDash = engine.getDashboardData();
    assert.equal(initialDash.activeCodexModel, 'gpt-6.1-sol');
    assert.equal(initialDash.autoDetectModel, true);
    assert.equal(initialDash.pricing.presetId, 'gpt-6.1-sol');
    assert.ok(initialDash.modelRates.some(m => m.id === 'gpt-6.1-sol'));
    assert.ok(initialDash.modelRates.some(m => m.id === 'gpt-6-astra'));
    assert.ok(initialDash.modelRates.some(m => m.id === 'gpt-6-luna'));

    // Customize gpt-6-astra per-model rates (Input $6.00/1M, Cache $0.60/1M (90% off), Output $24.00/1M)
    const customAstra = engine.setModelRate('gpt-6-astra', {
      priceInPerMillion: 6.0,
      priceCachedPerMillion: 0.6,
      priceOutPerMillion: 24.0
    });
    assert.equal(customAstra.customized, true);
    assert.equal(customAstra.priceInPerMillion, 6.0);
    assert.equal(customAstra.priceCachedPerMillion, 0.6);
    assert.equal(customAstra.cacheDiscountPercent, 90);
    assert.equal(customAstra.priceOutPerMillion, 24.0);

    // Record a turn where the user switched to gpt-6-astra in ChatGPT/Codex
    const turn = engine.recordTurn({
      threadId: 't_astra',
      model: 'gpt-6-astra',
      turnContext: {
        historyNativeTokens: 4000,
        historyEnTokens: 2000,
        fullEnTokens: 2000,
        localCachedTokens: 1000,
        fingerprints: []
      },
      apiUsage: {
        input_tokens: 2000,
        output_tokens: 500,
        input_tokens_details: { cached_tokens: 1000 }
      },
      replyEnText: 'Detailed architectural review.',
      replyNativeText: 'Подробный архитектурный обзор системы и рекомендации по безопасности.'
    });

    // Verify turn used gpt-6-astra's custom rate ($6 / $0.60 / $24):
    // Actual with cache: (1000 * 6 + 1000 * 0.6 + 500 * 24) / 1e6 = (6000 + 600 + 12000) / 1e6 = 0.0186
    // Actual no cache:   (2000 * 6 + 500 * 24) / 1e6 = (12000 + 12000) / 1e6 = 0.0240
    assert.equal(turn.model, 'gpt-6-astra');
    assert.equal(turn.costActual, 0.0186);
    assert.equal(turn.costActualNoCache, 0.024);

    // Check the 4 separated blocks + consolidated summary
    const dash = engine.getDashboardData();
    assert.equal(dash.activeCodexModel, 'gpt-6-astra');
    const { blocks } = dash;
    assert.ok(blocks.withoutTranslationNoCache);
    assert.ok(blocks.withoutTranslationWithCache);
    assert.ok(blocks.withTranslationNoCache);
    assert.ok(blocks.withTranslationWithCache);
    assert.ok(blocks.consolidatedSummary);

    // Block 1 (Native No Cache) > Block 2 (Native With Cache) > Block 4 (EN With Cache)
    assert.ok(blocks.withoutTranslationNoCache.totalCostUsd > blocks.withoutTranslationWithCache.totalCostUsd);
    assert.ok(blocks.withTranslationNoCache.totalCostUsd > blocks.withTranslationWithCache.totalCostUsd);
    assert.ok(blocks.withoutTranslationWithCache.totalCostUsd > blocks.withTranslationWithCache.totalCostUsd);

    // Consolidated summary matches Block 2 vs Block 4 and Block 1 vs Block 3
    assert.equal(
      blocks.consolidatedSummary.withoutTranslation.finalTotalCostUsd,
      blocks.withoutTranslationWithCache.totalCostUsd
    );
    assert.equal(
      blocks.consolidatedSummary.withTranslation.finalTotalCostUsd,
      blocks.withTranslationWithCache.totalCostUsd
    );
    assert.equal(
      blocks.consolidatedSummary.delta.netSavedWithCacheUsd,
      Number((blocks.withoutTranslationWithCache.totalCostUsd - blocks.withTranslationWithCache.totalCostUsd).toFixed(6))
    );

    // Record a second turn 3 days ago on gpt-6.1-sol and a third turn 15 days ago on gpt-6-luna
    const nowMs = Date.now();
    const threeDaysAgo = new Date(nowMs - 3 * 24 * 60 * 60 * 1000).toISOString();
    const fifteenDaysAgo = new Date(nowMs - 15 * 24 * 60 * 60 * 1000).toISOString();

    engine.recordTurn({
      threadId: 't_sol',
      model: 'gpt-6.1-sol',
      at: threeDaysAgo,
      turnContext: { historyNativeTokens: 3000, historyEnTokens: 2000, fullEnTokens: 2000, localCachedTokens: 1500, fingerprints: [] },
      apiUsage: { input_tokens: 2000, output_tokens: 300, input_tokens_details: { cached_tokens: 1500 } },
      replyEnText: 'Check passed.',
      replyNativeText: 'Проверка успешно пройдена.'
    });

    engine.recordTurn({
      threadId: 't_luna',
      model: 'gpt-6-luna',
      at: fifteenDaysAgo,
      turnContext: { historyNativeTokens: 1500, historyEnTokens: 1000, fullEnTokens: 1000, localCachedTokens: 800, fingerprints: [] },
      apiUsage: { input_tokens: 1000, output_tokens: 200, input_tokens_details: { cached_tokens: 800 } },
      replyEnText: 'Done.',
      replyNativeText: 'Выполнено.'
    });

    const dashWithPeriods = engine.getDashboardData();
    assert.equal(dashWithPeriods.periods.today.kpi.turnsCount, 1);
    assert.equal(dashWithPeriods.periods.today.byModel.length, 1);
    assert.equal(dashWithPeriods.periods.today.byModel[0].model, 'gpt-6-astra');

    assert.equal(dashWithPeriods.periods.week.kpi.turnsCount, 2);
    assert.equal(dashWithPeriods.periods.week.byModel.length, 2);

    assert.equal(dashWithPeriods.periods.month.kpi.turnsCount, 3);
    assert.equal(dashWithPeriods.periods.month.byModel.length, 3);
    assert.ok(dashWithPeriods.byModel.every(m => m.totalActualTokens > 0 && m.savedTokens > 0 && m.savedUsd > 0));

    // Reset gpt-6-astra rate back to default ($5 / $0.50 / $20)
    const resetAstra = engine.resetModelRate('gpt-6-astra');
    assert.equal(resetAstra.customized, false);
    assert.equal(resetAstra.priceInPerMillion, 5.0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Codex effort sync tracks config.toml & live requests accurately and tariff changes preserve past days', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-translate-effort-sync-'));
  try {
    const dataDir = path.join(tmp, 'data');
    const codexHome = path.join(tmp, 'codex');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(codexHome, { recursive: true });

    const cfgPath = path.join(codexHome, 'config.toml');
    const gsPath = path.join(codexHome, '.codex-global-state.json');

    // 1. User selects gpt-6-luna with effort = "medium" in Codex UI (written to config.toml via config/batchWrite)
    fs.writeFileSync(cfgPath, 'model = "gpt-6-luna"\nmodel_reasoning_effort = "medium"\n');
    // Simulate Electron writing .codex-global-state.json LATER (on window blur) with an older "high" entry in recent list
    fs.writeFileSync(
      gsPath,
      JSON.stringify({
        'electron-persisted-atom-state': {
          'composer-recent-model-configurations-v1': [
            { model: 'gpt-6-luna', reasoningEffort: 'high', serviceTier: null }
          ]
        }
      })
    );
    const futureTime = new Date(Date.now() + 10000);
    fs.utimesSync(gsPath, futureTime, futureTime);

    const engine = new TokenEconomicsEngine({ dataDir, codexHome });
    const dash1 = engine.getDashboardData();
    assert.equal(dash1.activeCodexModel, 'gpt-6-luna');
    // Must reflect "medium" from config.toml, NOT the stale "high" from .codex-global-state.json!
    assert.equal(dash1.codexReasoningEffort, 'medium');

    // 2. Live request arrives with explicit effort "xhigh"
    const eff1 = engine.resolveEffectiveRequestSettings({
      threadId: 'thread_1',
      model: 'gpt-6.1-sol',
      reasoningEffort: 'xhigh'
    });
    assert.equal(eff1.reasoningEffort, 'xhigh');
    assert.equal(engine.getDashboardData().codexReasoningEffort, 'xhigh');

    // 3. While in thread_1, user changes effort in Codex UI (config.toml updated to "max")
    fs.writeFileSync(cfgPath, 'model = "gpt-6.1-sol"\nmodel_reasoning_effort = "max"\n');
    assert.equal(engine.getDashboardData().codexReasoningEffort, 'max');

    // Next turn on thread_1 still sends cached "xhigh" from thread creation -> gateway upgrades to "max"
    const eff2 = engine.resolveEffectiveRequestSettings({
      threadId: 'thread_1',
      model: 'gpt-6.1-sol',
      reasoningEffort: 'xhigh'
    });
    assert.equal(eff2.reasoningEffort, 'max');

    // 4. Verify historical tariff preservation: record one turn 2 days ago and one turn today
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const todayIso = new Date().toISOString();

    const pastTurn = engine.recordTurn({
      threadId: 't_hist',
      model: 'gpt-6.1-sol',
      reasoningEffort: 'high',
      at: twoDaysAgo,
      turnContext: { historyNativeTokens: 2000, historyEnTokens: 1000, fullEnTokens: 1000, localCachedTokens: 0, fingerprints: [] },
      apiUsage: { input_tokens: 1000, output_tokens: 500, input_tokens_details: { cached_tokens: 0 } },
      replyEnText: 'Past reply.',
      replyNativeText: 'Прошлый ответ.'
    });
    const todayTurn = engine.recordTurn({
      threadId: 't_hist',
      model: 'gpt-6.1-sol',
      reasoningEffort: 'max',
      at: todayIso,
      turnContext: { historyNativeTokens: 2000, historyEnTokens: 1000, fullEnTokens: 1000, localCachedTokens: 0, fingerprints: [] },
      apiUsage: { input_tokens: 1000, output_tokens: 500, input_tokens_details: { cached_tokens: 0 } },
      replyEnText: 'Today reply.',
      replyNativeText: 'Сегодняшний ответ.'
    });

    const initialCostPast = pastTurn.costActual;
    const initialCostToday = todayTurn.costActual;
    assert.equal(initialCostPast, initialCostToday);

    // Change gpt-6.1-sol rate today (double the prices)
    engine.setModelRate('gpt-6.1-sol', {
      priceInPerMillion: 5.0,
      priceCachedPerMillion: 0.5,
      priceOutPerMillion: 20.0
    });

    const storeAfter = engine.loadStore();
    const updatedPastTurn = storeAfter.turns.find(t => t.id === pastTurn.id);
    const updatedTodayTurn = storeAfter.turns.find(t => t.id === todayTurn.id);
    // Past day's turn keeps its historical cost, while today's turn uses the new rate
    assert.equal(updatedPastTurn.costActual, initialCostPast);
    assert.equal(updatedTodayTurn.costActual, Number((initialCostToday * 2).toFixed(8)));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('live OpenAI pricing parser, 4-hour launch sync, 30m/12h cache writes, >272K long context, mini/nano rates, and non-inflated math', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-translate-live-pricing-'));
  try {
    // 1. Verify mini/nano/terra fallback rates are not shadowed by parent model families
    assert.equal(inferDefaultModelRate('gpt-5-mini').priceInPerMillion, 0.25);
    assert.equal(inferDefaultModelRate('gpt-5-nano').priceInPerMillion, 0.05);
    assert.equal(inferDefaultModelRate('gpt-5.4-mini').priceInPerMillion, 0.75);
    assert.equal(inferDefaultModelRate('gpt-5.4-nano').priceInPerMillion, 0.2);
    assert.equal(inferDefaultModelRate('gpt-4.1-mini').priceInPerMillion, 0.4);
    assert.equal(inferDefaultModelRate('gpt-4.1-nano').priceInPerMillion, 0.1);
    assert.equal(inferDefaultModelRate('o4-mini').priceCachedPerMillion, 0.275);
    assert.equal(inferDefaultModelRate('gpt-6.1-terra').priceInPerMillion, 1.0);
    assert.equal(inferDefaultModelRate('gpt-6.1-terra').priceCachedPerMillion, 0.05);
    assert.equal(inferDefaultModelRate('gpt-6.1-terra').priceCacheWrite30mPerMillion, 1.25);
    assert.equal(inferDefaultModelRate('gpt-6.1-terra').priceCacheWrite12hPerMillion, 2.5);

    // 2. Verify parseOpenAiPricingHtml parses <astro-island> JSON props (Standard, Fast, Batch, Ultrafast, 30m & 12h write)
    const mockPricingHtml = `
      <!DOCTYPE html><html><body>
      <astro-island props="{&quot;tier&quot;:[0,&quot;standard&quot;],&quot;rows&quot;:[1,[[1,[[0,&quot;gpt-6-astra&quot;],[0,10],[0,1],[0,12.5],[0,50]]],[1,[[0,&quot;gpt-6.1-sol&quot;],[0,2],[0,0.1],[0,2.5],[0,10]]],[1,[[0,&quot;gpt-6.1-terra&quot;],[0,1],[0,0.05],[0,1.25],[0,5]]],[1,[[0,&quot;gpt-6-luna&quot;],[0,0.1],[0,0.01],[0,0.125],[0,0.5]]]]]}" opts="{&quot;name&quot;:&quot;TextTokenPricingTables&quot;,&quot;value&quot;:true}"></astro-island>
      <astro-island props="{&quot;tier&quot;:[0,&quot;fast&quot;],&quot;rows&quot;:[1,[[1,[[0,&quot;gpt-6-astra&quot;],[0,20],[0,2],[0,25],[0,100]]]]]}" opts="{&quot;name&quot;:&quot;TextTokenPricingTables&quot;,&quot;value&quot;:true}"></astro-island>
      <astro-island props="{&quot;headings&quot;:[1,[[0,&quot;Category&quot;],[0,&quot;Model&quot;],[0,&quot;Input&quot;],[0,&quot;Output&quot;],[0,&quot;Cached input&quot;]]],&quot;groups&quot;:[1,[[0,{&quot;rows&quot;:[1,[[1,[[0,&quot;gpt-5.3-codex&quot;],[0,&quot;$1.75&quot;],[0,&quot;$14.00&quot;],[0,&quot;$0.175&quot;]]]]]}]]]}" opts="{&quot;name&quot;:&quot;GroupedPricingTable&quot;,&quot;value&quot;:true}"></astro-island>
      </body></html>
    `;
    const parsed = parseOpenAiPricingHtml(mockPricingHtml);
    assert.equal(parsed.count, 5);
    assert.equal(parsed.models['gpt-6-astra'].priceInPerMillion, 10);
    assert.equal(parsed.models['gpt-6-astra'].priceCachedPerMillion, 1);
    assert.equal(parsed.models['gpt-6-astra'].priceCacheWrite30mPerMillion, 12.5);
    assert.equal(parsed.models['gpt-6-astra'].priceCacheWrite12hPerMillion, 25);
    assert.equal(parsed.models['gpt-6-astra'].priceOutPerMillion, 50);
    assert.equal(parsed.models['gpt-6-astra'].tiers.fast.priceInPerMillion, 20);
    assert.equal(parsed.models['gpt-6-astra'].longContext.priceInPerMillion, 20);
    assert.equal(parsed.models['gpt-6-astra'].longContext.priceOutPerMillion, 75);
    assert.equal(parsed.models['gpt-6.1-sol'].priceInPerMillion, 2);
    assert.equal(parsed.models['gpt-6.1-sol'].priceCachedPerMillion, 0.1);
    assert.equal(parsed.models['gpt-6.1-sol'].cacheDiscountPercent, 95);
    assert.equal(parsed.models['gpt-6.1-sol'].priceCacheWrite30mPerMillion, 2.5);
    assert.equal(parsed.models['gpt-6.1-sol'].priceCacheWrite12hPerMillion, 5);
    assert.equal(parsed.models['gpt-5.3-codex'].priceInPerMillion, 1.75);
    assert.equal(parsed.models['gpt-5.3-codex'].priceOutPerMillion, 14);

    // 3. Verify launch-time sync & 4-hour timer reset in TokenEconomicsEngine
    const engine = new TokenEconomicsEngine({ dataDir: tmp });
    let fetchCount = 0;
    const mockPricingFetch = async () => {
      fetchCount++;
      return new Response(mockPricingHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    };
    const syncRes1 = await engine.startAutoPricingSync({
      fetchImpl: mockPricingFetch,
      intervalMs: 4 * 60 * 60 * 1000,
      runImmediately: true
    });
    assert.equal(syncRes1.synced, true);
    assert.equal(fetchCount, 1);

    // Re-launching always triggers a fresh parse and resets nextPricingSyncAt
    const syncRes2 = await engine.startAutoPricingSync({
      fetchImpl: mockPricingFetch,
      intervalMs: 4 * 60 * 60 * 1000,
      runImmediately: true
    });
    engine.stopAutoPricingSync();
    assert.equal(syncRes2.synced, true);
    assert.equal(fetchCount, 2);

    const dashAfterSync = engine.getDashboardData();
    const astraRate = dashAfterSync.modelRates.find(m => m.id === 'gpt-6-astra');
    assert.equal(astraRate.priceInPerMillion, 10);
    assert.equal(astraRate.priceCacheWrite30mPerMillion, 12.5);
    assert.equal(astraRate.priceCacheWrite12hPerMillion, 25);

    // 4. Verify 30m write vs 12h write non-additive billing and time-window expiration
    const write30mMetrics = calculateTurnEconomics({
      inUncached: 1000,
      inCached: 2000,
      inCacheWrite: 1000,
      cacheWriteWindow: '30m',
      outEn: 100,
      historyNativeTokens: 3000,
      historyEnTokens: 3000,
      virtualOutTokens: 100,
      pricing: astraRate
    });
    // 1000 written @ $12.50/1M ($0.0125) + 2000 cached read @ $1.00/1M ($0.0020) + 100 out @ $50/1M ($0.0050) = $0.0195
    assert.equal(write30mMetrics.actualCacheWriteCost, 0.0125);
    assert.equal(write30mMetrics.costActual, 0.0195);

    const write12hMetrics = calculateTurnEconomics({
      inUncached: 1000,
      inCached: 2000,
      inCacheWrite: 1000,
      cacheWriteWindow: '12h',
      outEn: 100,
      historyNativeTokens: 3000,
      historyEnTokens: 3000,
      virtualOutTokens: 100,
      pricing: astraRate
    });
    // 1000 written @ $25.00/1M ($0.0250) + 2000 cached read @ $1.00/1M ($0.0020) + 100 out @ $50/1M ($0.0050) = $0.0320
    assert.equal(write12hMetrics.actualCacheWriteCost, 0.025);
    assert.equal(write12hMetrics.costActual, 0.032);

    // 5. Verify non-inflated input scaling when nonTranslatedInTokens (system prompt / tools) is present
    const nonInflated = calculateTurnEconomics({
      inUncached: 1000,
      inCached: 9000,
      nonTranslatedInTokens: 9000, // 9000 tokens are English system prompt / tool outputs, 1000 tokens are dialogue
      outEn: 200,
      historyNativeTokens: 2000,
      historyEnTokens: 1000, // Dialogue K_ratio = 2.0
      virtualOutTokens: 400,
      pricing: astraRate
    });
    // Only the 1000 dialogue tokens expand by 2.0x (+1000 tokens), NOT the 9000 system tokens!
    assert.equal(nonInflated.inputSavedTokens, 1000);
    assert.equal(nonInflated.virtualIn, 11000);

    // 6. Verify >272K Long Context automatic tariff upgrade and 30m/12h thread time-binding
    const t0 = Date.parse('2026-10-31T10:00:00Z');
    const turnShort = engine.recordTurn({
      threadId: 'thread_ttl',
      model: 'gpt-6-astra',
      at: new Date(t0).toISOString(),
      turnContext: {
        historyNativeTokens: 2000,
        historyEnTokens: 1000,
        fullEnTokens: 1000,
        localCachedTokens: 800,
        fingerprints: ['fp1']
      },
      apiUsage: { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 800 } },
      replyEnText: 'Short context reply.',
      replyNativeText: 'Ответ короткого контекста.'
    });
    assert.equal(turnShort.contextLengthTier, 'short');
    assert.equal(turnShort.appliedPricing.priceInPerMillion, 10);

    // 45 minutes later (>30m, <=12h) WITH API reporting cached_tokens > 0 -> binds thread to 12h window
    const t45m = t0 + 45 * 60 * 1000;
    const turn12hLong = engine.recordTurn({
      threadId: 'thread_ttl',
      model: 'gpt-6-astra',
      at: new Date(t45m).toISOString(),
      turnContext: {
        historyNativeTokens: 300000,
        historyEnTokens: 280000,
        fullEnTokens: 280000,
        localCachedTokens: 200000,
        fingerprints: ['fp1', 'fp2']
      },
      apiUsage: {
        input_tokens: 280000,
        output_tokens: 500,
        output_tokens_details: { reasoning_tokens: 400 },
        input_tokens_details: { cached_tokens: 200000, cache_write_tokens: 10000 }
      },
      replyEnText: 'Long context reply.',
      replyNativeText: 'Ответ длинного контекста.'
    });
    assert.equal(turn12hLong.cacheWriteWindow, '12h');
    assert.equal(turn12hLong.contextLengthTier, 'long');
    // Long context (>272K) for gpt-6-astra doubles Input to $20 and Output to $75
    assert.equal(turn12hLong.appliedPricing.priceInPerMillion, 20);
    assert.equal(turn12hLong.appliedPricing.priceOutPerMillion, 75);

    // Verify period-scoped blocks, inputStructure, series, and recentTurns exist on every period
    const fullDash = engine.getDashboardData();
    for (const pKey of ['today', 'week', 'month', 'all']) {
      assert.ok(fullDash.periods[pKey].blocks?.consolidatedSummary);
      assert.ok(fullDash.periods[pKey].inputStructure);
      assert.ok(Array.isArray(fullDash.periods[pKey].series));
      assert.ok(Array.isArray(fullDash.periods[pKey].recentTurns));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
