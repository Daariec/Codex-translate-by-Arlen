import http from 'node:http';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  efforts,
  normalizeURL,
  parseModels,
  normalizeModel,
  translateBridgeConfig,
  isOwnTranslateBridgeUrl,
  hash,
  jsonRead,
  writeJSON,
  atomicWrite,
  defaultDataDir,
  defaultCodexHome,
  psPath,
  credential
} from './lib.mjs';
import {
  routingStatus,
  switchRoute,
  restartCodexDesktop,
  ensurePluginEnabledInCodex as ensurePluginEnabledInCodexRouting,
  ensureTrayRunning,
  syncMsixLocalCache
} from './routing.mjs';
import { ProtocolError, sseEvents } from './protocol.mjs';
import {
  LANGUAGES,
  readTranslatorSettings,
  saveTranslatorSettings,
  readTranslatorState,
  isCompactionRequest,
  isAutoReviewRequest,
  isInternalHelperRequest,
  isTranslatorSelfCall,
  translateText,
  translateRequestInput,
  translateResponsesSseStream,
  translateResponsesJsonOutput
} from './translator.mjs';
import { TokenEconomicsEngine, countTokens } from './economics.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const pkg = jsonRead(path.join(root, 'package.json'), { name: 'codex-translate', version: '1.0.0' });
const helper = path.join(root, 'Credential.ps1');

export const DEFAULT_GATEWAY_PORT = 24131;

function modelKey(connectionId, modelId) {
  return `${connectionId}::${modelId}`;
}

function connFingerprint(c) {
  return hash(JSON.stringify([c.kind || 'omniroute', c.baseURL || c.baseUrl || '', c.credentialFile || ''])).slice(0, 24);
}

function apiEndpoint(baseUrl, suffix) {
  const norm = normalizeURL(baseUrl);
  return norm.replace(/\/+$/, '') + '/' + suffix.replace(/^\/+/, '');
}

async function readRequestBuffer(req, maxBytes = 64 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) throw new ProtocolError('Request body too large', 413);
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function decodeRequestBuffer(rawBuf, contentEncoding = '') {
  if (!rawBuf || rawBuf.length === 0) return '';
  const enc = String(contentEncoding || '').toLowerCase().trim();
  const isZstdMagic =
    rawBuf.length >= 4 &&
    rawBuf[0] === 0x28 &&
    rawBuf[1] === 0xb5 &&
    rawBuf[2] === 0x2f &&
    rawBuf[3] === 0xfd;
  if (enc === 'zstd' || isZstdMagic) {
    return zlib.zstdDecompressSync(rawBuf).toString('utf8');
  }
  if (enc === 'gzip' || (rawBuf.length >= 2 && rawBuf[0] === 0x1f && rawBuf[1] === 0x8b)) {
    return zlib.gunzipSync(rawBuf).toString('utf8');
  }
  if (enc === 'br') {
    return zlib.brotliDecompressSync(rawBuf).toString('utf8');
  }
  if (enc === 'deflate') {
    return zlib.inflateSync(rawBuf).toString('utf8');
  }
  return rawBuf.toString('utf8');
}

