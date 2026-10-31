'use strict';

const $ = id => document.getElementById(id);
const timers = new Map();
const kinds = {
  omniroute: 'OmniRoute Gateway',
  responses: 'OpenAI Responses',
  chat_completions: 'OpenAI Chat Completions',
  anthropic: 'Anthropic Messages'
};

let state = null;
let connectionId = null;
let editing = false;
let saving = 0;
let uiStateApplied = false;
let selectedEconPeriod = 'all';
let currentUiLang = 'en';
let pending = Promise.resolve();
let reloading = Promise.resolve();
let probeResult = null;

const I18N = {
  en: {
    'page.title': 'Codex Translate — Control Panel',
    'side.uiLangLabel': 'Interface Language',
    'side.statusLabel': 'Translator Status',
    'side.turnOn': 'Turn ON',
    'side.turnOff': 'Turn OFF',
    'nav.translator': 'Translator (ON/OFF)',
    'nav.economics': 'Token Economics',
    'nav.connections': 'API Providers',
    'nav.models': 'Translator Models',
    'side.restartDesktop': '↻ Restart ChatGPT / Codex',
    'dash.title': 'Intermediary Translator (User ↔ Agent)',
    'dash.subtitle': 'Intercepts and translates your prompts into English for the Agent and translates the Agent responses back into your language to save tokens and usage limits.',
    'econ.title': 'Token Economics & Prompt Caching',
    'econ.subtitle': 'Actual vs. virtual BPE tokenization costs, Prompt Caching efficiency, and net savings in tokens and USD.',
    'conn.title': 'Translator API Providers',
    'conn.subtitle': 'Connect external API servers (OpenAI, Anthropic, or compatible gateways) to power translation while preserving your base ChatGPT/Codex connection.',
    'models.title': 'Translator Models',
    'models.subtitle': 'Filter, check availability (Online/Offline), and select the model used by the translator.',
    'dash.pluginHeader': 'Codex / ChatGPT Plugin & Interception',
    'dash.statTranslator': 'Translator (User ↔ EN ↔ Agent):',
    'dash.statIntercept': 'Interception in config.toml:',
    'dash.statGateway': 'Local Gateway:',
    'dash.statTranslated': 'Messages Translated:',
    'dash.statEconomics': 'Saved (Token Economics):',
    'dash.btnEnable': '✓ Turn ON Translator',
    'dash.btnDisable': '✕ Turn OFF Translator',
    'dash.btnOpenEcon': '📊 Open Token Economics Dashboard',
    'dash.btnInstall': 'Install / Enable Interception',
    'dash.btnDirect': 'Direct Connection (No Translation)',
    'dash.btnTray': '🗔 Launch System Tray Icon (CT)',
    'dash.settingsHeader': 'Translator Settings (User → EN → Agent → Your Language)',
    'dash.enableToggle': 'Enable bidirectional User ↔ Agent translation',
    'dash.liveActivity': 'Live Translation Activity:',
    'dash.autoLangToggle': 'Priority #1: Reply in the user prompt language (auto-detect)',
    'dash.showIndicatorsToggle': 'Show translation confirmation badge in chat messages',
    'dash.fallbackLangLabel': 'Priority #2: Fallback reply language (if prompt is in English)',
    'dash.searchLangPlaceholder': 'Search language…',
    'dash.translatorModelLabel': 'Translator Model (from your API provider)',
    'dash.searchModelPlaceholder': 'Search model…',
    'dash.effortLabel': 'Effort (reasoning level)',
    'dash.effortDefault': 'Default (auto)',
    'dash.customPromptLabel': 'Additional Translator Prompt (Custom Instructions)',
    'dash.customPromptPlaceholder': 'e.g., Keep a formal tone, do not translate React component names or domain terms…',
    'dash.btnSaveSettings': 'Save Translator Settings',
    'dash.btnTestTranslation': 'Test Translation',
    'dash.hint': 'Markdown tables, code blocks, file paths, URLs, and identifiers are protected with cryptographic markers (`__CT_...__`). Images and file attachments are forwarded directly to the Agent without being sent to the translator.',
    'econ.activeModelLabel': 'Active model in ChatGPT / Codex (auto-sync)',
    'econ.period.today': 'Today',
    'econ.period.week': 'Week',
    'econ.period.month': 'Month',
    'econ.period.all': 'All Time',
    'econ.autoTariff': 'Auto-tariff from ChatGPT / Codex',
    'econ.kpi.netSaved': '🎯 Real Translator Benefit (Net Saved)',
    'econ.kpi.tokensSpentSaved': '🪙 Tokens Spent & Saved',
    'econ.kpi.totalSpent': '💵 Actual Cost in Money (Total Spent $)',
    'econ.kpi.cacheDynamics': '⚡ Prompt Cache Dynamics',
    'econ.pcard.today': '📅 Today',
    'econ.pcard.week': '📆 Past 7 Days (Week)',
    'econ.pcard.month': '🗓️ Past 30 Days (Month)',
    'econ.pcard.tokensSpent': 'Tokens spent (Actual):',
    'econ.pcard.moneySpent': 'Money spent (Actual):',
    'econ.pcard.cacheDyn': 'Cache dynamics (Hit % / $):',
    'econ.pcard.benefit': 'Translator benefit:',
    'econ.table.title': 'Unified Unit-Economics & Dynamics Table by Model',
    'econ.table.subtitle': 'Actual token and money spend, prompt cache dynamics, and real translator savings broken down for each model used.',
    'econ.th.model': 'Model & Rate ($/1M)',
    'econ.th.turns': 'Turns',
    'econ.th.actualTokens': 'Tokens Spent (Actual: New / Cache / Out)',
    'econ.th.actualUsd': 'Money Spent (Actual $)',
    'econ.th.cacheDyn': 'Cache Dynamics (Hit % · Saved $)',
    'econ.th.withoutTrans': 'Without Translator (Tokens · $)',
    'econ.th.savedTokens': 'Tokens Saved (Compression)',
    'econ.th.netBenefit': 'Real Translator Benefit ($ & %)',
    'econ.th.totalBenefit': 'Total Benefit (Trans + Cache)',
    'econ.table.empty': 'No data for the selected period.',
    'econ.structure.title': 'Input Token Structure',
    'econ.structure.desc': 'Ratio of cached input tokens (green), new English tokens (blue), and tokens eliminated by translating from your native language to English (gray dashed).',
    'econ.structure.cached': 'Cached Tokens (Cached EN)',
    'econ.structure.uncached': 'New EN Tokens (Uncached EN)',
    'econ.structure.cutoff': 'Cut Off by Translation',
    'econ.chart.title': 'Cumulative Cost Dynamics',
    'econ.chart.virtual': '--- Without Plugin (Native Lang)',
    'econ.chart.actual': '─── With Plugin (EN + Cache)',
    'econ.blocks.title': 'Separated Scenario Blocks: No Cache vs With Cache · Without Translation vs With Translation',
    'econ.blocks.badge': 'All 4 Scenarios Breakdown',
    'econ.b1.title': '1. Without Translation · No Cache',
    'econ.b1.in': 'All Input (Native, full rate):',
    'econ.b1.cached': 'Cached Input:',
    'econ.b1.out': 'Output (Native):',
    'econ.b1.cacheSaved': 'Cache savings:',
    'econ.b1.trans': 'Translator cost:',
    'econ.b1.total': 'Cost without translation & cache:',
    'econ.b2.title': '2. Without Translation · With Cache',
    'econ.b2.uncached': 'Uncached Input (Native):',
    'econ.b2.cached': 'Cached Input (Native Cached):',
    'econ.b2.out': 'Output (Native):',
    'econ.b2.cacheSaved': 'Cache discount (native):',
    'econ.b2.trans': 'Translator cost:',
    'econ.b2.total': 'Cost without translation (cached):',
    'econ.b3.title': '3. With Translation (EN) · No Cache',
    'econ.b3.in': 'All Input (EN, full rate):',
    'econ.b3.cached': 'Cached Input:',
    'econ.b3.out': 'Output (EN):',
    'econ.b3.trans': 'Translator cost:',
    'econ.b3.savedVsB1': 'Translation-only benefit (vs Block 1):',
    'econ.b3.total': 'Cost with translation (no cache):',
    'econ.b4.title': '4. With Translation (EN) · With Cache (ACTUAL)',
    'econ.b4.badge': 'Actual Spend',
    'econ.b4.uncached': 'Uncached Input (EN):',
    'econ.b4.cached': 'Cached Input (EN Cached):',
    'econ.b4.out': 'Output (EN):',
    'econ.b4.cacheSaved': 'Cache discount (EN Cache Saved):',
    'econ.b4.trans': 'Translator cost:',
    'econ.b4.total': 'Actual cost (EN + Cache):',
    'econ.sum.title': 'Consolidated Summary: Without Translation vs With Translation',
    'econ.sum.badge': 'Consolidated Balance',
    'econ.sum.thMetric': 'Metric / Cost Item',
    'econ.sum.thWithout': 'Total WITHOUT TRANSLATION (Native)',
    'econ.sum.thWith': 'Total WITH TRANSLATION (EN)',
    'econ.sum.thDelta': 'Difference / Net Benefit',
    'econ.sum.r1': '1. Uncached Input Tokens',
    'econ.sum.r2': '2. Cached Input Tokens',
    'econ.sum.r3': '3. Total Input Tokens (Uncached + Cached)',
    'econ.sum.r4': '4. Output Tokens',
    'econ.sum.r5': '5. Total Dialogue Tokens (Input + Output)',
    'econ.sum.r6': '6. Cost WITHOUT Caching (100% full rate)',
    'econ.sum.r7': '7. Savings from Prompt Caching Discount',
    'econ.sum.r8': '8. Translator Overhead Cost',
    'econ.sum.r9': 'FINAL TOTAL WITH CACHE',
    'econ.sum.r10': 'Combined Benefit (Translation + Cache) vs Uncached Native Baseline',
    'econ.rates.title': 'Codex Per-Model Tariff Configuration (Input · Output · Caching per 1M Tokens)',
    'econ.rates.syncLive': '↻ Sync OpenAI Prices',
    'econ.rates.exportCsv': '⬇ Export CSV',
    'econ.rates.exportJson': '⬇ Export JSON',
    'econ.rates.resetSession': 'Reset Session Stats',
    'econ.rates.desc': 'Select any Codex model (`gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-*`) or custom preset to configure its input ($/1M), cached input ($/1M or discount %), and output ($/1M) token rates. New rates apply from today without altering historical past days.',
    'econ.rates.modelSelect': 'Model for configuration / calculation',
    'econ.rates.priceIn': 'Input ($ per 1M, P_in)',
    'econ.rates.priceCached': 'Cached Input ($ per 1M, P_cached)',
    'econ.rates.cacheDisc': 'Cache Discount (% off Input)',
    'econ.rates.priceWrite30m': '30m Cache Write ($ per 1M)',
    'econ.rates.priceWrite12h': '12h Cache Write ($ per 1M)',
    'econ.rates.priceOut': 'Output ($ per 1M, P_out)',
    'econ.rates.priceTrans': 'Translator ($ per 1M, C_trans)',
    'econ.rates.saveBtn': '💾 Save Rate for Selected Model',
    'econ.rates.resetBtn': '↺ Reset Model Rate to Default',
    'econ.rates.thModel': 'Codex Model',
    'econ.rates.thDesc': 'Description / Context',
    'econ.rates.thIn': 'Input ($ / 1M)',
    'econ.rates.thCache': 'Caching ($ / 1M · Discount %)',
    'econ.rates.thOut': 'Output ($ / 1M)',
    'econ.rates.thStatus': 'Tariff Status',
    'econ.rates.thAction': 'Action',
    'econ.turns.title': 'Turn-by-Turn Request Log',
    'econ.turns.thStep': 'Step # · Model · Effort',
    'econ.turns.thIn': 'In (Cached / New EN)',
    'econ.turns.thOut': 'Out (EN / Virtual)',
    'econ.turns.thSavedTok': 'Tokens Saved',
    'econ.turns.thPrice': 'Request Cost ($)',
    'econ.turns.thBenefit': 'Benefit ($)',
    'econ.turns.empty': 'No requests recorded in the current session yet. Send a message to the Agent while the translator is enabled.',
    'conn.addBtn': '＋ Add Translator API Provider',
    'conn.toolbarHint': 'Connect an external API that will translate messages (your base ChatGPT/Codex connection remains untouched)',
    'conn.makePrimary': 'Make Primary',
    'conn.remove': 'Remove',
    'conn.nameLabel': 'Connection Name',
    'conn.namePlaceholder': 'e.g., Translator API Provider',
    'conn.kindLabel': 'Translator API Protocol',
    'conn.urlLabel': 'Translator Server Base URL',
    'conn.keyLabel': 'API Key (encrypted via Windows DPAPI)',
    'conn.refreshBtn': 'Load / Refresh Models',
    'conn.checkBtn': 'Check Model Status (Online/Offline)',
    'models.searchPlaceholder': 'Search translator models by ID or name…',
    'models.refreshAll': 'Refresh All Catalogs',
    'models.unchecked': 'Unchecked',
    'models.batch10': 'Batch of 10',
    'models.batch20': 'Batch of 20',
    'models.checkAll': 'Check All Models',
    'models.stop': 'Stop',
    'models.enableVisible': 'Enable Visible',
    'models.disableVisible': 'Disable Visible',
    'models.thConn': 'Connection',
    'models.thModel': 'Model (Context · Efforts)',
    'models.thStatus': 'Status',
    'models.thAction': 'Action',
    'models.thEnabled': 'Enabled',
    'footer.text': 'The translator intercepts requests on the fly without replacing your base ChatGPT / Codex model. Turning ON / OFF takes effect immediately.',
    'side.sectionsLabel': 'Sections',
    'side.note': 'Your base ChatGPT and Codex models are preserved. User → English → Agent → your language. API keys are encrypted with Windows DPAPI.',
    'models.online': 'Online',
    'models.offline': 'Offline',
    'models.allConnections': 'All connections',
    'conn.editorTitle': 'Translator Connection',
    'conn.keyPlaceholder': 'Enter API key',
    'conn.protocol.omniroute': 'OmniRoute gateway (/v1/responses)',
    'conn.protocol.responses': 'OpenAI Responses API (/v1/responses)',
    'conn.protocol.chat_completions': 'OpenAI Chat Completions (/v1/chat/completions)',
    'conn.protocol.anthropic': 'Anthropic Messages (/v1/messages)',
    'a11y.period': 'Statistics period',
    'a11y.connectionFilter': 'Connection filter',
    'a11y.batchSize': 'Models per batch',
    'econ.nativeNoCache': 'Native language · No cache',
    'econ.nativeCache': 'Native language · With cache',
    'econ.englishNoCache': 'English · No cache',
    'econ.ratio': 'Compression ratio',
    'econ.zeroTokens': '0 tok. ($0.0000)'
  },
  ru: {
    'page.title': 'Codex Translate — Панель управления',
    'side.uiLangLabel': 'Язык интерфейса',
    'side.statusLabel': 'Статус переводчика',
    'side.turnOn': 'Включить',
    'side.turnOff': 'Выключить',
    'nav.translator': 'Переводчик',
    'nav.economics': 'Экономика токенов',
    'nav.connections': 'API-провайдеры',
    'nav.models': 'Модели переводчика',
    'side.restartDesktop': '↻ Перезапустить ChatGPT / Codex',
    'dash.title': 'Переводчик между пользователем и агентом',
    'dash.subtitle': 'Перехват и перевод ваших запросов на английский для Агента и перевод ответов Агента обратно на ваш язык для экономии токенов и лимитов.',
    'econ.title': 'Экономика токенов и кэширование запросов',
    'econ.subtitle': 'Фактические и расчётные затраты на токены, эффективность кэширования запросов и чистая экономия в токенах и долларах.',
    'conn.title': 'API-провайдеры переводчика',
    'conn.subtitle': 'Подключите серверы API (OpenAI, Anthropic или совместимые шлюзы), которые будут выполнять перевод (базовое подключение ChatGPT/Codex сохраняется).',
    'models.title': 'Модели переводчика',
    'models.subtitle': 'Фильтруйте модели, проверяйте их доступность и выбирайте модель для перевода.',
    'dash.pluginHeader': 'Плагин и перехват в ChatGPT / Codex',
    'dash.statTranslator': 'Переводчик (Пользователь ↔ EN ↔ Агент):',
    'dash.statIntercept': 'Перехват в config.toml:',
    'dash.statGateway': 'Локальный шлюз:',
    'dash.statTranslated': 'Переведено сообщений:',
    'dash.statEconomics': 'Экономия токенов и средств:',
    'dash.btnEnable': '✓ Включить переводчик',
    'dash.btnDisable': '✕ Выключить переводчик',
    'dash.btnOpenEcon': '📊 Открыть экономику токенов',
    'dash.btnInstall': 'Установить / Включить перехват',
    'dash.btnDirect': 'Прямое соединение (без перевода)',
    'dash.btnTray': '🗔 Запустить иконку в трее (CT)',
    'dash.settingsHeader': 'Настройки двустороннего перевода',
    'dash.enableToggle': 'Включить двусторонний перевод сообщений (Пользователь ↔ Агент)',
    'dash.liveActivity': 'Активность переводчика в реальном времени:',
    'dash.autoLangToggle': 'Приоритет №1: Отвечать на языке сообщения пользователя (автоопределение)',
    'dash.showIndicatorsToggle': 'Показывать плашку-подтверждение перевода в сообщениях чата',
    'dash.fallbackLangLabel': 'Приоритет №2: Резервный язык ответа (если запрос на английском)',
    'dash.searchLangPlaceholder': 'Поиск языка…',
    'dash.translatorModelLabel': 'Модель переводчика (из подключённого API-провайдера)',
    'dash.searchModelPlaceholder': 'Поиск модели…',
    'dash.effortLabel': 'Уровень рассуждений переводчика',
    'dash.effortDefault': 'По умолчанию (авто)',
    'dash.customPromptLabel': 'Дополнительные инструкции переводчику',
    'dash.customPromptPlaceholder': 'Например: Сохраняй деловой тон, не переводи названия таблиц БД и термины React-компонентов…',
    'dash.btnSaveSettings': 'Сохранить настройки переводчика',
    'dash.btnTestTranslation': 'Проверить перевод (Тест)',
    'dash.hint': 'Таблицы Markdown, блоки кода, пути к файлам, URL и идентификаторы защищены криптографическими маркерами (`__CT_...__`). Изображения и вложения передаются Агенту напрямую.',
    'econ.activeModelLabel': 'Активная модель в ChatGPT / Codex (авто-синхронизация)',
    'econ.period.today': 'Сегодня',
    'econ.period.week': 'За неделю',
    'econ.period.month': 'За месяц',
    'econ.period.all': 'За всё время',
    'econ.autoTariff': 'Авто-тариф из ChatGPT / Codex',
    'econ.kpi.netSaved': '🎯 Чистая выгода от перевода',
    'econ.kpi.tokensSpentSaved': '🪙 Расход и экономия токенов',
    'econ.kpi.totalSpent': '💵 Фактические расходы',
    'econ.kpi.cacheDynamics': '⚡ Эффективность кэширования запросов',
    'econ.pcard.today': '📅 Сегодня',
    'econ.pcard.week': '📆 За неделю (7 дней)',
    'econ.pcard.month': '🗓️ За месяц (30 дней)',
    'econ.pcard.tokensSpent': 'Потрачено токенов (Факт):',
    'econ.pcard.moneySpent': 'Потрачено в деньгах (Факт):',
    'econ.pcard.cacheDyn': 'Попадания в кэш (% / экономия $):',
    'econ.pcard.benefit': 'Польза переводчика:',
    'econ.table.title': 'Затраты и экономия по моделям',
    'econ.table.subtitle': 'Фактический расход токенов и денег, динамика кэша и реальная экономия от переводчика в разрезе каждой модели.',
    'econ.th.model': 'Модель и тариф ($ за 1 млн)',
    'econ.th.turns': 'Шагов',
    'econ.th.actualTokens': 'Фактические токены (новые / кэш / ответ)',
    'econ.th.actualUsd': 'Потрачено в деньгах (Факт $)',
    'econ.th.cacheDyn': 'Кэш (попадания % · экономия $)',
    'econ.th.withoutTrans': 'Без переводчика (Токены · $)',
    'econ.th.savedTokens': 'Сэкономлено токенов (Сжатие)',
    'econ.th.netBenefit': 'Реальная выгода переводчика ($ и %)',
    'econ.th.totalBenefit': 'Общая выгода (Перевод + Кэш)',
    'econ.table.empty': 'Нет данных за выбранный период.',
    'econ.structure.title': 'Структура входных токенов',
    'econ.structure.desc': 'Соотношение кэшированных токенов (зелёный), новых английских токенов (синий) и токенов, отсечённых благодаря переводу с родного языка на английский (серый пунктир).',
    'econ.structure.cached': 'Входные токены из кэша (английский)',
    'econ.structure.uncached': 'Новые входные токены (английский)',
    'econ.structure.cutoff': 'Токены, сэкономленные переводом',
    'econ.chart.title': 'Накопительный график расходов',
    'econ.chart.virtual': '--- Без плагина (родной язык)',
    'econ.chart.actual': '─── С плагином (английский + кэш)',
    'econ.blocks.title': 'Четыре сценария: с переводом и без перевода, с кэшем и без кэша',
    'econ.blocks.badge': 'Детализация всех 4 сценариев',
    'econ.b1.title': '1. Без перевода · Без кэширования',
    'econ.b1.in': 'Весь ввод на родном языке (полный тариф):',
    'econ.b1.cached': 'Входные токены из кэша:',
    'econ.b1.out': 'Ответ на родном языке:',
    'econ.b1.cacheSaved': 'Экономия от кэша:',
    'econ.b1.trans': 'Затраты на переводчик:',
    'econ.b1.total': 'Расход без перевода и без кэша:',
    'econ.b2.title': '2. Без перевода · С кэшированием',
    'econ.b2.uncached': 'Новые входные токены на родном языке:',
    'econ.b2.cached': 'Входные токены из кэша на родном языке:',
    'econ.b2.out': 'Ответ на родном языке:',
    'econ.b2.cacheSaved': 'Скидка кэша (без перевода):',
    'econ.b2.trans': 'Затраты на переводчик:',
    'econ.b2.total': 'Расход без перевода (с кэшем):',
    'econ.b3.title': '3. С переводом (EN) · Без кэширования',
    'econ.b3.in': 'Весь ввод на английском (полный тариф):',
    'econ.b3.cached': 'Входные токены из кэша:',
    'econ.b3.out': 'Ответ на английском:',
    'econ.b3.trans': 'Затраты на переводчик:',
    'econ.b3.savedVsB1': 'Выгода только от перевода (к сценарию 1):',
    'econ.b3.total': 'Расход с переводом (без кэша):',
    'econ.b4.title': '4. С переводом (EN) · С кэшированием (ФАКТ)',
    'econ.b4.badge': 'Реальный расход',
    'econ.b4.uncached': 'Новые входные токены на английском:',
    'econ.b4.cached': 'Входные токены из кэша на английском:',
    'econ.b4.out': 'Ответ на английском:',
    'econ.b4.cacheSaved': 'Экономия на кэшировании:',
    'econ.b4.trans': 'Затраты на переводчик:',
    'econ.b4.total': 'Фактический расход (EN + Кэш):',
    'econ.sum.title': 'Итоговое сравнение: без перевода и с переводом',
    'econ.sum.badge': 'Сводный баланс',
    'econ.sum.thMetric': 'Метрика / Статья расхода',
    'econ.sum.thWithout': 'БЕЗ ПЕРЕВОДА (родной язык)',
    'econ.sum.thWith': 'Итого С ПЕРЕВОДОМ (EN)',
    'econ.sum.thDelta': 'Разница / Чистая выгода',
    'econ.sum.r1': '1. Входные токены без кэша',
    'econ.sum.r2': '2. Входные токены из кэша',
    'econ.sum.r3': '3. Всего входных токенов (новые + кэш)',
    'econ.sum.r4': '4. Токены ответа',
    'econ.sum.r5': '5. Всего токенов диалога (ввод + ответ)',
    'econ.sum.r6': '6. Стоимость БЕЗ кэширования (100% полный тариф)',
    'econ.sum.r7': '7. Экономия за счёт кэширования запросов',
    'econ.sum.r8': '8. Затраты на переводчик',
    'econ.sum.r9': 'ИТОГОВАЯ СТОИМОСТЬ С УЧЁТОМ КЭША',
    'econ.sum.r10': 'Суммарная выгода (Перевод + Кэш) относительно нативного запроса без кэша',
    'econ.rates.title': 'Тарифы моделей Codex: ввод, ответ и кэширование за 1 млн токенов',
    'econ.rates.syncLive': '↻ Обновить тарифы OpenAI',
    'econ.rates.exportCsv': '⬇ Экспорт CSV',
    'econ.rates.exportJson': '⬇ Экспорт JSON',
    'econ.rates.resetSession': 'Сбросить статистику сессии',
    'econ.rates.desc': 'Выберите любую модель Codex (`gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-*`) для настройки стоимости входящих ($/1M), кэшированных ($/1M или % скидки) и исходящих ($/1M) токенов. Новые тарифы применяются начиная с сегодняшнего дня, не меняя статистику прошлых дней.',
    'econ.rates.modelSelect': 'Модель для настройки / расчёта',
    'econ.rates.priceIn': 'Ввод ($ за 1 млн, P_in)',
    'econ.rates.priceCached': 'Ввод из кэша ($ за 1 млн, P_cached)',
    'econ.rates.cacheDisc': 'Скидка за кэширование (% от цены ввода)',
    'econ.rates.priceWrite30m': 'Запись в кэш 30м ($ за 1 млн)',
    'econ.rates.priceWrite12h': 'Запись в кэш 12ч ($ за 1 млн)',
    'econ.rates.priceOut': 'Ответ ($ за 1 млн, P_out)',
    'econ.rates.priceTrans': 'Переводчик ($ за 1 млн, C_trans)',
    'econ.rates.saveBtn': '💾 Сохранить тариф для выбранной модели',
    'econ.rates.resetBtn': '↺ Сбросить тариф модели по умолчанию',
    'econ.rates.thModel': 'Модель Codex',
    'econ.rates.thDesc': 'Описание / Контекст',
    'econ.rates.thIn': 'Ввод ($ за 1 млн)',
    'econ.rates.thCache': 'Кэш ($ / 1 млн · скидка %)',
    'econ.rates.thOut': 'Ответ ($ за 1 млн)',
    'econ.rates.thStatus': 'Статус тарифа',
    'econ.rates.thAction': 'Действие',
    'econ.turns.title': 'Пошаговый журнал запросов',
    'econ.turns.thStep': 'Шаг · Модель · Уровень рассуждений',
    'econ.turns.thIn': 'Ввод (кэш / новые на английском)',
    'econ.turns.thOut': 'Ответ (английский / расчёт на родном языке)',
    'econ.turns.thSavedTok': 'Сэкономлено токенов',
    'econ.turns.thPrice': 'Цена запроса ($)',
    'econ.turns.thBenefit': 'Выгода ($)',
    'econ.turns.empty': 'Запросов в текущей сессии пока нет. Отправьте сообщение Агенту при включённом переводчике.',
    'conn.addBtn': '＋ Добавить API-провайдер для переводчика',
    'conn.toolbarHint': 'Подключите внешний API, который будет выполнять перевод сообщений (базовое подключение ChatGPT/Codex не заменяется)',
    'conn.makePrimary': 'Сделать основным',
    'conn.remove': 'Удалить',
    'conn.nameLabel': 'Название подключения',
    'conn.namePlaceholder': 'Например, API-провайдер переводчика',
    'conn.kindLabel': 'Тип API протокола переводчика',
    'conn.urlLabel': 'Базовый URL сервера переводчика',
    'conn.keyLabel': 'API-ключ (шифрование Windows DPAPI)',
    'conn.refreshBtn': 'Загрузить / обновить модели',
    'conn.checkBtn': 'Проверить статус моделей (доступна/недоступна)',
    'models.searchPlaceholder': 'Найти модель переводчика по ID или названию…',
    'models.refreshAll': 'Обновить все каталоги',
    'models.unchecked': 'Не проверены',
    'models.batch10': 'По 10 моделей',
    'models.batch20': 'По 20 моделей',
    'models.checkAll': 'Проверить все модели',
    'models.stop': 'Остановить',
    'models.enableVisible': 'Включить видимые',
    'models.disableVisible': 'Выключить видимые',
    'models.thConn': 'Подключение',
    'models.thModel': 'Модель (контекст · уровни рассуждений)',
    'models.thStatus': 'Статус',
    'models.thAction': 'Действие',
    'models.thEnabled': 'Доступна',
    'footer.text': 'Переводчик перехватывает запросы без изменения базовой модели ChatGPT / Codex. Включение и выключение применяются сразу.',
    'side.sectionsLabel': 'Разделы',
    'side.note': 'Базовые модели ChatGPT и Codex сохраняются. Пользователь → английский → агент → ваш язык. API-ключи зашифрованы средствами Windows DPAPI.',
    'models.online': 'Доступна',
    'models.offline': 'Недоступна',
    'models.allConnections': 'Все подключения',
    'conn.editorTitle': 'Подключение переводчика',
    'conn.keyPlaceholder': 'Введите API-ключ',
    'conn.protocol.omniroute': 'Шлюз OmniRoute (/v1/responses)',
    'conn.protocol.responses': 'OpenAI Responses API (/v1/responses)',
    'conn.protocol.chat_completions': 'OpenAI Chat Completions (/v1/chat/completions)',
    'conn.protocol.anthropic': 'Anthropic Messages (/v1/messages)',
    'a11y.period': 'Период статистики',
    'a11y.connectionFilter': 'Фильтр подключений',
    'a11y.batchSize': 'Моделей в группе проверки',
    'econ.nativeNoCache': 'Родной язык · Без кэша',
    'econ.nativeCache': 'Родной язык · С кэшем',
    'econ.englishNoCache': 'Английский · Без кэша',
    'econ.ratio': 'Коэффициент сжатия',
    'econ.zeroTokens': '0 ток. ($0.0000)'
  },
  zh: {
    'page.title': 'Codex Translate — 控制面板',
    'side.uiLangLabel': '界面语言',
    'side.statusLabel': '翻译器状态',
    'side.turnOn': '开启',
    'side.turnOff': '关闭',
    'nav.translator': '翻译器',
    'nav.economics': '词元成本分析',
    'nav.connections': 'API 提供商',
    'nav.models': '翻译器模型',
    'side.restartDesktop': '↻ 重启 ChatGPT / Codex',
    'dash.title': '用户与智能体之间的双向翻译',
    'dash.subtitle': '拦截并将您的提示词翻译为英文发送给 智能体，再将 智能体 的回复翻译回您的母语，从而节省词元与配额限制。',
    'econ.title': '词元成本与提示缓存',
    'econ.subtitle': '比较实际与估算的词元费用，查看提示缓存效率以及词元和美元的净节省。',
    'conn.title': '翻译器 API 提供商',
    'conn.subtitle': '连接用于执行翻译的外部 API 服务器（OpenAI、Anthropic 或兼容网关），保持原有的 ChatGPT/Codex 基础连接不变。',
    'models.title': '翻译器模型',
    'models.subtitle': '筛选模型、检测在线状态，并选择用于翻译的模型。',
    'dash.pluginHeader': 'Codex / ChatGPT 插件与拦截状态',
    'dash.statTranslator': '翻译器 (用户 ↔ EN ↔ 智能体):',
    'dash.statIntercept': 'config.toml 拦截状态:',
    'dash.statGateway': '本地网关:',
    'dash.statTranslated': '已翻译消息数:',
    'dash.statEconomics': '词元与费用节省：',
    'dash.btnEnable': '✓ 开启翻译器 （开启）',
    'dash.btnDisable': '✕ 关闭翻译器 （关闭）',
    'dash.btnOpenEcon': '📊 打开词元成本面板',
    'dash.btnInstall': '安装 / 启用拦截',
    'dash.btnDirect': '直连模式 (不翻译)',
    'dash.btnTray': '🗔 启动系统托盘图标 (CT)',
    'dash.settingsHeader': '双向翻译设置',
    'dash.enableToggle': '启用双向 用户 ↔ 智能体 实时翻译',
    'dash.liveActivity': '实时翻译动态:',
    'dash.autoLangToggle': '优先级 #1：自动使用用户提问的语言回复（自动检测）',
    'dash.showIndicatorsToggle': '在聊天消息末尾显示翻译确认标识',
    'dash.fallbackLangLabel': '优先级 #2：备用回复语言（当提问为英文时）',
    'dash.searchLangPlaceholder': '搜索语言…',
    'dash.translatorModelLabel': '翻译模型（来自已连接的 API 提供商）',
    'dash.searchModelPlaceholder': '搜索模型…',
    'dash.effortLabel': '翻译模型的推理强度',
    'dash.effortDefault': '默认 (自动)',
    'dash.customPromptLabel': '附加翻译指令',
    'dash.customPromptPlaceholder': '例如：保持专业语气，不要翻译数据库表名或 React 组件术语…',
    'dash.btnSaveSettings': '保存翻译器设置',
    'dash.btnTestTranslation': '测试翻译',
    'dash.hint': 'Markdown 表格、代码块、文件路径、URL 和标识符均受加密标记 (`__CT_...__`) 保护。图片与附件将直接转发给 智能体。',
    'econ.activeModelLabel': 'ChatGPT / Codex 当前活动模型（自动同步）',
    'econ.period.today': '今天',
    'econ.period.week': '近 7 天',
    'econ.period.month': '近 30 天',
    'econ.period.all': '全部时间',
    'econ.autoTariff': '从 ChatGPT / Codex 自动匹配费率',
    'econ.kpi.netSaved': '🎯 翻译净收益',
    'econ.kpi.tokensSpentSaved': '🪙词元消耗与节省',
    'econ.kpi.totalSpent': '💵 实际总费用',
    'econ.kpi.cacheDynamics': '⚡ 提示缓存效率',
    'econ.pcard.today': '📅 今天',
    'econ.pcard.week': '📆 近 7 天',
    'econ.pcard.month': '🗓️ 近 30 天',
    'econ.pcard.tokensSpent': '实际消耗词元:',
    'econ.pcard.moneySpent': '实际花费金额:',
    'econ.pcard.cacheDyn': '缓存命中与节省:',
    'econ.pcard.benefit': '翻译器净收益:',
    'econ.table.title': '各模型的费用与节省明细',
    'econ.table.subtitle': '各模型实际消耗的词元与金额、缓存命中率及翻译器带来的真实净节省。',
    'econ.th.model': '模型与费率（美元/百万词元）',
    'econ.th.turns': '轮次',
    'econ.th.actualTokens': '实际消耗词元 (新输入 / 缓存 / 输出)',
    'econ.th.actualUsd': '实际花费 ($)',
    'econ.th.cacheDyn': '缓存动态 (命中率 · 节省 $)',
    'econ.th.withoutTrans': '无翻译器虚拟消耗 (词元 · $)',
    'econ.th.savedTokens': '节省词元 (压缩比)',
    'econ.th.netBenefit': '翻译器净收益 ($ 与 %)',
    'econ.th.totalBenefit': '综合总收益 (翻译 + 缓存)',
    'econ.table.empty': '所选时间段内暂无数据。',
    'econ.structure.title': '输入词元构成',
    'econ.structure.desc': '缓存命中的词元（绿色）、新发送的英文词元（蓝色）以及因母语转英文而削减的词元（灰色虚线）比例。',
    'econ.structure.cached': '缓存命中的英文输入词元',
    'econ.structure.uncached': '未缓存的英文输入词元',
    'econ.structure.cutoff': '翻译所节省的词元',
    'econ.chart.title': '累计费用变化',
    'econ.chart.virtual': '--- 无插件（母语）',
    'econ.chart.actual': '─── 启用插件（英文 + 缓存）',
    'econ.blocks.title': '四种场景：启用或关闭翻译，使用或不使用缓存',
    'econ.blocks.badge': '4 种场景完整明细',
    'econ.b1.title': '1. 无翻译 · 无缓存',
    'econ.b1.in': '全部输入 (母语全价):',
    'econ.b1.cached': '缓存输入：',
    'econ.b1.out': '输出 (母语):',
    'econ.b1.cacheSaved': '缓存节省:',
    'econ.b1.trans': '翻译器开销:',
    'econ.b1.total': '无翻译无缓存总费用:',
    'econ.b2.title': '2. 无翻译 · 有缓存',
    'econ.b2.uncached': '未缓存新输入 (母语):',
    'econ.b2.cached': '母语缓存输入：',
    'econ.b2.out': '输出 (母语):',
    'econ.b2.cacheSaved': '缓存折扣 (无翻译):',
    'econ.b2.trans': '翻译器开销:',
    'econ.b2.total': '无翻译（含缓存）总费用:',
    'econ.b3.title': '3. 有翻译 (EN) · 无缓存',
    'econ.b3.in': '全部输入 (英文全价):',
    'econ.b3.cached': '缓存输入：',
    'econ.b3.out': '输出 (英文):',
    'econ.b3.trans': '翻译器开销:',
    'econ.b3.savedVsB1': '仅翻译带来的节省 (对比场景 1):',
    'econ.b3.total': '有翻译（无缓存）总费用:',
    'econ.b4.title': '4. 有翻译 (EN) · 有缓存（实际支出）',
    'econ.b4.badge': '实际花费',
    'econ.b4.uncached': '未缓存新输入 (EN):',
    'econ.b4.cached': '英文缓存输入：',
    'econ.b4.out': '输出 (EN):',
    'econ.b4.cacheSaved': '缓存费用节省：',
    'econ.b4.trans': '翻译器开销:',
    'econ.b4.total': '实际总花费 (EN + 缓存):',
    'econ.sum.title': '费用汇总对比：关闭翻译与启用翻译',
    'econ.sum.badge': '综合核算表',
    'econ.sum.thMetric': '指标 / 费用项',
    'econ.sum.thWithout': '总计：无翻译 (母语)',
    'econ.sum.thWith': '总计：有翻译 (EN)',
    'econ.sum.thDelta': '差额 / 净收益',
    'econ.sum.r1': '1. 未缓存的输入词元',
    'econ.sum.r2': '2. 缓存命中的输入词元',
    'econ.sum.r3': '3. 输入词元总计（新输入 + 缓存）',
    'econ.sum.r4': '4. 回复输出词元',
    'econ.sum.r5': '5. 对话词元总计（输入 + 输出）',
    'econ.sum.r6': '6. 不使用缓存时的全价费用',
    'econ.sum.r7': '7. 提示缓存折扣节省的费用',
    'econ.sum.r8': '8. 翻译服务费用',
    'econ.sum.r9': '计入缓存后的最终费用',
    'econ.sum.r10': '对比无缓存母语基准的综合总节省（翻译 + 缓存）',
    'econ.rates.title': '各 Codex 模型的费率设置（每百万词元的输入、输出与缓存费用）',
    'econ.rates.syncLive': '↻ 同步 OpenAI 价格',
    'econ.rates.exportCsv': '⬇ 导出 CSV',
    'econ.rates.exportJson': '⬇ 导出 JSON',
    'econ.rates.resetSession': '重置当前会话统计',
    'econ.rates.desc': '选择任意 Codex 模型（`gpt-6.1-sol`、`gpt-6-astra`、`gpt-6-sol`、`gpt-6-luna`、`gpt-5.6-*`）设置其输入 ($/1M)、缓存输入 ($/1M 或折扣 %) 和输出 ($/1M) 单价。修改费率仅从今天起生效，不会改动历史日期的统计。',
    'econ.rates.modelSelect': '选择要配置 / 核算的模型',
    'econ.rates.priceIn': '输入（美元/百万词元，P_in）',
    'econ.rates.priceCached': '缓存输入（美元/百万词元，P_cached）',
    'econ.rates.cacheDisc': '缓存折扣 (% 减免)',
    'econ.rates.priceWrite30m': '30m 缓存写入（美元/百万词元）',
    'econ.rates.priceWrite12h': '12h 缓存写入（美元/百万词元）',
    'econ.rates.priceOut': '输出（美元/百万词元，P_out）',
    'econ.rates.priceTrans': '翻译服务（美元/百万词元，C_trans）',
    'econ.rates.saveBtn': '💾 保存所选模型费率',
    'econ.rates.resetBtn': '↺ 恢复模型默认费率',
    'econ.rates.thModel': 'Codex 模型',
    'econ.rates.thDesc': '描述 / 上下文',
    'econ.rates.thIn': '输入（美元/百万词元）',
    'econ.rates.thCache': '缓存（美元/百万词元 · 折扣 %）',
    'econ.rates.thOut': '输出（美元/百万词元）',
    'econ.rates.thStatus': '费率状态',
    'econ.rates.thAction': '操作',
    'econ.turns.title': '逐轮请求日志',
    'econ.turns.thStep': '轮次 · 模型 · 推理强度',
    'econ.turns.thIn': '输入 (缓存 / 新 EN)',
    'econ.turns.thOut': '输出 (EN / 虚拟母语)',
    'econ.turns.thSavedTok': '节省词元',
    'econ.turns.thPrice': '本次请求费用 ($)',
    'econ.turns.thBenefit': '净节省 ($)',
    'econ.turns.empty': '当前会话暂无请求记录。开启翻译器后向 智能体 发送消息即可查看。',
    'conn.addBtn': '＋ 添加翻译器 API 提供商',
    'conn.toolbarHint': '连接负责翻译消息的外部 API（不会替换原有的 ChatGPT/Codex 基础连接）',
    'conn.makePrimary': '设为主连接',
    'conn.remove': '删除',
    'conn.nameLabel': '连接名称',
    'conn.namePlaceholder': '例如：翻译 API 提供商',
    'conn.kindLabel': '翻译器 API 协议类型',
    'conn.urlLabel': '翻译服务器的基础 URL',
    'conn.keyLabel': 'API 密钥（使用 Windows DPAPI 加密）',
    'conn.refreshBtn': '加载 / 刷新模型列表',
    'conn.checkBtn': '检测模型在线状态 (在线/离线)',
    'models.searchPlaceholder': '按 ID 或名称搜索翻译模型…',
    'models.refreshAll': '刷新全部目录',
    'models.unchecked': '未检测',
    'models.batch10': '每批 10 个模型',
    'models.batch20': '每批 20 个模型',
    'models.checkAll': '检测全部模型',
    'models.stop': '停止',
    'models.enableVisible': '启用当前可见',
    'models.disableVisible': '禁用当前可见',
    'models.thConn': '连接',
    'models.thModel': '模型（上下文 · 推理强度）',
    'models.thStatus': '状态',
    'models.thAction': '操作',
    'models.thEnabled': '启用',
    'footer.text': '翻译器在保留原有 ChatGPT / Codex 模型的同时实时拦截并翻译请求。开启或关闭翻译会立即生效。',
    'side.sectionsLabel': '功能分区',
    'side.note': '保留原有的 ChatGPT 和 Codex 模型。用户 → 英文 → 智能体 → 您的语言。API 密钥使用 Windows DPAPI 加密。',
    'models.online': '在线',
    'models.offline': '离线',
    'models.allConnections': '全部连接',
    'conn.editorTitle': '翻译服务连接',
    'conn.keyPlaceholder': '输入 API 密钥',
    'conn.protocol.omniroute': 'OmniRoute 网关 (/v1/responses)',
    'conn.protocol.responses': 'OpenAI Responses API (/v1/responses)',
    'conn.protocol.chat_completions': 'OpenAI Chat Completions (/v1/chat/completions)',
    'conn.protocol.anthropic': 'Anthropic Messages (/v1/messages)',
    'a11y.period': '统计周期',
    'a11y.connectionFilter': '筛选连接',
    'a11y.batchSize': '每批检测的模型数',
    'econ.nativeNoCache': '母语 · 无缓存',
    'econ.nativeCache': '母语 · 使用缓存',
    'econ.englishNoCache': '英文 · 无缓存',
    'econ.ratio': '压缩比',
    'econ.zeroTokens': '0词元 ($0.0000)'
  }
};

