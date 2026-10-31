import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { psPath } from '../lib.mjs';
import { syncPluginCache } from '../routing.mjs';

const html = fs.readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('../ui/renderer.js', import.meta.url), 'utf8');
// Run the real render functions without starting polling or making network requests.
const renderSource = script.slice(0, script.indexOf('\nfor (const langBtn of document.querySelectorAll'));

class Element {
  constructor(tag = 'div', attributes = {}) {
    this.tagName = tag;
    this.attributes = { ...attributes };
    this.id = attributes.id;
    this.children = [];
    this.dataset = Object.fromEntries(Object.entries(attributes).filter(([k]) => k.startsWith('data-')).map(([k, v]) => [k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v]));
    this.value = attributes.value || '';
    this.checked = Object.hasOwn(attributes, 'checked');
    this.style = {};
    const classes = new Set((attributes.class || '').split(' '));
    this.classList = {
      contains: c => classes.has(c),
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      toggle: (c, on = !classes.has(c)) => on ? classes.add(c) : classes.delete(c)
    };
    this._text = '';
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(' '); }
  get firstChild() { return this.children[0]; }
  get options() { return this.children; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); }
  replaceChildren(...children) { this._text = ''; this.children = children; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
}

function renderer(events = false) {
  const elements = [...html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)].map(([, tag, attrs]) => {
    const attributes = Object.fromEntries([...attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([, k, v]) => [k, v ?? '']));
    return new Element(tag, attributes);
  });
  const matches = (e, selector) => selector.startsWith('.')
    ? selector.slice(1).split('.').every(c => e.classList.contains(c))
    : e.getAttribute(selector.slice(1, -1)) !== null;
  const document = {
    documentElement: {}, activeElement: null,
    getElementById: id => elements.find(e => e.id === id) || null,
    querySelectorAll: selector => elements.filter(e => matches(e, selector)),
    querySelector: selector => elements.find(e => matches(e, selector)) || null,
    createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag)
  };
  const context = vm.createContext({ document, window: { addEventListener() {} }, Intl, setTimeout: () => 0, clearTimeout() {}, AbortSignal });
  vm.runInContext(events ? script.slice(0, script.lastIndexOf('\nreload(true);')) : renderSource, context);
  return { document, run: source => vm.runInContext(source, context), setFetch: fn => { context.fetch = fn; } };
}