export async function createGatewayServer({
  dataDir = defaultDataDir(pkg.name),
  codexHome = defaultCodexHome(),
  port = DEFAULT_GATEWAY_PORT,
  upstreamBaseUrl = null,
  fetchImpl = fetch,
  keyCodec = null,
  autoSyncPricing = undefined,
  pricingSyncIntervalMs = undefined,
  pricingUrl = undefined
} = {}) {
  dataDir = path.resolve(dataDir);
  codexHome = path.resolve(codexHome);
  fs.mkdirSync(dataDir, { recursive: true });

  const stateFile = path.join(dataDir, 'state.json');
  const modelStateFile = path.join(dataDir, 'model-state.json');
  const uiStateFile = path.join(dataDir, 'provider-ui-state.json');
  const gatewayInfoFile = path.join(dataDir, 'gateway.json');
  const existingGatewayInfo = jsonRead(gatewayInfoFile, null);
  const economics = new TokenEconomicsEngine({ dataDir, codexHome });
  const shouldAutoSyncPricing = autoSyncPricing !== undefined ? !!autoSyncPricing : !upstreamBaseUrl;
  if (shouldAutoSyncPricing) {
    void economics
      .startAutoPricingSync({
        intervalMs: pricingSyncIntervalMs,
        fetchImpl,
        pricingUrl,
        runImmediately: true
      })
      .then(() => syncMsixLocalCache(dataDir))
      .catch(() => {});
  }
  const adminToken =
    typeof existingGatewayInfo?.adminToken === 'string' && existingGatewayInfo.adminToken.length >= 32
      ? existingGatewayInfo.adminToken
      : crypto.randomBytes(32).toString('hex');

  const keyCache = new Map();
  const codec = keyCodec || {
    protect: (id, plainKey) => {
      const credFile = path.join(dataDir, 'credentials', `${id}-${crypto.randomUUID()}.dpapi`);
      credential(helper, 'Protect', credFile, plainKey);
      keyCache.set(credFile, plainKey);
      return credFile;
    },
    read: credFile => {
      if (!credFile) return '';
      if (keyCache.has(credFile)) return keyCache.get(credFile);
      const plain = credential(helper, 'Read', credFile);
      keyCache.set(credFile, plain);
      return plain;
    }
  };

  function loadState() {
    const state = jsonRead(stateFile, { version: 1, selected: null, desiredRoute: 'translate', connections: {} });
    state.connections ||= {};
    for (const [id, conn] of Object.entries(state.connections)) {
      conn.id = id;
      conn.name = conn.name || (id === 'default' ? 'Translator API' : id);
      conn.kind = conn.kind || 'omniroute';
      conn.baseURL = conn.baseURL || conn.baseUrl || '';
      conn.baseUrl = conn.baseURL;
      if (Array.isArray(conn.models)) {
        conn.models = conn.models.map(normalizeModel);
      } else {
        conn.models = [];
      }
    }
    return state;
  }

  function saveState(state) {
    const clean = structuredClone(state);
    for (const conn of Object.values(clean.connections || {})) {
      if (conn && typeof conn === 'object') {
        conn.baseURL = conn.baseURL || conn.baseUrl || '';
        delete conn.baseUrl;
      }
    }
    writeJSON(stateFile, clean);
    syncMsixLocalCache(dataDir);
  }

  function loadModelState(state) {
    const ms = jsonRead(modelStateFile, { version: 1, models: {} });
    ms.models ||= {};
    let changed = false;
    for (const [cid, conn] of Object.entries(state.connections)) {
      const fp = connFingerprint(conn);
      const eligible = (conn.models || []).filter(m => m.eligible);
      const anyExplicit = eligible.some(m => ms.models[modelKey(cid, m.id)]?.enabled !== undefined);
      if (!anyExplicit && eligible.length > 0) {
        const defaultModel = conn.model || eligible[0].id;
        for (const m of eligible.slice(0, 25)) {
          const k = modelKey(cid, m.id);
          ms.models[k] = {
            ...ms.models[k],
            enabled: true,
            fingerprint: fp
          };
        }
        const defKey = modelKey(cid, defaultModel);
        ms.models[defKey] = {
          ...ms.models[defKey],
          enabled: true,
          fingerprint: fp
        };
        changed = true;
      }
    }
    if (changed) writeJSON(modelStateFile, ms);
    return ms;
  }

  function saveModelState(ms) {
    writeJSON(modelStateFile, ms);
    syncMsixLocalCache(dataDir);
  }

  let actualPort = port;

  function currentGatewayBaseUrl() {
    return `http://127.0.0.1:${actualPort || DEFAULT_GATEWAY_PORT}/v1`;
  }

  function ensureInterceptActiveIfNeeded(state) {
    if (state.desiredRoute === 'base') return;
    const status = routingStatus(dataDir, codexHome);
    const gwUrl = currentGatewayBaseUrl();
    const cfgPath = path.join(codexHome, 'config.toml');
    const cfgText = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : '';
    if (!status.interceptActive || !cfgText.includes(gwUrl)) {
      try {
        switchRoute({
          route: 'translate',
          dataDir,
          codexHome,
          gatewayBaseUrl: gwUrl,
          generated: translateBridgeConfig(gwUrl),
          force: true
        });
      } catch {}
    }
  }

  let checkJob = null;
  const checkQueue = new Map();

  async function probeModel(conn, modelId, apiKey, signal) {
    const kind = conn.kind || 'omniroute';
    const baseUrl = conn.baseURL || conn.baseUrl;
    const combinedSignal = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
    try {
      let endpoint, request, headers;
      if (kind === 'anthropic') {
        endpoint = apiEndpoint(baseUrl, 'messages');
        request = { model: modelId, stream: false, max_tokens: 32, messages: [{ role: 'user', content: 'Reply OK.' }] };
        headers = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', ...(apiKey ? { 'x-api-key': apiKey } : {}) };
      } else if (kind === 'chat_completions') {
        endpoint = apiEndpoint(baseUrl, 'chat/completions');
        request = { model: modelId, stream: false, max_tokens: 32, messages: [{ role: 'user', content: 'Reply OK.' }] };
        headers = { 'content-type': 'application/json', ...(apiKey ? { authorization: 'Bearer ' + apiKey } : {}) };
      } else {
        endpoint = apiEndpoint(baseUrl, 'responses');
        request = { model: modelId, stream: false, max_output_tokens: 32, input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Reply OK.' }] }] };
        headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(apiKey ? { authorization: 'Bearer ' + apiKey } : {}) };
      }

      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: combinedSignal,
        redirect: 'error'
      });
      if (!response.ok) return { status: 'offline', detail: 'HTTP ' + response.status };

      const ct = response.headers.get('content-type') || '';
      if (ct.includes('text/event-stream')) {
        let text = '';
        for await (const ev of sseEvents(response.body)) {
          if (ev.type === 'response.output_text.delta' && ev.delta) text += ev.delta;
          if (ev.type === 'response.completed') text = text || 'OK';
        }
        return text.trim() ? { status: 'online', detail: 'Получен потоковый ответ' } : { status: 'offline', detail: 'Пустой SSE поток' };
      }

      const data = await response.json();
      const msg = data.choices?.[0]?.message;
      const rawContent = msg?.content;
      const text =
        kind === 'anthropic'
          ? (data.content || []).map(x => x.text || x.thinking || '').join('')
          : kind === 'chat_completions'
            ? (Array.isArray(rawContent) ? rawContent.map(x => x.text || '').join('') : String(rawContent || '')) || String(msg?.reasoning_content || msg?.reasoning || '')
            : (data.output || []).flatMap(x => x.content || x.summary || []).map(x => x.text || '').join('') ||
              (data.status === 'completed' && Array.isArray(data.output) && data.output.length ? 'OK' : '');

      return typeof text === 'string' && text.trim()
        ? { status: 'online', detail: 'Получен текстовый ответ' }
        : { status: 'offline', detail: 'API не вернул текстовый ответ' };
    } catch {
      return {
        status: 'offline',
        detail: signal.aborted ? 'Проверка остановлена' : 'Нет ответа за 30 секунд или ошибка соединения'
      };
    }
  }

  function launchChecks(batchSize = 10) {
    if (checkJob?.running || !checkQueue.size) return;
    const current = {
      id: crypto.randomUUID(),
      running: true,
      total: checkQueue.size,
      done: 0,
      online: 0,
      offline: 0,
      batchSize,
      controller: new AbortController()
    };
    checkJob = current;

    current.promise = (async () => {
      while (checkQueue.size && !current.controller.signal.aborted) {
        const batch = [...checkQueue.values()].slice(0, batchSize);
        const state = loadState();
        const results = await Promise.all(
          batch.map(async item => {
            const conn = state.connections[item.connectionId];
            if (!conn) return { item, conn: null, result: { status: 'offline', detail: 'Подключение удалено' } };
            let key = '';
            try {
              key = conn.credentialFile ? codec.read(conn.credentialFile) : '';
            } catch {}
            const result = await probeModel(conn, item.id, key, current.controller.signal);
            return { item, conn, result };
          })
        );

        const freshState = loadState();
        const ms = loadModelState(freshState);
        for (const { item, conn, result } of results) {
          if (current.controller.signal.aborted) break;
          const k = modelKey(item.connectionId, item.id);
          if (conn && freshState.connections[item.connectionId]) {
            ms.models[k] = {
              ...ms.models[k],
              ...result,
              fingerprint: connFingerprint(conn),
              checkedAt: new Date().toISOString()
            };
          }
          checkQueue.delete(k);
          current.done++;
          if (result.status === 'online') current.online++;
          else current.offline++;
        }
        saveModelState(ms);
      }
    })()
      .catch(err => {
        current.error = err.message;
      })
      .finally(() => {
        current.running = false;
        current.cancelled = current.controller.signal.aborted;
      });
  }

  async function resolveTranslatorRoute(tSettings) {
    const state = loadState();
    const conn =
      state.connections[tSettings.connectionId] ||
      state.connections[state.selected] ||
      Object.values(state.connections)[0];
    if (!conn) return null;
    const apiKey = conn.credentialFile ? codec.read(conn.credentialFile) : '';
    const model =
      tSettings.model ||
      conn.model ||
      (conn.models || []).find(m => m.eligible)?.id ||
      '';
    if (!model) return null;
    return {
      connection: { ...conn, model },
      apiKey,
      model,
      effort: typeof tSettings.effort === 'string' ? tSettings.effort : conn.effort || ''
    };
  }

  function ensurePluginEnabledInCodex() {
    ensurePluginEnabledInCodexRouting({
      codexHome,
      pluginRoot: root,
      dataDir,
      version: pkg.version || '1.0.0'
    });
  }

  function getSnapshot() {
    const state = loadState();
    const ms = loadModelState(state);
    const connections = Object.entries(state.connections).map(([id, c]) => ({
      id,
      name: c.name || id,
      kind: c.kind || 'omniroute',
      baseUrl: c.baseURL || c.baseUrl || '',
      model: c.model || '',
      effort: c.effort || '',
      hasKey: !!c.credentialFile && fs.existsSync(c.credentialFile),
      fetchedAt: c.fetchedAt || null
    }));

    const models = [];
    for (const [cid, c] of Object.entries(state.connections)) {
      const fp = connFingerprint(c);
      for (const m of (c.models || []).filter(x => x.eligible)) {
        const k = modelKey(cid, m.id);
        const ctrl = ms.models[k] || {};
        const fresh = ctrl.fingerprint === fp;
        models.push({
          id: m.id,
          name: m.name || m.id,
          context: m.context,
          efforts: m.efforts || [],
          vision: !!m.vision,
          connectionId: cid,
          connectionName: c.name || cid,
          enabled: ctrl.enabled !== false,
          status: fresh ? ctrl.status || 'unchecked' : 'unchecked',
          checkedAt: fresh ? ctrl.checkedAt || null : null,
          detail: fresh ? ctrl.detail || null : null
        });
      }
    }

    let translator = readTranslatorSettings(dataDir);
    const tState = readTranslatorState(dataDir);
    let routing = routingStatus(dataDir, codexHome);
    const uiState = jsonRead(uiStateFile, {});

    const selectedId =
      (translator.connectionId && state.connections[translator.connectionId] ? translator.connectionId : null) ||
      (state.selected && state.connections[state.selected] ? state.selected : null) ||
      connections[0]?.id ||
      null;
    const primaryConn = selectedId ? state.connections[selectedId] : null;
    const hasProvider = !!(primaryConn && (primaryConn.baseURL || primaryConn.baseUrl));
    const candidateModel = translator.model || primaryConn?.model || null;
    const hasModel = !!(
      hasProvider &&
      candidateModel &&
      (!Array.isArray(primaryConn.models) ||
        primaryConn.models.length === 0 ||
        primaryConn.models.some(m => m.eligible && m.id === candidateModel))
    );
    const activeTranslatorModel = hasModel ? candidateModel : null;

    if (translator.enabled && (!hasProvider || !hasModel)) {
      translator = saveTranslatorSettings(dataDir, {
        enabled: false,
        connectionId: selectedId || null,
        model: activeTranslatorModel || ''
      });
      if (routing.interceptActive) {
        try {
          routing = switchRoute({ route: 'base', dataDir, codexHome, force: true });
        } catch {}
      }
      state.desiredRoute = 'base';
      saveState(state);
    }

    const cachePath = path.join(codexHome, 'plugins', 'cache', 'codex-translate-local', 'codex-translate', pkg.version || '1.0.0');
    const configPath = path.join(codexHome, 'config.toml');
    const configText = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
    const pluginInstalled = fs.existsSync(path.join(cachePath, 'plugin.json'));
    const pluginEnabledInConfig = /\[plugins\."codex-translate@codex-translate-local"\]\s*\r?\n\s*enabled\s*=\s*true/m.test(configText);
    const pluginEnabled = pluginInstalled && pluginEnabledInConfig;
    const ready = !!(translator.enabled && hasProvider && hasModel && routing.interceptActive);

    return {
      version: 1,
      selectedId,
      activeModel: activeTranslatorModel,
      activeEffort: translator.effort || primaryConn?.effort || 'medium',
      desiredRoute: state.desiredRoute ?? 'translate',
      routing,
      plugin: {
        installed: pluginInstalled,
        enabled: pluginEnabled,
        cachePath
      },
      gatewayPort: actualPort,
      connections,
      models,
      translator: {
        ...translator,
        connectionId: selectedId || null,
        model: activeTranslatorModel || '',
        hasProvider,
        hasModel,
        ready,
        status: tState.status || null,
        stats: tState.stats || { userTranslatedCount: 0, agentTranslatedCount: 0 },
        recentTranslations: (tState.recentTranslations || []).slice(-25).reverse()
      },
      languages: LANGUAGES,
      efforts,
      uiState,
      economics: economics.getDashboardData(),
      checkJob: checkJob
        ? {
            id: checkJob.id,
            running: checkJob.running,
            total: checkJob.total,
            done: checkJob.done,
            online: checkJob.online,
            offline: checkJob.offline,
            batchSize: checkJob.batchSize,
            cancelled: checkJob.cancelled,
            error: checkJob.error
          }
        : null
    };
  }

  async function dispatch(action, payload = {}) {
    if (action === 'snapshot') return getSnapshot();

    if (action === 'createConnection') {
      const state = loadState();
      const id = 'conn_' + crypto.randomUUID().replaceAll('-', '').slice(0, 10);
      state.connections[id] = {
        id,
        name: 'Провайдер переводчика',
        kind: 'omniroute',
        baseURL: '',
        baseUrl: '',
        credentialFile: '',
        model: '',
        effort: 'medium',
        models: [],
        fetchedAt: null
      };
      if (!state.selected) state.selected = id;
      saveState(state);
      return { id, saved: true };
    }

    if (action === 'saveConnection') {
      const state = loadState();
      const id = (payload.id || state.selected || 'default').trim();
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw Error('Некорректный ID подключения.');
      const existing = state.connections[id] || {
        id,
        name: payload.name || id,
        kind: 'omniroute',
        baseURL: '',
        credentialFile: '',
        model: '',
        effort: 'medium',
        models: []
      };
      const next = { ...existing };
      if (typeof payload.name === 'string' && payload.name.trim()) next.name = payload.name.trim();
      if (typeof payload.kind === 'string' && ['omniroute', 'responses', 'chat_completions', 'anthropic'].includes(payload.kind)) {
        next.kind = payload.kind;
      }
      if (typeof payload.baseUrl === 'string' && payload.baseUrl.trim()) {
        next.baseURL = normalizeURL(payload.baseUrl.trim());
        next.baseUrl = next.baseURL;
      } else if (typeof payload.baseURL === 'string' && payload.baseURL.trim()) {
        next.baseURL = normalizeURL(payload.baseURL.trim());
        next.baseUrl = next.baseURL;
      }
      if (typeof payload.model === 'string' && payload.model.trim()) next.model = payload.model.trim();
      if (typeof payload.effort === 'string' && payload.effort.trim()) next.effort = payload.effort.trim();
      if (typeof payload.apiKey === 'string' && payload.apiKey.trim()) {
        next.credentialFile = codec.protect(id, payload.apiKey.trim());
      }
      state.connections[id] = next;
      if (payload.primary || !state.selected) state.selected = id;
      saveState(state);
      loadModelState(state);
      if (payload.primary) {
        const nextModel = next.model || next.models?.find(m => m.eligible)?.id || '';
        saveTranslatorSettings(dataDir, {
          connectionId: id,
          ...(nextModel ? { model: nextModel } : {})
        });
      }
      return { id, saved: true, primary: state.selected === id };
    }

    if (action === 'removeConnection') {
      const state = loadState();
      const id = payload.id;
      if (!id || !state.connections[id]) throw Error('Подключение не найдено.');
      delete state.connections[id];
      if (state.selected === id) {
        state.selected = Object.keys(state.connections)[0] || null;
      }
      saveState(state);
      const t = readTranslatorSettings(dataDir);
      if (t.connectionId === id || !state.connections[t.connectionId]) {
        const fallbackId = state.selected;
        const fallbackConn = fallbackId ? state.connections[fallbackId] : null;
        const fallbackModel = fallbackConn?.model || fallbackConn?.models?.find(m => m.eligible)?.id || '';
        const canStayEnabled = !!(fallbackConn && (fallbackConn.baseURL || fallbackConn.baseUrl) && fallbackModel);
        saveTranslatorSettings(dataDir, {
          enabled: canStayEnabled ? t.enabled : false,
          connectionId: fallbackId || null,
          model: fallbackModel
        });
        if (!canStayEnabled) {
          try {
            switchRoute({ route: 'base', dataDir, codexHome, force: true });
          } catch {}
        }
      }
      return { saved: true };
    }

    if (action === 'refreshModels') {
      const state = loadState();
      const id = payload.id || state.selected || 'default';
      const conn = state.connections[id];
      if (!conn) throw Error('Подключение не найдено.');
      if (!conn.baseURL) throw Error('Укажите Base URL сервера.');
      const key = conn.credentialFile ? codec.read(conn.credentialFile) : '';
      const headers =
        conn.kind === 'anthropic'
          ? { 'anthropic-version': '2023-06-01', ...(key ? { 'x-api-key': key } : {}) }
          : key
            ? { Authorization: 'Bearer ' + key }
            : {};
      let res;
      try {
        res = await fetchImpl(apiEndpoint(conn.baseURL, 'models'), {
          headers,
          redirect: 'error',
          signal: AbortSignal.timeout(30000)
        });
      } catch {
        throw Error('Не удалось подключиться к /v1/models. Проверьте Base URL и сеть.');
      }
      if (!res.ok) throw Error(`Сервер моделей ответил HTTP ${res.status}.`);
      const body = await res.json();
      const parsed = parseModels(Array.isArray(body) ? { data: body } : body.data ? body : { data: body.models || [] });
      conn.models = parsed;
      conn.fetchedAt = new Date().toISOString();
      if (!conn.model || !parsed.some(m => m.eligible && m.id === conn.model)) {
        conn.model =
          parsed.find(m => m.eligible)?.id ??
          '';
      }
      state.connections[id] = conn;
      if (!state.selected) state.selected = id;
      saveState(state);
      loadModelState(state);

      const t = readTranslatorSettings(dataDir);
      if (!t.connectionId || !t.model) {
        saveTranslatorSettings(dataDir, {
          connectionId: id,
          model: conn.model
        });
      }
      return { id, count: parsed.filter(m => m.eligible).length, selectedModel: conn.model };
    }

    if (action === 'refreshAllModels') {
      const state = loadState();
      const results = [];
      for (const id of Object.keys(state.connections)) {
        if (!state.connections[id].baseURL) continue;
        try {
          const r = await dispatch('refreshModels', { id });
          results.push(r);
        } catch (err) {
          results.push({ id, error: err.message });
        }
      }
      return { results };
    }

    if (action === 'setModelEnabled') {
      const state = loadState();
      const ms = loadModelState(state);
      const k = modelKey(payload.connectionId, payload.model);
      const conn = state.connections[payload.connectionId];
      if (!conn) throw Error('Подключение не найдено.');
      ms.models[k] = {
        ...ms.models[k],
        enabled: payload.enabled === true,
        fingerprint: ms.models[k]?.fingerprint || connFingerprint(conn)
      };
      if (payload.enabled === true && (!conn.model || payload.makeDefault)) {
        conn.model = payload.model;
      }
      saveState(state);
      saveModelState(ms);
      return { saved: true };
    }

    if (action === 'setBulkModelsEnabled') {
      const state = loadState();
      const ms = loadModelState(state);
      for (const item of payload.items || []) {
        const conn = state.connections[item.connectionId];
        if (!conn) continue;
        const k = modelKey(item.connectionId, item.model);
        ms.models[k] = {
          ...ms.models[k],
          enabled: (item.enabled ?? payload.enabled) === true,
          fingerprint: ms.models[k]?.fingerprint || connFingerprint(conn)
        };
      }
      saveModelState(ms);
      return { saved: true };
    }

    if (action === 'checkModels') {
      if (checkJob?.running) throw Error('Проверка уже выполняется.');
      const snap = getSnapshot();
      const targets = snap.models.filter(m => !payload.connectionId || m.connectionId === payload.connectionId);
      if (!targets.length) throw Error('Сначала загрузите список моделей.');
      const batchSize = payload.batchSize === 20 ? 20 : 10;
      for (const t of targets) {
        checkQueue.set(modelKey(t.connectionId, t.id), { connectionId: t.connectionId, id: t.id });
      }
      launchChecks(batchSize);
      return { started: true, total: targets.length, batchSize };
    }

    if (action === 'cancelCheck') {
      checkJob?.controller.abort();
      checkQueue.clear();
      return { cancelled: true };
    }

    if (action === 'toggleTranslator') {
      const current = readTranslatorSettings(dataDir);
      const nextEnabled = typeof payload.enabled === 'boolean' ? payload.enabled : !current.enabled;
      return dispatch('saveTranslator', { ...payload, enabled: nextEnabled });
    }

    if (action === 'saveTranslator') {
      if (payload.effort && !efforts.includes(payload.effort)) throw Error('Некорректный уровень effort.');
      const patch = { ...payload };
      const current = readTranslatorSettings(dataDir);
      const state = loadState();
      const candidateCid = patch.connectionId || current.connectionId || state.selected || Object.keys(state.connections)[0] || null;
      const cid = candidateCid && state.connections[candidateCid] ? candidateCid : Object.keys(state.connections)[0] || null;
      const conn = cid ? state.connections[cid] : null;
      patch.connectionId = cid;
      if (conn && !patch.model) {
        patch.model =
          (current.connectionId === cid && current.model ? current.model : '') ||
          conn.model ||
          conn.models?.find(m => m.eligible)?.id ||
          '';
      } else if (!conn) {
        patch.model = '';
      }
      const wantsEnabled = typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled;
      if (wantsEnabled) {
        if (!conn || !(conn.baseURL || conn.baseUrl)) {
          saveTranslatorSettings(dataDir, { ...patch, enabled: false, connectionId: null, model: '' });
          throw Error('Сначала добавьте и настройте API провайдер для переводчика на вкладке «API Провайдеры».');
        }
        if (!patch.model) {
          saveTranslatorSettings(dataDir, { ...patch, enabled: false, connectionId: cid, model: '' });
          throw Error('Сначала загрузите и выберите модель переводчика.');
        }
      }
      if (patch.connectionId && state.connections[patch.connectionId] && patch.model) {
        state.connections[patch.connectionId].model = patch.model;
        if (patch.effort !== undefined) state.connections[patch.connectionId].effort = patch.effort;
        state.selected = patch.connectionId;
        saveState(state);
      }
      const saved = saveTranslatorSettings(dataDir, patch);
      if (saved.enabled) {
        const wasInterceptActive = routingStatus(dataDir, codexHome).interceptActive;
        ensurePluginEnabledInCodex();
        state.desiredRoute = 'translate';
        saveState(state);
        ensureInterceptActiveIfNeeded(state);
        const isLiveDesktop = !upstreamBaseUrl && actualPort === DEFAULT_GATEWAY_PORT;
        if (!wasInterceptActive && isLiveDesktop && payload.restartDesktop !== false) {
          restartCodexDesktop({ relaunch: true, codexHome, dataDir });
        }
      }
      syncMsixLocalCache(dataDir);
      return { saved: true, translator: saved };
    }

    if (action === 'setDefaultModel' || action === 'selectTranslatorModel') {
      const state = loadState();
      const ms = loadModelState(state);
      const cid = payload.connectionId || state.selected || Object.keys(state.connections)[0];
      const conn = state.connections[cid];
      if (!conn) throw Error('Подключение не найдено.');
      if (payload.model) {
        if (!conn.models.some(m => m.eligible && m.id === payload.model)) {
          throw Error('Модель не найдена в каталоге выбранного подключения.');
        }
        conn.model = payload.model;
        ms.models[modelKey(cid, payload.model)] = {
          ...ms.models[modelKey(cid, payload.model)],
          enabled: true,
          fingerprint: connFingerprint(conn)
        };
      }
      if (payload.effort !== undefined) {
        conn.effort = payload.effort || 'medium';
      }
      state.selected = cid;
      state.connections[cid] = conn;
      saveModelState(ms);
      saveState(state);

      const saved = saveTranslatorSettings(dataDir, {
        connectionId: cid,
        model: conn.model,
        ...(payload.effort !== undefined ? { effort: payload.effort } : {}),
        ...(typeof payload.enabled === 'boolean' ? { enabled: payload.enabled } : {})
      });
      if (saved.enabled) {
        ensureInterceptActiveIfNeeded(state);
      }
      return { saved: true, connectionId: cid, model: conn.model, effort: conn.effort, translator: saved };
    }

    if (action === 'testActiveRoute' || action === 'testTranslator') {
      const state = loadState();
      const t = readTranslatorSettings(dataDir);
      const cid = payload.connectionId || t.connectionId || state.selected || Object.keys(state.connections)[0];
      const conn = state.connections[cid];
      if (!conn) throw Error('Сначала добавьте и настройте API провайдер для переводчика.');
      const modelId = payload.model || t.model || conn.model || conn.models?.find(m => m.eligible)?.id;
      if (!modelId) throw Error('Сначала выберите модель переводчика.');
      const key = conn.credentialFile ? codec.read(conn.credentialFile) : '';
      const t0 = Date.now();
      const sampleInput = payload.sampleText || 'Привет! Проверь файл `src/app.mjs` и переменную `user_count`.';
      const toEn = await translateText({
        text: sampleInput,
        targetLanguage: 'en',
        connection: { ...conn, model: modelId },
        apiKey: key,
        model: modelId,
        effort: payload.effort ?? t.effort ?? '',
        timeoutMs: 30000,
        fetchImpl
      });
      const latencyMs = Date.now() - t0;
      const ms = loadModelState(state);
      const k = modelKey(cid, modelId);
      ms.models[k] = {
        ...ms.models[k],
        status: 'online',
        detail: `Перевод выполнен (${latencyMs} мс): ${toEn.text}`,
        fingerprint: connFingerprint(conn),
        checkedAt: new Date().toISOString()
      };
      saveModelState(ms);
      return {
        status: 'online',
        detail: `Перевод User → EN (${latencyMs} мс): "${toEn.text}"`,
        translatedSample: toEn.text,
        connectionId: cid,
        model: modelId,
        latencyMs
      };
    }

    if (action === 'switchRoute') {
      const rawRoute = payload.route;
      const normRoute = rawRoute === 'omniroute' || rawRoute === 'translate' ? 'translate' : 'base';
      const state = loadState();
      if (normRoute === 'base') {
        const res = switchRoute({ route: 'base', dataDir, codexHome, force: true });
        state.desiredRoute = 'base';
        saveState(state);
        if (payload.disableTranslator) {
          saveTranslatorSettings(dataDir, { enabled: false });
        }
        if (payload.restartDesktop) restartCodexDesktop({ relaunch: true, codexHome, dataDir });
        return { ...res, desiredRoute: 'base' };
      }
      ensurePluginEnabledInCodex();
      state.desiredRoute = 'translate';
      saveState(state);
      const gwUrl = currentGatewayBaseUrl();
      const res = switchRoute({
        route: 'translate',
        dataDir,
        codexHome,
        gatewayBaseUrl: gwUrl,
        generated: translateBridgeConfig(gwUrl),
        force: true
      });
      if (typeof payload.enabled === 'boolean') {
        saveTranslatorSettings(dataDir, { enabled: payload.enabled });
      }
      if (payload.restartDesktop) restartCodexDesktop({ relaunch: true, codexHome, dataDir });
      return { ...res, desiredRoute: 'translate' };
    }

    if (action === 'installPlugin') {
      const wasInterceptActive = routingStatus(dataDir, codexHome).interceptActive;
      ensurePluginEnabledInCodex();
      const state = loadState();
      state.desiredRoute = 'translate';
      saveState(state);
      const gwUrl = currentGatewayBaseUrl();
      const res = switchRoute({
        route: 'translate',
        dataDir,
        codexHome,
        gatewayBaseUrl: gwUrl,
        generated: translateBridgeConfig(gwUrl),
        force: true
      });
      const isLiveDesktop = !upstreamBaseUrl && actualPort === DEFAULT_GATEWAY_PORT;
      const shouldRestart = payload.restartDesktop === true || (!wasInterceptActive && isLiveDesktop && payload.restartDesktop !== false);
      const desktopRestart = shouldRestart ? restartCodexDesktop({ relaunch: true, codexHome, dataDir }) : { restarted: false, relaunched: false };
      if (isLiveDesktop) {
        ensureTrayRunning(root, { minimizePanelToTray: false, dataDir, codexHome });
      }
      return { installed: true, enabled: true, routing: res, desktopRestart };
    }

    if (action === 'disablePlugin') {
      const wasInterceptActive = routingStatus(dataDir, codexHome).interceptActive;
      const state = loadState();
      state.desiredRoute = 'base';
      saveState(state);
      saveTranslatorSettings(dataDir, { enabled: false });
      try {
        switchRoute({ route: 'base', dataDir, codexHome, force: true });
      } catch {}
      if (payload.uninstallFromCodex) {
        const configPath = path.join(codexHome, 'config.toml');
        if (fs.existsSync(configPath)) {
          const cfgText = fs
            .readFileSync(configPath, 'utf8')
            .replace(/\0+/g, '')
            .replace(/(\[plugins\."codex-translate@codex-translate-local"\]\s*\r?\n\s*enabled\s*=\s*)true/m, '$1false');
          atomicWrite(configPath, cfgText);
        }
      }
      const isLiveDesktop = !upstreamBaseUrl && actualPort === DEFAULT_GATEWAY_PORT;
      const shouldRestart = payload.restartDesktop === true || (wasInterceptActive && isLiveDesktop && payload.restartDesktop !== false);
      const desktopRestart = shouldRestart ? restartCodexDesktop({ relaunch: true, codexHome, dataDir }) : { restarted: false, relaunched: false };
      return { disabled: true, desiredRoute: 'base', desktopRestart };
    }

    if (action === 'saveUiState') {
      const current = jsonRead(uiStateFile, {});
      const next = { ...current, ...payload };
      writeJSON(uiStateFile, next);
      return { saved: true, uiState: next };
    }

    if (action === 'getEconomics') {
      return economics.getDashboardData();
    }

    if (action === 'syncEconomicsPricing') {
      const syncRes = await economics.startAutoPricingSync({
        intervalMs: payload?.intervalMs || pricingSyncIntervalMs,
        fetchImpl,
        pricingUrl: payload?.pricingUrl || pricingUrl,
        runImmediately: true
      });
      syncMsixLocalCache(dataDir);
      return { ...syncRes, economics: economics.getDashboardData() };
    }

    if (action === 'saveEconomicsPricing') {
      const pricing = economics.setPricing(payload || {});
      syncMsixLocalCache(dataDir);
      return { saved: true, pricing, economics: economics.getDashboardData() };
    }

    if (action === 'saveModelRate') {
      const rate = economics.setModelRate(payload?.modelId || payload?.id, payload || {});
      syncMsixLocalCache(dataDir);
      return { saved: true, rate, economics: economics.getDashboardData() };
    }

    if (action === 'resetModelRate') {
      const rate = economics.resetModelRate(payload?.modelId || payload?.id);
      syncMsixLocalCache(dataDir);
      return { reset: true, rate, economics: economics.getDashboardData() };
    }

    if (action === 'resetEconomicsSession') {
      const data = economics.resetSession();
      syncMsixLocalCache(dataDir);
      return { reset: true, economics: data };
    }

    if (action === 'exportEconomics') {
      return economics.exportData(payload?.format || 'json');
    }

    if (action === 'restartDesktop') {
      return restartCodexDesktop({ relaunch: true, codexHome, dataDir });
    }

    if (action === 'startTray') {
      const started = ensureTrayRunning(root, {
        minimizePanelToTray: !!payload.minimizePanelToTray,
        dataDir,
        codexHome
      });
      return { started };
    }

    throw Error(`Неизвестное действие: ${action}`);
  }

  function resolveBaseUpstreamUrl(req, subPathWithQuery) {
    if (upstreamBaseUrl) {
      return upstreamBaseUrl.replace(/\/+$/, '') + subPathWithQuery;
    }
    const rec = jsonRead(path.join(dataDir, 'routing.json'), null);
    if (
      rec?.originalOpenaiBaseUrl &&
      !isOwnTranslateBridgeUrl(rec.originalOpenaiBaseUrl, [currentGatewayBaseUrl(), rec.gatewayBaseUrl])
    ) {
      return rec.originalOpenaiBaseUrl.replace(/\/+$/, '') + subPathWithQuery;
    }
    const authHeader = String(req.headers.authorization || '');
    const accountId = req.headers['chatgpt-account-id'];
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const isApiKeyAuth = !accountId && /^sk-(?:proj-|svcacct-|admin-|[A-Za-z0-9]{20,})/.test(token);
    const baseRoot = isApiKeyAuth ? 'https://api.openai.com/v1' : 'https://chatgpt.com/backend-api/codex';
    return baseRoot + subPathWithQuery;
  }

  function buildForwardHeaders(reqHeaders) {
    const out = {};
    const skip = new Set([
      'host',
      'connection',
      'content-length',
      'transfer-encoding',
      'content-encoding',
      'accept-encoding',
      'upgrade',
      'sec-websocket-key',
      'sec-websocket-version',
      'sec-websocket-extensions',
      'sec-websocket-protocol'
    ]);
    for (const [k, v] of Object.entries(reqHeaders || {})) {
      if (v === undefined || skip.has(k.toLowerCase())) continue;
      out[k] = v;
    }
    return out;
  }

  const uiDir = path.join(root, 'ui');
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.svg': 'image/svg+xml'
  };

  const server = http.createServer(async (req, res) => {
    if (req.headers.upgrade) {
      res.writeHead(426, { 'content-type': 'text/plain', connection: 'close' });
      res.end('Upgrade Required');
      return;
    }

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    try {
      const urlObj = new URL(req.url, `http://127.0.0.1:${actualPort || 80}`);
      const pathname = urlObj.pathname;

      if (req.method === 'GET' && pathname === '/health') {
        let snap = null;
        try {
          snap = getSnapshot();
        } catch {}
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            ok: true,
            pid: process.pid,
            port: actualPort,
            configuredRoute: snap?.routing?.configuredRoute ?? 'base',
            interceptActive: snap?.routing?.interceptActive ?? false,
            desiredRoute: snap?.desiredRoute ?? 'translate',
            activeModel: snap?.translator?.model ?? snap?.activeModel ?? null,
            targetLanguage: snap?.translator?.targetLanguage ?? 'ru',
            translatorEnabled: !!(snap?.translator?.enabled && snap?.translator?.hasProvider && snap?.translator?.hasModel),
            translatorReady: snap?.translator?.ready ?? false
          })
        );
        return;
      }

      const isAllowedUiOrigin = originHeader => {
        if (!originHeader) return true;
        try {
          const u = new URL(originHeader);
          return (
            u.protocol === 'http:' &&
            (u.hostname === '127.0.0.1' || u.hostname === 'localhost') &&
            Number(u.port || 80) === Number(actualPort)
          );
        } catch {
          return false;
        }
      };

      if (
        req.method === 'GET' &&
        (pathname === '/' || pathname === '/index.html' || pathname === '/style.css' || pathname === '/renderer.js' || pathname === '/icon.svg')
      ) {
        const secFetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
        if (secFetchSite === 'cross-site' || !isAllowedUiOrigin(req.headers.origin)) {
          res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'Forbidden cross-origin asset request' }));
          return;
        }
        const fileName = pathname === '/' ? 'index.html' : pathname === '/icon.svg' ? '../assets/icon.svg' : pathname.slice(1);
        const filePath = path.resolve(uiDir, fileName);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const ext = path.extname(filePath);
          res.writeHead(200, { 'content-type': mimeTypes[ext] || 'application/octet-stream', 'cache-control': 'no-cache' });
          if (pathname === '/renderer.js') {
            const rawJs = fs.readFileSync(filePath, 'utf8');
            res.end(`window.__CT_ADMIN_TOKEN__ = ${JSON.stringify(adminToken)};\n` + rawJs);
          } else {
            res.end(fs.readFileSync(filePath));
          }
          return;
        }
      }

      if (pathname === '/api/action') {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
          return;
        }
        const secFetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
        if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
          res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'Forbidden cross-site request' }));
          return;
        }
        if (!isAllowedUiOrigin(req.headers.origin) || !isAllowedUiOrigin(req.headers.referer)) {
          res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'Forbidden origin' }));
          return;
        }
        const contentType = String(req.headers['content-type'] || '').trim();
        if (!/^application\/json\b/i.test(contentType)) {
          res.writeHead(415, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'Content-Type must be application/json' }));
          return;
        }
        const suppliedToken =
          String(req.headers['x-codex-translate-token'] || '').trim() ||
          String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
        if (!suppliedToken || suppliedToken !== adminToken) {
          res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'Missing or invalid management token' }));
          return;
        }
        const rawBuf = await readRequestBuffer(req);
        const raw = decodeRequestBuffer(rawBuf, req.headers['content-encoding']);
        const { action, payload } = JSON.parse(raw || '{}');
        try {
          const value = await dispatch(action, payload);
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, value }));
        } catch (err) {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
        return;
      }

      // Intercepted Base ChatGPT / Codex Traffic (/v1/*)
      if (pathname.startsWith('/v1/') || pathname === '/v1') {
        const subPathWithQuery = req.url.replace(/^\/v1\b/, '') || '/';

        // Fallback for local unauthenticated GET /v1/models inspection when no upstreamBaseUrl is set
        if (
          req.method === 'GET' &&
          pathname === '/v1/models' &&
          !upstreamBaseUrl &&
          !req.headers.authorization &&
          !req.headers['chatgpt-account-id']
        ) {
          const snap = getSnapshot();
          const list = (snap.models || []).map(m => ({
            id: m.id,
            object: 'model',
            name: m.name,
            owned_by: m.connectionName || 'translator',
            context_length: m.context ?? 128000,
            capabilities: { tool_calling: true, effort_tiers: m.efforts || [] }
          }));
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ object: 'list', data: list }));
          return;
        }

        if (req.method === 'POST' && pathname === '/v1/responses') {
          const rawBuf = await readRequestBuffer(req);
          const rawText = decodeRequestBuffer(rawBuf, req.headers['content-encoding']);
          let body = JSON.parse(rawText);

          const tSettings = readTranslatorSettings(dataDir);
          const tRoute = tSettings.enabled ? await resolveTranslatorRoute(tSettings) : null;
          const isStreaming = body.stream !== false;
          let nativeMetadata = null;
          try {
            nativeMetadata = JSON.parse(
              body.client_metadata?.['x-codex-turn-metadata'] || req.headers['x-codex-turn-metadata'] || 'null'
            );
          } catch {}
          const isCompaction =
            nativeMetadata?.request_kind === 'compaction' ||
            !!nativeMetadata?.compaction ||
            isCompactionRequest(body);
          const isSubagent =
            nativeMetadata?.subagent_kind === 'thread_spawn' ||
            !!nativeMetadata?.parent_thread_id;
          const isHelperOrReview = isInternalHelperRequest(body) || isAutoReviewRequest(body);
          const isSelfCall = isTranslatorSelfCall(body);
          const translatorActive = !!(tSettings.enabled && tRoute?.connection && tRoute?.model);

          const shouldTranslateInput = translatorActive && !isSelfCall;
          const shouldTranslateOutput =
            translatorActive && !isCompaction && !isSubagent && !isHelperOrReview;

          const threadId =
            nativeMetadata?.thread_id ||
            nativeMetadata?.conversation_id ||
            body.client_metadata?.session_id ||
            body.prompt_cache_key ||
            'default';
          let requestEffort =
            body.reasoning?.effort ||
            body.reasoning_effort ||
            body.effort ||
            body.collaboration_mode?.settings?.reasoning_effort ||
            nativeMetadata?.reasoning_effort ||
            nativeMetadata?.effort ||
            '';

          if (!isHelperOrReview && !isSubagent) {
            try {
              const effective = economics.resolveEffectiveRequestSettings({
                threadId,
                model: body.model || '',
                reasoningEffort: requestEffort,
                serviceTier: body.service_tier || ''
              });
              if (effective?.reasoningEffort) {
                requestEffort = effective.reasoningEffort;
                if (body.reasoning && typeof body.reasoning === 'object') {
                  body.reasoning = { ...body.reasoning, effort: effective.reasoningEffort };
                } else if (body.reasoning_effort !== undefined) {
                  body.reasoning_effort = effective.reasoningEffort;
                }
              }
            } catch {}
          }

          // Step 1: Intercept User Message -> Translate to English before forwarding to Agent
          const rawRequestBody = shouldTranslateInput && !isHelperOrReview ? structuredClone(body) : null;
          let turnContext = null;
          if (shouldTranslateInput) {
            body = await translateRequestInput({
              body,
              threadId,
              dataDir,
              resolveRoute: resolveTranslatorRoute,
              fetchImpl,
              signal: controller.signal
            });
            if (!isHelperOrReview) {
              try {
                turnContext = economics.prepareTurnContext({
                  threadId,
                  rawRequestBody,
                  translatedRequestBody: body,
                  translatorState: readTranslatorState(dataDir)
                });
              } catch {}
            }
          }

          const onTurnCompleted = ({ usage, replyEnText, replyNativeText }) => {
            try {
              const enc = economics.getPricing()?.encoding || 'o200k_base';
              const userTransTokens = turnContext?.currentTurnUserTransTokens || 0;
              const replyTransTokens =
                replyEnText && replyNativeText && replyEnText !== replyNativeText
                  ? countTokens(replyEnText, enc) + countTokens(replyNativeText, enc)
                  : 0;
              economics.recordTurn({
                threadId,
                model: body.model || '',
                reasoningEffort: requestEffort,
                translatorModel: tRoute?.model || '',
                turnContext,
                apiUsage: usage || null,
                replyEnText,
                replyNativeText,
                translatorTokens: userTransTokens + replyTransTokens
              });
              syncMsixLocalCache(dataDir);
            } catch {}
          };

          // Step 2: Forward translated English request to Base ChatGPT / Codex Agent (or configured upstream)
          const forwardHeaders = buildForwardHeaders(req.headers);
          forwardHeaders['content-type'] = 'application/json';
          forwardHeaders.accept = isStreaming ? 'text/event-stream' : 'application/json';

          let upstreamRes;
          if (!upstreamBaseUrl && !req.headers.authorization && !req.headers['chatgpt-account-id'] && tRoute?.connection) {
            // Test/standalone fallback when no OpenAI auth header is supplied
            const fallbackUrl = apiEndpoint(tRoute.connection.baseURL || tRoute.connection.baseUrl, 'responses');
            if (tRoute.apiKey) forwardHeaders.authorization = 'Bearer ' + tRoute.apiKey;
            upstreamRes = await fetchImpl(fallbackUrl, {
              method: 'POST',
              headers: forwardHeaders,
              body: JSON.stringify(body),
              signal: controller.signal,
              redirect: 'error'
            });
          } else {
            const targetUrl = resolveBaseUpstreamUrl(req, subPathWithQuery);
            upstreamRes = await fetchImpl(targetUrl, {
              method: 'POST',
              headers: forwardHeaders,
              body: JSON.stringify(body),
              signal: controller.signal,
              redirect: 'error'
            });
          }

          if (!upstreamRes.ok) {
            const errText = await upstreamRes.text();
            res.writeHead(upstreamRes.status, {
              'content-type': upstreamRes.headers.get('content-type') || 'application/json'
            });
            res.end(errText);
            return;
          }

          const contentType = upstreamRes.headers.get('content-type') || '';
          const isSse = isStreaming || contentType.includes('text/event-stream');

          if (!isSse) {
            const rawRespText = await upstreamRes.text();
            if (/^\s*(?:event:|data:)/m.test(rawRespText)) {
              res.writeHead(upstreamRes.status, {
                'content-type': 'text/event-stream',
                'cache-control': 'no-cache',
                connection: 'keep-alive'
              });
              if (shouldTranslateOutput) {
                await translateResponsesSseStream([rawRespText], {
                  threadId,
                  dataDir,
                  resolveRoute: resolveTranslatorRoute,
                  fetchImpl,
                  signal: controller.signal,
                  onTurnCompleted,
                  writeSse: ev => {
                    if (!res.writableEnded) res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
                  }
                });
              } else {
                res.write(rawRespText);
              }
              if (!res.writableEnded) res.end();
              return;
            }
            const json = JSON.parse(rawRespText);
            const finalJson = shouldTranslateOutput
              ? await translateResponsesJsonOutput(json, {
                  threadId,
                  dataDir,
                  resolveRoute: resolveTranslatorRoute,
                  fetchImpl,
                  signal: controller.signal,
                  onTurnCompleted
                })
              : json;
            res.writeHead(upstreamRes.status, { 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(finalJson));
            return;
          }

          // Step 3: Intercept Agent's English Response -> Translate to User's Language before sending to User
          res.writeHead(upstreamRes.status, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive'
          });

          if (shouldTranslateOutput) {
            await translateResponsesSseStream(upstreamRes.body, {
              threadId,
              dataDir,
              resolveRoute: resolveTranslatorRoute,
              fetchImpl,
              signal: controller.signal,
              onTurnCompleted,
              onHeartbeat: () => {
                if (!res.writableEnded) res.write(': keepalive\n\n');
              },
              writeSse: ev => {
                if (!res.writableEnded) {
                  res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
                }
              }
            });
            if (!res.writableEnded) res.end();
          } else {
            await pipeline(Readable.fromWeb(upstreamRes.body), res, { signal: controller.signal });
          }
          return;
        }

        // Transparently proxy all other /v1/* requests (e.g., GET /v1/models, POST /v1/responses/compact)
        const rawBuf = req.method === 'GET' || req.method === 'HEAD' ? null : await readRequestBuffer(req);
        let bodyText = rawBuf ? decodeRequestBuffer(rawBuf, req.headers['content-encoding']) : undefined;
        if (req.method === 'POST' && pathname === '/v1/responses/compact' && bodyText) {
          let parsedCompact = null;
          try {
            parsedCompact = JSON.parse(bodyText);
          } catch {}
          if (parsedCompact) {
            const tSettings = readTranslatorSettings(dataDir);
            const tRoute = tSettings.enabled ? await resolveTranslatorRoute(tSettings) : null;
            if (tSettings.enabled && tRoute?.connection && tRoute?.model) {
              let compactMeta = null;
              try {
                compactMeta = JSON.parse(
                  parsedCompact.client_metadata?.['x-codex-turn-metadata'] || req.headers['x-codex-turn-metadata'] || 'null'
                );
              } catch {}
              const compactThreadId =
                compactMeta?.thread_id ||
                compactMeta?.conversation_id ||
                parsedCompact.client_metadata?.session_id ||
                parsedCompact.prompt_cache_key ||
                'default';
              const sanitizedCompact = await translateRequestInput({
                body: parsedCompact,
                threadId: compactThreadId,
                dataDir,
                resolveRoute: resolveTranslatorRoute,
                fetchImpl,
                signal: controller.signal
              });
              bodyText = JSON.stringify(sanitizedCompact);
            }
          }
        }
        const forwardHeaders = buildForwardHeaders(req.headers);
        const targetUrl = resolveBaseUpstreamUrl(req, subPathWithQuery);
        const upstreamRes = await fetchImpl(targetUrl, {
          method: req.method,
          headers: forwardHeaders,
          body: bodyText,
          signal: controller.signal,
          redirect: 'error'
        });
        res.writeHead(upstreamRes.status, {
          'content-type': upstreamRes.headers.get('content-type') || 'application/json',
          'cache-control': 'no-cache'
        });
        if (upstreamRes.body) {
          await pipeline(Readable.fromWeb(upstreamRes.body), res, { signal: controller.signal });
        } else {
          res.end();
        }
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(err.status || 500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: err.message } }));
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  });

  server.on('upgrade', (_req, socket) => {
    try {
      socket.write('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    } catch {}
    socket.destroy();
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  actualPort = server.address().port;
  writeJSON(gatewayInfoFile, {
    pid: process.pid,
    port: actualPort,
    baseUrl: `http://127.0.0.1:${actualPort}/v1`,
    uiUrl: `http://127.0.0.1:${actualPort}/`,
    adminToken,
    startedAt: new Date().toISOString()
  });
  syncMsixLocalCache(dataDir);

  return {
    server,
    port: actualPort,
    adminToken,
    dispatch,
    getSnapshot,
    close: () =>
      new Promise(resolve => {
        checkJob?.controller.abort();
        economics.stopAutoPricingSync();
        server.closeAllConnections?.();
        server.close(() => resolve());
      })
  };
}

export async function ensureGatewayDaemon({
  dataDir = defaultDataDir(pkg.name),
  codexHome = defaultCodexHome(),
  port = DEFAULT_GATEWAY_PORT
} = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const infoFile = path.join(dataDir, 'gateway.json');
  const existing = jsonRead(infoFile, null);
  const probeHealth = async p => {
    try {
      const r = await fetch(`http://127.0.0.1:${p}/health`, { signal: AbortSignal.timeout(4500) });
      if (!r.ok) return null;
      const h = await r.json();
      if (!h?.ok) return null;
      const latestInfo = jsonRead(infoFile, existing);
      const result = {
        running: true,
        port: p,
        uiUrl: `http://127.0.0.1:${p}/`,
        baseUrl: `http://127.0.0.1:${p}/v1`,
        adminToken: latestInfo?.adminToken || existing?.adminToken || ''
      };
      if (result.adminToken) {
        void fetch(`http://127.0.0.1:${p}/api/action`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-codex-translate-token': result.adminToken
          },
          body: JSON.stringify({ action: 'syncEconomicsPricing', payload: {} }),
          signal: AbortSignal.timeout(4000)
        }).catch(() => {});
      }
      if (existing?.port !== p || (h.pid && existing?.pid !== h.pid)) {
        try {
          writeJSON(infoFile, {
            pid: h.pid || existing?.pid || 0,
            port: p,
            baseUrl: result.baseUrl,
            uiUrl: result.uiUrl,
            adminToken: result.adminToken,
            startedAt: existing?.startedAt || new Date().toISOString()
          });
          syncMsixLocalCache(dataDir);
        } catch {}
      }
      return result;
    } catch {
      return null;
    }
  };

  // Prefer the canonical port (24131) first so the bridge never drifts to ephemeral ports
  const candidatePorts = [...new Set([port, existing?.port].filter(Boolean))];
  for (const p of candidatePorts) {
    const res = await probeHealth(p);
    if (res) return res;
  }

  const spawnLock = path.join(dataDir, 'gateway-spawn.lock');
  let lockFd = null;
  try {
    lockFd = fs.openSync(spawnLock, 'wx');
  } catch {
    try {
      const st = fs.statSync(spawnLock);
      if (Date.now() - st.mtimeMs > 12000) {
        fs.unlinkSync(spawnLock);
        lockFd = fs.openSync(spawnLock, 'wx');
      }
    } catch {}
    if (lockFd === null) {
      // Another process is currently spawning the daemon; wait for it to come online
      const waitDeadline = Date.now() + 8000;
      while (Date.now() < waitDeadline) {
        await new Promise(r => setTimeout(r, 250));
        const info = jsonRead(infoFile, null);
        for (const p of [...new Set([port, info?.port].filter(Boolean))]) {
          const res = await probeHealth(p);
          if (res) return res;
        }
      }
      return { running: false };
    }
  }

  try {
  const { spawn } = await import('node:child_process');
  const scriptPath = fileURLToPath(import.meta.url);
  let spawnedViaWmi = false;
  if (process.platform === 'win32') {
    try {
      const cmdLine = `"${process.execPath}" "${scriptPath}" --daemon --data-dir "${dataDir}" --codex-home "${codexHome}" --port ${port}`;
      const psQuote = s => `'${String(s).replace(/'/g, "''")}'`;
      const psCmd = `$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }; $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${psQuote(cmdLine)}; CurrentDirectory = ${psQuote(root)}; ProcessStartupInformation = $si }; if ($r.ReturnValue -eq 0) { exit 0 } else { exit 1 }`;
      const wmiRes = spawnSync(psPath(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psCmd], {
        windowsHide: true,
        timeout: 8000
      });
      spawnedViaWmi = wmiRes.status === 0;
    } catch {}
  }
  if (!spawnedViaWmi) {
    const child = spawn(
      process.execPath,
      [scriptPath, '--daemon', '--data-dir', dataDir, '--codex-home', codexHome, '--port', String(port)],
      {
        detached: true,
        windowsHide: true,
        stdio: 'ignore'
      }
    );
    child.unref();
  }

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 200));
    const info = jsonRead(infoFile, null);
    for (const checkPort of [...new Set([port, info?.port].filter(Boolean))]) {
      const res = await probeHealth(checkPort);
      if (res) return res;
    }
  }
  return { running: false };
  } finally {
    if (lockFd !== null) {
      try { fs.closeSync(lockFd); } catch {}
      try { fs.unlinkSync(spawnLock); } catch {}
    }
  }
}