function tr(key) {
  return I18N[currentUiLang]?.[key] ?? I18N.en[key] ?? key;
}

function L(enText, ruText, zhText) {
  if (currentUiLang === 'ru') return ruText;
  if (currentUiLang === 'zh') return zhText;
  return enText;
}

function uiLocale() {
  return { en: 'en-US', ru: 'ru-RU', zh: 'zh-CN' }[currentUiLang];
}

function kindLabel(kind) {
  return kind === 'omniroute' ? L('OmniRoute gateway', 'Шлюз OmniRoute', 'OmniRoute 网关') : kinds[kind] || kind;
}

// Translate application-owned status text; provider messages and user content stay intact.
function localizeMessage(value) {
  const text = String(value ?? '');
  const messages = [
    ['Request failed', 'Ошибка запроса', '请求失败'],
    ['Unknown error', 'Неизвестная ошибка', '未知错误'],
    ['Loading…', 'Загрузка…', '加载中…'],
    ['Saving…', 'Сохраняю…', '保存中…'],
    ['Saved automatically', 'Сохранено автоматически', '已自动保存'],
    ['Synchronized', 'Синхронизировано', '已同步'],
    ['Not saved', 'Не сохранено', '未保存'],
    ['Connection not found.', 'Подключение не найдено.', '找不到连接。'],
    ['Invalid connection ID.', 'Некорректный ID подключения.', '连接 ID 无效。'],
    ['Enter the server base URL.', 'Укажите Base URL сервера.', '请输入服务器的基础 URL。'],
    ['Cannot load /v1/models. Check the base URL and network.', 'Не удалось подключиться к /v1/models. Проверьте Base URL и сеть.', '无法加载 /v1/models。请检查基础 URL 和网络连接。'],
    ['A model check is already running.', 'Проверка уже выполняется.', '模型检测正在进行。'],
    ['Load the model catalog first.', 'Сначала загрузите список моделей.', '请先加载模型列表。'],
    ['Invalid reasoning effort.', 'Некорректный уровень effort.', '推理强度无效。'],
    ['Add and configure a provider on the API Providers tab first.', 'Сначала добавьте и настройте API провайдер для переводчика на вкладке «API Провайдеры».', '请先在“API 提供商”页面添加并配置翻译服务。'],
    ['Load and select a translator model first.', 'Сначала загрузите и выберите модель переводчика.', '请先加载并选择翻译模型。'],
    ['The model is not in the selected connection catalog.', 'Модель не найдена в каталоге выбранного подключения.', '所选连接的目录中没有该模型。'],
    ['Add and configure a translator API provider first.', 'Сначала добавьте и настройте API провайдер для переводчика.', '请先添加并配置翻译 API 提供商。'],
    ['Select a translator model first.', 'Сначала выберите модель переводчика.', '请先选择翻译模型。'],
    ['Streaming response received', 'Получен потоковый ответ', '已收到流式响应'],
    ['Empty response stream', 'Пустой SSE поток', '响应事件流为空'],
    ['Text response received', 'Получен текстовый ответ', '已收到文本响应'],
    ['The API returned no text', 'API не вернул текстовый ответ', 'API 未返回文本'],
    ['Check stopped', 'Проверка остановлена', '检测已停止'],
    ['No response within 30 seconds, or connection error', 'Нет ответа за 30 секунд или ошибка соединения', '30 秒内未收到响应，或连接发生错误'],
    ['Connection removed', 'Подключение удалено', '连接已删除'],
    ['Translator provider', 'Провайдер переводчика', '翻译 API 提供商'],
    ['Remote servers require HTTPS.', 'Для удалённых серверов требуется HTTPS.', '远程服务器必须使用 HTTPS。'],
    ['Use an HTTP(S) server URL without credentials, query or fragment.', 'Укажите HTTP(S) URL сервера без логина, пароля, параметров и фрагмента.', '请使用不含登录信息、查询参数或片段的 HTTP(S) 服务器 URL。'],
    ['Invalid URL', 'Некорректный URL', 'URL 无效'],
    ['Credential helper failed. Reconfigure for this Windows user.', 'Не удалось прочитать ключ. Настройте подключение заново для текущего пользователя Windows.', '无法读取密钥。请为当前 Windows 用户重新配置连接。'],
    ['Translation returned invalid JSON', 'Переводчик вернул некорректный JSON', '翻译服务返回的 JSON 无效', 'invalid_json'],
    ['Translation damaged a protected code fragment', 'Переводчик изменил защищённый фрагмент кода', '翻译过程中受保护的代码片段被修改', 'literal_integrity'],
    ['Translation contains an unexpected placeholder', 'Перевод содержит неизвестный маркер', '译文包含未知占位符', 'unexpected_literal'],
    ['Translation response has the wrong format', 'Некорректный формат ответа переводчика', '翻译响应格式无效', 'invalid_translation'],
    ['Translation has the wrong number of parts', 'Переводчик вернул неверное число частей', '翻译响应中的分段数量不正确', 'invalid_part_count'],
    ['Translation is empty', 'Перевод пуст', '译文为空', 'empty_translation'],
    ['Translation is in the wrong language', 'Перевод выполнен не на выбранный язык', '译文未使用所选语言', 'wrong_language'],
    ['Translation failed', 'Не удалось выполнить перевод', '翻译失败', 'translation_failed'],
    ['The panel management token is missing or invalid. Reopen the panel.', 'Токен управления панелью отсутствует или недействителен. Откройте панель заново.', '面板管理令牌缺失或无效。请重新打开面板。', 'Missing or invalid management token'],
    ['Custom rate', 'Ручной тариф', '自定义费率', 'Custom (Ручной тариф)']
  ];
  const match = messages.find(row => row.includes(text));
  if (match) return L(...match);
  if (text === 'unknown') return L('Unknown error', 'Неизвестная ошибка', '未知错误');
  const rules = [
    [/^(.+) \(Codex Workhorse\)$/, (_, name) => L(`${name} (Codex Workhorse)`, `${name} (основная модель Codex)`, `${name}（Codex 主力模型）`)],
    [/^(.+) \(Codex Frontier\)$/, (_, name) => L(`${name} (Codex Frontier)`, `${name} (передовая модель Codex)`, `${name}（Codex 前沿模型）`)],
    [/^(.+) \(Codex Fast\)$/, (_, name) => L(`${name} (Codex Fast)`, `${name} (быстрая модель Codex)`, `${name}（Codex 快速模型）`)],
    [/^Перевод запроса пользователя \(User → EN\)…$/, () => L('Translating the user prompt into English…', 'Перевод запроса пользователя на английский…', '正在将用户提示翻译为英文…')],
    [/^Запрос переведён \((.+) · (.+)с\) и отправлен Агенту$/, (_, pair, sec) => L(`Prompt translated (${pair} · ${sec}s) and sent to the Agent`, `Запрос переведён (${pair} · ${sec} с) и отправлен агенту`, `提示已翻译（${pair} · ${sec} 秒）并发送给智能体`)],
    [/^Перевод ответа агента \((.+?)(?: · чанк (.+))?\)…$/, (_, pair, chunk) => L(`Translating the Agent reply (${pair}${chunk ? ' · part ' + chunk : ''})…`, `Перевод ответа агента (${pair}${chunk ? ' · часть ' + chunk : ''})…`, `正在翻译智能体回复（${pair}${chunk ? ' · 分段 ' + chunk : ''}）…`)],
    [/^Ответ переведён \((.+) · (.+)с\)$/, (_, pair, sec) => L(`Reply translated (${pair} · ${sec}s)`, `Ответ переведён (${pair} · ${sec} с)`, `回复已翻译（${pair} · ${sec} 秒）`)],
    [/^Сервер моделей ответил HTTP (\d+)\.$/, (_, code) => L(`Model server returned HTTP ${code}.`, `Сервер моделей ответил HTTP ${code}.`, `模型服务器返回 HTTP ${code}。`)],
    [/^Перевод(?: выполнен| User → EN) \((\d+) мс\): ([\s\S]*)$/, (_, ms, result) => L(`Translation (${ms} ms): ${result}`, `Перевод (${ms} мс): ${result}`, `翻译完成（${ms} 毫秒）：${result}`)],
    [/^translator_http_(\d+)$/, (_, code) => L(`Translator API returned HTTP ${code}`, `API переводчика вернул HTTP ${code}`, `翻译 API 返回 HTTP ${code}`)]
  ];
  for (const [pattern, replacement] of rules) if (pattern.test(text)) return text.replace(pattern, replacement);
  return text;
}