test('every interface translation key has English, Russian, and Chinese text', () => {
  const r = renderer();
  const keys = [...new Set([...html.matchAll(/data-i18n(?:-placeholder|-title|-aria-label)?="([^"]+)"/g)].map(m => m[1]))];
  for (const lang of ['en', 'ru', 'zh']) {
    const missing = r.run(`(${JSON.stringify(keys)}).filter(key => typeof I18N.${lang}[key] !== 'string' || !I18N.${lang}[key].trim())`);
    assert.equal(missing.length, 0, `${lang}: ${missing.join(', ')}`);
  }
});

test('fresh economics renders localized empty states and can switch back to English', () => {
  const r = renderer();
  r.run('state = { connections: [], models: [], languages: [], translator: {}, economics: {} };');
  for (const [lang, text] of [['ru', 'Нет данных'], ['zh', '暂无'], ['en', 'No data']]) {
    r.run(`applyUiLanguage('${lang}')`);
    assert.ok(r.document.getElementById('econ-by-model-tbody').textContent.includes(text));
    assert.ok(r.document.getElementById('econ-turns-tbody').textContent.length > 20);
    assert.equal(r.document.documentElement.lang, lang);
  }
});

test('language switching translates model status, job progress, effort labels, and accessibility text', () => {
  const r = renderer();
  r.run(`state = { connections: [{ id: 'test', name: 'My API', kind: 'responses', baseUrl: 'https://example.com/v1' }], models: [{ connectionId: 'test', connectionName: 'My API', id: 'model-id', status: 'online', enabled: true, efforts: ['low'] }], languages: [{ code: 'ru', name: 'Russian' }], translator: {}, checkJob: { running: true, done: 1, total: 2, online: 1, offline: 0, batchSize: 10 } };`);
  for (const [lang, status, effort] of [['ru', 'Доступна', 'Низкий'], ['zh', '在线', '低'], ['en', 'Online', 'Low']]) {
    r.run(`applyUiLanguage('${lang}')`);
    assert.ok(r.document.getElementById('model-list').textContent.includes(status));
    assert.ok(r.run("formatEffortLabel('low')").includes(effort));
    const job = r.document.getElementById('check-progress').textContent;
    assert.ok(job.includes('1/2'));
    if (lang !== 'ru') assert.doesNotMatch(job, /Проверяю|Остановлено|пакет/);
    if (lang !== 'en') assert.notEqual(r.document.getElementById('model-search').getAttribute('aria-label'), 'Search models');
  }
});

test('tray and quick switcher read the selected interface language, with a safe English default', () => {
  if (process.platform !== 'win32') return;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-translate-locales-'));
  const helper = fileURLToPath(new URL('../ui/native-language.ps1', import.meta.url));
  try {
    for (const [lang, expected] of [['ru', 'Включить'], ['zh', '开启'], ['en', 'Turn on'], ['invalid', 'Turn on']]) {
      fs.writeFileSync(path.join(temp, 'provider-ui-state.json'), JSON.stringify({ uiLang: lang }));
      const quote = v => `'${v.replaceAll("'", "''")}'`;
      const output = spawnSync(psPath(), ['-NoProfile', '-NonInteractive', '-Command',
        `[Console]::OutputEncoding = [Text.Encoding]::UTF8; . ${quote(helper)}; Initialize-UiLanguage ${quote(temp)}; @{ label = (Get-UiText 'turnOn'); error = (Get-UiError 'Remote servers require HTTPS.') } | ConvertTo-Json -Compress`
      ], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
      assert.equal(output.status, 0, output.stderr);
      const text = JSON.parse(output.stdout.trim());
      assert.equal(text.label, expected);
      assert.match(text.error, lang === 'ru' ? /удалённых/ : lang === 'zh' ? /远程服务器/ : /Remote servers/);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('translation probes and action notifications use the selected language', async () => {
  const snapshot = { connections: [], models: [], languages: [], translator: {} };
  for (const [lang, success, notice] of [['ru', 'Успешно', 'Иконка'], ['zh', '成功', '系统托盘'], ['en', 'Success', 'system tray']]) {
    const r = renderer(true);
    r.setFetch(async (_url, options) => {
      const { action } = JSON.parse(options.body);
      return { json: async () => ({ ok: true, value: action === 'snapshot' ? snapshot : { status: 'online', detail: 'Перевод User → EN (3 мс): "Hello"' } }) };
    });
    r.run(`state = ${JSON.stringify(snapshot)}; applyUiLanguage('${lang}');`);
    await r.run("$('dash-test-translator').onclick()");
    assert.ok(r.document.getElementById('dash-probe-result').textContent.includes(success));
    await r.run("$('dash-start-tray').onclick()");
    assert.ok(r.document.getElementById('notice').textContent.includes(notice));
    if (lang !== 'ru') assert.doesNotMatch(r.document.getElementById('dash-probe-result').textContent, /Успешно|Перевод|мс/);
    r.run("applyUiLanguage('zh')");
    assert.ok(r.document.getElementById('dash-probe-result').textContent.includes('成功'));
  }
});

test('application progress and errors translate without changing provider-supplied details', () => {
  const r = renderer();
  r.run("currentUiLang = 'zh'");
  assert.match(r.run("localizeMessage('Перевод запроса пользователя (User → EN)…')"), /用户/);
  assert.match(r.run("localizeMessage('Перевод ответа агента (EN → RU · чанк 1/2)…')"), /分段 1\/2/);
  assert.match(r.run("localizeMessage('Получен потоковый ответ')"), /流式响应/);
  assert.match(r.run("localizeMessage('literal_integrity')"), /受保护/);
  assert.match(r.run("localizeMessage('GPT-6.1-Sol (Codex Workhorse)')"), /主力模型/);
  assert.equal(r.run("localizeMessage('Provider detail: model-alpha rejected input')"), 'Provider detail: model-alpha rejected input');
});

test('populated model economics translates cost labels while preserving model IDs', () => {
  const r = renderer();
  const pricing = {
    presetId: 'model-alpha',
    priceInPerMillion: 2,
    priceCachedPerMillion: 0.2,
    priceCacheWrite30mPerMillion: 2.5,
    priceCacheWrite12hPerMillion: 5.0,
    priceOutPerMillion: 8
  };
  const kpi = { turnsCount: 1, tokensSavedTotal: 100, netSavedUsd: 0.1, netSavingsPercent: 10 };
  const snapshot = {
    connections: [], models: [], languages: [], translator: {},
    economics: {
      activeCodexModel: 'model-alpha', pricing, kpi,
      codexReasoningEffort: 'medium',
      codexServiceTier: 'priority',
      periods: { all: { kpi, byModel: [{ model: 'model-alpha', pricing, turnsCount: 1 }] } },
      modelRates: [
        { id: 'model-alpha', name: 'model-alpha', description: 'Наша последняя и самая совершенная модель', contextWindow: 500000, ...pricing },
        { id: 'codex-auto-review', name: 'Codex Auto Review', description: 'Automatic approval review model for Codex.', contextWindow: 272000, ...pricing }
      ],
      recentTurns: [{ step: 1, model: 'model-alpha', reasoningEffort: 'medium', inCacheWrite: 100, cacheWriteWindow: '30m', at: '2026-01-01T12:00:00Z' }]
    }
  };
  r.run(`state = ${JSON.stringify(snapshot)};`);
  for (const lang of ['ru', 'zh', 'en']) {
    r.run(`applyUiLanguage('${lang}')`);
    assert.equal(r.document.getElementById('brand-version').textContent, 'v1.0.0');
    assert.match(r.document.title, /v1\.0\.0/);
    const table = r.document.getElementById('econ-by-model-tbody').textContent;
    const ratesTable = r.document.getElementById('econ-models-rate-tbody').textContent;
    const turnsTable = r.document.getElementById('econ-turns-tbody').textContent;
    assert.ok(table.includes('model-alpha'));
    assert.match(table, /\$2\.00/);
    assert.match(r.document.getElementById('econ-active-tariff-pill').textContent, /\$2\.00/);
    if (lang === 'en') {
      assert.match(ratesTable, /Our latest and most advanced model/);
      assert.doesNotMatch(ratesTable, /Наша последняя/);
      assert.match(turnsTable, /\[Medium\]/);
    } else if (lang === 'ru') {
      assert.match(ratesTable, /Наша последняя и самая совершенная модель/);
      assert.match(ratesTable, /Модель автоматической проверки разрешений для Codex\./);
      assert.match(turnsTable, /\[Средний\]/);
      assert.match(turnsTable, /30м/);
    } else if (lang === 'zh') {
      assert.match(ratesTable, /我们最新、最先进的模型/);
      assert.match(ratesTable, /Codex 自动审批评估模型。/);
      assert.match(turnsTable, /\[中\]/);
      assert.match(turnsTable, /30分钟/);
    }
    if (lang !== 'en') {
      const prose = table + r.document.getElementById('econ-kpi-cache-sub').textContent + r.document.getElementById('econ-active-tariff-pill').textContent;
      assert.doesNotMatch(prose, /\b(?:In|Input|Cache|Out|Hit|input tokens)\b/);
    }
  }
});

test('quick switcher renders the saved language and preserves reasoning API values', () => {
  if (process.platform !== 'win32') return;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-translate-native-ui-'));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const codexHome = path.join(temp, 'codex');
  fs.mkdirSync(codexHome);
  fs.writeFileSync(path.join(temp, 'state.json'), JSON.stringify({ selected: 'test', connections: { test: { baseURL: 'https://example.invalid/v1', model: 'model-alpha', models: [{ id: 'model-alpha', eligible: true, context: 200000, efforts: ['low', 'medium'] }] } } }));
  fs.writeFileSync(path.join(temp, 'translator.json'), JSON.stringify({ connectionId: 'test', model: 'model-alpha', effort: 'low' }));
  try {
    for (const [lang, label] of [['en', 'Turn on'], ['ru', 'Включить'], ['zh', '开启']]) {
      fs.writeFileSync(path.join(temp, 'provider-ui-state.json'), JSON.stringify({ uiLang: lang }));
      const output = spawnSync(psPath(), ['-NoProfile', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'Switch.ps1'), '-Check', '-DataDirectory', temp, '-CodexHome', codexHome], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
      assert.equal(output.status, 0, output.stderr);
      const rendered = JSON.parse(output.stdout.trim());
      assert.equal(rendered.interfaceLanguage, lang);
      assert.equal(rendered.toggleButtonText, label);
      assert.equal(rendered.selectedEffort, 'low');
      assert.notEqual(rendered.selectedEffortLabel, 'low');
      assert.ok(rendered.modelDetails.length > 10);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('installed plugin cache includes the guide and native language resources', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-translate-cache-'));
  const root = fileURLToPath(new URL('../', import.meta.url));
  try {
    assert.equal(syncPluginCache(temp, root), true);
    for (const relative of [
      'INSTALLATION.md',
      'Install-Plugin for Windows.cmd',
      'Install-Plugin for MacOS.command',
      'Install-Plugin for MacOS.sh',
      'Install-Plugin for Linux.sh',
      'install-plugin.sh',
      'panel.sh',
      'switch.sh',
      'setup.sh',
      'ui/index.html',
      'ui/renderer.js',
      'ui/native-language.ps1',
      'ui/native-strings.json'
    ]) {
      assert.deepEqual(fs.readFileSync(path.join(temp, 'plugins/cache/codex-translate-local/codex-translate/1.0.0', relative)), fs.readFileSync(path.join(root, relative)));
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
