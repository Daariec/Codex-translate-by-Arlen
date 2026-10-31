import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import {
  atomicWrite,
  writeJSON,
  jsonRead,
  hash,
  patchCodexTranslate,
  stripCodexTranslate,
  translateBridgeConfig,
  hasCodexTranslateBridge,
  extractRootOpenaiBaseUrl,
  isOwnTranslateBridgeUrl,
  psPath,
  defaultCodexHome,
  realUserProfile
} from './lib.mjs';

const read = p => (fs.existsSync(p) ? fs.readFileSync(p) : Buffer.alloc(0));
const runtimeLine = /^([ \t]*SKY_CUA_NATIVE_PIPE_DIRECTORY[ \t]*=)[^\r\n]*/gm;
const stableHash = bytes => hash(bytes.toString('utf8').replace(runtimeLine, '$1 [runtime value]'));

function restoreRuntimeValue(baseline, current) {
  const curText = current.toString('utf8');
  const lines = curText.match(runtimeLine) ?? [];
  let i = 0;
  let out = baseline.toString('utf8').replace(runtimeLine, line => lines[i++] ?? line);

  // Preserve user-selected root model and reasoning effort from current config if present
  const curRoot = curText.split(/^\s*\[/m)[0];
  for (const key of ['model', 'model_reasoning_effort', 'service_tier', 'model_reasoning_summary', 'model_verbosity']) {
    const re = new RegExp(`^(\\s*${key}\\s*=\\s*["'][^"']+["'])`, 'm');
    const curMatch = re.exec(curRoot);
    if (curMatch?.[1]) {
      const parts = out.split(/^(\s*\[)/m);
      if (re.test(parts[0])) {
        parts[0] = parts[0].replace(re, curMatch[1]);
        out = parts.join('');
      }
    }
  }
  return Buffer.from(out);
}

function findLatestBackup(dataDir) {
  const backupsDir = path.join(dataDir, 'backups');
  if (!fs.existsSync(backupsDir)) return null;
  const files = fs
    .readdirSync(backupsDir)
    .filter(f => f.startsWith('base-') && f.endsWith('.toml'))
    .map(f => path.join(backupsDir, f));
  if (!files.length) return null;
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0];
}

export function routingStatus(dataDir, codexHome) {
  const target = path.join(codexHome, 'config.toml');
  const record = jsonRead(path.join(dataDir, 'routing.json'), null);
  const gwInfo = jsonRead(path.join(dataDir, 'gateway.json'), null);
  const knownGatewayUrls = [record?.gatewayBaseUrl, gwInfo?.baseUrl].filter(Boolean);
  const current = read(target);
  const digest = hash(current);
  const valid = record?.target === target;
  const matches =
    valid &&
    (digest === record.installedHash ||
      (record.installedStableHash && stableHash(current) === record.installedStableHash));
  const baselineMatches =
    valid && fs.existsSync(record.backup) && stableHash(current) === stableHash(read(record.backup));
  const currentStr = current.toString('utf8');
  const baseUrl = extractRootOpenaiBaseUrl(currentStr);
  const isTranslateBridge = hasCodexTranslateBridge(currentStr, knownGatewayUrls);

  return {
    configuredRoute: isTranslateBridge ? 'translate' : 'base',
    interceptActive: !!isTranslateBridge,
    interceptUrl: isTranslateBridge ? baseUrl : null,
    externalBaseUrl: !isTranslateBridge && baseUrl ? baseUrl : record?.originalOpenaiBaseUrl || null,
    managed: !!matches,
    changedOutsideSwitcher: !!valid && !matches && !baselineMatches,
    restartRequired: true,
    backup: valid ? record.backup : null
  };
}

export function switchRoute({
  route,
  dataDir,
  codexHome,
  gatewayBaseUrl = 'http://127.0.0.1:24131/v1',
  generated = null,
  force = false
}) {
  const normRoute = route === 'omniroute' || route === 'translate' ? 'translate' : route === 'direct' ? 'base' : route;
  if (!['base', 'translate'].includes(normRoute)) {
    throw Error('Choose --route base or --route translate.');
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const lock = path.join(dataDir, 'routing.lock');
  let fd;
  try {
    fd = fs.openSync(lock, 'wx');
  } catch {
    try {
      const st = fs.statSync(lock);
      if (Date.now() - st.mtimeMs > 60000) {
        fs.unlinkSync(lock);
        fd = fs.openSync(lock, 'wx');
      }
    } catch {}
    if (fd === undefined) throw Error('Another switch is in progress. Retry after it finishes. Lock: ' + lock);
  }

  try {
    const target = path.join(codexHome, 'config.toml');
    const stateFile = path.join(dataDir, 'routing.json');
    const record = jsonRead(stateFile, null);
    const rawCurrent = read(target);
    let current = rawCurrent;
    const onDiskDigest = hash(rawCurrent);

    const cleanBackup = record?.backup && fs.existsSync(record.backup) ? record.backup : findLatestBackup(dataDir);
    const backupBytes = cleanBackup && fs.existsSync(cleanBackup) ? fs.readFileSync(cleanBackup) : null;
    const backupHasDesktop = backupBytes ? backupBytes.toString('utf8').includes('[desktop]') : false;
    const diskWasCorrupted =
      rawCurrent.includes(0) ||
      (backupHasDesktop && !rawCurrent.toString('utf8').includes('[desktop]'));

    if (diskWasCorrupted) {
      if (backupBytes) {
        current = restoreRuntimeValue(backupBytes, Buffer.from(current.toString('utf8').replace(/\0+/g, '')));
      } else {
        current = Buffer.from(current.toString('utf8').replace(/\0+/g, ''));
      }
    }

    const digest = hash(current);
    if (record && record.target !== target && !force) {
      throw Error('Switcher belongs to a different Codex home. Use its original home or an isolated data directory.');
    }
    const managed =
      record &&
      (digest === record.installedHash ||
        (record.installedStableHash && stableHash(current) === record.installedStableHash));
    const atBaseline =
      record &&
      (digest === record.baselineHash ||
        (fs.existsSync(record.backup) && stableHash(current) === stableHash(read(record.backup))));
    if (record && !managed && !atBaseline && !force) {
      throw Error(
        'Codex settings changed outside Codex Translate. Switch refused to preserve your edits. Original backup: ' +
          record.backup
      );
    }

    const gwInfo = jsonRead(path.join(dataDir, 'gateway.json'), null);
    const knownGatewayUrls = [gatewayBaseUrl, record?.gatewayBaseUrl, gwInfo?.baseUrl].filter(Boolean);

    if (normRoute === 'base') {
      const currentText = current.toString('utf8');
      const hasBridge = hasCodexTranslateBridge(currentText, knownGatewayUrls);
      if (!hasBridge && !record) {
        return routingStatus(dataDir, codexHome);
      }

      let backupFile = record?.backup;
      if (!backupFile || !fs.existsSync(backupFile)) {
        backupFile = findLatestBackup(dataDir);
      }
      if (backupFile && fs.existsSync(backupFile)) {
        const baseline = fs.readFileSync(backupFile);
        if (record && !force && hash(baseline) !== record.baselineHash) {
          throw Error('Original backup changed. Restore refused.');
        }
        if (record && !force && hash(read(target)) !== onDiskDigest) {
          throw Error('Codex settings changed during switching. Retry.');
        }
        if (!atBaseline || diskWasCorrupted) {
          if (record?.existed ?? true) {
            const stripped = stripCodexTranslate(currentText, baseline.toString('utf8'), knownGatewayUrls);
            const matchesBaseline = stableHash(Buffer.from(stripped)) === stableHash(baseline);
            if ((managed || atBaseline || matchesBaseline || diskWasCorrupted) && !force) {
              atomicWrite(target, restoreRuntimeValue(baseline, current));
            } else {
              atomicWrite(target, restoreRuntimeValue(Buffer.from(stripped), current));
            }
          } else if (fs.existsSync(target)) {
            fs.unlinkSync(target);
          }
        }
      } else {
        const fallbackBaseline = record?.originalOpenaiBaseUrl
          ? `openai_base_url = ${JSON.stringify(record.originalOpenaiBaseUrl)}\n`
          : '';
        const stripped = stripCodexTranslate(currentText, fallbackBaseline, knownGatewayUrls);
        atomicWrite(target, restoreRuntimeValue(Buffer.from(stripped), current));
      }
      writeJSON(stateFile, null);
      syncMsixLocalCache(dataDir);
      return routingStatus(dataDir, codexHome);
    }

    if (record && !force && hash(fs.readFileSync(record.backup)) !== record.baselineHash) {
      throw Error('Original backup changed. Switch refused.');
    }

    const effectiveGenerated = generated || translateBridgeConfig(gatewayBaseUrl);
    const installed = patchCodexTranslate(current.toString('utf8'), effectiveGenerated, !!managed || force, knownGatewayUrls);
    if (hash(read(target)) !== onDiskDigest) {
      throw Error('Codex settings changed during validation. Switch refused.');
    }

    let backup = record?.backup;
    let baselineHash = record?.baselineHash;
    let existed = record?.existed;
    let originalOpenaiBaseUrl = record?.originalOpenaiBaseUrl ?? null;
    if (!record) {
      const latest = findLatestBackup(dataDir);
      const currentText = current.toString('utf8');
      const hasBridge = hasCodexTranslateBridge(currentText, knownGatewayUrls);
      const currentBaseUrl = extractRootOpenaiBaseUrl(currentText);
      if (!hasBridge && currentBaseUrl && !isOwnTranslateBridgeUrl(currentBaseUrl, knownGatewayUrls)) {
        originalOpenaiBaseUrl = currentBaseUrl;
      }
      if (hasBridge && latest && fs.existsSync(latest)) {
        const latestBytes = fs.readFileSync(latest);
        const latestBaseUrl = extractRootOpenaiBaseUrl(latestBytes.toString('utf8'));
        if (latestBaseUrl && !isOwnTranslateBridgeUrl(latestBaseUrl, knownGatewayUrls)) {
          originalOpenaiBaseUrl = latestBaseUrl;
        }
        backup = path.join(dataDir, 'backups', 'base-' + randomUUID() + '.toml');
        const stripped = stripCodexTranslate(currentText, latestBytes.toString('utf8'), knownGatewayUrls);
        atomicWrite(backup, Buffer.from(stripped));
        baselineHash = hash(Buffer.from(stripped));
        existed = true;
      } else if (hasBridge) {
        backup = path.join(dataDir, 'backups', 'base-' + randomUUID() + '.toml');
        const stripped = stripCodexTranslate(currentText, '', knownGatewayUrls);
        atomicWrite(backup, Buffer.from(stripped));
        baselineHash = hash(Buffer.from(stripped));
        existed = fs.existsSync(target);
      } else {
        backup = path.join(dataDir, 'backups', 'base-' + randomUUID() + '.toml');
        atomicWrite(backup, current);
        baselineHash = digest;
        existed = fs.existsSync(target);
      }
    }

    const next = {
      version: 2,
      target,
      backup,
      baselineHash,
      existed,
      originalOpenaiBaseUrl,
      installedHash: hash(installed),
      installedStableHash: stableHash(Buffer.from(installed)),
      gatewayBaseUrl,
      activatedAt: new Date().toISOString(),
      pending: true
    };
    writeJSON(stateFile, next);
    atomicWrite(target, installed);
    next.pending = false;
    writeJSON(stateFile, next);
    syncMsixLocalCache(dataDir);
    return routingStatus(dataDir, codexHome);
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}

export function syncMsixLocalCache(dataDir) {
  if (process.platform !== 'win32' || !dataDir) return false;
  try {
    const norm = path.resolve(dataDir).toLowerCase();
    if (!norm.endsWith(path.join('omnirouteintegrations', 'codex-translate')) || norm.includes('\\packages\\')) {
      return false;
    }
    const packagesRoot = path.join(realUserProfile(), 'AppData', 'Local', 'Packages');
    if (!fs.existsSync(packagesRoot)) return false;

    const copyIfDiff = (src, dst) => {
      if (!fs.existsSync(src)) return;
      const srcBuf = fs.readFileSync(src);
      if (fs.existsSync(dst)) {
        try {
          if (srcBuf.equals(fs.readFileSync(dst))) return;
        } catch {}
      }
      atomicWrite(dst, srcBuf);
    };

    const syncDirFiles = (srcDir, dstDir, pruneExtraneous = false) => {
      if (!fs.existsSync(srcDir)) return;
      fs.mkdirSync(dstDir, { recursive: true });
      for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        const s = path.join(srcDir, entry.name);
        const d = path.join(dstDir, entry.name);
        if (entry.isDirectory()) {
          syncDirFiles(s, d, pruneExtraneous);
        } else if (entry.isFile()) {
          copyIfDiff(s, d);
        }
      }
      if (pruneExtraneous && fs.existsSync(dstDir)) {
        for (const entry of fs.readdirSync(dstDir)) {
          const s = path.join(srcDir, entry);
          const d = path.join(dstDir, entry);
          if (!fs.existsSync(s)) {
            try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
          }
        }
      }
    };

    let synced = false;
    for (const pkgName of fs.readdirSync(packagesRoot)) {
      if (!pkgName.startsWith('OpenAI.Codex_')) continue;
      const localCache = path.join(packagesRoot, pkgName, 'LocalCache', 'Local');
      if (!fs.existsSync(localCache)) continue;
      const cacheRoot = path.join(localCache, 'OmniRouteIntegrations', 'codex-translate');
      fs.mkdirSync(cacheRoot, { recursive: true });

      for (const file of ['state.json', 'routing.json', 'gateway.json', 'model-state.json', 'translator.json', 'translator-state.json']) {
        copyIfDiff(path.join(dataDir, file), path.join(cacheRoot, file));
      }
      copyIfDiff(path.join(dataDir, 'token-economics.json'), path.join(cacheRoot, 'token-economics.json'));
      syncDirFiles(path.join(dataDir, 'credentials'), path.join(cacheRoot, 'credentials'), false);
      syncDirFiles(path.join(dataDir, 'connections'), path.join(cacheRoot, 'connections'), true);

      const rec = jsonRead(path.join(dataDir, 'routing.json'), null);
      const activeBackupName = rec?.backup ? path.basename(rec.backup) : null;
      if (activeBackupName) {
        copyIfDiff(path.join(dataDir, 'backups', activeBackupName), path.join(cacheRoot, 'backups', activeBackupName));
      }
      synced = true;
    }
    return synced;
  } catch {
    return false;
  }
}

export function syncPluginCache(codexHome, pluginRoot, version = '1.0.0') {
  try {
    if (!codexHome || !pluginRoot) return false;
    const cacheDir = path.join(codexHome, 'plugins', 'cache', 'codex-translate-local', 'codex-translate', version);
    if (path.resolve(pluginRoot).toLowerCase() === path.resolve(cacheDir).toLowerCase()) return true;
    fs.mkdirSync(cacheDir, { recursive: true });
    const copyRel = rel => {
      const src = path.join(pluginRoot, rel);
      const dst = path.join(cacheDir, rel);
      if (!fs.existsSync(src)) return;
      const stat = fs.statSync(src);
      if (stat.isDirectory()) {
        fs.mkdirSync(dst, { recursive: true });
        for (const entry of fs.readdirSync(src)) {
          copyRel(path.join(rel, entry));
        }
      } else {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        try {
          fs.copyFileSync(src, dst);
          if (/\.(?:sh|command)$/i.test(dst)) {
            fs.chmodSync(dst, 0o755);
          }
        } catch {}
      }
    };
    const items = [
      '.agents',
      '.codex-plugin',
      'assets',
      'skills',
      'ui',
      '.mcp.json',
      'hooks.json',
      'plugin.json',
      'package.json',
      'cli.mjs',
      'lib.mjs',
      'routing.mjs',
      'protocol.mjs',
      'translator.mjs',
      'economics.mjs',
      'gateway.mjs',
      'mcp-server.mjs',
      'CodexTranslate.exe',
      'Launcher.cs',
      'Credential.ps1',
      'Switch.ps1',
      'Switch.cmd',
      'Panel.ps1',
      'Panel.cmd',
      'Tray.ps1',
      'Tray.cmd',
      'Setup.ps1',
      'Setup.cmd',
      'Install-Plugin.cmd',
      'Install-Plugin for Windows.cmd',
      'Install-Plugin for MacOS.command',
      'Install-Plugin for MacOS.sh',
      'Install-Plugin for Linux.sh',
      'install-plugin.sh',
      'panel.sh',
      'switch.sh',
      'setup.sh',
      'verify-native.mjs',
      'README.md',
      'SETUP.md',
      'INSTALLATION.md',
      'VALIDATION.md',
      'node_modules'
    ];
    for (const item of items) copyRel(item);
    return true;
  } catch {
    return false;
  }
}

export function ensurePluginEnabledInCodex({ codexHome = defaultCodexHome(), pluginRoot, dataDir = null, version = '1.0.0' } = {}) {
  fs.mkdirSync(codexHome, { recursive: true });
  const configPath = path.join(codexHome, 'config.toml');
  const rawCfgBuf = fs.existsSync(configPath) ? fs.readFileSync(configPath) : Buffer.alloc(0);
  let cfgText = rawCfgBuf.toString('utf8').replace(/\0+/g, '');
  if (!cfgText.includes('[desktop]') && dataDir) {
    const rec = jsonRead(path.join(dataDir, 'routing.json'), null);
    if (rec?.backup && fs.existsSync(rec.backup)) {
      cfgText = fs.readFileSync(rec.backup, 'utf8').replace(/\0+/g, '');
    }
  }
  const sourceToml = JSON.stringify(path.resolve(pluginRoot));
  if (!cfgText.includes('[marketplaces.codex-translate-local]')) {
    cfgText =
      cfgText.trimEnd() +
      `\n\n[marketplaces.codex-translate-local]\nsource_type = "local"\nsource = ${sourceToml}\n`;
  } else {
    cfgText = cfgText.replace(
      /(\[marketplaces\.codex-translate-local\][\s\S]*?^\s*source\s*=\s*)[^\r\n]+/m,
      `$1${sourceToml}`
    );
  }
  if (!cfgText.includes('[plugins."codex-translate@codex-translate-local"]')) {
    cfgText = cfgText.trimEnd() + `\n\n[plugins."codex-translate@codex-translate-local"]\nenabled = true\n`;
  } else {
    cfgText = cfgText.replace(
      /(\[plugins\."codex-translate@codex-translate-local"\]\s*\r?\n\s*enabled\s*=\s*)false/m,
      '$1true'
    );
  }
  atomicWrite(configPath, cfgText.trimEnd() + '\n');
  syncPluginCache(codexHome, pluginRoot, version);
}

function spawnDetachedWindowsProcess(commandLine, cwd) {
  if (process.platform !== 'win32') return false;
  try {
    const psQuote = s => `'${String(s).replace(/'/g, "''")}'`;
    const psCmd = `$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }; $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${psQuote(commandLine)}; CurrentDirectory = ${psQuote(cwd)}; ProcessStartupInformation = $si }; if ($r.ReturnValue -eq 0) { exit 0 } else { exit 1 }`;
    const wmiRes = spawnSync(psPath(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psCmd], {
      windowsHide: true,
      timeout: 8000
    });
    if (wmiRes.status === 0) return true;
  } catch {}
  return false;
}

function ensurePanelMinimizedToTray(pluginRoot, { dataDir = null, codexHome = null } = {}) {
  if (process.platform !== 'win32') return false;
  try {
    const panelScript = path.join(pluginRoot, 'Panel.ps1');
    if (!fs.existsSync(panelScript)) return false;
    const args = ['-NoProfile', '-Sta', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', panelScript, '-MinimizeToTray'];
    if (dataDir) args.push('-DataDirectory', dataDir);
    if (codexHome) args.push('-CodexHome', codexHome);
    const cmdLine = `"${psPath()}" ` + args.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ');
    if (spawnDetachedWindowsProcess(cmdLine, pluginRoot)) return true;
    const child = spawn(psPath(), args, {
      detached: true,
      windowsHide: true,
      stdio: 'ignore'
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export function ensureTrayRunning(pluginRoot, { minimizePanelToTray = false, dataDir = null, codexHome = null } = {}) {
  if (process.platform !== 'win32') return false;
  try {
    const trayScript = path.join(pluginRoot, 'Tray.ps1');
    if (!fs.existsSync(trayScript)) return false;
    const args = ['-NoProfile', '-Sta', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', trayScript];
    if (minimizePanelToTray) args.push('-LaunchMinimizedPanel');
    if (dataDir) args.push('-DataDirectory', dataDir);
    if (codexHome) args.push('-CodexHome', codexHome);
    const cmdLine = `"${psPath()}" ` + args.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ');
    if (!spawnDetachedWindowsProcess(cmdLine, pluginRoot)) {
      const child = spawn(psPath(), args, {
        detached: true,
        windowsHide: true,
        stdio: 'ignore'
      });
      child.unref();
    }
    if (minimizePanelToTray) {
      ensurePanelMinimizedToTray(pluginRoot, { dataDir, codexHome });
    }
    return true;
  } catch {
    return false;
  }
}

export function openControlPanel({
  pluginRoot,
  uiUrl,
  dataDir = null,
  codexHome = null,
  async = false,
  platform = process.platform,
  env = process.env
} = {}) {
  if (!uiUrl) return { opened: false, reason: 'missing_url' };
  if (platform === 'win32') {
    const panelScript = path.join(pluginRoot, 'Panel.ps1');
    const args = ['-NoProfile', '-Sta', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', panelScript];
    if (dataDir) args.push('-DataDirectory', dataDir);
    if (codexHome) args.push('-CodexHome', codexHome);
    if (async) {
      const child = spawn(psPath(), args, { detached: true, windowsHide: true, stdio: 'ignore' });
      child.unref();
    } else {
      spawnSync(psPath(), args, { windowsHide: true });
    }
    return { opened: true, uiUrl, platform };
  }

  const profileDir = dataDir ? path.join(dataDir, 'panel-window-profile') : null;
  if (profileDir) {
    try {
      fs.mkdirSync(profileDir, { recursive: true });
    } catch {}
  }
  const appArgs = [
    `--app=${uiUrl}`,
    ...(profileDir ? [`--user-data-dir=${profileDir}`] : []),
    '--window-size=1280,900',
    '--no-first-run',
    '--no-default-browser-check'
  ];

  if (platform === 'darwin') {
    const macBrowsers = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    ];
    const browserExe = macBrowsers.find(p => fs.existsSync(p));
    try {
      if (browserExe) {
        const child = spawn(browserExe, appArgs, { detached: true, stdio: 'ignore' });
        child.unref();
        return { opened: true, uiUrl, platform, browser: browserExe };
      }
      const child = spawn('open', [uiUrl], { detached: true, stdio: 'ignore' });
      child.unref();
      return { opened: true, uiUrl, platform, browser: 'open' };
    } catch {
      return { opened: false, uiUrl, platform };
    }
  }

  // Linux / POSIX
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) {
    return { opened: false, uiUrl, platform, headless: true };
  }
  const linuxBrowserNames = [
    'google-chrome',
    'google-chrome-stable',
    'microsoft-edge',
    'microsoft-edge-stable',
    'chromium',
    'chromium-browser',
    'brave-browser'
  ];
  let linuxBrowserExe = null;
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const name of linuxBrowserNames) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) {
        linuxBrowserExe = candidate;
        break;
      }
    }
    if (linuxBrowserExe) break;
  }
  try {
    if (linuxBrowserExe) {
      const child = spawn(linuxBrowserExe, appArgs, { detached: true, stdio: 'ignore' });
      child.unref();
      return { opened: true, uiUrl, platform, browser: linuxBrowserExe };
    }
    const child = spawn('xdg-open', [uiUrl], { detached: true, stdio: 'ignore' });
    child.unref();
    return { opened: true, uiUrl, platform, browser: 'xdg-open' };
  } catch {
    return { opened: false, uiUrl, platform };
  }
}

function syncGlobalStateModelAndEffort(codexHome, preStopModel, preStopEffort) {
  if (!codexHome || (!preStopModel && !preStopEffort)) return;
  try {
    const gsPath = path.join(codexHome, '.codex-global-state.json');
    if (fs.existsSync(gsPath)) {
      const gs = jsonRead(gsPath, null);
      const recent = gs?.['electron-persisted-atom-state']?.['composer-recent-model-configurations-v1'];
      if (Array.isArray(recent) && recent.length > 0 && recent[0] && typeof recent[0] === 'object') {
        let gsChanged = false;
        if (preStopModel && recent[0].model !== preStopModel) {
          recent[0].model = preStopModel;
          gsChanged = true;
        }
        if (preStopEffort && recent[0].reasoningEffort !== preStopEffort) {
          recent[0].reasoningEffort = preStopEffort;
          gsChanged = true;
        }
        if (gsChanged) {
          atomicWrite(gsPath, JSON.stringify(gs));
        }
      }
    }
  } catch {}
}

export function restartCodexDesktop({
  relaunch = true,
  codexHome = defaultCodexHome(),
  dataDir = null,
  platform = process.platform
} = {}) {
  try {
    const configPath = codexHome ? path.join(codexHome, 'config.toml') : null;
    let preStopSnapshot = null;
    let preStopModel = null;
    let preStopEffort = null;
    if (configPath && fs.existsSync(configPath)) {
      const buf = fs.readFileSync(configPath);
      if (!buf.includes(0) && buf.length > 0) {
        preStopSnapshot = buf;
        const rootPart = buf.toString('utf8').split(/^\s*\[/m)[0];
        preStopModel = /^\s*model\s*=\s*["']([^"']+)["']/m.exec(rootPart)?.[1]?.trim() || null;
        preStopEffort = /^\s*model_reasoning_effort\s*=\s*["']([^"']+)["']/m.exec(rootPart)?.[1]?.trim() || null;
      }
    }

    if (platform === 'darwin') {
      syncGlobalStateModelAndEffort(codexHome, preStopModel, preStopEffort);
      const check = spawnSync('pgrep', ['-f', 'Codex.app/Contents/MacOS/Codex'], { encoding: 'utf8', timeout: 5000 });
      if (check.status !== 0 || !check.stdout.trim()) {
        return { restarted: false, relaunched: false };
      }
      spawnSync('osascript', ['-e', 'tell application "Codex" to quit'], { timeout: 5000 });
      spawnSync('pkill', ['-TERM', '-f', 'Codex.app/Contents/MacOS/Codex'], { timeout: 5000 });
      if (configPath && fs.existsSync(configPath)) {
        const afterBuf = fs.readFileSync(configPath);
        if (afterBuf.includes(0) || (preStopSnapshot && afterBuf.length === 0)) {
          if (preStopSnapshot) atomicWrite(configPath, preStopSnapshot);
        }
      }
      let relaunched = false;
      if (relaunch && fs.existsSync('/Applications/Codex.app')) {
        spawnSync('open', ['-a', '/Applications/Codex.app'], { timeout: 5000 });
        relaunched = true;
      }
      return { restarted: true, relaunched };
    }

    if (platform !== 'win32') {
      syncGlobalStateModelAndEffort(codexHome, preStopModel, preStopEffort);
      return { restarted: false, relaunched: false };
    }

    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$procs = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'ChatGPT.exe' -and $_.ExecutablePath -like '*OpenAI.Codex*'
}
if (-not $procs) {
  @{ restarted = $false; relaunched = $false } | ConvertTo-Json -Compress
  exit 0
}
$mainPids = @($procs | Select-Object -ExpandProperty ProcessId)
foreach ($pidVal in $mainPids) {
  $pObj = Get-Process -Id $pidVal -ErrorAction SilentlyContinue
  if ($pObj) { $null = $pObj.CloseMainWindow() }
}
Start-Sleep -Milliseconds 400
$children = Get-CimInstance Win32_Process | Where-Object {
  $mainPids -contains $_.ParentProcessId -and $_.Name -in @('codex.exe', 'codex-code-mode-host.exe', 'codex-computer-use-swift.exe', 'node_repl.exe')
}
foreach ($c in $children) { Stop-Process -Id $c.ProcessId -Force -ErrorAction SilentlyContinue }
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 600
@{ restarted = $true; relaunched = $false; stoppedPids = $mainPids } | ConvertTo-Json -Compress
`;
    const r = spawnSync(
      psPath(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15000
      }
    );

    if (configPath && fs.existsSync(configPath)) {
      const afterBuf = fs.readFileSync(configPath);
      if (afterBuf.includes(0) || (preStopSnapshot && afterBuf.length === 0)) {
        if (preStopSnapshot) {
          atomicWrite(configPath, preStopSnapshot);
        } else if (dataDir) {
          const latest = findLatestBackup(dataDir);
          if (latest && fs.existsSync(latest)) atomicWrite(configPath, fs.readFileSync(latest));
        }
      }
    }

    syncGlobalStateModelAndEffort(codexHome, preStopModel, preStopEffort);

    if (r.status === 0 && r.stdout.trim()) {
      const parsed = JSON.parse(r.stdout.trim());
      if (parsed.restarted && relaunch) {
        spawnSync(
          psPath(),
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            "Start-Process explorer.exe -ArgumentList 'shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App'"
          ],
          {
            windowsHide: true,
            timeout: 10000
          }
        );
        parsed.relaunched = true;
      }
      return parsed;
    }
  } catch {}
  return { restarted: false, relaunched: false };
}