function formatEffortLabel(effort) {
  if (!effort) return '';
  const clean = String(effort).trim().toLowerCase();
  const map = {
    none: L('None', 'Без рассуждений', '无'),
    minimal: L('Minimal', 'Минимальный', '极低'),
    min: L('Minimal', 'Минимальный', '极低'),
    low: L('Low', 'Низкий', '低'),
    medium: L('Medium', 'Средний', '中'),
    standard: L('Standard', 'Стандартный', '标准'),
    high: L('High', 'Высокий', '高'),
    extended: L('Extended', 'Расширенный', '扩展'),
    xhigh: L('Extra High', 'Очень высокий', '超高'),
    max: L('Max', 'Максимальный', '最高'),
    ultra: L('Ultra', 'Ультра', '极限')
  };
  return map[clean] || effort;
}

function applyUiLanguage(lang) {
  currentUiLang = ['en', 'ru', 'zh'].includes(lang) ? lang : 'en';
  document.documentElement.lang = currentUiLang;
  document.title = tr('page.title');
  for (const btn of document.querySelectorAll('[data-ui-lang]')) {
    btn.classList.toggle('active', btn.dataset.uiLang === currentUiLang);
  }
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    if (key && I18N[currentUiLang]?.[key]) {
      el.textContent = I18N[currentUiLang][key];
    }
  }
  for (const attribute of ['placeholder', 'title', 'aria-label']) {
    for (const el of document.querySelectorAll(`[data-i18n-${attribute}]`)) {
      const key = el.getAttribute(`data-i18n-${attribute}`);
      if (key && I18N[currentUiLang]?.[key]) el.setAttribute(attribute, tr(key));
    }
  }
  const activeNav = document.querySelector('.nav.active');
  if (activeNav?.dataset.tab) {
    activateTab(activeNav.dataset.tab);
  }
  if (state) {
    renderSidebarTranslatorBox();
    renderDashboard();
    renderEconomics();
    renderConnections();
    renderModels();
    renderJob();
    updateConnectionLabels();
  }
  renderProbeResult();
  status(localizeMessage($('save-status').textContent));
}

function element(tag, text, cls) {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function status(text) {
  $('save-status').textContent = text;
}

function notify(text) {
  $('notice').textContent = text;
  $('notice').classList.remove('hidden');
  setTimeout(() => $('notice').classList.add('hidden'), 6000);
}

function renderProbeResult() {
  if (!probeResult) return;
  $('dash-probe-result').textContent = probeResult.pending
    ? L('Testing translation with the selected model…', 'Проверка перевода с выбранной моделью…', '正在使用所选模型测试翻译…')
    : `${probeResult.success ? '✓' : '✗'} ${probeResult.success ? L('Success:', 'Успешно:', '成功：') : L('Error:', 'Ошибка:', '错误：')} ${localizeMessage(probeResult.detail)}`;
}

async function request(action, payload = {}) {
  const doPost = async () => {
    const headers = { 'content-type': 'application/json' };
    if (typeof window !== 'undefined' && window.__CT_ADMIN_TOKEN__) {
      headers['x-codex-translate-token'] = window.__CT_ADMIN_TOKEN__;
    }
    return fetch('/api/action', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action, payload })
    });
  };
  let res = await doPost();
  if (res.status === 403 && typeof window !== 'undefined') {
    try {
      const jsText = await (await fetch('/renderer.js', { cache: 'no-store' })).text();
      const m = /^window\.__CT_ADMIN_TOKEN__\s*=\s*("[^"]+");/m.exec(jsText);
      if (m) {
        window.__CT_ADMIN_TOKEN__ = JSON.parse(m[1]);
        res = await doPost();
      }
    } catch {}
  }
  const data = await res.json();
  if (!data.ok) throw Error(localizeMessage(data.error || 'Request failed'));
  return data.value;
}

