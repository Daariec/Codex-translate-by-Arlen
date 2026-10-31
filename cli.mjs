import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  routingStatus,
  switchRoute,
  syncPluginCache,
  ensurePluginEnabledInCodex,
  restartCodexDesktop,
  ensureTrayRunning,
  openControlPanel
} from './routing.mjs';
import {
  normalizeURL,
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
import { readTranslatorSettings, saveTranslatorSettings, LANGUAGES } from './translator.mjs';

export const root = path.dirname(fileURLToPath(import.meta.url));
export const pkg = jsonRead(path.join(root, 'package.json'), { name: 'codex-translate', version: '1.0.0' });
export const kind = pkg.name;

export function options(args) {
  const out = {};
  const allowed = new Set([
    'id',
    'url',
    'kind',
    'model',
    'effort',
    'route',
    'enabled',
    'lang',
    'auto-lang',
    'key-env',
    'search',
    'data-dir',
    'codex-home'
  ]);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--stdin-key') {
      out.stdinKey = true;
      continue;
    }
    if (args[i] === '--json') {
      out.json = true;
      continue;
    }
    if (args[i] === '--force') {
      out.force = true;
      continue;
    }
    if (args[i] === '--restart-desktop') {
      out.restartDesktop = true;
      continue;
    }
    if (args[i] === '--on') {
      out.enabled = 'true';
      continue;
    }
    if (args[i] === '--off') {
      out.enabled = 'false';
      continue;
    }
    const key = args[i].replace(/^--/, '');
    if (!args[i].startsWith('--') || !allowed.has(key) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw Error('Invalid option: ' + args[i]);
    }
    out[key] = args[++i];
  }
  return out;
}

function help() {
  console.log(
    `${kind} — Standalone User <-> Agent Translator for official ChatGPT & Codex\n\n` +
      `Commands:\n` +
      `  on                            Turn ON the User <-> Agent translator\n` +
      `  off                           Turn OFF the User <-> Agent translator\n` +
      `  toggle                        Toggle translator between ON and OFF\n` +
      `  configure --id name --url https://server/v1 --stdin-key [--kind omniroute|responses|chat_completions|anthropic] [--model id]\n` +
      `  update --id name [--url https://server/v1] [--stdin-key] [--json]\n` +
      `  use --id name                 Select active translator connection\n` +
      `  sync [--id name]              Refresh /v1/models for translator connection\n` +
      `  models [--id name] [--search text]\n` +
      `  select --model exact-model-id [--id name] [--effort level] [--lang ru]\n` +
      `  status                        Show translator status (ON/OFF), model, and saved connections\n` +
      `  switch --route translate      Enable local translation interception in ChatGPT/Codex\n` +
      `  switch --route base           Disable interception and restore direct connection\n` +
      `  panel                         Open Codex Translate Control Panel\n` +
      `  tray                          Start Windows System Tray icon (CT)\n` +
      `  install                       Install plugin and activate translation bridge\n` +
      `  restore                       Restore original config.toml without interception\n`
  );
}

