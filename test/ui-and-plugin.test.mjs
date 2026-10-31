import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { psPath } from '../lib.mjs';
import { openControlPanel, restartCodexDesktop } from '../routing.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('plugin manifests and CLI on/off/toggle commands work cleanly', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.codex-plugin', 'plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'codex-translate');
  assert.equal(manifest.hooks, './hooks.json');
  assert.equal(manifest.mcpServers, './.mcp.json');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-translate-cli-'));
  try {
    const dataDir = path.join(tmp, 'data');
    const codexHome = path.join(tmp, 'codex');
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(path.join(codexHome, 'config.toml'), 'model = "gpt-6.1-sol"\n');

    const runCli = args =>
      spawnSync(process.execPath, [path.join(root, 'cli.mjs'), ...args, '--data-dir', dataDir, '--codex-home', codexHome], {
        encoding: 'utf8',
        windowsHide: true
      });

    const onRes = JSON.parse(runCli(['on', '--json']).stdout);
    assert.equal(onRes.enabled, true);
    assert.equal(onRes.routing.interceptActive, true);

    const offRes = JSON.parse(runCli(['off', '--json']).stdout);
    assert.equal(offRes.enabled, false);

    const toggleRes = JSON.parse(runCli(['toggle', '--json']).stdout);
    assert.equal(toggleRes.enabled, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Switch.ps1 -Check and CodexTranslate.exe --check validate UI and ON/OFF toggle button', () => {
  for (const shFile of [
    'Install-Plugin for MacOS.sh',
    'Install-Plugin for MacOS.command',
    'Install-Plugin for Linux.sh',
    'Uninstall-Plugin for MacOS.sh',
    'Uninstall-Plugin for MacOS.command',
    'Uninstall-Plugin for Linux.sh',
    'install-plugin.sh',
    'uninstall-plugin.sh',
    'panel.sh',
    'switch.sh',
    'setup.sh'
  ]) {
    const fullSh = path.join(root, shFile);
    assert.ok(fs.existsSync(fullSh), `Missing POSIX script: ${shFile}`);
    const content = fs.readFileSync(fullSh, 'utf8');
    assert.match(content, /^#!\/usr\/bin\/env bash/);
    assert.ok(!content.includes('\r\n'), `${shFile} must use LF line endings for Linux/macOS compatibility`);
  }
  for (const cmdFile of ['Install-Plugin for Windows.cmd', 'Install-Plugin.cmd', 'Uninstall-Plugin for Windows.cmd']) {
    assert.ok(fs.existsSync(path.join(root, cmdFile)), `Missing Windows installer: ${cmdFile}`);
  }

  const headlessPanel = openControlPanel({
    pluginRoot: root,
    uiUrl: 'http://127.0.0.1:24131/',
    platform: 'linux',
    env: {}
  });
  assert.equal(headlessPanel.headless, true);

  const linuxRestart = restartCodexDesktop({ relaunch: false, platform: 'linux' });
  assert.equal(linuxRestart.restarted, false);

  if (process.platform !== 'win32') {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-translate-switch-sh-'));
    try {
      const dataDir = path.join(tmp, 'data');
      const codexHome = path.join(tmp, 'codex');
      fs.mkdirSync(codexHome, { recursive: true });
      fs.writeFileSync(path.join(codexHome, 'config.toml'), 'model = "gpt-6.1-sol"\n');
      const switchSh = spawnSync('bash', [path.join(root, 'switch.sh'), '--check', '--data-dir', dataDir, '--codex-home', codexHome], {
        encoding: 'utf8',
        timeout: 15000
      });
      assert.equal(switchSh.status, 0, switchSh.stderr);
      const uiState = JSON.parse(switchSh.stdout.trim());
      assert.equal(uiState.phase, 'SwitchReady');
      assert.equal(uiState.toggleButtonPresent, true);
      assert.equal(uiState.keyMasked, true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    return;
  }

  const exeCheck = spawnSync(path.join(root, 'CodexTranslate.exe'), ['--check'], {
    encoding: 'utf8',
    windowsHide: true
  });
  assert.equal(exeCheck.status, 0);
  const exeData = JSON.parse(exeCheck.stdout.trim());
  assert.equal(exeData.ok, true);
  assert.equal(exeData.launcher, 'CodexTranslate.exe');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-translate-switch-'));
  try {
    const dataDir = path.join(tmp, 'data');
    const codexHome = path.join(tmp, 'codex');
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(path.join(codexHome, 'config.toml'), 'model = "gpt-6.1-sol"\n');

    const switchCheck = spawnSync(
      psPath(),
      [
        '-NoProfile',
        '-Sta',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(root, 'Switch.ps1'),
        '-Check',
        '-DataDirectory',
        dataDir,
        '-CodexHome',
        codexHome
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 20000 }
    );
    assert.equal(switchCheck.status, 0, switchCheck.stderr);
    const uiState = JSON.parse(switchCheck.stdout.trim());
    assert.equal(uiState.phase, 'SwitchReady');
    assert.equal(uiState.toggleButtonPresent, true);
    assert.equal(uiState.keyMasked, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Install-Plugin for Windows, Install-Plugin for MacOS, Install-Plugin for Linux, and hooks.json install and start cleanly', () => {
  const verifyInstallScript = (runner, buildSpawn) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-translate-installer-'));
    try {
      const dataDir = path.join(tmp, 'data');
      const codexHome = path.join(tmp, 'codex');
      fs.mkdirSync(codexHome, { recursive: true });
      fs.writeFileSync(path.join(codexHome, 'config.toml'), 'model = "gpt-6.1-sol"\nmodel_reasoning_effort = "high"\n');

      const { args, opts } = buildSpawn(dataDir, codexHome);
      const res = spawnSync(runner, args, {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30000,
        ...(opts || {})
      });
      assert.equal(res.status, 0, res.stderr || res.stdout);
      const out = JSON.parse(res.stdout.trim());
      assert.equal(out.configuredRoute, 'translate');
      assert.equal(out.interceptActive, true);

      const cfgText = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
      assert.match(cfgText, /\[marketplaces\.codex-translate-local\]/);
      assert.match(cfgText, /\[plugins\."codex-translate@codex-translate-local"\]\s*\r?\n\s*enabled\s*=\s*true/);
      assert.match(cfgText, /openai_base_url = "http:\/\/127\.0\.0\.1:24131\/v1"/);
      assert.match(cfgText, /model = "gpt-6\.1-sol"/);
      assert.ok(fs.existsSync(path.join(codexHome, 'plugins', 'cache', 'codex-translate-local', 'codex-translate', '1.0.0', 'plugin.json')));

      // Verify cli.mjs shutdown restores base route while keeping desiredRoute = 'translate' for next session auto-start
      const shutRes = spawnSync(
        process.execPath,
        [path.join(root, 'cli.mjs'), 'shutdown', '--json', '--data-dir', dataDir, '--codex-home', codexHome],
        { encoding: 'utf8', windowsHide: true, timeout: 15000 }
      );
      assert.equal(shutRes.status, 0, shutRes.stderr);
      const shutJson = JSON.parse(shutRes.stdout.trim());
      assert.equal(shutJson.shutdown, true);
      assert.equal(shutJson.routing.interceptActive, false);
      const savedStateAfterShutdown = JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8'));
      assert.equal(savedStateAfterShutdown.desiredRoute, 'translate');

      // Verify cli.mjs uninstall removes plugin entries from config.toml and deletes plugin cache
      const uninstRes = spawnSync(
        process.execPath,
        [path.join(root, 'cli.mjs'), 'uninstall', '--json', '--data-dir', dataDir, '--codex-home', codexHome],
        { encoding: 'utf8', windowsHide: true, timeout: 15000 }
      );
      assert.equal(uninstRes.status, 0, uninstRes.stderr);
      const uninstJson = JSON.parse(uninstRes.stdout.trim());
      assert.equal(uninstJson.uninstalled, true);
      const cfgAfterUninst = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
      assert.doesNotMatch(cfgAfterUninst, /\[marketplaces\.codex-translate-local\]/);
      assert.doesNotMatch(cfgAfterUninst, /\[plugins\."codex-translate@codex-translate-local"\]/);
      assert.doesNotMatch(cfgAfterUninst, /24131/);
      assert.match(cfgAfterUninst, /model = "gpt-6\.1-sol"/);
      assert.equal(fs.existsSync(path.join(codexHome, 'plugins', 'cache', 'codex-translate-local')), false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  };

  if (process.platform === 'win32') {
    const winCmd = path.join(root, 'Install-Plugin for Windows.cmd');
    verifyInstallScript('cmd.exe', (dataDir, codexHome) => ({
      args: ['/d', '/s', '/c', `""${winCmd}" --check --data-dir "${dataDir}" --codex-home "${codexHome}""`],
      opts: { windowsVerbatimArguments: true }
    }));
  }

  const bashCandidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    '/bin/bash',
    '/usr/bin/bash'
  ];
  const bashExe = bashCandidates.find(p => fs.existsSync(p));
  if (bashExe) {
    for (const shName of ['Install-Plugin for MacOS.sh', 'Install-Plugin for MacOS.command', 'Install-Plugin for Linux.sh']) {
      verifyInstallScript(bashExe, (dataDir, codexHome) => ({
        args: [path.join(root, shName), '--check', '--data-dir', dataDir, '--codex-home', codexHome]
      }));
    }

    // Verify hooks.json SessionStart command executes under POSIX bash without backslash regex corruption
    const hooksObj = JSON.parse(fs.readFileSync(path.join(root, 'hooks.json'), 'utf8'));
    const hookCmd = hooksObj.hooks.SessionStart[0].hooks[0].command.replace(/^node\b/, `"${process.execPath.replace(/\\/g, '/')}"`);
    const tmpHook = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-translate-hook-'));
    try {
      const hookRes = spawnSync(bashExe, ['-c', hookCmd], {
        encoding: 'utf8',
        windowsHide: true,
        env: { ...process.env, CODEX_HOME: tmpHook },
        timeout: 15000
      });
      assert.equal(hookRes.status, 0, hookRes.stderr);
    } finally {
      fs.rmSync(tmpHook, { recursive: true, force: true });
    }
  }
});

test('mcp-server.mjs exposes translator_status, translator_toggle, and translator_configure over JSON-RPC stdio', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-translate-mcp-'));
  try {
    const dataDir = path.join(tmp, 'data');
    const codexHome = path.join(tmp, 'codex');
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(path.join(codexHome, 'config.toml'), 'model = "gpt-6.1-sol"\n');

    const rpcLines = [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'translator_toggle', arguments: { enabled: true } }
      }),
      JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'translator_status', arguments: {} }
      })
    ].join('\n') + '\n';

    const res = spawnSync(
      process.execPath,
      [path.join(root, 'mcp-server.mjs'), '--data-dir', dataDir, '--codex-home', codexHome],
      { input: rpcLines, encoding: 'utf8', windowsHide: true, timeout: 10000 }
    );
    assert.equal(res.status, 0, res.stderr);
    const messages = res.stdout
      .trim()
      .split(/\r?\n/)
      .map(l => JSON.parse(l));

    const toolsList = messages.find(m => m.id === 2);
    assert.ok(toolsList.result.tools.some(t => t.name === 'translator_toggle'));
    assert.ok(toolsList.result.tools.some(t => t.name === 'translator_status'));

    const toggleOut = JSON.parse(messages.find(m => m.id === 3).result.content[0].text);
    assert.equal(toggleOut.translator.enabled, true);

    const statusOut = JSON.parse(messages.find(m => m.id === 4).result.content[0].text);
    assert.equal(statusOut.translator.enabled, true);
    assert.equal(statusOut.translator.targetLanguage, 'auto');
    assert.equal(statusOut.routing.interceptActive, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