function enqueue(action, payload, after) {
  saving++;
  status(L('Saving…', 'Сохраняю…', '保存中…'));
  const next = pending.then(async () => {
    let ok = false;
    try {
      const value = await request(action, payload);
      await after?.(value);
      ok = true;
      return value;
    } catch (e) {
      status(L('Not saved', 'Не сохранено', '未保存'));
      notify(e.message);
      throw e;
    } finally {
      saving--;
      if (ok) status(timers.size || saving ? L('Saving…', 'Сохраняю…', '保存中…') : L('Saved automatically', 'Сохранено автоматически', '已自动保存'));
    }
  });
  pending = next.catch(() => {});
  return next;
}

function debounce(key, fn) {
  status(L('Saving…', 'Сохраняю…', '保存中…'));
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      fn();
    }, 500)
  );
}

function formatContext(tokens) {
  if (!tokens || tokens <= 0) return L('context unspecified', 'контекст не объявлен', '上下文未声明');
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M ${L('tokens', 'токенов', '词元')}`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K ${L('tokens', 'токенов', '词元')}`;
  return `${tokens} ${L('tokens', 'токенов', '词元')}`;
}

function activateTab(tab) {
  if (!['dashboard', 'economics', 'connections', 'models'].includes(tab)) return;
  for (const panel of document.querySelectorAll('.panel')) {
    panel.classList.toggle('hidden', panel.id !== tab);
  }
  for (const nav of document.querySelectorAll('.nav')) {
    nav.classList.toggle('active', nav.dataset.tab === tab);
  }
  $('title').textContent = {
    dashboard: tr('dash.title'),
    economics: tr('econ.title'),
    connections: tr('conn.title'),
    models: tr('models.title')
  }[tab];
  $('subtitle').textContent = {
    dashboard: tr('dash.subtitle'),
    economics: tr('econ.subtitle'),
    connections: tr('conn.subtitle'),
    models: tr('models.subtitle')
  }[tab];
}

function currentUiState() {
  const activeNav = document.querySelector('.nav.active');
  return {
    tab: activeNav?.dataset.tab || 'dashboard',
    uiLang: currentUiLang || 'en',
    econPeriod: selectedEconPeriod || 'all',
    connectionId: connectionId || null,
    modelSearch: $('model-search').value,
    modelProvider: $('model-provider').value,
    filterOnline: $('filter-online').checked,
    filterOffline: $('filter-offline').checked,
    filterUnchecked: $('filter-unchecked').checked,
    checkBatch: $('check-batch').value,
    translatorModelSearch: $('translator-model-search')?.value || '',
    translatorLanguageSearch: $('translator-language-search')?.value || ''
  };
}

function persistUiState() {
  if (!uiStateApplied || editing) return null;
  const next = currentUiState();
  if (state) state.uiState = next;
  return request('saveUiState', next).catch(() => {});
}

async function flush() {
  for (const [key, timer] of timers) {
    clearTimeout(timers.delete(key) ? timer : timer);
    if (key === 'connection') saveConnection();
    else if (key === 'translator') saveTranslator();
    else if (key === 'economicsPricing') saveCustomEconomicsPricing();
  }
  await persistUiState();
  await pending;
}

function renderSidebarTranslatorBox() {
  if (!state) return;
  const t = state.translator || {};
  const hasProvider = t.hasProvider === true || !!(state.connections?.length && state.connections.find(c => c.id === (t.connectionId || state.selectedId))?.baseUrl);
  const hasModel = t.hasModel === true || !!(hasProvider && t.model);
  const interceptActive = state.routing?.interceptActive === true;
  const isOn = t.enabled === true && hasProvider && hasModel;
  const isTranslating = isOn && t.status?.state === 'translating';
  const pill = $('translator-pill');
  pill.className = 'route-pill ' + (!isOn ? 'base' : !interceptActive || isTranslating ? 'translating' : 'omni');
  pill.textContent = !isOn
    ? !hasProvider
      ? L('OFF · Add Provider', 'ВЫКЛ · Добавьте провайдер', '已关闭 · 请添加提供商')
      : !hasModel
        ? L('OFF · Select Model', 'ВЫКЛ · Выберите модель', '已关闭 · 请选择模型')
        : L('DISABLED (OFF)', 'Выключен', '已关闭')
    : !interceptActive
      ? L('ON · Enable Interception', 'ВКЛ · Включите перехват', '已开启 · 请启用拦截')
      : isTranslating
        ? `⏳ ${localizeMessage(t.status?.phase) || L('Translating…', 'Перевод…', '翻译中…')}`
        : `${L('ENABLED (ON)', 'Включён', '已启用')} · ${t.model}`;
  $('btn-translator-on').classList.toggle('active', isOn);
  $('btn-translator-off').classList.toggle('active', !isOn);
  $('translator-nav-state').textContent = !isOn ? L('OFF', 'ВЫКЛ', '已关闭') : isTranslating ? '⏳' : L('ON', 'ВКЛ', '已开启');
}

function translatorModelOptions(selected) {
  const options = [element('option', L('Select translator model', 'Выберите модель переводчика', '请选择翻译模型'))];
  options[0].value = '';
  const q = ($('translator-model-search')?.value || '').toLowerCase();
  const enabledList = state.models.filter(m => m.enabled);
  const sourceList = enabledList.length ? enabledList : state.models;
  const candidates = sourceList.filter(
    m =>
      (m.connectionName + ' - ' + m.id + ' ' + m.name).toLowerCase().includes(q) ||
      JSON.stringify([m.connectionId, m.id]) === selected
  );
  for (const m of candidates) {
    const o = element('option', `${localizeMessage(m.connectionName)} — ${m.id} (${formatContext(m.context)})`);
    o.value = JSON.stringify([m.connectionId, m.id]);
    options.push(o);
  }
  return options;
}

function fillTranslatorEfforts(selected) {
  const value = $('translator-model').value;
  const pair = value ? JSON.parse(value) : null;
  const m = pair && state.models.find(x => x.connectionId === pair[0] && x.id === pair[1]);
  const values = m?.efforts?.length ? m.efforts : ['none', 'low', 'medium', 'high'];
  $('translator-effort').replaceChildren(element('option', tr('dash.effortDefault')));
  $('translator-effort').firstChild.value = '';
  for (const eff of values) {
    const o = element('option', formatEffortLabel(eff));
    o.value = eff;
    $('translator-effort').append(o);
  }
  if (selected && [...$('translator-effort').options].some(o => o.value === selected)) {
    $('translator-effort').value = selected;
  }
}

function renderTranslatorLanguages(selectedCode) {
  const list = state.languages || [];
  const q = ($('translator-language-search')?.value || '').toLowerCase();
  const sel = $('translator-language');
  const names = new Intl.DisplayNames([uiLocale()], { type: 'language' });
  const displayName = language => names.of(language.code) || language.name;
  sel.replaceChildren();
  for (const l of list.filter(x => (displayName(x) + ' ' + x.name + ' ' + x.code).toLowerCase().includes(q) || x.code === selectedCode)) {
    const o = element('option', `${displayName(l)} [${l.code}]`);
    o.value = l.code;
    sel.append(o);
  }
  if (selectedCode && [...sel.options].some(o => o.value === selectedCode)) {
    sel.value = selectedCode;
  }
}

function renderDashboard() {
  if (!state) return;
  const t = state.translator || {};
  const hasProvider = t.hasProvider === true || !!(state.connections?.length && state.connections.find(c => c.id === (t.connectionId || state.selectedId))?.baseUrl);
  const hasModel = t.hasModel === true || !!(hasProvider && t.model);
  const interceptActive = state.routing?.interceptActive === true;
  const isOn = t.enabled === true && hasProvider && hasModel;
  const wasEditing = editing;
  editing = true;

  $('translator-enabled').checked = isOn;
  $('translator-auto-language').checked = t.autoLanguage !== false;
  if ($('translator-show-indicators')) $('translator-show-indicators').checked = t.showIndicators !== false;
  if ($('translator-instructions') && document.activeElement !== $('translator-instructions')) {
    $('translator-instructions').value = t.instructions || '';
  }

  const selectedPair = t.connectionId && t.model ? JSON.stringify([t.connectionId, t.model]) : '';
  if (document.activeElement !== $('translator-model')) {
    $('translator-model').replaceChildren(...translatorModelOptions(selectedPair));
    if (selectedPair && [...$('translator-model').options].some(o => o.value === selectedPair)) {
      $('translator-model').value = selectedPair;
    }
    fillTranslatorEfforts(t.effort || '');
  }
  if (document.activeElement !== $('translator-language')) {
    renderTranslatorLanguages(t.targetLanguage || 'ru');
  }

  const st = t.status || {};
  const badge = $('translator-status-badge');
  if (!hasProvider) {
    badge.textContent = L('Not configured · Add API provider', 'Не настроен · Добавьте API-провайдер', '未配置 · 请添加 API 提供商');
  } else if (!hasModel) {
    badge.textContent = L('Not configured · Select translator model', 'Не настроен · Выберите модель переводчика', '未配置 · 请选择翻译模型');
  } else if (!isOn) {
    badge.textContent = L('Translator DISABLED (OFF)', 'Переводчик Выключен', '翻译器已关闭');
  } else if (!interceptActive) {
    badge.textContent = L('ENABLED · Interception bridge inactive', 'ВКЛЮЧЕН · Мост перехвата отключён', '已开启 · 拦截桥未激活');
  } else if (st.state === 'translating') {
    badge.textContent = `⏳ ${localizeMessage(st.phase) || L('Translating…', 'Идёт перевод…', '正在翻译…')}`;
  } else if (t.autoLanguage !== false) {
    badge.textContent = L('ENABLED (ON) · Priority #1 (prompt language)', 'Включён · Приоритет №1 (язык запроса)', '已启用 · 优先级 #1（提问语言）');
  } else {
    badge.textContent = `${L('ENABLED (ON) · Priority #2', 'Включён · Приоритет №2', '已启用 · 优先级 #2')} (${t.targetLanguage || 'ru'})`;
  }

  const livePill = $('translator-live-pill');
  if (livePill) {
    if (!hasProvider) {
      livePill.className = 'route-pill base';
      livePill.textContent = L('⚠️ Not configured: add an API provider on the "API Providers" tab', '⚠️ Не настроен: добавьте API-провайдер на вкладке «API-провайдеры»', '⚠️ 未配置：请在“API 提供商”标签页添加提供商');
    } else if (!hasModel) {
      livePill.className = 'route-pill base';
      livePill.textContent = L('⚠️ Not configured: select a translator model', '⚠️ Не настроен: выберите модель переводчика', '⚠️ 未配置：请选择翻译器模型');
    } else if (!isOn) {
      livePill.className = 'route-pill base';
      livePill.textContent = L('Translator is OFF', 'Переводчик выключен', '翻译器已关闭');
    } else if (!interceptActive) {
      livePill.className = 'route-pill translating';
      livePill.textContent = L('⚠️ Interception bridge is off — click "Install / Enable Interception"', '⚠️ Мост перехвата отключён — нажмите «Установить / Включить перехват»', '⚠️ 拦截桥已关闭 — 请点击“安装 / 启用拦截”');
    } else if (st.state === 'translating') {
      livePill.className = 'route-pill translating';
      livePill.textContent = `⏳ ${localizeMessage(st.phase) || L('Translating message…', 'перевод сообщения…', '正在翻译消息…')}`;
    } else if (st.state === 'error') {
      livePill.className = 'route-pill base';
      livePill.textContent = `⚠️ ${L('Translation error:', 'Ошибка перевода:', '翻译错误:')} ${localizeMessage(st.reason || 'unknown')}`;
    } else if (st.phase) {
      livePill.className = 'route-pill omni';
      livePill.textContent = `✓ ${L('Confirmed:', 'Подтверждено:', '已确认:')} ${localizeMessage(st.phase)}`;
    } else {
      livePill.className = 'route-pill omni';
      livePill.textContent = `✓ ${L('Ready to translate', 'Готов к переводу', '准备就绪')} (${L('User → EN · Agent', 'Пользователь → EN · Агент', '用户 → 英文 · 智能体')} → ${(t.targetLanguage || 'ru').toUpperCase()})`;
    }
  }

  const recentBox = $('translator-recent-list');
  if (recentBox) {
    recentBox.replaceChildren();
    const recent = Array.isArray(t.recentTranslations) ? t.recentTranslations : [];
    if (!recent.length) {
      recentBox.append(
        element(
          'div',
          L('Translation log is empty — send a message in ChatGPT or Codex to see live confirmation of prompt translation (User → EN) and agent response translation (EN → Your Language).', 'Журнал переводов пуст — отправьте сообщение в ChatGPT или Codex, чтобы увидеть подтверждение перевода запроса (пользователь → EN) и ответа агента (EN → Ваш язык).', '翻译日志为空 — 在 ChatGPT 或 Codex 中发送一条消息即可查看实时翻译记录（用户 → EN 与 智能体 → 您的语言）。'),
          'muted'
        )
      );
    } else {
      for (const item of recent.slice(0, 20)) {
        const row = element('div', null, 'translator-recent-item');
        const dirLabel =
          item.direction === 'user->agent'
            ? L('👤 User prompt translated & sent to Agent (User → EN)', '👤 Запрос пользователя переведён и отправлен Агенту (пользователь → EN)', '👤 用户提问已翻译并发送给 智能体 (用户 → EN)')
            : L('🤖 Agent response translated for User (Agent → User)', '🤖 Ответ Агента переведён для пользователя (агент → пользователь)', '🤖 智能体 回复已翻译为用户语言 (智能体 → 用户)');
        const langPair = `${(item.sourceLanguage || '').toUpperCase()} → ${(item.targetLanguage || '').toUpperCase()}`;
        const sec = ((item.durationMs || 0) / 1000).toFixed(1) + L('s', 'с', '秒');
        const top = element('div', null, 'translator-recent-meta');
        top.append(
          element('strong', `✓ ${dirLabel} [${langPair}]`),
          element('span', `${item.model || ''} · ${sec} · ${item.at ? new Date(item.at).toLocaleTimeString(uiLocale()) : ''}`)
        );
        const pairBox = element('div', null, 'translator-recent-pair');
        const origCol = element('div', null, 'translator-recent-col');
        origCol.append(
          element('span', L('Original', 'Оригинал', '原文'), 'translator-recent-label'),
          element('div', item.originalPreview || '', 'translator-recent-text muted')
        );
        const transCol = element('div', null, 'translator-recent-col translated');
        transCol.append(
          element('span', L('Translated', 'Перевод', '译文'), 'translator-recent-label'),
          element('div', item.translatedPreview || '', 'translator-recent-text')
        );
        pairBox.append(origCol, transCol);
        row.append(top, pairBox);
        recentBox.append(row);
      }
    }
  }

  $('dash-plugin-badge').textContent = interceptActive
    ? state.plugin?.enabled
      ? L('Connected & Interception Active (ChatGPT + Codex)', 'Подключён и перехват активен (ChatGPT + Codex)', '已连接且拦截已激活 (ChatGPT + Codex)')
      : L('Interception active in config.toml', 'Перехват активен в config.toml', 'config.toml 拦截已激活')
    : L('Direct connection (no interception)', 'Прямое соединение (без перехвата)', '直连模式（未拦截）');

  $('stat-translator').textContent = isOn
    ? `${L('ON', 'ВКЛ', '已开启')} (${t.model} → ${t.targetLanguage || 'ru'})`
    : !hasProvider
      ? L('OFF (no provider added)', 'ВЫКЛ (провайдер не добавлен)', '已关闭（未添加提供商）')
      : !hasModel
        ? L('OFF (no model selected)', 'ВЫКЛ (модель не выбрана)', '已关闭（未选择模型）')
        : L('OFF', 'ВЫКЛ', '已关闭');
  $('stat-intercept').textContent = interceptActive
    ? `${L('Active', 'Активен', '已激活')} (${state.routing?.interceptUrl || L('local gateway', 'локальный шлюз', '本地网关')})`
    : state.routing?.externalBaseUrl
      ? `${L('Inactive (external:', 'Отключён (внешний:', '未激活（外部:')} ${state.routing.externalBaseUrl})`
      : L('Inactive (direct connection)', 'Отключён (прямое соединение)', '未激活（直连）');
  $('stat-gateway-port').textContent = state.gatewayPort ? `127.0.0.1:${state.gatewayPort} (${L('Online', 'Работает', '运行中')})` : L('Not running', 'Не запущен', '未运行');
  const uCount = t.stats?.userTranslatedCount || 0;
  const aCount = t.stats?.agentTranslatedCount || 0;
  $('stat-translated-counts').textContent = L(`${uCount} prompts / ${aCount} replies`, `${uCount} запросов / ${aCount} ответов`, `${uCount} 次提问 / ${aCount} 次回复`);
  const econKpi = state.economics?.kpi;
  if ($('stat-economics-summary')) {
    if (econKpi && econKpi.turnsCount > 0) {
      const sign = econKpi.netSavedUsd >= 0 ? '+' : '';
      $('stat-economics-summary').textContent =
        `${econKpi.tokensSavedTotal.toLocaleString(uiLocale())} ${L('tokens', 'токенов', '词元')} · ${sign}$${econKpi.netSavedUsd.toFixed(4)} (${econKpi.netSavingsPercent.toFixed(1)}%)`;
    } else {
      $('stat-economics-summary').textContent = `0 ${L('tokens', 'токенов', '词元')} · $0.0000`;
    }
  }

  editing = wasEditing;
}

function formatUsd(val, digits = 4) {
  const n = Number(val) || 0;
  const abs = Math.abs(n).toFixed(digits);
  return n < 0 ? `-$${abs}` : `$${abs}`;
}

function formatSignedUsd(val, digits = 4) {
  const n = Number(val) || 0;
  const abs = Math.abs(n).toFixed(digits);
  return n < 0 ? `-$${abs}` : `+$${abs}`;
}