export async function main(argv = process.argv.slice(2)) {
  const command = argv.shift() ?? 'help';
  const opt = options(argv);
  if (command === 'help') return help();
  if (command === 'guide') {
    console.log(path.join(root, 'README.md'));
    return;
  }

  const dataDir = path.resolve(opt['data-dir'] ?? defaultDataDir(kind));
  const codexHome = path.resolve(opt['codex-home'] ?? defaultCodexHome());
  const stateFile = path.join(dataDir, 'state.json');
  const helper = path.join(root, 'Credential.ps1');

  const state = jsonRead(stateFile, { version: 1, selected: null, desiredRoute: 'translate', connections: {} });
  for (const conn of Object.values(state.connections ?? {})) {
    if (Array.isArray(conn.models)) conn.models = conn.models.map(normalizeModel);
  }
  const id = opt.id ?? state.selected ?? 'default';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
    throw Error('Connection ID must contain 1–64 letters, digits, underscores or hyphens.');
  }
  const save = () => writeJSON(stateFile, state);
  const connection = () => {
    const c = state.connections[id];
    if (!c) throw Error('No saved connection: ' + id);
    return c;
  };

  if (command === 'ui-data') {
    const translator = readTranslatorSettings(dataDir);
    const preferredLanguage = jsonRead(path.join(dataDir, 'provider-ui-state.json'), {}).uiLang;
    const uiLanguage = ['en', 'ru', 'zh'].includes(preferredLanguage) ? preferredLanguage : 'en';
    const languageNames = new Intl.DisplayNames([uiLanguage], { type: 'language' });
    console.log(
      JSON.stringify({
        dataDir,
        codexHome,
        selected: state.selected,
        translator,
        uiLanguage,
        languages: LANGUAGES.map(language => ({ ...language, name: languageNames.of(language.code) || language.name })),
        routing: routingStatus(dataDir, codexHome),
        connections: Object.entries(state.connections).map(([cid, c]) => ({
          id: cid,
          name: c.name || cid,
          kind: c.kind || 'omniroute',
          baseURL: c.baseURL,
          model: c.model,
          effort: c.effort ?? null,
          models: (c.models || []).filter(m => m.eligible)
        }))
      })
    );
    return;
  }

  if (command === 'status') {
    const translator = readTranslatorSettings(dataDir);
    console.log(
      JSON.stringify(
        {
          package: kind,
          selected: state.selected,
          desiredRoute: state.desiredRoute ?? 'translate',
          translator,
          routing: routingStatus(dataDir, codexHome),
          connections: Object.entries(state.connections).map(([name, c]) => ({
            id: name,
            kind: c.kind || 'omniroute',
            url: c.baseURL,
            model: c.model,
            effort: c.effort ?? 'auto',
            models: c.models?.length ?? 0,
            fetchedAt: c.fetchedAt
          })),
          dataDir
        },
        null,
        2
      )
    );
    return;
  }

  if (command === 'on' || command === 'off' || command === 'toggle') {
    const current = readTranslatorSettings(dataDir);
    const nextEnabled = command === 'on' ? true : command === 'off' ? false : !current.enabled;
    const cid = opt.id || current.connectionId || state.selected || Object.keys(state.connections)[0] || null;
    const conn = cid ? state.connections[cid] : null;
    const model = opt.model || current.model || conn?.model || conn?.models?.find(m => m.eligible)?.id || '';
    const saved = saveTranslatorSettings(dataDir, {
      enabled: nextEnabled,
      ...(cid ? { connectionId: cid } : {}),
      ...(model ? { model } : {}),
      ...(opt.effort ? { effort: opt.effort } : {}),
      ...(opt.lang ? { targetLanguage: opt.lang } : {})
    });
    const isIsolated = !!(opt['data-dir'] || opt['codex-home']);
    let gwInfo = jsonRead(path.join(dataDir, 'gateway.json'), null);
    if (!isIsolated && nextEnabled) {
      gwInfo = await ensureGatewayDaemon({ dataDir, codexHome });
    }
    if (nextEnabled) {
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
      save();
    }
    const payload = { ok: true, enabled: saved.enabled, translator: saved, routing: routingStatus(dataDir, codexHome) };
    console.log(opt.json ? JSON.stringify(payload) : JSON.stringify(payload, null, 2));
    return;
  }

  if (command === 'panel-url') {
    const gw = await ensureGatewayDaemon({ dataDir, codexHome });
    console.log(JSON.stringify({ ...gw, dataDir, codexHome }));
    return;
  }

  if (command === 'panel') {
    const gw = await ensureGatewayDaemon({ dataDir, codexHome });
    ensureTrayRunning(root);
    openControlPanel({ pluginRoot: root, uiUrl: gw.uiUrl, dataDir, codexHome, async: false });
    console.log(JSON.stringify({ opened: true, ...gw }));
    return;
  }

  if (command === 'tray') {
    const gw = await ensureGatewayDaemon({ dataDir, codexHome });
    ensureTrayRunning(root);
    console.log(JSON.stringify({ trayStarted: true, ...gw }));
    return;
  }

  if (command === 'startup' || command === 'install') {
    ensurePluginEnabledInCodex({ codexHome, pluginRoot: root, dataDir, version: pkg.version });
    const isIsolatedTest = !!(opt['data-dir'] || opt['codex-home']);
    let gw = null;
    if (!isIsolatedTest) {
      gw = await ensureGatewayDaemon({ dataDir, codexHome });
      ensureTrayRunning(root, {
        minimizePanelToTray: command === 'startup',
        dataDir,
        codexHome
      });
    }
    let status = routingStatus(dataDir, codexHome);
    const gwUrl = gw?.baseUrl || `http://127.0.0.1:${DEFAULT_GATEWAY_PORT}/v1`;
    if (state.desiredRoute !== 'base') {
      const cfgFile = path.join(codexHome, 'config.toml');
      const rawBuf = fs.existsSync(cfgFile) ? fs.readFileSync(cfgFile) : Buffer.alloc(0);
      const rawStr = rawBuf.toString('utf8');
      const alreadyHealthy =
        command === 'startup' &&
        !rawBuf.includes(0) &&
        status.interceptActive &&
        status.managed &&
        rawStr.includes(gwUrl);
      if (!alreadyHealthy) {
        status = switchRoute({
          route: 'translate',
          dataDir,
          codexHome,
          gatewayBaseUrl: gwUrl,
          generated: translateBridgeConfig(gwUrl),
          force: true
        });
      }
      state.desiredRoute = 'translate';
      save();
    }
    const desktopRestart = opt.restartDesktop ? restartCodexDesktop({ relaunch: true, codexHome, dataDir }) : { restarted: false, relaunched: false };
    const payload = {
      ...status,
      selected: state.selected,
      desiredRoute: state.desiredRoute ?? 'translate',
      translator: readTranslatorSettings(dataDir),
      ...(gw ? { gateway: gw } : {}),
      desktopRestart
    };
    console.log(opt.json ? JSON.stringify(payload) : JSON.stringify(payload, null, 2));
    return;
  }

  if (command === 'switch' || command === 'activate' || command === 'restore') {
    const rawRoute = command === 'activate' ? 'translate' : command === 'restore' ? 'base' : opt.route;
    const normRoute = rawRoute === 'omniroute' || rawRoute === 'translate' ? 'translate' : rawRoute === 'direct' ? 'base' : rawRoute;
    if (!['base', 'translate'].includes(normRoute)) {
      throw Error('Choose --route base or --route translate.');
    }
    const isIsolatedTest = !!(opt['data-dir'] || opt['codex-home']);
    let gw = null;
    if (!isIsolatedTest && normRoute === 'translate') {
      try {
        gw = await ensureGatewayDaemon({ dataDir, codexHome });
      } catch {}
    }
    const gwUrl = gw?.baseUrl || `http://127.0.0.1:${DEFAULT_GATEWAY_PORT}/v1`;
    const result = switchRoute({
      route: normRoute,
      dataDir,
      codexHome,
      gatewayBaseUrl: gwUrl,
      generated: normRoute === 'translate' ? translateBridgeConfig(gwUrl) : null,
      force: !!opt.force
    });
    state.desiredRoute = normRoute;
    save();
    if (opt.enabled !== undefined) {
      saveTranslatorSettings(dataDir, { enabled: opt.enabled === 'true' });
    }
    syncPluginCache(codexHome, root, pkg.version);
    const desktopRestart = opt.restartDesktop ? restartCodexDesktop({ relaunch: true, codexHome, dataDir }) : undefined;
    console.log(
      JSON.stringify(
        {
          ...result,
          translator: readTranslatorSettings(dataDir),
          ...(desktopRestart ? { desktopRestart } : {}),
          message: 'Translator route updated. Base ChatGPT/Codex models and OpenAI authentication were preserved.'
        },
        null,
        2
      )
    );
    return;
  }

  if (command === 'configure' || command === 'update') {
    const urlRaw = opt.url ?? (command === 'update' ? connection().baseURL : null);
    if (!urlRaw) throw Error('--url is required.');
    let key;
    if (opt.stdinKey) key = fs.readFileSync(0, 'utf8').trim();
    else if (opt['key-env']) key = process.env[opt['key-env']];
    else if (command === 'update') key = credential(helper, 'Read', connection().credentialFile);
    else throw Error('Use Setup.cmd, Panel.cmd, --stdin-key or --key-env VARIABLE_NAME; never pass a key as an argument.');
    if (!key) throw Error('An API key is required.');

    const url = normalizeURL(urlRaw);
    const connKind = opt.kind && ['omniroute', 'responses', 'chat_completions', 'anthropic'].includes(opt.kind)
      ? opt.kind
      : state.connections[id]?.kind || 'omniroute';
    const models = await discover(url, key, connKind);
    const previousModel = state.connections[id]?.model;
    const model =
      opt.model ??
      (models.some(m => m.eligible && m.id === previousModel) ? previousModel : null) ??
      models.find(m => m.eligible)?.id;
    if (!models.some(m => m.id === model && m.eligible)) {
      throw Error('Selected model was not returned as an eligible model by this server.');
    }
    const credentialFile = path.join(dataDir, 'credentials', id + '-' + randomUUID() + '.dpapi');
    credential(helper, 'Protect', credentialFile, key);
    const selectedModelObj = models.find(m => m.id === model);
    let effort = opt.effort ?? state.connections[id]?.effort;
    if (effort && selectedModelObj?.efforts?.length > 0 && !selectedModelObj.efforts.includes(effort)) {
      effort = selectedModelObj.efforts.includes('medium') ? 'medium' : selectedModelObj.efforts[0] ?? null;
    }
    state.connections[id] = {
      id,
      name: state.connections[id]?.name || id,
      kind: connKind,
      baseURL: url,
      credentialFile,
      model,
      effort,
      models,
      fetchedAt: new Date().toISOString()
    };
    state.selected = id;
    save();

    const currentTrans = readTranslatorSettings(dataDir);
    saveTranslatorSettings(dataDir, {
      connectionId: id,
      model,
      ...(effort ? { effort } : {}),
      ...(opt.lang ? { targetLanguage: opt.lang } : {}),
      ...(opt.enabled !== undefined ? { enabled: opt.enabled === 'true' } : { enabled: currentTrans.enabled })
    });

    if (opt.json) console.log(JSON.stringify({ id, baseURL: url, models: models.length, model, staged: true }));
    else console.log(`Saved translator provider ${id}: ${models.length} models; selected ${model}.`);
    return;
  }

  if (command === 'models') {
    const q = (opt.search ?? '').toLowerCase();
    for (const m of connection().models.filter(m => (m.id + ' ' + m.name).toLowerCase().includes(q))) {
      console.log(`${m.id}\tcontext=${m.context ?? 'unknown'}\teffort=${m.efforts.join(',') || 'not advertised'}${m.eligible ? '' : '\t[not eligible]'}`);
    }
    return;
  }

  if (command === 'use' || command === 'select' || command === 'sync') {
    const c = connection();
    if (command === 'select') {
      if (!c.models.some(m => m.id === opt.model && m.eligible)) throw Error('Choose an exact eligible model ID from models.');
      c.model = opt.model;
      const targetModel = c.models.find(m => m.id === c.model);
      if (opt.effort) {
        if (targetModel?.efforts?.length > 0 && !targetModel.efforts.includes(opt.effort)) {
          throw Error(`Effort "${opt.effort}" is not supported for ${c.model}. Supported: ${targetModel.efforts.join(', ')}`);
        }
        c.effort = opt.effort;
      } else if (c.effort && targetModel?.efforts?.length > 0 && !targetModel.efforts.includes(c.effort)) {
        c.effort = targetModel.efforts.includes('medium') ? 'medium' : targetModel.efforts[0] ?? null;
      }
    }
    if (command === 'sync') {
      const models = await discover(c.baseURL, credential(helper, 'Read', c.credentialFile), c.kind || 'omniroute');
      if (!models.some(m => m.id === c.model && m.eligible)) {
        c.model = models.find(m => m.eligible)?.id ?? c.model;
      }
      c.models = models;
      c.fetchedAt = new Date().toISOString();
    }
    state.selected = id;
    save();
    saveTranslatorSettings(dataDir, {
      connectionId: id,
      model: c.model,
      ...(c.effort ? { effort: c.effort } : {}),
      ...(opt.lang ? { targetLanguage: opt.lang } : {}),
      ...(opt.enabled !== undefined ? { enabled: opt.enabled === 'true' } : {})
    });
    if (opt.json) console.log(JSON.stringify({ id, model: c.model, effort: c.effort, staged: true }));
    else console.log(`Selected translator model ${c.model} on ${id}.`);
    return;
  }

  throw Error('Unknown command: ' + command);
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

if (isExecutedDirectly(process.argv[1], import.meta.url)) {
  main().catch(e => {
    console.error(e.message);
    process.exit(1);
  });
}