function isExecutedDirectly(argv1, metaUrl) {
  if (!argv1) return false;
  const resolvedArg = path.resolve(argv1);
  const resolvedMeta = fileURLToPath(metaUrl);
  if (resolvedArg === resolvedMeta) return true;
  try {
    return fs.realpathSync(resolvedArg) === fs.realpathSync(resolvedMeta);
  } catch {
    return false;
  }
}

if (isExecutedDirectly(process.argv[1], import.meta.url) && process.argv.includes('--daemon')) {
  const args = process.argv.slice(2);
  let dataDir;
  let codexHome;
  let port = DEFAULT_GATEWAY_PORT;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data-dir' && args[i + 1]) dataDir = args[++i];
    else if (args[i] === '--codex-home' && args[i + 1]) codexHome = args[++i];
    else if (args[i] === '--port' && args[i + 1]) port = Number(args[++i]) || 0;
  }
  (async () => {
    let gw = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        gw = await createGatewayServer({ dataDir, codexHome, port });
        break;
      } catch {
        // If another gateway daemon is already serving the target port, exit cleanly instead of drifting to port 0
        if (port > 0) {
          try {
            const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
            if (r.ok) process.exit(0);
          } catch {}
        }
        await new Promise(r => setTimeout(r, 250));
      }
    }
    if (!gw) {
      if (port > 0) {
        try {
          const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
          if (r.ok) process.exit(0);
        } catch {}
      }
      gw = await createGatewayServer({ dataDir, codexHome, port: 0 });
    }
    if (process.platform === 'win32' && (!dataDir || path.resolve(dataDir) === path.resolve(defaultDataDir(pkg.name)))) {
      ensureTrayRunning(root, { minimizePanelToTray: false, dataDir, codexHome });
    }
  })().catch(() => process.exit(1));
}