function renderCumulativeChart(series = []) {
  const svg = $('econ-chart-svg');
  if (!svg) return;
  const ns = 'http://www.w3.org/2000/svg';
  svg.replaceChildren();

  const W = 640;
  const H = 220;
  const padL = 58;
  const padR = 18;
  const padT = 18;
  const padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const points = [{ step: 0, cumulativeActualUsd: 0, cumulativeVirtualUsd: 0 }, ...series];
  const maxVal = Math.max(
    0.0001,
    ...points.map(p => Math.max(p.cumulativeActualUsd || 0, p.cumulativeVirtualUsd || 0))
  );

  const xFor = idx =>
    points.length <= 1 ? padL + plotW / 2 : padL + (idx / (points.length - 1)) * plotW;
  const yFor = val => padT + plotH - Math.min(1, Math.max(0, val / maxVal)) * plotH;

  // Horizontal grid lines and Y labels
  for (let g = 0; g <= 4; g++) {
    const ratio = g / 4;
    const y = padT + plotH * (1 - ratio);
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', String(padL));
    line.setAttribute('x2', String(W - padR));
    line.setAttribute('y1', String(y));
    line.setAttribute('y2', String(y));
    line.setAttribute('stroke', '#2a2a2e');
    line.setAttribute('stroke-width', '1');
    svg.appendChild(line);

    const label = document.createElementNS(ns, 'text');
    label.setAttribute('x', String(padL - 6));
    label.setAttribute('y', String(y + 4));
    label.setAttribute('text-anchor', 'end');
    label.setAttribute('fill', '#8e8e93');
    label.setAttribute('font-size', '10');
    label.textContent = `$${(maxVal * ratio).toFixed(4)}`;
    svg.appendChild(label);
  }

  if (series.length === 0) {
    const emptyTxt = document.createElementNS(ns, 'text');
    emptyTxt.setAttribute('x', String(padL + plotW / 2));
    emptyTxt.setAttribute('y', String(padT + plotH / 2));
    emptyTxt.setAttribute('text-anchor', 'middle');
    emptyTxt.setAttribute('fill', '#71717a');
    emptyTxt.setAttribute('font-size', '12');
    emptyTxt.textContent = L('Chart will populate automatically after the first intercepted Agent response', 'График построится автоматически после первого перехваченного ответа Агента', '拦截并处理首次 智能体 回复后将自动生成图表');
    svg.appendChild(emptyTxt);
    return;
  }

  const virtualCoords = points.map((p, i) => [xFor(i), yFor(p.cumulativeVirtualUsd || 0)]);
  const actualCoords = points.map((p, i) => [xFor(i), yFor(p.cumulativeActualUsd || 0)]);

  // Shaded savings polygon between Virtual and Actual curves
  const polyPoints = [
    ...virtualCoords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`),
    ...[...actualCoords].reverse().map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
  ].join(' ');
  const area = document.createElementNS(ns, 'polygon');
  area.setAttribute('points', polyPoints);
  area.setAttribute('fill', 'rgba(74, 202, 137, 0.14)');
  svg.appendChild(area);

  // Line 1: Red dashed (Virtual Native cost without plugin)
  const vPath = document.createElementNS(ns, 'polyline');
  vPath.setAttribute('fill', 'none');
  vPath.setAttribute('stroke', '#f87171');
  vPath.setAttribute('stroke-width', '2.2');
  vPath.setAttribute('stroke-dasharray', '6 4');
  vPath.setAttribute('points', virtualCoords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
  svg.appendChild(vPath);

  // Line 2: Green solid (Actual EN + Cache cost with plugin)
  const aPath = document.createElementNS(ns, 'polyline');
  aPath.setAttribute('fill', 'none');
  aPath.setAttribute('stroke', '#4aca89');
  aPath.setAttribute('stroke-width', '2.5');
  aPath.setAttribute('points', actualCoords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
  svg.appendChild(aPath);

  // Step dots and X-axis step labels
  const labelStride = Math.max(1, Math.ceil(points.length / 8));
  points.forEach((p, idx) => {
    const [vx, vy] = virtualCoords[idx];
    const [ax, ay] = actualCoords[idx];

    const vDot = document.createElementNS(ns, 'circle');
    vDot.setAttribute('cx', String(vx));
    vDot.setAttribute('cy', String(vy));
    vDot.setAttribute('r', '3');
    vDot.setAttribute('fill', '#f87171');
    svg.appendChild(vDot);

    const aDot = document.createElementNS(ns, 'circle');
    aDot.setAttribute('cx', String(ax));
    aDot.setAttribute('cy', String(ay));
    aDot.setAttribute('r', '3.2');
    aDot.setAttribute('fill', '#4aca89');
    svg.appendChild(aDot);

    if (idx % labelStride === 0 || idx === points.length - 1) {
      const xLbl = document.createElementNS(ns, 'text');
      xLbl.setAttribute('x', String(ax));
      xLbl.setAttribute('y', String(H - 8));
      xLbl.setAttribute('text-anchor', 'middle');
      xLbl.setAttribute('fill', '#8e8e93');
      xLbl.setAttribute('font-size', '10');
      xLbl.textContent = idx === 0 ? L('Start', 'Старт', '起点') : `#${p.step}`;
      svg.appendChild(xLbl);
    }
  });
}

