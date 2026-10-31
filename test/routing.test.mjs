import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { routingStatus, switchRoute } from '../routing.mjs';
import { translateBridgeConfig } from '../lib.mjs';

test('switchRoute activates translation interception and restores exact baseline while preserving runtime pipe', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-translate-routing-'));
  try {
    const dataDir = path.join(tmp, 'data');
    const codexHome = path.join(tmp, 'codex');
    fs.mkdirSync(codexHome, { recursive: true });

    const initialConfig = [
      'model = "gpt-6.1-sol"',
      'model_reasoning_effort = "high"',
      '[desktop]',
      'followUpQueueMode = "steer"',
      '[mcp_servers.node_repl.env]',
      'SKY_CUA_NATIVE_PIPE_DIRECTORY = "\\\\.\\pipe\\pipe-initial"'
    ].join('\n') + '\n';
    const cfgPath = path.join(codexHome, 'config.toml');
    fs.writeFileSync(cfgPath, initialConfig);

    assert.equal(routingStatus(dataDir, codexHome).configuredRoute, 'base');
    assert.equal(routingStatus(dataDir, codexHome).interceptActive, false);

    const gwUrl = 'http://127.0.0.1:24131/v1';
    const st1 = switchRoute({
      route: 'translate',
      dataDir,
      codexHome,
      gatewayBaseUrl: gwUrl,
      generated: translateBridgeConfig(gwUrl)
    });
    assert.equal(st1.configuredRoute, 'translate');
    assert.equal(st1.interceptActive, true);
    assert.equal(st1.managed, true);

    const activeCfg = fs.readFileSync(cfgPath, 'utf8');
    assert.match(activeCfg, /openai_base_url = "http:\/\/127\.0\.0\.1:24131\/v1"/);
    assert.match(activeCfg, /model = "gpt-6\.1-sol"/);

    // Simulate ChatGPT.exe updating its runtime pipe directory between turns
    const updatedPipeCfg = activeCfg.replace('pipe-initial', 'pipe-updated-runtime');
    fs.writeFileSync(cfgPath, updatedPipeCfg);
    assert.equal(routingStatus(dataDir, codexHome).managed, true);

    // Restore to base
    const st2 = switchRoute({ route: 'base', dataDir, codexHome });
    assert.equal(st2.configuredRoute, 'base');
    assert.equal(st2.interceptActive, false);

    const restoredCfg = fs.readFileSync(cfgPath, 'utf8');
    assert.doesNotMatch(restoredCfg, /openai_base_url/);
    assert.match(restoredCfg, /model = "gpt-6\.1-sol"/);
    assert.match(restoredCfg, /pipe-updated-runtime/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('switchRoute auto-heals zero-byte or NUL-corrupted config.toml from backup', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-translate-heal-'));
  try {
    const dataDir = path.join(tmp, 'data');
    const codexHome = path.join(tmp, 'codex');
    fs.mkdirSync(codexHome, { recursive: true });
    const cfgPath = path.join(codexHome, 'config.toml');
    fs.writeFileSync(cfgPath, 'model = "gpt-6.1-sol"\n[desktop]\nfollowUpQueueMode = "steer"\n');

    switchRoute({
      route: 'translate',
      dataDir,
      codexHome,
      gatewayBaseUrl: 'http://127.0.0.1:24131/v1'
    });

    // Corrupt config.toml with NUL bytes
    fs.writeFileSync(cfgPath, Buffer.alloc(64, 0));

    const st = switchRoute({ route: 'base', dataDir, codexHome, force: true });
    assert.equal(st.configuredRoute, 'base');
    const healed = fs.readFileSync(cfgPath, 'utf8');
    assert.ok(!healed.includes('\0'));
    assert.match(healed, /\[desktop\]/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('routingStatus and switchRoute preserve third-party localhost openai_base_url (e.g. OmniRoute :20128) even with force: true', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-translate-ext-url-'));
  try {
    const dataDir = path.join(tmp, 'data');
    const codexHome = path.join(tmp, 'codex');
    fs.mkdirSync(codexHome, { recursive: true });
    const cfgPath = path.join(codexHome, 'config.toml');
    const initial = [
      'openai_base_url = "http://127.0.0.1:20128/v1"',
      'model = "gpt-6.1-sol"',
      '[desktop]',
      'followUpQueueMode = "steer"'
    ].join('\n') + '\n';
    fs.writeFileSync(cfgPath, initial);

    const before = routingStatus(dataDir, codexHome);
    assert.equal(before.configuredRoute, 'base');
    assert.equal(before.interceptActive, false);
    assert.equal(before.externalBaseUrl, 'http://127.0.0.1:20128/v1');

    const activated = switchRoute({
      route: 'translate',
      dataDir,
      codexHome,
      gatewayBaseUrl: 'http://127.0.0.1:24131/v1',
      force: true
    });
    assert.equal(activated.configuredRoute, 'translate');
    assert.equal(activated.interceptActive, true);
    assert.match(fs.readFileSync(cfgPath, 'utf8'), /openai_base_url = "http:\/\/127\.0\.0\.1:24131\/v1"/);

    const restored = switchRoute({
      route: 'base',
      dataDir,
      codexHome,
      force: true
    });
    assert.equal(restored.configuredRoute, 'base');
    assert.equal(restored.interceptActive, false);
    const finalCfg = fs.readFileSync(cfgPath, 'utf8');
    assert.match(finalCfg, /^openai_base_url = "http:\/\/127\.0\.0\.1:20128\/v1"$/m);
    assert.doesNotMatch(finalCfg, /24131/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