function renderEconomics() {
  if (!state?.economics || !$('economics')) return;
  const econ = state.economics;
  const periods = econ.periods || {};
  const periodLabels = {
    today: tr('econ.period.today'),
    week: tr('econ.period.week'),
    month: tr('econ.period.month'),
    all: tr('econ.period.all')
  };
  const activePeriodObj =
    periods[selectedEconPeriod] ||
    periods.all || {
      key: 'all',
      label: periodLabels.all,
      kpi: econ.kpi || {},
      byModel: econ.byModel || [],
      blocks: econ.blocks || {},
      inputStructure: econ.inputStructure || {},
      series: econ.series || [],
      recentTurns: econ.recentTurns || []
    };
  const kpi = activePeriodObj.kpi || econ.kpi || {};
  const allKpi = econ.kpi || {};
  const bar = activePeriodObj.inputStructure || econ.inputStructure || {};
  const pricing = econ.pricing || {};
  const blocks = activePeriodObj.blocks || econ.blocks || {};
  const periodSeries = activePeriodObj.series || econ.series || [];
  const periodTurns = activePeriodObj.recentTurns || econ.recentTurns || [];
  const tokUnit = L('tok.', 'ток.', '词元');

  const navBadge = $('economics-nav-saved');
  if (navBadge) {
    navBadge.textContent =
      allKpi.turnsCount > 0
        ? `${allKpi.netSavedUsd >= 0 ? '+' : ''}${formatUsd(allKpi.netSavedUsd, 3)}`
        : '';
  }

  // Highlight active period button and card
  for (const btn of document.querySelectorAll('[data-econ-period]')) {
    btn.classList.toggle('active', btn.dataset.econPeriod === selectedEconPeriod);
  }
  for (const card of document.querySelectorAll('[data-select-period]')) {
    card.classList.toggle('active-period', card.dataset.selectPeriod === selectedEconPeriod);
  }
  if ($('econ-active-period-badge')) {
    $('econ-active-period-badge').textContent = `${L('Period:', 'Период:', '统计周期:')} ${periodLabels[selectedEconPeriod] || activePeriodObj.label || periodLabels.all}`;
  }

  // Active Codex Model Banner
  if ($('econ-active-codex-model')) {
    $('econ-active-codex-model').textContent = econ.activeCodexModel || pricing.presetId || 'gpt-6.1-sol';
  }
  if ($('econ-active-codex-meta')) {
    const effortStr = econ.codexReasoningEffort
      ? ` · ${L('Effort:', 'Усилие:', '推理强度:')} ${formatEffortLabel(econ.codexReasoningEffort)}`
      : '';
    const tierStr = econ.codexServiceTier && econ.codexServiceTier !== 'default' ? ` · ${L('service tier:', 'уровень обслуживания:', '服务等级：')} ${econ.codexServiceTier}` : '';
    $('econ-active-codex-meta').textContent =
      econ.autoDetectModel !== false
        ? `${L('Auto from ChatGPT / Codex', 'Авто из ChatGPT / Codex', '自动同步自 ChatGPT / Codex')}${effortStr}${tierStr}`
        : `${L('Manual tariff preset', 'Ручной выбор тарифа', '手动选择费率')} (${pricing.presetId || 'custom'})`;
    $('econ-active-codex-meta').className = 'route-pill ' + (econ.autoDetectModel !== false ? 'omni' : 'base');
  }
  if ($('econ-active-tariff-pill')) {
    const disc = Number(pricing.cacheDiscountPercent ?? 90).toFixed(0);
    const w30 =
      pricing.priceCacheWrite30mPerMillion !== undefined && pricing.priceCacheWrite30mPerMillion !== null
        ? ` · 30m: $${Number(pricing.priceCacheWrite30mPerMillion).toFixed(2)}`
        : '';
    const w12 =
      pricing.priceCacheWrite12hPerMillion !== undefined && pricing.priceCacheWrite12hPerMillion !== null
        ? ` · 12h: $${Number(pricing.priceCacheWrite12hPerMillion).toFixed(2)}`
        : '';
    $('econ-active-tariff-pill').textContent =
      `${L('Input:', 'Вход:', '输入：')} $${Number(pricing.priceInPerMillion ?? 0).toFixed(2)} · ${L('Cache:', 'Кэш:', '缓存：')} $${Number(pricing.priceCachedPerMillion ?? 0).toFixed(3)} (-${disc}%)${w30}${w12} · ${L('Output:', 'Выход:', '输出：')} $${Number(pricing.priceOutPerMillion ?? 0).toFixed(2)} / ${L('1M tokens', '1 млн токенов', '百万词元')}`;
  }
  if ($('econ-sync-status')) {
    if (econ.pricingSyncedAt) {
      const syncTime = new Date(econ.pricingSyncedAt).toLocaleTimeString(uiLocale());
      $('econ-sync-status').textContent = L(
        `✓ OpenAI prices synced (${syncTime} · 4h auto)`,
        `✓ Тарифы OpenAI обновлены (${syncTime} · авто 4ч)`,
        `✓ OpenAI 价格已同步 (${syncTime} · 4h 自动)`
      );
    } else {
      $('econ-sync-status').textContent = L('OpenAI Pricing (4h auto-sync)', 'Тарифы OpenAI (авто-обновление 4ч)', 'OpenAI 价格 (每 4 小时自动同步)');
    }
  }
  if ($('econ-auto-detect-model')) {
    $('econ-auto-detect-model').checked = econ.autoDetectModel !== false;
  }

  // Hero KPI Cards (for active period)
  const savedUsdVal = kpi.netSavedUsd || 0;
  $('econ-kpi-saved-usd').textContent = formatSignedUsd(savedUsdVal, 4);
  const pctSign = (kpi.netSavingsPercent || 0) >= 0 ? '+' : '';
  $('econ-kpi-saved-pct').textContent = `${pctSign}${(kpi.netSavingsPercent || 0).toFixed(1)}%`;
  $('econ-kpi-saved-pct').className = 'route-pill ' + (savedUsdVal >= 0 ? 'omni' : 'base');
  $('econ-kpi-saved-sub').textContent =
    `${L('Without translator:', 'Без переводчика:', '无翻译器:')} ${formatUsd(kpi.virtualTotalUsd, 4)} → ${L('With translator:', 'С переводчиком:', '启用翻译器:')} ${formatUsd(kpi.totalSpentUsd, 4)}`;
  if ($('econ-kpi-nocache-benefit')) {
    const ncSaved = kpi.savedNoCacheUsd || 0;
    $('econ-kpi-nocache-benefit').textContent =
      `${L('Translator benefit without cache:', 'Выгода переводчика без учёта кэша:', '不含缓存的纯翻译收益:')} ${formatSignedUsd(ncSaved, 4)}`;
  }

  const savedTokVal = kpi.tokensSavedTotal || 0;
  $('econ-kpi-saved-tokens').textContent = `${savedTokVal >= 0 ? '+' : ''}${savedTokVal.toLocaleString(uiLocale())} ${tokUnit}`;
  $('econ-kpi-turns-badge').textContent = `${L('Turns:', 'Шагов:', '轮次:')} ${kpi.turnsCount || 0}`;
  const actualTokTotal = kpi.totalActualTokens ?? (kpi.totalActualIn || 0) + (kpi.totalOutEn || 0);
  const virtualTokTotal = kpi.totalVirtualTokens ?? (kpi.totalVirtualIn || 0) + (kpi.totalVirtualOut || 0);
  if ($('econ-kpi-actual-tokens')) {
    $('econ-kpi-actual-tokens').textContent =
      `${L('Actual spent:', 'Потрачено по факту:', '实际消耗:')} ${actualTokTotal.toLocaleString(uiLocale())} ${tokUnit} (${L('without translator:', 'без переводчика:', '无翻译器:')} ${virtualTokTotal.toLocaleString(uiLocale())})`;
  }
  $('econ-kpi-saved-tokens-sub').textContent =
    `${L('Saved: In', 'Сэкономлено: Вход', '已节省：输入')} +${(kpi.inputSavedTokens || 0).toLocaleString(uiLocale())} · ${L('Out', 'Выход', '输出')} +${(kpi.outputSavedTokens || 0).toLocaleString(uiLocale())}`;

  $('econ-kpi-spent').textContent = formatUsd(kpi.totalSpentUsd, 4);
  $('econ-kpi-virtual').textContent = `${L('Without plugin:', 'Без плагина:', '无插件:')} ${formatUsd(kpi.virtualTotalUsd, 4)}`;
  $('econ-kpi-spent-sub').textContent =
    `${L('Model:', 'Модель:', '模型:')} ${formatUsd(kpi.modelSpentUsd, 4)} + ${L('Translator:', 'Переводчик:', '翻译器:')} ${formatUsd(kpi.translatorSpentUsd, 4)}`;
  if ($('econ-kpi-raw-baseline-sub')) {
    $('econ-kpi-raw-baseline-sub').textContent =
      `${L('No trans & no cache:', 'Без перевода и кэша:', '无翻译无缓存:')} ${formatUsd(kpi.virtualNoCacheTotalUsd, 4)} (${L('total saved', 'общая выгода', '综合节省')} +${formatUsd(kpi.savedVsRawNoCacheUsd, 4)})`;
  }

  $('econ-kpi-cache-rate').textContent = `${(kpi.cacheHitRatePercent || 0).toFixed(1)}%`;
  $('econ-kpi-cache-usd').textContent = `${L('Cache saved:', 'Экономия на кэше:', '缓存节省：')} +${formatUsd(kpi.cacheSavedUsd, 4)}`;
  $('econ-kpi-cache-sub').textContent =
    `${L('Cached:', 'Из кэша:', '缓存命中:')} ${(kpi.totalInCached || 0).toLocaleString(uiLocale())} / ${(kpi.totalActualIn || 0).toLocaleString(uiLocale())} ${L('input tokens', 'входных токенов', '输入词元')}`;
  if ($('econ-kpi-cache-nat-sub')) {
    $('econ-kpi-cache-nat-sub').textContent =
      `${L('New input:', 'Новый вход:', '新输入:')} ${(kpi.totalInUncached || 0).toLocaleString(uiLocale())} ${tokUnit} · ${L('Out:', 'Выход:', '输出:')} ${(kpi.totalOutEn || 0).toLocaleString(uiLocale())} ${tokUnit}`;
  }

  // Populate 3 Period Dynamics Cards (Today, Week, Month)
  for (const pKey of ['today', 'week', 'month']) {
    const pk = periods[pKey]?.kpi || {};
    const pTurns = pk.turnsCount || 0;
    const pActTok = pk.totalActualTokens ?? (pk.totalActualIn || 0) + (pk.totalOutEn || 0);
    const pSavedTok = pk.tokensSavedTotal || 0;
    const pSavedUsd = pk.netSavedUsd || 0;
    const pSavedPct = pk.netSavingsPercent || 0;
    if ($(`p-${pKey}-turns`)) $(`p-${pKey}-turns`).textContent = `${pTurns} ${L('turns', 'шаг.', '轮')}`;
    if ($(`p-${pKey}-tokens`)) {
      $(`p-${pKey}-tokens`).textContent =
        `${pActTok.toLocaleString(uiLocale())} ${tokUnit} (${L('cache', 'кэш', '缓存')} ${(pk.totalInCached || 0).toLocaleString(uiLocale())} / ${L('new', 'нов.', '新')} ${(pk.totalInUncached || 0).toLocaleString(uiLocale())})`;
    }
    if ($(`p-${pKey}-spent`)) {
      $(`p-${pKey}-spent`).textContent =
        `${formatUsd(pk.totalSpentUsd, 4)} (${L('no trans:', 'без пер.:', '无翻译:')} ${formatUsd(pk.virtualTotalUsd, 4)})`;
    }
    if ($(`p-${pKey}-cache`)) {
      $(`p-${pKey}-cache`).textContent =
        `${(pk.cacheHitRatePercent || 0).toFixed(1)}% · ${L('saved', 'сэкономлено', '节省')} +${formatUsd(pk.cacheSavedUsd, 4)}`;
    }
    if ($(`p-${pKey}-saved`)) {
      $(`p-${pKey}-saved`).textContent =
        `${pSavedTok >= 0 ? '+' : ''}${pSavedTok.toLocaleString(uiLocale())} ${tokUnit} · ${formatSignedUsd(pSavedUsd, 4)} (${pSavedPct >= 0 ? '+' : ''}${pSavedPct.toFixed(1)}%)`;
    }
  }

  // Populate Single Unified Model Unit-Economics Table
  const byModelTbody = $('econ-by-model-tbody');
  const byModelTfoot = $('econ-by-model-tfoot');
  if (byModelTbody) {
    byModelTbody.replaceChildren();
    if (byModelTfoot) byModelTfoot.replaceChildren();
    const modelRows = activePeriodObj.byModel || [];
    if (!modelRows.length) {
      const row = element('tr');
      const td = element('td', tr('econ.table.empty'), 'empty');
      td.colSpan = 9;
      row.append(td);
      byModelTbody.append(row);
    } else {
      for (const m of modelRows) {
        const tr = element('tr');
        const isCurrentCodex = m.model === econ.activeCodexModel;

        // 1. Model & Tariff
        const tdModel = element('td');
        const pr = m.pricing || {};
        tdModel.append(
          element('strong', m.model + (isCurrentCodex ? ' ★' : '')),
          element(
            'span',
            `${L('Input', 'Вход', '输入')} $${Number(pr.priceInPerMillion ?? 0).toFixed(2)} · ${L('Cache', 'Кэш', '缓存')} $${Number(pr.priceCachedPerMillion ?? 0).toFixed(3)} (-${Number(pr.cacheDiscountPercent ?? 90).toFixed(0)}%) · ${L('Output', 'Выход', '输出')} $${Number(pr.priceOutPerMillion ?? 0).toFixed(2)}`,
            'model-meta'
          )
        );

        // 2. Turns
        const tdTurns = element('td', String(m.turnsCount || 0));

        // 3. Actual Tokens Spent
        const tdActTok = element('td');
        tdActTok.append(
          element('strong', `${(m.totalActualTokens || 0).toLocaleString(uiLocale())} ${tokUnit}`),
          element(
            'span',
            `${L('New:', 'Нов:', '新:')} ${(m.inUncached || 0).toLocaleString(uiLocale())} · ${L('Cache:', 'Кэш:', '缓存:')} ${(m.inCached || 0).toLocaleString(uiLocale())} · ${L('Out:', 'Выход:', '输出：')} ${(m.outEn || 0).toLocaleString(uiLocale())}`,
            'model-meta'
          )
        );

        // 4. Actual Money Spent ($)
        const tdActUsd = element('td');
        tdActUsd.append(
          element('strong', formatUsd(m.costActualUsd, 4)),
          element('span', `${L('no cache:', 'без кэша:', '无缓存:')} ${formatUsd(m.costActualNoCacheUsd, 4)}`, 'model-meta')
        );

        // 5. Cache Dynamics
        const tdCache = element('td');
        tdCache.append(
          element('strong', `${(m.cacheHitRatePercent || 0).toFixed(1)}% ${L('hit', 'попаданий', '命中率')}`, 'econ-pos'),
          element('span', `${L('Cache saved:', 'Экономия на кэше:', '缓存节省：')} +${formatUsd(m.cacheSavedUsd, 4)}`, 'model-meta')
        );

        // 6. Without Translator (Virtual Native)
        const tdVirt = element('td');
        tdVirt.append(
          element('strong', `${(m.totalVirtualTokens || 0).toLocaleString(uiLocale())} ${tokUnit}`),
          element(
            'span',
            `${L('cached:', 'с кэшем:', '含缓存:')} ${formatUsd(m.costVirtualUsd, 4)} · ${L('no cache:', 'без кэша:', '无缓存:')} ${formatUsd(m.costVirtualNoCacheUsd, 4)}`,
            'model-meta'
          )
        );

        // 7. Tokens Saved by Translator
        const tdSavedTok = element('td');
        const sTok = m.savedTokens || 0;
        tdSavedTok.append(
          element('strong', `${sTok >= 0 ? '+' : ''}${sTok.toLocaleString(uiLocale())} ${tokUnit}`, sTok >= 0 ? 'econ-pos' : 'econ-neg'),
          element(
            'span',
            `${L('ratio', 'сжатие', '压缩比')} ${Number(m.avgKRatio || 1).toFixed(2)}× (${L('In', 'Вход', '输入')} +${(m.inputSavedTokens || 0).toLocaleString(uiLocale())} / ${L('Out', 'Выход', '输出')} +${(m.outputSavedTokens || 0).toLocaleString(uiLocale())})`,
            'model-meta'
          )
        );

        // 8. Real Translator Benefit ($ and %)
        const tdSavedUsd = element('td');
        const sUsd = m.savedUsd || 0;
        tdSavedUsd.append(
          element(
            'strong',
            `${formatSignedUsd(sUsd, 4)} (${m.savingsPercent >= 0 ? '+' : ''}${(m.savingsPercent || 0).toFixed(1)}%)`,
            sUsd >= 0 ? 'econ-pos' : 'econ-neg'
          ),
          element('span', `${L('without cache:', 'без учёта кэша:', '不含缓存:')} ${formatSignedUsd(m.savedNoCacheUsd, 4)}`, 'model-meta')
        );

        // 9. Combined Benefit (Translator + Cache vs Raw Baseline)
        const tdTotalBen = element('td');
        const totBen = m.totalSavedVsRawNoCacheUsd || 0;
        tdTotalBen.append(
          element(
            'strong',
            `${formatSignedUsd(totBen, 4)} (${(m.totalSavingsVsRawPercent || 0) >= 0 ? '+' : ''}${(m.totalSavingsVsRawPercent || 0).toFixed(1)}%)`,
            'econ-pos'
          ),
          element('span', `${L('vs baseline', 'от базы', '对比基准')} ${formatUsd(m.costVirtualNoCacheUsd, 4)}`, 'model-meta')
        );

        tr.append(tdModel, tdTurns, tdActTok, tdActUsd, tdCache, tdVirt, tdSavedTok, tdSavedUsd, tdTotalBen);
        byModelTbody.append(tr);
      }

      if (byModelTfoot) {
        const ftr = element('tr');
        const avgK = actualTokTotal > 0 ? (virtualTokTotal / actualTokTotal).toFixed(2) : '1.00';
        ftr.append(
          element('td', `${L('TOTAL', 'ИТОГО', '总计')} (${periodLabels[selectedEconPeriod] || activePeriodObj.label} · ${L('models:', 'моделей:', '模型数:')} ${modelRows.length})`),
          element('td', String(kpi.turnsCount || 0)),
          element(
            'td',
            `${actualTokTotal.toLocaleString(uiLocale())} ${tokUnit} (${L('New:', 'Нов:', '新:')} ${(kpi.totalInUncached || 0).toLocaleString(uiLocale())} / ${L('Cache:', 'Кэш:', '缓存:')} ${(kpi.totalInCached || 0).toLocaleString(uiLocale())} / ${L('Out:', 'Выход:', '输出：')} ${(kpi.totalOutEn || 0).toLocaleString(uiLocale())})`
          ),
          element('td', `${formatUsd(kpi.totalSpentUsd, 4)} (${L('no cache:', 'без кэша:', '无缓存:')} ${formatUsd(kpi.actualNoCacheTotalUsd, 4)})`),
          element('td', `${(kpi.cacheHitRatePercent || 0).toFixed(1)}% · +${formatUsd(kpi.cacheSavedUsd, 4)}`, 'econ-pos'),
          element('td', `${virtualTokTotal.toLocaleString(uiLocale())} ${tokUnit} · ${formatUsd(kpi.virtualTotalUsd, 4)}`),
          element('td', `+${(kpi.tokensSavedTotal || 0).toLocaleString(uiLocale())} ${tokUnit} (${avgK}×)`, 'econ-pos'),
          element(
            'td',
            `${formatSignedUsd(kpi.netSavedUsd, 4)} (${(kpi.netSavingsPercent || 0) >= 0 ? '+' : ''}${(kpi.netSavingsPercent || 0).toFixed(1)}%)`,
            'econ-pos'
          ),
          element(
            'td',
            `${formatSignedUsd(kpi.savedVsRawNoCacheUsd, 4)} (${(kpi.savedVsRawNoCachePercent || 0) >= 0 ? '+' : ''}${(kpi.savedVsRawNoCachePercent || 0).toFixed(1)}%)`,
            'econ-pos'
          )
        );
        byModelTfoot.append(ftr);
      }
    }
  }

  if ($('econ-encoding-badge')) {
    $('econ-encoding-badge').textContent = `${pricing.encoding || 'o200k_base'} · ${localizeMessage(pricing.name) || L('Tariff', 'Тариф', '费率')}`;
  }

  const hasBarTokens =
    (bar.cachedTokens || 0) + (bar.uncachedEnTokens || 0) + (bar.cutOffByTranslationTokens || 0) > 0;
  const pCached = hasBarTokens ? bar.cachedPercent || 0 : 0;
  const pUncached = hasBarTokens ? bar.uncachedEnPercent || 0 : 0;
  const pCutOff = hasBarTokens ? Math.max(0, 100 - pCached - pUncached) : 0;

  $('econ-bar-seg-cached').style.width = `${pCached}%`;
  $('econ-bar-seg-uncached').style.width = `${pUncached}%`;
  $('econ-bar-seg-cutoff').style.width = `${pCutOff}%`;

  $('econ-legend-cached').textContent =
    `${(bar.cachedTokens || 0).toLocaleString(uiLocale())} ${tokUnit} (${(bar.cachedPercent || 0).toFixed(1)}%)`;
  $('econ-legend-uncached').textContent =
    `${(bar.uncachedEnTokens || 0).toLocaleString(uiLocale())} ${tokUnit} (${(bar.uncachedEnPercent || 0).toFixed(1)}%)`;
  $('econ-legend-cutoff').textContent =
    `${(bar.cutOffByTranslationTokens || 0).toLocaleString(uiLocale())} ${tokUnit} (${(bar.cutOffPercent || 0).toFixed(1)}%)`;

  renderCumulativeChart(periodSeries);

  // Populate 4 Separated Scenario Blocks
  const b1 = blocks.withoutTranslationNoCache || {};
  const b2 = blocks.withoutTranslationWithCache || {};
  const b3 = blocks.withTranslationNoCache || {};
  const b4 = blocks.withTranslationWithCache || {};

  if ($('b1-in-tokens')) {
    $('b1-in-tokens').textContent = `${(b1.inputTokens || 0).toLocaleString(uiLocale())} ${tokUnit} (${formatUsd(b1.inputCostUsd, 4)})`;
    $('b1-out-tokens').textContent = `${(b1.outputTokens || 0).toLocaleString(uiLocale())} ${tokUnit} (${formatUsd(b1.outputCostUsd, 4)})`;
    $('b1-total-usd').textContent = formatUsd(b1.totalCostUsd, 4);
  }
  if ($('b2-uncached-tokens')) {
    $('b2-uncached-tokens').textContent = `${(b2.uncachedInputTokens || 0).toLocaleString(uiLocale())} ${tokUnit} (${formatUsd(b2.uncachedInputCostUsd, 4)})`;
    $('b2-cached-tokens').textContent = `${(b2.cachedInputTokens || 0).toLocaleString(uiLocale())} ${tokUnit} (${formatUsd(b2.cachedInputCostUsd, 4)})`;
    $('b2-out-tokens').textContent = `${(b2.outputTokens || 0).toLocaleString(uiLocale())} ${tokUnit} (${formatUsd(b2.outputCostUsd, 4)})`;
    $('b2-cache-saved').textContent = `-$${Math.abs(Number(b2.cacheSavedUsd) || 0).toFixed(4)}`;
    $('b2-total-usd').textContent = formatUsd(b2.totalCostUsd, 4);
  }
  if ($('b3-in-tokens')) {
    $('b3-in-tokens').textContent = `${(b3.inputTokens || 0).toLocaleString(uiLocale())} ${tokUnit} (${formatUsd(b3.inputCostUsd, 4)})`;
    $('b3-out-tokens').textContent = `${(b3.outputTokens || 0).toLocaleString(uiLocale())} ${tokUnit} (${formatUsd(b3.outputCostUsd, 4)})`;
    $('b3-trans-usd').textContent = formatUsd(b3.translatorCostUsd, 4);
    const s3 = b3.savedVsNativeNoCacheUsd || 0;
    $('b3-saved-vs-b1').textContent = `${formatSignedUsd(s3, 4)} (${(b3.savedVsNativeNoCachePercent || 0).toFixed(1)}%)`;
    $('b3-total-usd').textContent = formatUsd(b3.totalCostUsd, 4);
  }
  if ($('b4-uncached-tokens')) {
    $('b4-uncached-tokens').textContent = `${(b4.uncachedInputTokens || 0).toLocaleString(uiLocale())} ${tokUnit} (${formatUsd(b4.uncachedInputCostUsd, 4)})`;
    $('b4-cached-tokens').textContent = `${(b4.cachedInputTokens || 0).toLocaleString(uiLocale())} ${tokUnit} (${formatUsd(b4.cachedInputCostUsd, 4)})`;
    $('b4-out-tokens').textContent = `${(b4.outputTokens || 0).toLocaleString(uiLocale())} ${tokUnit} (${formatUsd(b4.outputCostUsd, 4)})`;
    $('b4-cache-saved').textContent = `-$${Math.abs(Number(b4.cacheSavedUsd) || 0).toFixed(4)}`;
    $('b4-trans-usd').textContent = formatUsd(b4.translatorCostUsd, 4);
    $('b4-total-usd').textContent = formatUsd(b4.totalCostUsd, 4);
  }

  // Populate Block 5: Consolidated Final Summary Table
  const cs = blocks.consolidatedSummary || {};
  const csNat = cs.withoutTranslation || {};
  const csEn = cs.withTranslation || {};
  const csDelta = cs.delta || {};
  if ($('sum-nat-uncached')) {
    $('sum-nat-uncached').textContent = `${(csNat.uncachedInputTokens || 0).toLocaleString(uiLocale())} ${tokUnit} (${formatUsd(csNat.uncachedInputCostUsd, 4)})`;
    $('sum-en-uncached').textContent = `${(csEn.uncachedInputTokens || 0).toLocaleString(uiLocale())} ${tokUnit} (${formatUsd(csEn.uncachedInputCostUsd, 4)})`;
    $('sum-diff-uncached').textContent =
      `-${(csDelta.uncachedInputTokensSaved || 0).toLocaleString(uiLocale())} ${tokUnit} (${L('saved', 'выгода', '节省')} ${formatUsd(csDelta.uncachedInputCostSavedUsd, 4)})`;

    $('sum-nat-cached').textContent = `${(csNat.cachedInputTokens || 0).toLocaleString(uiLocale())} ${tokUnit} (${formatUsd(csNat.cachedInputCostUsd, 4)})`;
    $('sum-en-cached').textContent = `${(csEn.cachedInputTokens || 0).toLocaleString(uiLocale())} ${tokUnit} (${formatUsd(csEn.cachedInputCostUsd, 4)})`;
    $('sum-diff-cached').textContent =
      `-${(csDelta.cachedInputTokensSaved || 0).toLocaleString(uiLocale())} ${tokUnit} (${L('saved', 'выгода', '节省')} ${formatUsd(csDelta.cachedInputCostSavedUsd, 4)})`;

    $('sum-nat-in-total').textContent = `${(csNat.totalInputTokens || 0).toLocaleString(uiLocale())} ${tokUnit} (${formatUsd(csNat.totalInputCostWithCacheUsd, 4)})`;
    $('sum-en-in-total').textContent = `${(csEn.totalInputTokens || 0).toLocaleString(uiLocale())} ${tokUnit} (${formatUsd(csEn.totalInputCostWithCacheUsd, 4)})`;
    $('sum-diff-in-total').textContent =
      `-${(csDelta.totalInputTokensSaved || 0).toLocaleString(uiLocale())} ${tokUnit} (${L('saved', 'выгода', '节省')} ${formatUsd(csDelta.totalInputCostSavedUsd, 4)})`;

    $('sum-nat-out').textContent = `${(csNat.outputTokens || 0).toLocaleString(uiLocale())} ${tokUnit} (${formatUsd(csNat.outputCostUsd, 4)})`;
    $('sum-en-out').textContent = `${(csEn.outputTokens || 0).toLocaleString(uiLocale())} ${tokUnit} (${formatUsd(csEn.outputCostUsd, 4)})`;
    $('sum-diff-out').textContent =
      `-${(csDelta.outputTokensSaved || 0).toLocaleString(uiLocale())} ${tokUnit} (${L('saved', 'выгода', '节省')} ${formatUsd(csDelta.outputCostSavedUsd, 4)})`;

    $('sum-nat-all-tok').textContent = `${(csNat.totalTokens || 0).toLocaleString(uiLocale())} ${tokUnit}`;
    $('sum-en-all-tok').textContent = `${(csEn.totalTokens || 0).toLocaleString(uiLocale())} ${tokUnit}`;
    $('sum-diff-all-tok').textContent = `${L('Saved:', 'Сэкономлено:', '已节省:')} ${(csDelta.totalTokensSaved || 0).toLocaleString(uiLocale())} ${tokUnit}`;

    $('sum-nat-nocache-usd').textContent = formatUsd(csNat.costNoCacheUsd, 4);
    $('sum-en-nocache-usd').textContent = formatUsd(csEn.costNoCacheUsd, 4);
    $('sum-diff-nocache-usd').textContent =
      `${formatSignedUsd(csDelta.translationOnlySavedNoCacheUsd, 4)} (${(csDelta.translationOnlySavedNoCachePercent || 0).toFixed(1)}%)`;

    $('sum-nat-cache-disc').textContent = `-$${Math.abs(Number(csNat.cacheSavingsUsd) || 0).toFixed(4)}`;
    $('sum-en-cache-disc').textContent = `-$${Math.abs(Number(csEn.cacheSavingsUsd) || 0).toFixed(4)}`;
    $('sum-diff-cache-info').textContent = `${L('EN cache saved', 'Экономия на кэше английского ввода', '英文输入的缓存节省')} ${formatUsd(csEn.cacheSavingsUsd, 4)}`;

    $('sum-en-trans-usd').textContent = formatUsd(csEn.translatorCostUsd, 4);
    $('sum-diff-trans-usd').textContent =
      (csEn.translatorCostUsd || 0) > 0 ? `+${formatUsd(csEn.translatorCostUsd, 4)}` : `$0.0000 (${L('free', 'бесплатно', '免费')})`;

    $('sum-nat-final-usd').textContent = formatUsd(csNat.finalTotalCostUsd, 4);
    $('sum-en-final-usd').textContent = formatUsd(csEn.finalTotalCostUsd, 4);
    const netUsd = csDelta.netSavedWithCacheUsd || 0;
    $('sum-diff-final-usd').textContent =
      `${L('NET BENEFIT:', 'ЧИСТАЯ ВЫГОДА:', '净收益:')} ${formatSignedUsd(netUsd, 4)} (${(csDelta.netSavedWithCachePercent || 0).toFixed(1)}%)`;

    $('sum-raw-baseline').textContent = `${formatUsd(csNat.costNoCacheUsd, 4)} (${L('without trans & cache', 'без перевода и без кэша', '无翻译无缓存')})`;
    $('sum-raw-actual').textContent = `${formatUsd(csEn.finalTotalCostUsd, 4)} (${L('with trans & cache', 'с переводом и с кэшем', '含翻译与缓存')})`;
    const rawBen = csDelta.totalSavedVsNoCacheBaselineUsd || 0;
    $('sum-raw-total-benefit').textContent =
      `${L('TOTAL SAVINGS:', 'ОБЩАЯ ЭКОНОМИЯ:', '综合总节省:')} ${formatSignedUsd(rawBen, 4)} (${(csDelta.totalSavedVsNoCacheBaselinePercent || 0).toFixed(1)}%)`;
  }

  // Populate Dynamic Codex Model Select & Per-Model Tariff Table
  const modelRates = Array.isArray(econ.modelRates) ? econ.modelRates : [];
  const wasEditing = editing;
  editing = true;
  const sel = $('econ-preset-select');
  if (sel && document.activeElement !== sel) {
    const prevVal = sel.value || pricing.presetId || econ.activeCodexModel || 'gpt-6.1-sol';
    sel.replaceChildren();
    for (const m of modelRates) {
      const isCurrentCodex = m.id === econ.activeCodexModel;
      const disc = Number(m.cacheDiscountPercent ?? 90).toFixed(0);
      const label =
        `${m.id}${isCurrentCodex ? ` ★ [${L('Active in Codex', 'Выбрана в Codex', 'Codex 当前选中')}]` : ''} — ${L('Input', 'Вход', '输入')} $${Number(m.priceInPerMillion).toFixed(2)} / ${L('Cache', 'Кэш', '缓存')} $${Number(m.priceCachedPerMillion).toFixed(3)} (-${disc}%) / ${L('Output', 'Выход', '输出')} $${Number(m.priceOutPerMillion).toFixed(2)}`;
      const opt = element('option', label);
      opt.value = m.id;
      sel.append(opt);
    }
    const customOpt = element('option', L('Custom rate', 'Произвольный тариф', '自定义费率'));
    customOpt.value = 'custom';
    sel.append(customOpt);

    const targetVal = pricing.presetId && [...sel.options].some(o => o.value === pricing.presetId)
      ? pricing.presetId
      : prevVal && [...sel.options].some(o => o.value === prevVal)
        ? prevVal
        : econ.activeCodexModel || modelRates[0]?.id || 'gpt-6.1-sol';
    sel.value = targetVal;
  }
  if (document.activeElement !== $('econ-price-in') && pricing.priceInPerMillion !== undefined) {
    $('econ-price-in').value = pricing.priceInPerMillion;
  }
  if (document.activeElement !== $('econ-price-cached') && pricing.priceCachedPerMillion !== undefined) {
    $('econ-price-cached').value = pricing.priceCachedPerMillion;
  }
  if ($('econ-cache-discount') && document.activeElement !== $('econ-cache-discount') && pricing.cacheDiscountPercent !== undefined) {
    $('econ-cache-discount').value = pricing.cacheDiscountPercent;
  }
  if ($('econ-price-write-30m') && document.activeElement !== $('econ-price-write-30m')) {
    $('econ-price-write-30m').value =
      pricing.priceCacheWrite30mPerMillion !== null && pricing.priceCacheWrite30mPerMillion !== undefined
        ? pricing.priceCacheWrite30mPerMillion
        : Number(((pricing.priceInPerMillion || 0) * 1.25).toFixed(4));
  }
  if ($('econ-price-write-12h') && document.activeElement !== $('econ-price-write-12h')) {
    $('econ-price-write-12h').value =
      pricing.priceCacheWrite12hPerMillion !== null && pricing.priceCacheWrite12hPerMillion !== undefined
        ? pricing.priceCacheWrite12hPerMillion
        : Number(((pricing.priceInPerMillion || 0) * 2.5).toFixed(4));
  }
  if (document.activeElement !== $('econ-price-out') && pricing.priceOutPerMillion !== undefined) {
    $('econ-price-out').value = pricing.priceOutPerMillion;
  }
  if (document.activeElement !== $('econ-price-trans') && pricing.translatorPricePerMillion !== undefined) {
    $('econ-price-trans').value = pricing.translatorPricePerMillion;
  }
  editing = wasEditing;

  // Render Per-Model Tariff Table
  const ratesTbody = $('econ-models-rate-tbody');
  if (ratesTbody) {
    ratesTbody.replaceChildren();
    for (const m of modelRates) {
      const tr = element('tr');
      const isCurrentCodex = m.id === econ.activeCodexModel;
      const tdId = element('td');
      tdId.append(
        element('strong', m.id),
        isCurrentCodex ? element('span', ` ★ ${L('Active in Codex', 'Активна в Codex', 'Codex 当前活动')}`, 'econ-pos') : element('span', '')
      );
      const ctxStr = m.contextWindow ? `${Math.round(m.contextWindow / 1000)}K` : '';
      const tdDesc = element('td', [m.name !== m.id ? localizeMessage(m.name) : '', m.description || '', ctxStr].filter(Boolean).join(' · ') || L('Codex model', 'Модель Codex', 'Codex 模型'));
      const tdIn = element('td', `$${Number(m.priceInPerMillion).toFixed(3)} / ${L('1M tokens', '1 млн токенов', '百万词元')}`);
      const writeMeta =
        m.priceCacheWrite30mPerMillion != null
          ? ` · 30m: $${Number(m.priceCacheWrite30mPerMillion).toFixed(2)} / 12h: $${Number(m.priceCacheWrite12hPerMillion ?? m.priceInPerMillion * 2.5).toFixed(2)}`
          : '';
      const tdCache = element(
        'td',
        `$${Number(m.priceCachedPerMillion).toFixed(4)} / ${L('1M tokens', '1 млн токенов', '百万词元')} (-${Number(m.cacheDiscountPercent ?? 0).toFixed(0)}%)${writeMeta}`
      );
      const tdOut = element('td', `$${Number(m.priceOutPerMillion).toFixed(3)} / ${L('1M tokens', '1 млн токенов', '百万词元')}`);
      const tdStatus = element('td', m.customized ? L('Custom', 'Пользовательский', '自定义') : L('Codex Default', 'Авто-тариф Codex', 'Codex 默认'));
      const tdAction = element('td');
      const editBtn = element('button', L('Configure Rate', 'Настроить тариф', '配置费率'), 'use-model-btn' + (pricing.presetId === m.id ? ' active-model' : ''));
      editBtn.onclick = () => {
        if ($('econ-preset-select')) $('econ-preset-select').value = m.id;
        if ($('econ-price-in')) $('econ-price-in').value = m.priceInPerMillion;
        if ($('econ-price-cached')) $('econ-price-cached').value = m.priceCachedPerMillion;
        if ($('econ-cache-discount')) $('econ-cache-discount').value = m.cacheDiscountPercent;
        if ($('econ-price-write-30m') && m.priceCacheWrite30mPerMillion != null) $('econ-price-write-30m').value = m.priceCacheWrite30mPerMillion;
        if ($('econ-price-write-12h') && m.priceCacheWrite12hPerMillion != null) $('econ-price-write-12h').value = m.priceCacheWrite12hPerMillion;
        if ($('econ-price-out')) $('econ-price-out').value = m.priceOutPerMillion;
        enqueue('saveEconomicsPricing', { presetId: m.id, autoDetectModel: m.id === econ.activeCodexModel }, () => reload(true));
      };
      tdAction.append(editBtn);
      tr.append(tdId, tdDesc, tdIn, tdCache, tdOut, tdStatus, tdAction);
      ratesTbody.append(tr);
    }
  }

  if ($('econ-daily-summary')) {
    const today = (econ.daily || [])[0];
    $('econ-daily-summary').textContent = today
      ? `${today.date}: ${today.turnsCount} ${L('turns', 'шаг.', '轮')} · ${L('Saved', 'Выгода', '节省')} ${formatUsd(today.savedUsd, 4)} · ${L('Active model:', 'Активная модель:', '当前模型:')} ${econ.activeCodexModel || pricing.presetId}`
      : L('Session active', 'Сессия активна', '会话活动中');
  }

  const tbody = $('econ-turns-tbody');
  if (tbody) {
    tbody.replaceChildren();
    const turns = periodTurns;
    if (!turns.length) {
      const row = element('tr');
      const td = element('td', tr('econ.turns.empty'), 'empty');
      td.colSpan = 7;
      row.append(td);
      tbody.append(row);
    } else {
      for (const t of turns) {
        const tr = element('tr');
        const timeStr = t.at ? new Date(t.at).toLocaleTimeString(uiLocale()) : '';
        const effBadge = t.reasoningEffort ? ` [${t.reasoningEffort}]` : '';
        const winBadge = t.inCacheWrite > 0 || t.cacheWriteWindow === '12h' ? ` · ${t.cacheWriteWindow || '30m'}` : '';
        const tdStep = element('td', `#${t.step} · ${t.model || 'codex'}${effBadge} (${timeStr})`);
        const tdIn = element(
          'td',
          `${(t.inCached || 0).toLocaleString(uiLocale())} ${L('cache', 'кэш', '缓存')} / ${(t.inUncached || 0).toLocaleString(uiLocale())} ${L('new', 'нов.', '新')}${winBadge} (${L('virt:', 'вирт:', '虚拟:')} ${(t.virtualIn || 0).toLocaleString(uiLocale())})`
        );
        const tdOut = element(
          'td',
          `${(t.outEn || 0).toLocaleString(uiLocale())} EN → ${(t.virtualOut || 0).toLocaleString(uiLocale())} ${L('native', 'родн.', '母语')}`
        );
        const tdRatio = element('td', `${Number(t.kRatio || 1).toFixed(2)}×`);
        const savedTok = t.savedTokens || 0;
        const tdSavedTok = element(
          'td',
          `${savedTok >= 0 ? '+' : ''}${savedTok.toLocaleString(uiLocale())}`,
          savedTok >= 0 ? 'econ-pos' : 'econ-neg'
        );
        const tdPrice = element(
          'td',
          `${formatUsd(t.costActual, 5)} (${L('no plugin:', 'без пл.:', '无插件:')} ${formatUsd(t.costVirtual, 5)})`
        );
        const savedUsd = t.savedUsd || 0;
        const tdBenefit = element(
          'td',
          `${formatSignedUsd(savedUsd, 5)} (${L('cache:', 'кэш:', '缓存:')} ${formatUsd(t.cacheSavedUsd, 5)})`,
          savedUsd >= 0 ? 'econ-pos' : 'econ-neg'
        );
        tr.append(tdStep, tdIn, tdOut, tdRatio, tdSavedTok, tdPrice, tdBenefit);
        tbody.append(tr);
      }
    }
  }
}

function renderConnections() {
  const list = $('connection-list');
  list.replaceChildren();
  for (const c of state.connections) {
    const b = element('button', null, 'item' + (c.id === connectionId ? ' selected' : ''));
    const label = localizeMessage(c.name || c.id) + (c.id === state.selectedId ? ' ★' : '');
    b.append(element('strong', label), element('small', `${kindLabel(c.kind)} · ${c.baseUrl || L('URL not set', 'URL не задан', '未设置 URL')}`));
    b.onclick = async () => {
      await flush();
      showConnection(c.id, true);
    };
    list.append(b);
  }
}

function showConnection(id, save = false) {
  const c = state.connections.find(x => x.id === id);
  connectionId = id;
  editing = true;
  $('connection-editor').classList.toggle('hidden', !c);
  if (c) {
    $('connection-title').textContent = localizeMessage(c.name || c.id) + (c.id === state.selectedId ? L(' (Primary)', ' (Основное)', '（主连接）') : '');
    $('connection-name').value = localizeMessage(c.name || '');
    $('connection-kind').value = c.kind || 'omniroute';
    $('connection-url').value = c.baseUrl || '';
    $('connection-key').value = '';
    $('connection-key').placeholder = c.hasKey
      ? L('Key saved (DPAPI) · enter new key to replace', 'Ключ сохранён (DPAPI) · введите новый для замены', '密钥已保存 (DPAPI) · 输入新密钥以替换')
      : L('Enter API key', 'Введите API ключ', '输入 API 密钥');
    $('make-primary-connection').disabled = c.id === state.selectedId;
    const count = state.models.filter(m => m.connectionId === c.id).length;
    $('connection-hint').textContent = connectionHint(count);
  }
  editing = false;
  renderConnections();
  if (save) persistUiState();
}

function saveConnection() {
  if (editing || !connectionId) return;
  const id = connectionId;
  const payload = {
    id,
    name: $('connection-name').value,
    kind: $('connection-kind').value,
    baseUrl: $('connection-url').value,
    apiKey: $('connection-key').value
  };
  enqueue('saveConnection', payload, async () => {
    if (connectionId === id && $('connection-key').value === payload.apiKey && document.activeElement !== $('connection-key')) {
      $('connection-key').value = '';
      $('connection-key').placeholder = L('Key saved (DPAPI) · enter new key to replace', 'Ключ сохранён (DPAPI) · введите новый для замены', '密钥已保存（DPAPI）· 输入新密钥以替换');
    }
    await reload();
  });
}

function connectionHint(count) {
  return L(`Models in catalog: ${count}. Select a translator model on the Translator Models or Translator tab.`, `Моделей в каталоге: ${count}. Выберите модель на вкладке «Модели переводчика» или «Переводчик».`, `目录中共有 ${count} 个模型。请在“翻译器模型”或“翻译器”页面选择翻译模型。`);
}

function updateConnectionLabels() {
  const connection = state.connections.find(c => c.id === connectionId);
  if (!connection) return;
  $('connection-title').textContent = localizeMessage(connection.name || connection.id) + (connection.id === state.selectedId ? L(' (Primary)', ' (Основное)', '（主连接）') : '');
  if (['Translator provider', 'Провайдер переводчика', '翻译 API 提供商'].includes($('connection-name').value)) $('connection-name').value = localizeMessage(connection.name);
  $('connection-key').placeholder = connection.hasKey
    ? L('Key saved (DPAPI) · enter new key to replace', 'Ключ сохранён (DPAPI) · введите новый для замены', '密钥已保存（DPAPI）· 输入新密钥以替换')
    : tr('conn.keyPlaceholder');
  if (!state.checkJob) $('connection-hint').textContent = connectionHint(state.models.filter(m => m.connectionId === connection.id).length);
}

function renderJob() {
  const j = state.checkJob;
  const running = j?.running === true;
  $('cancel-check').classList.toggle('hidden', !running);
  $('check-all').disabled = running;
  $('check-connection').disabled = running;
  const progressText = j
    ? `${running ? L('Checking', 'Проверка', '检测中') : j.cancelled ? L('Stopped', 'Остановлено', '已停止') : L('Check complete', 'Проверка завершена', '检测完成')}: ${j.done}/${j.total} · ${tr('models.online')} ${j.online} · ${tr('models.offline')} ${j.offline} · ${L('batch size', 'размер группы', '每批数量')} ${j.batchSize}${j.error ? ' · ' + localizeMessage(j.error) : ''}`
    : '';
  $('check-progress').textContent = progressText;
  if (j && connectionId) {
    const count = state.models.filter(m => m.connectionId === connectionId).length;
    $('connection-hint').textContent = L(`Models in catalog: ${count}. ${progressText}`, `Моделей в каталоге: ${count}. ${progressText}`, `目录中的模型数：${count}。${progressText}`);
  }
}

function getFilteredModels() {
  const filter = $('model-provider').value;
  const query = $('model-search').value.toLowerCase();
  return state.models.filter(
    m =>
      (!filter || m.connectionId === filter) &&
      $('filter-' + m.status).checked &&
      (m.connectionName + ' - ' + m.id + ' ' + m.name).toLowerCase().includes(query)
  );
}

function renderModels() {
  const filter = $('model-provider').value;
  if (document.activeElement !== $('model-provider')) {
    $('model-provider').replaceChildren(element('option', L('All connections', 'Все подключения', '全部连接')));
    $('model-provider').firstChild.value = '';
    for (const c of state.connections) {
      const o = element('option', localizeMessage(c.name || c.id));
      o.value = c.id;
      $('model-provider').append(o);
    }
    $('model-provider').value = filter;
  }

  const models = getFilteredModels();
  const list = $('model-list');
  list.replaceChildren();
  const activeConnId = state.translator?.connectionId || state.selectedId;
  const activeModelId = state.translator?.model || state.activeModel;

  for (const m of models) {
    const row = element('div', null, 'model-row');
    const indicator = element(
      'span',
      { online: tr('models.online'), offline: tr('models.offline'), unchecked: L('Unchecked', 'Не проверена', '未检测') }[m.status] || L('Unchecked', 'Не проверена', '未检测'),
      'status ' + (m.status || 'unchecked')
    );
    indicator.title = (localizeMessage(m.detail) || L('Not checked yet', 'Проверка ещё не выполнялась', '尚未检测')) + (m.checkedAt ? ' · ' + new Date(m.checkedAt).toLocaleString(uiLocale()) : '');

    const nameCell = element('div', null, 'model-name');
    nameCell.append(
      element('span', m.id),
      element('span', `${formatContext(m.context)} · ${L('reasoning:', 'рассуждения:', '推理强度：')} ${(m.efforts || []).map(formatEffortLabel).join(', ') || L('none', 'нет', '无')}`, 'model-meta')
    );

    const isCurrentTranslatorModel = m.connectionId === activeConnId && m.id === activeModelId;
    const useBtn = element(
      'button',
      isCurrentTranslatorModel
        ? L('✓ Selected for Translator', '✓ Выбрана в переводчик', '✓ 已选为翻译模型')
        : L('Select for Translator', 'Выбрать для переводчика', '选为翻译模型'),
      'use-model-btn' + (isCurrentTranslatorModel ? ' active-model' : '')
    );
    useBtn.onclick = () =>
      enqueue('selectTranslatorModel', { connectionId: m.connectionId, model: m.id }, () => reload(true));

    const toggle = element('input');
    toggle.type = 'checkbox';
    toggle.className = 'switch';
    toggle.checked = m.enabled;
    toggle.title = L('Show in translator model selection', 'Показывать в списке моделей переводчика', '在翻译模型选择列表中显示');
    toggle.onchange = () =>
      enqueue('setModelEnabled', { connectionId: m.connectionId, model: m.id, enabled: toggle.checked }, () => reload());

    row.append(element('div', localizeMessage(m.connectionName), 'model-connection'), nameCell, indicator, useBtn, toggle);
    list.append(row);
  }
  const enabledTotal = state.models.filter(m => m.enabled).length;
  $('model-summary').textContent = L(
    `Showing ${models.length} of ${state.models.length} · Enabled for translator selection: ${enabledTotal}`,
    `Показано ${models.length} из ${state.models.length} · Доступно для выбора в переводчике: ${enabledTotal}`,
    `显示 ${models.length} / ${state.models.length} · 可供翻译器选择的模型：${enabledTotal}`
  );
  if (!models.length) {
    list.append(
      element(
        'div',
        L('No models found. Add an API provider on the "API Providers" tab and click "Load / Refresh Models".', 'Нет моделей. Добавьте API-провайдер на вкладке «API-провайдеры» и нажмите «Загрузить / обновить модели».', '暂无模型。请在“API 提供商”标签页添加提供商并点击“加载 / 刷新模型列表”。'),
        'empty'
      )
    );
  }
}

function saveTranslator(overrideEnabled = undefined) {
  if (editing) return;
  const value = $('translator-model').value;
  const pair = value ? JSON.parse(value) : null;
  const enabledVal = typeof overrideEnabled === 'boolean' ? overrideEnabled : $('translator-enabled').checked;
  enqueue(
    'saveTranslator',
    {
      enabled: enabledVal,
      autoLanguage: $('translator-auto-language').checked,
      showIndicators: $('translator-show-indicators') ? $('translator-show-indicators').checked : true,
      instructions: $('translator-instructions') ? $('translator-instructions').value : '',
      connectionId: pair?.[0] || state?.translator?.connectionId || state?.selectedId || null,
      model: pair?.[1] || state?.translator?.model || '',
      effort: $('translator-effort').value,
      targetLanguage: $('translator-language').value || 'ru',
      timeoutMs: 120000
    },
    () => reload()
  ).catch(() => {
    reload(true);
  });
}

function reload(full = false) {
  const run = reloading.then(async () => {
    const next = await request('snapshot');
    if (!timers.size && !saving && ($('save-status').textContent === 'Загрузка…' || $('save-status').textContent === 'Loading…' || $('save-status').textContent === '加载中…')) {
      status(L('Synchronized', 'Синхронизировано', '已同步'));
    }
    if (!full && JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    $('connection-count').textContent = state.connections.length;
    $('model-count').textContent = `${state.models.filter(m => m.enabled).length}/${state.models.length}`;

    if (!uiStateApplied) {
      uiStateApplied = true;
      const u = state.uiState || {};
      const initialLang = ['en', 'ru', 'zh'].includes(u.uiLang) ? u.uiLang : 'en';
      applyUiLanguage(initialLang);
      if (typeof u.filterOnline === 'boolean') $('filter-online').checked = u.filterOnline;
      if (typeof u.filterOffline === 'boolean') $('filter-offline').checked = u.filterOffline;
      if (typeof u.filterUnchecked === 'boolean') $('filter-unchecked').checked = u.filterUnchecked;
      if (u.checkBatch === '10' || u.checkBatch === '20') $('check-batch').value = u.checkBatch;
      if (typeof u.modelSearch === 'string') $('model-search').value = u.modelSearch;
      if (typeof u.translatorModelSearch === 'string') $('translator-model-search').value = u.translatorModelSearch;
      if (typeof u.translatorLanguageSearch === 'string') $('translator-language-search').value = u.translatorLanguageSearch;
      if (u.connectionId && state.connections.some(c => c.id === u.connectionId)) connectionId = u.connectionId;
      if (['today', 'week', 'month', 'all'].includes(u.econPeriod)) selectedEconPeriod = u.econPeriod;
      if (['dashboard', 'economics', 'connections', 'models'].includes(u.tab)) activateTab(u.tab);
    }

    renderSidebarTranslatorBox();
    renderDashboard();
    renderEconomics();
    renderConnections();
    renderModels();
    renderJob();
    if (state?.checkJob?.running) {
      setTimeout(() => {
        if (!editing && !saving && !timers.size) reload(false);
      }, 250);
    }
    if ((full || !connectionId || $('connection-editor')?.classList.contains('hidden')) && !timers.size) {
      showConnection(
        (connectionId && state.connections.some(c => c.id === connectionId) ? connectionId : null) ||
          state.selectedId ||
          state.connections[0]?.id,
        false
      );
    }
  });
  reloading = run.catch(() => {});
  return run;
}

for (const langBtn of document.querySelectorAll('[data-ui-lang]')) {
  langBtn.onclick = () => {
    applyUiLanguage(langBtn.dataset.uiLang || 'en');
    persistUiState();
  };
}

for (const b of document.querySelectorAll('[data-tab]')) {
  b.onclick = () => {
    activateTab(b.dataset.tab);
    persistUiState();
  };
}

for (const btn of document.querySelectorAll('[data-econ-period]')) {
  btn.onclick = () => {
    selectedEconPeriod = btn.dataset.econPeriod || 'all';
    renderEconomics();
    persistUiState();
  };
}

for (const card of document.querySelectorAll('[data-select-period]')) {
  card.onclick = () => {
    selectedEconPeriod = card.dataset.selectPeriod || 'all';
    renderEconomics();
    persistUiState();
  };
}

for (const kpiCard of document.querySelectorAll('.econ-kpi-card')) {
  kpiCard.onclick = () => {
    const target = $('econ-by-model-table');
    if (target?.scrollIntoView) target.scrollIntoView({ behavior: 'auto', block: 'nearest' });
  };
}

if ($('econ-active-tariff-pill')) {
  $('econ-active-tariff-pill').style.cursor = 'pointer';
  $('econ-active-tariff-pill').onclick = () => {
    const target = $('econ-preset-select');
    if (target?.scrollIntoView) {
      target.scrollIntoView({ behavior: 'auto', block: 'center' });
      target.focus?.();
    }
  };
}

$('btn-translator-on').onclick = () => {
  $('translator-enabled').checked = true;
  saveTranslator(true);
};

$('btn-translator-off').onclick = () => {
  $('translator-enabled').checked = false;
  saveTranslator(false);
};

$('dash-enable-translator').onclick = () => {
  $('translator-enabled').checked = true;
  saveTranslator(true);
};

$('dash-disable-translator').onclick = () => {
  $('translator-enabled').checked = false;
  saveTranslator(false);
};

$('btn-restart-desktop').onclick = async () => {
  await flush();
  status(L('Restarting ChatGPT / Codex Desktop…', 'Перезапуск ChatGPT / Codex Desktop…', '正在重启 ChatGPT / Codex 桌面应用…'));
  await enqueue('restartDesktop', {}, res => {
    notify(
      res?.restarted
        ? L('ChatGPT / Codex Desktop restarted.', 'ChatGPT / Codex Desktop перезапущен.', 'ChatGPT / Codex 桌面应用已重启。')
        : L('ChatGPT.exe is not running. Open the app normally.', 'ChatGPT.exe не запущен. Откройте приложение обычным способом.', 'ChatGPT.exe 未运行。请正常打开应用。')
    );
  });
};

$('dash-apply-translator').onclick = () => {
  saveTranslator();
};

$('dash-test-translator').onclick = async () => {
  const val = $('translator-model').value;
  const pair = val ? JSON.parse(val) : null;
  probeResult = { pending: true };
  renderProbeResult();
  try {
    const res = await enqueue('testTranslator', {
      connectionId: pair?.[0],
      model: pair?.[1],
      effort: $('translator-effort').value
    });
    probeResult = { success: res.status === 'online', detail: res.detail };
    renderProbeResult();
    await reload();
  } catch (err) {
    probeResult = { success: false, detail: err.message };
    renderProbeResult();
  }
};

$('dash-install-plugin').onclick = () =>
  enqueue('installPlugin', { restartDesktop: false }, async () => {
    await reload(true);
    notify(L('Plugin and translation interception enabled in ChatGPT / Codex.', 'Плагин и перехват переводчика активированы в ChatGPT / Codex.', '已在 ChatGPT / Codex 中启用插件和翻译拦截。'));
  });

$('dash-disable-plugin').onclick = () =>
  enqueue('disablePlugin', { uninstallFromCodex: false, restartDesktop: false }, async () => {
    await reload(true);
    notify(L('Translator disabled; direct connection restored.', 'Переводчик выключен, восстановлено прямое соединение.', '翻译器已关闭，已恢复直连。'));
  });

$('dash-start-tray').onclick = () =>
  enqueue('startTray', {}, res => {
    if (res && res.started === false) {
      notify(
        L(
          'System tray icon is available on Windows. On macOS and Linux, the gateway runs in the background and is controlled via this panel or CLI.',
          'Иконка в системном трее доступна в Windows. На macOS и Linux шлюз работает в фоне и управляется через эту панель или CLI.',
          '系统托盘图标仅在 Windows 上可用。在 macOS 和 Linux 上，网关在后台运行，可通过此面板或 CLI 控制。'
        )
      );
      return;
    }
    notify(L('Codex Translate (CT) is running in the Windows system tray.', 'Иконка Codex Translate (CT) запущена в системном трее Windows.', 'Codex Translate（CT）已在 Windows 系统托盘中运行。'));
  });

if ($('dash-open-economics')) {
  $('dash-open-economics').onclick = async () => {
    await flush();
    activateTab('economics');
    persistUiState();
  };
}

if ($('econ-preset-select')) {
  $('econ-preset-select').onchange = () => {
    if (editing) return;
    const presetId = $('econ-preset-select').value;
    const isAutoCodex = presetId === state?.economics?.activeCodexModel;
    enqueue('saveEconomicsPricing', { presetId, autoDetectModel: isAutoCodex }, () => reload(true));
  };
}

if ($('econ-auto-detect-model')) {
  $('econ-auto-detect-model').onchange = () => {
    if (editing) return;
    const autoDetectModel = $('econ-auto-detect-model').checked;
    const presetId = autoDetectModel
      ? state?.economics?.activeCodexModel || 'gpt-6.1-sol'
      : $('econ-preset-select')?.value || 'gpt-6.1-sol';
    enqueue('saveEconomicsPricing', { presetId, autoDetectModel }, () => reload(true));
  };
}

function saveCustomEconomicsPricing() {
  if (editing) return;
  const selectedModelId = $('econ-preset-select')?.value || state?.economics?.activeCodexModel || 'gpt-6.1-sol';
  const priceIn = Number($('econ-price-in')?.value || 0);
  const priceCached = Number($('econ-price-cached')?.value || 0);
  const priceWrite30m = $('econ-price-write-30m') ? Number($('econ-price-write-30m').value || 0) : Number((priceIn * 1.25).toFixed(4));
  const priceWrite12h = $('econ-price-write-12h') ? Number($('econ-price-write-12h').value || 0) : Number((priceIn * 2.5).toFixed(4));
  const discountPct =
    priceIn > 0
      ? Number((Math.max(0, (priceIn - priceCached) / priceIn) * 100).toFixed(2))
      : Number($('econ-cache-discount')?.value || 0);

  if (selectedModelId && selectedModelId !== 'custom') {
    enqueue(
      'saveModelRate',
      {
        modelId: selectedModelId,
        priceInPerMillion: priceIn,
        priceCachedPerMillion: priceCached,
        cacheDiscountPercent: discountPct,
        priceCacheWrite30mPerMillion: priceWrite30m,
        priceCacheWrite12hPerMillion: priceWrite12h,
        priceOutPerMillion: Number($('econ-price-out')?.value || 0),
        translatorPricePerMillion: Number($('econ-price-trans')?.value || 0)
      },
      () => reload(true)
    );
    return;
  }

  enqueue(
    'saveEconomicsPricing',
    {
      presetId: 'custom',
      priceInPerMillion: priceIn,
      priceCachedPerMillion: priceCached,
      cacheDiscountPercent: discountPct,
      priceCacheWrite30mPerMillion: priceWrite30m,
      priceCacheWrite12hPerMillion: priceWrite12h,
      priceOutPerMillion: Number($('econ-price-out')?.value || 0),
      translatorPricePerMillion: Number($('econ-price-trans')?.value || 0)
    },
    () => reload(true)
  );
}

if ($('econ-price-in')) {
  $('econ-price-in').oninput = () => {
    const pIn = Number($('econ-price-in').value || 0);
    const disc = Number($('econ-cache-discount')?.value ?? 90);
    if ($('econ-price-cached') && pIn >= 0) {
      $('econ-price-cached').value = Number((pIn * (1 - Math.min(100, Math.max(0, disc)) / 100)).toFixed(4));
    }
    if ($('econ-price-write-30m') && pIn >= 0) {
      $('econ-price-write-30m').value = Number((pIn * 1.25).toFixed(4));
    }
    if ($('econ-price-write-12h') && pIn >= 0) {
      $('econ-price-write-12h').value = Number((pIn * 2.5).toFixed(4));
    }
    debounce('economicsPricing', saveCustomEconomicsPricing);
  };
}

if ($('econ-price-cached')) {
  $('econ-price-cached').oninput = () => {
    const pIn = Number($('econ-price-in')?.value || 0);
    const pCac = Number($('econ-price-cached').value || 0);
    if ($('econ-cache-discount') && pIn > 0) {
      $('econ-cache-discount').value = Number((Math.max(0, (pIn - pCac) / pIn) * 100).toFixed(1));
    }
    debounce('economicsPricing', saveCustomEconomicsPricing);
  };
}

if ($('econ-cache-discount')) {
  $('econ-cache-discount').oninput = () => {
    const pIn = Number($('econ-price-in')?.value || 0);
    const disc = Math.min(100, Math.max(0, Number($('econ-cache-discount').value || 0)));
    if ($('econ-price-cached')) {
      $('econ-price-cached').value = Number((pIn * (1 - disc / 100)).toFixed(4));
    }
    debounce('economicsPricing', saveCustomEconomicsPricing);
  };
}

for (const id of ['econ-price-write-30m', 'econ-price-write-12h', 'econ-price-out', 'econ-price-trans']) {
  if ($(id)) {
    $(id).oninput = () => debounce('economicsPricing', saveCustomEconomicsPricing);
  }
}

if ($('econ-sync-pricing')) {
  $('econ-sync-pricing').onclick = () =>
    enqueue('syncEconomicsPricing', {}, async res => {
      await reload(true);
      notify(
        res?.synced
          ? L(`Synced ${res.modelsCount || 0} models from OpenAI Pricing (4h timer reset).`, `Обновлено тарифов с сайта OpenAI: ${res.modelsCount || 0} (таймер 4ч перезапущен).`, `已从 OpenAI 同步 ${res.modelsCount || 0} 个模型价格（4 小时计时器已重置）。`)
          : L('Could not reach OpenAI Pricing; using saved rates.', 'Сайт тарифов OpenAI недоступен; используются сохранённые тарифы.', '无法连接 OpenAI 价格页面；继续使用已保存的费率。')
      );
    });
}

if ($('econ-save-model-rate')) {
  $('econ-save-model-rate').onclick = () => {
    saveCustomEconomicsPricing();
    notify(L(`Rate saved for model ${$('econ-preset-select')?.value || ''}.`, `Тариф сохранён для модели ${$('econ-preset-select')?.value || ''}.`, `已保存模型 ${$('econ-preset-select')?.value || ''} 的费率。`));
  };
}

if ($('econ-reset-model-rate')) {
  $('econ-reset-model-rate').onclick = () => {
    const modelId = $('econ-preset-select')?.value || state?.economics?.activeCodexModel || 'gpt-6.1-sol';
    if (modelId === 'custom') return;
    enqueue('resetModelRate', { modelId }, async () => {
      await reload(true);
      notify(L(`Default rate restored for ${modelId}.`, `Для модели ${modelId} восстановлен тариф по умолчанию.`, `模型 ${modelId} 的费率已恢复默认值。`));
    });
  };
}

if ($('econ-reset-stats')) {
  $('econ-reset-stats').onclick = () =>
    enqueue('resetEconomicsSession', {}, async () => {
      await reload(true);
      notify(L('Token statistics for this session have been reset.', 'Статистика токенов текущей сессии сброшена.', '本次会话的词元统计已重置。'));
    });
}

async function triggerEconomicsExport(format) {
  try {
    const res = await request('exportEconomics', { format });
    const mime = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';
    const blob = new Blob([res.content || ''], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = res.filename || `codex-translate-economics.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    notify(L(`${format.toUpperCase()} exported: ${a.download}`, `Экспорт ${format.toUpperCase()} выполнен: ${a.download}`, `${format.toUpperCase()} 已导出：${a.download}`));
  } catch (err) {
    notify(`${L('Export failed:', 'Ошибка экспорта:', '导出失败：')} ${localizeMessage(err.message)}`);
  }
}

if ($('econ-export-csv')) {
  $('econ-export-csv').onclick = () => triggerEconomicsExport('csv');
}
if ($('econ-export-json')) {
  $('econ-export-json').onclick = () => triggerEconomicsExport('json');
}

$('add-connection').onclick = async () => {
  await flush();
  await enqueue('createConnection', {}, async value => {
    connectionId = value.id;
    await reload(true);
  });
};

$('make-primary-connection').onclick = () => {
  if (!connectionId) return;
  enqueue('saveConnection', { id: connectionId, primary: true }, () => reload(true));
};

$('remove-connection').onclick = () => {
  if (!connectionId) return;
  enqueue('removeConnection', { id: connectionId }, async () => {
    connectionId = null;
    await reload(true);
  });
};

for (const id of ['connection-name', 'connection-url', 'connection-key']) {
  $(id).oninput = () => debounce('connection', saveConnection);
}
$('connection-kind').onchange = () => saveConnection();

$('refresh-connection').onclick = async () => {
  await flush();
  if (!connectionId) return;
  $('connection-hint').textContent = L('Loading the model catalog from the server…', 'Загрузка каталога моделей с сервера…', '正在从服务器加载模型目录…');
  await enqueue('refreshModels', { id: connectionId }, async res => {
    await reload(true);
    notify(L(`Models loaded: ${res.count}`, `Загружено моделей: ${res.count}`, `已加载 ${res.count} 个模型`));
  });
};

$('check-connection').onclick = async () => {
  await flush();
  if (!connectionId) return;
  const batchSize = Number($('check-batch').value) === 20 ? 20 : 10;
  await enqueue('checkModels', { connectionId, batchSize }, () => reload());
};

$('refresh-all').onclick = async () => {
  await flush();
  await enqueue('refreshAllModels', {}, () => reload(true));
};

$('check-all').onclick = async () => {
  await flush();
  const batchSize = Number($('check-batch').value) === 20 ? 20 : 10;
  await enqueue('checkModels', { connectionId: $('model-provider').value || null, batchSize }, () => reload());
};

$('cancel-check').onclick = () => enqueue('cancelCheck', {}, () => reload());

$('enable-filtered').onclick = () => {
  const items = getFilteredModels().map(m => ({ connectionId: m.connectionId, model: m.id, enabled: true }));
  enqueue('setBulkModelsEnabled', { items, enabled: true }, () => reload());
};

$('disable-filtered').onclick = () => {
  const items = getFilteredModels().map(m => ({ connectionId: m.connectionId, model: m.id, enabled: false }));
  enqueue('setBulkModelsEnabled', { items, enabled: false }, () => reload());
};

for (const id of ['model-search', 'model-provider', 'filter-online', 'filter-offline', 'filter-unchecked', 'check-batch']) {
  $(id).oninput = $(id).onchange = () => {
    renderModels();
    persistUiState();
  };
}

$('translator-enabled').onchange = () => saveTranslator();
$('translator-auto-language').onchange = () => saveTranslator();
if ($('translator-show-indicators')) $('translator-show-indicators').onchange = () => saveTranslator();
if ($('translator-instructions')) $('translator-instructions').oninput = () => debounce('translator', () => saveTranslator());
$('translator-model').onchange = () => {
  fillTranslatorEfforts('');
  saveTranslator();
};
$('translator-effort').onchange = () => saveTranslator();
$('translator-language').onchange = () => saveTranslator();
$('translator-model-search').oninput = () => {
  renderDashboard();
  persistUiState();
};
$('translator-language-search').oninput = () => {
  renderDashboard();
  persistUiState();
};

window.addEventListener('beforeunload', () => {
  flush();
});

reload(true);
setInterval(() => {
  if (!editing && !saving && !timers.size) reload(false);
}, 2500);
