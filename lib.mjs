import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomUUID, createHash, randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';

export const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

export function normalizeURL(value) {
  const u = new URL(value);
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) {
    throw Error('Use an HTTP(S) server URL without credentials, query or fragment.');
  }
  if (u.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) {
    throw Error('Remote servers require HTTPS.');
  }
  u.pathname = u.pathname.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1';
  return u.toString().replace(/\/$/, '');
}

function positive(...xs) {
  return xs.map(Number).find(x => Number.isSafeInteger(x) && x > 0) ?? null;
}

function cleanText(x, max = 220) {
  return String(x ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, max);
}

function isReasoningModel(m) {
  const cap = m.capabilities ?? {};
  if (cap.reasoning === true || cap.thinking === true || cap.supportsThinking === true || m.thinking === true || m.supportsThinking === true || m.reasoning === true) return true;
  const s = ((m.id || '') + ' ' + (m.name || '')).toLowerCase();
  if (/\b(o1|o3|o4|qwq|qvq|deepseek-r1|r1|reasoning|thinking|tiered)\b/.test(s)) return true;
  if (s.startsWith('auto/best-') || s.startsWith('auto/pro-') || s.startsWith('auto/coding') || s.startsWith('auto/reasoning') || s.startsWith('auto/smart') || s.startsWith('auto/chat') || m.provider === 'combo') return true;
  return false;
}

function resolveModelEfforts(m) {
  const s = ((m.id || '') + ' ' + (m.name || '')).toLowerCase();
  const cap = m.capabilities ?? {};
  const isGemini = s.includes('gemini');
  const isClaude = s.includes('claude');
  const isOseries = /\b(o1|o3|o4)\b/.test(s);
  const isGpt5 = s.includes('gpt-5') || s.includes('codex');
  const isDeepSeek = s.includes('deepseek');
  const isQwen = /\b(qwq|qvq)\b/.test(s) || (s.includes('qwen') && (s.includes('thinking') || s.includes('reason')));

  const rawTiers = cap.effort_tiers ?? m.effort_tiers ?? (Array.isArray(m.efforts) && m.efforts.length ? m.efforts : null);
  let list = [];
  if (Array.isArray(rawTiers) && rawTiers.length > 0) {
    list = rawTiers.filter(e => efforts.includes(e));
  }

  if (isGemini) {
    if (list.length > 0) {
      list = list.filter(e => e !== 'xhigh' && e !== 'max' && e !== 'ultra');
    }
    const reasoning = isReasoningModel(m);
    if (list.length === 0 && reasoning) {
      list = ['none', 'low', 'medium', 'high'];
    }
    if (!reasoning && cap.reasoning === false && cap.thinking === false) {
      list = [];
    }
    return list;
  }

  if (list.length > 0) return list;
  if (!isReasoningModel(m)) return [];
  if (isClaude) return ['none', 'low', 'medium', 'high', 'max'];
  if (isOseries) return ['none', 'low', 'medium', 'high'];
  if (isGpt5) return ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
  if (isDeepSeek || isQwen) return ['none', 'low', 'medium', 'high'];
  return ['none', 'low', 'medium', 'high'];
}

function resolveModelContext(m) {
  const s = ((m.id || '') + ' ' + (m.name || '')).toLowerCase();
  const reported = positive(m.max_input_tokens, m.context_length, m.context_window, m.contextWindow, m.limit?.context, m.context);

  if (s.includes('gemini')) {
    if (s.includes('1.5-pro') || s.includes('2.0-pro')) return 2097152;
    return 1048576;
  }
  if (s.includes('claude')) {
    if (s.includes('1m') || s.includes('1000k')) return 1000000;
    return 200000;
  }
  if (s.includes('gpt-4o') || s.includes('gpt-4-turbo') || s.includes('gpt-4.5')) return 128000;
  if (/\bgpt-4\b/.test(s) && !s.includes('gpt-4o') && !s.includes('turbo')) return s.includes('32k') ? 32768 : 8192;
  if (s.includes('gpt-5.6') || s.includes('gpt-5-codex')) return reported && reported <= 1000000 ? reported : 872000;
  if (s.includes('gpt-5.5') || s.includes('gpt-5.3') || s.includes('gpt-5')) {
    const inputLimit = positive(m.max_input_tokens);
    if (inputLimit && inputLimit < (reported ?? 400000)) return inputLimit;
    return reported && reported <= 400000 ? reported : 400000;
  }
  if (/\b(o1|o3|o4)\b/.test(s)) return 200000;
  if (s.includes('deepseek')) return 131072;
  if (s.includes('qwen')) return reported && reported <= 131072 ? reported : 131072;
  if (s.includes('llama-3')) return 128000;
  if (s.includes('mistral-large') || s.includes('codestral')) return reported && reported <= 262144 ? reported : 128000;
  if (reported) return reported > 2097152 ? 1048576 : reported;
  return null;
}

export function normalizeModel(m) {
  if (!m || typeof m !== 'object') return m;
  const context = resolveModelContext(m);
  const effortsList = resolveModelEfforts(m);
  const isKnownMultimodal = /\b(gemini|claude|gpt-4o|gpt-4\.5|gpt-5|gpt-6|qvq|vl|vision|pixtral)\b|^auto\//i.test((m.id || '') + ' ' + (m.name || ''));
  const vision = m.vision === true || (m.vision === undefined && isKnownMultimodal);
  return {
    ...m,
    vision: m.vision !== undefined ? (m.vision || isKnownMultimodal) : vision,
    context: context ?? m.context ?? null,
    efforts: effortsList.length > 0 ? effortsList : (m.efforts ?? [])
  };
}

export function parseModels(body) {
  if (!Array.isArray(body.data)) throw Error('GET /v1/models did not return { data: [...] }.');
  const seen = new Set();
  const models = [];
  for (const m of body.data) {
    if (!m || typeof m.id !== 'string' || !m.id.trim() || /[\x00-\x1f\x7f]/.test(m.id) || seen.has(m.id)) continue;
    seen.add(m.id);
    const c = m.capabilities ?? {};
    const context = resolveModelContext(m);
    const supportedEfforts = resolveModelEfforts(m);
    const modalities = m.input_modalities ?? c.input_modalities ?? ['text'];
    const excluded = c.tool_calling === false || (Array.isArray(m.output_modalities) && !m.output_modalities.includes('text')) || m.type === 'embedding';
    models.push({
      id: m.id,
      name: cleanText(m.name ?? m.display_name ?? m.id),
      provider: cleanText(m.owned_by ?? m.provider),
      context,
      output: positive(m.max_output_tokens, m.limit?.output),
      efforts: supportedEfforts,
      reasoning: isReasoningModel(m),
      vision: (Array.isArray(modalities) && modalities.includes('image')) || c.vision === true || (/\b(gemini|claude|gpt-4o|gpt-4\.5|gpt-5|gpt-6|qvq|vl|vision|pixtral)\b|^auto\//i.test(m.id + ' ' + (m.name || '')) && (!Array.isArray(m.input_modalities) || m.input_modalities.includes('image'))),
      eligible: !excluded,
      toolCalling: c.tool_calling ?? null
    });
  }
  if (!models.some(m => m.eligible)) throw Error('This server has no text models eligible for translation.');
  return models;
}

function tomlString(x) {
  return JSON.stringify(String(x)).replace(/\\u0008/g, '\\b').replace(/\\u000c/g, '\\f');
}

export function translateBridgeConfig(gatewayBaseUrl) {
  return `# Generated by codex-translate\nopenai_base_url = ${tomlString(gatewayBaseUrl)}\n`;
}

export function isOwnTranslateBridgeUrl(url, knownGatewayUrls = []) {
  if (!url || typeof url !== 'string') return false;
  const cleaned = url.trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');
  const allowed = new Set([
    'http://127.0.0.1:24131/v1',
    'http://localhost:24131/v1',
    ...knownGatewayUrls
      .filter(Boolean)
      .flatMap(u => {
        const norm = String(u).trim().replace(/\/+$/, '');
        return [norm, norm.replace('//127.0.0.1:', '//localhost:'), norm.replace('//localhost:', '//127.0.0.1:')];
      })
  ]);
  return allowed.has(cleaned);
}

export function extractRootOpenaiBaseUrl(configText) {
  const rootPart = String(configText || '').replace(/\0+/g, '').split(/^\s*\[/m)[0];
  const m = /^\s*openai_base_url\s*=\s*["']([^"']+)["']/m.exec(rootPart);
  return m ? m[1].trim() : null;
}

export function hasCodexTranslateBridge(configText, knownGatewayUrls = []) {
  const text = String(configText || '').replace(/\0+/g, '');
  if (text.includes('# Generated by codex-translate')) return true;
  const url = extractRootOpenaiBaseUrl(text);
  return isOwnTranslateBridgeUrl(url, knownGatewayUrls);
}

/**
 * Patches ~/.codex/config.toml to route base OpenAI/ChatGPT requests through the local
 * translator loopback proxy (`openai_base_url = "http://127.0.0.1:24131/v1"`) WITHOUT
 * modifying the user's base model, model_provider, model_catalog_json, or auth.json.
 */
export function patchCodexTranslate(original, generated, managed = false, knownGatewayUrls = []) {
  original = String(original || '').replace(/\0+/g, '');
  const isOurBridge = hasCodexTranslateBridge(original, knownGatewayUrls);
  const rootPart = original.split(/^\s*\[/m)[0];
  if (!managed && !isOurBridge && /^\s*openai_base_url\s*=/m.test(rootPart)) {
    throw Error('openai_base_url is already set in config.toml; refusing to overwrite an unmanaged setting.');
  }

  const lines = original.split(/\r?\n/);
  let inRoot = true;
  let skipOmni = false;
  const kept = [];

  for (const line of lines) {
    if (line.trim() === '# Generated by codex-translate' || line.trim() === '# Generated by codex-omniroute') continue;
    if (/^\s*\[/.test(line)) {
      inRoot = false;
      skipOmni = /^\s*\[model_providers\.omniroute_bridge(?:\]|\.)/.test(line);
    }
    if (skipOmni) continue;
    if (inRoot) {
      const key = /^\s*([A-Za-z_]+)\s*=/.exec(line)?.[1];
      if (key === 'openai_base_url') continue;
      if (key === 'model_provider' && /omniroute_bridge/.test(line)) continue;
      if (key === 'model_catalog_json' && /omniroute/i.test(line)) continue;
    }
    kept.push(line);
  }

  const body = kept.join('\n').trim();
  return generated.trim() + (body ? '\n' + body + '\n' : '\n');
}

export function stripCodexTranslate(original, baselineConfig = '', knownGatewayUrls = []) {
  original = String(original || '').replace(/\0+/g, '');
  baselineConfig = String(baselineConfig || '').replace(/\0+/g, '');
  const isCRLF = original.includes('\r\n') || baselineConfig.includes('\r\n');
  const eol = isCRLF ? '\r\n' : '\n';

  let fallbackOpenaiBaseUrl = null;
  if (baselineConfig) {
    const rootPart = baselineConfig.split(/^\s*\[/m)[0];
    if (!hasCodexTranslateBridge(baselineConfig, knownGatewayUrls)) {
      fallbackOpenaiBaseUrl = /^\s*openai_base_url\s*=\s*(.+)$/m.exec(rootPart)?.[1]?.trim() ?? null;
    }
  }

  const isOurBridge = hasCodexTranslateBridge(original, knownGatewayUrls);
  const lines = original.split(/\r?\n/);
  let inRoot = true;
  const kept = [];
  let baseUrlRestored = false;

  for (const line of lines) {
    if (line.trim() === '# Generated by codex-translate') continue;
    if (/^\s*\[/.test(line)) {
      if (inRoot && fallbackOpenaiBaseUrl && !baseUrlRestored) {
        kept.push('openai_base_url = ' + fallbackOpenaiBaseUrl);
        baseUrlRestored = true;
      }
      inRoot = false;
    }
    if (inRoot) {
      const key = /^\s*([A-Za-z_]+)\s*=/.exec(line)?.[1];
      if (key === 'openai_base_url') {
        const lineUrl = /^\s*openai_base_url\s*=\s*["']([^"']+)["']/.exec(line)?.[1]?.trim() ?? '';
        if (!isOurBridge && !isOwnTranslateBridgeUrl(lineUrl, knownGatewayUrls) && !fallbackOpenaiBaseUrl) {
          kept.push(line);
          baseUrlRestored = true;
          continue;
        }
        if (fallbackOpenaiBaseUrl && !baseUrlRestored) {
          kept.push('openai_base_url = ' + fallbackOpenaiBaseUrl);
          baseUrlRestored = true;
        }
        continue;
      }
    }
    kept.push(line);
  }

  if (fallbackOpenaiBaseUrl && !baseUrlRestored) {
    kept.unshift('openai_base_url = ' + fallbackOpenaiBaseUrl);
  }

  return kept.join(eol).replace(/(\r?\n){3,}/g, eol + eol).trim() + eol;
}

export function hash(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function jsonRead(p, fallback) {
  if (!fs.existsSync(p)) return fallback;
  try {
    const rawFile = fs.readFileSync(p, 'utf8');
    const hadNulls = rawFile.includes('\0');
    const cleaned = rawFile.replace(/^\uFEFF/, '').replace(/\0+/g, '').trim();
    if (!cleaned) {
      if (arguments.length >= 2) {
        if (hadNulls && fallback !== undefined) {
          try { writeJSON(p, fallback); } catch {}
        }
        return fallback;
      }
      throw new SyntaxError('Unexpected end of JSON input');
    }
    const parsed = JSON.parse(cleaned);
    if (hadNulls) {
      try { writeJSON(p, parsed); } catch {}
    }
    return parsed;
  } catch (err) {
    if (arguments.length >= 2) return fallback;
    throw err;
  }
}

export function atomicWrite(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (typeof content === 'string') {
    content = content.replace(/\0+/g, '');
  } else if (Buffer.isBuffer(content) && content.includes(0)) {
    content = Buffer.from(content.toString('utf8').replace(/\0+/g, ''), 'utf8');
  }
  const temp = p + '.' + randomUUID() + '.tmp';
  const fd = fs.openSync(temp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, content);
    try { fs.fsyncSync(fd); } catch {}
  } finally {
    fs.closeSync(fd);
  }
  for (let i = 0; i < 5; i++) {
    try {
      fs.renameSync(temp, p);
      return;
    } catch (err) {
      if (i === 4) {
        try { fs.unlinkSync(temp); } catch {}
        throw err;
      }
    }
  }
}

export function writeJSON(p, value) {
  atomicWrite(p, JSON.stringify(value, null, 2) + '\n');
}

export function realUserProfile(platform = process.platform, env = process.env) {
  if (platform === 'win32' && env.USERNAME) {
    const candidate = path.join('C:\\Users', env.USERNAME);
    if (fs.existsSync(candidate)) return candidate;
  }
  if (platform !== 'win32' && env.HOME && fs.existsSync(env.HOME)) {
    return env.HOME;
  }
  return os.homedir();
}

export function defaultDataDir(kind = 'codex-translate', platform = process.platform, env = process.env) {
  const home = realUserProfile(platform, env);
  if (platform === 'win32') {
    const candidate = path.join(home, 'AppData', 'Local');
    if (fs.existsSync(candidate)) {
      return path.join(candidate, 'OmniRouteIntegrations', kind);
    }
    return path.join(env.LOCALAPPDATA ?? path.join(home, '.local', 'share'), 'OmniRouteIntegrations', kind);
  }
  if (env.XDG_DATA_HOME) {
    return path.join(env.XDG_DATA_HOME, 'OmniRouteIntegrations', kind);
  }
  if (platform === 'darwin') {
    const macAppSupport = path.join(home, 'Library', 'Application Support');
    if (fs.existsSync(macAppSupport)) {
      return path.join(macAppSupport, 'OmniRouteIntegrations', kind);
    }
  }
  return path.join(env.LOCALAPPDATA ?? path.join(home, '.local', 'share'), 'OmniRouteIntegrations', kind);
}

export function defaultCodexHome(platform = process.platform, env = process.env) {
  const home = realUserProfile(platform, env);
  if (platform === 'win32') {
    const candidate = path.join(home, '.codex');
    if (fs.existsSync(candidate)) return candidate;
  }
  return env.CODEX_HOME || path.join(home, '.codex');
}

export function psPath() {
  return path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

export function resolveCodexExe(codexHome = defaultCodexHome(), platform = process.platform, env = process.env) {
  if (env.OMNIROUTE_CODEX_EXE) return env.OMNIROUTE_CODEX_EXE;
  if (env.CODEX_EXE) return env.CODEX_EXE;

  const pathExts = platform === 'win32' ? ['codex.exe', 'codex.cmd'] : ['codex'];
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of pathExts) {
      const p = path.join(dir, ext);
      if (fs.existsSync(p)) return p;
    }
  }
  try {
    const cfgPath = path.join(codexHome || defaultCodexHome(platform, env), 'config.toml');
    if (fs.existsSync(cfgPath)) {
      const raw = fs.readFileSync(cfgPath, 'utf8');
      const m = /^\s*CODEX_CLI_PATH\s*=\s*"([^"]+)"/m.exec(raw);
      if (m) {
        const candidate = platform === 'win32' ? m[1].replace(/\\\\/g, '\\') : m[1];
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  } catch {}

  const home = realUserProfile(platform, env);
  if (platform !== 'win32') {
    const posixCandidates = [
      path.join(codexHome || defaultCodexHome(platform, env), '.sandbox-bin', 'codex'),
      path.join(codexHome || defaultCodexHome(platform, env), 'packages', 'standalone', 'current', 'bin', 'codex'),
      path.join(home, '.local', 'bin', 'codex'),
      path.join(home, '.npm-global', 'bin', 'codex'),
      '/opt/homebrew/bin/codex',
      '/usr/local/bin/codex',
      '/usr/bin/codex',
      '/snap/bin/codex',
      ...(platform === 'darwin'
        ? [
            '/Applications/Codex.app/Contents/Resources/codex',
            '/Applications/Codex.app/Contents/MacOS/codex',
            path.join(home, 'Applications', 'Codex.app', 'Contents', 'Resources', 'codex'),
            '/Applications/ChatGPT.app/Contents/Resources/codex'
          ]
        : [])
    ];
    for (const candidate of posixCandidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return 'codex';
  }

  try {
    const localBinRoot = path.join(home, 'AppData', 'Local', 'OpenAI', 'Codex', 'bin');
    if (fs.existsSync(localBinRoot)) {
      const candidates = fs.readdirSync(localBinRoot)
        .map(d => path.join(localBinRoot, d, 'codex.exe'))
        .filter(p => fs.existsSync(p))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      if (candidates.length) return candidates[0];
    }
  } catch {}
  for (const sub of [
    path.join(codexHome || defaultCodexHome(), '.sandbox-bin', 'codex.exe'),
    path.join(codexHome || defaultCodexHome(), 'packages', 'standalone', 'current', 'bin', 'codex.exe')
  ]) {
    if (fs.existsSync(sub)) return sub;
  }
  try {
    const winApps = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'WindowsApps');
    if (fs.existsSync(winApps)) {
      const pkgs = fs.readdirSync(winApps)
        .filter(d => d.startsWith('OpenAI.Codex_'))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const pkgDir of pkgs) {
        const exe = path.join(winApps, pkgDir, 'app', 'resources', 'codex.exe');
        if (fs.existsSync(exe)) return exe;
      }
    }
  } catch {}
  return 'codex';
}

const AES_CREDENTIAL_PREFIX = 'ct-aes256gcm:v1:';

function derivePosixCredentialKey(credDir) {
  fs.mkdirSync(credDir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(credDir, 0o700);
  } catch {}
  const masterKeyFile = path.join(credDir, '.master.key');
  let masterSecret;
  if (fs.existsSync(masterKeyFile)) {
    masterSecret = fs.readFileSync(masterKeyFile, 'utf8').trim();
  }
  if (!masterSecret || masterSecret.length < 32) {
    masterSecret = randomBytes(32).toString('hex');
    atomicWrite(masterKeyFile, masterSecret + '\n');
    try {
      fs.chmodSync(masterKeyFile, 0o600);
    } catch {}
  }
  let userIdentity = 'user';
  try {
    userIdentity = os.userInfo().username || 'user';
  } catch {}
  const salt = `codex-translate:v1:${userIdentity}:${os.homedir()}`;
  return scryptSync(masterSecret, salt, 32);
}

function protectPosixCredential(file, plainText) {
  const secret = String(plainText ?? '').trim();
  if (!secret) throw Error('Credential helper failed. Reconfigure for this Windows user.');
  const credDir = path.dirname(path.resolve(file));
  const key = derivePosixCredentialKey(credDir);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = `${AES_CREDENTIAL_PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}\n`;
  atomicWrite(file, payload);
  try {
    fs.chmodSync(file, 0o600);
  } catch {}
  return '';
}

function readPosixCredential(file) {
  if (!file || !fs.existsSync(file)) {
    throw Error('Credential helper failed. Reconfigure for this Windows user.');
  }
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw.startsWith(AES_CREDENTIAL_PREFIX)) {
      throw Error('Invalid prefix');
    }
    const parts = raw.slice(AES_CREDENTIAL_PREFIX.length).split(':');
    if (parts.length !== 3) {
      throw Error('Invalid format');
    }
    const [ivHex, tagHex, dataHex] = parts;
    const credDir = path.dirname(path.resolve(file));
    const key = derivePosixCredentialKey(credDir);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    throw Error('Credential helper failed. Reconfigure for this Windows user.');
  }
}

export function credential(helper, mode, file, input, options = {}) {
  const platform = options?.platform || process.platform;
  if (mode === 'Read' && file && fs.existsSync(file)) {
    try {
      const head = fs.readFileSync(file, 'utf8').slice(0, AES_CREDENTIAL_PREFIX.length);
      if (head === AES_CREDENTIAL_PREFIX) {
        return readPosixCredential(file);
      }
    } catch (err) {
      if (platform !== 'win32') throw err;
    }
  }
  if (platform !== 'win32') {
    try {
      if (mode === 'Protect') return protectPosixCredential(file, input);
      return readPosixCredential(file);
    } catch {
      throw Error('Credential helper failed. Reconfigure for this Windows user.');
    }
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = spawnSync(
      psPath(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Mode', mode, '-Path', file],
      { input, encoding: 'utf8', windowsHide: true, timeout: 15000 }
    );
    if (!r.error && r.status === 0) return r.stdout.trim();
  }
  throw Error('Credential helper failed. Reconfigure for this Windows user.');
}

export async function discover(baseURL, key, kind = 'omniroute') {
  let r;
  const headers =
    kind === 'anthropic'
      ? { 'anthropic-version': '2023-06-01', ...(key ? { 'x-api-key': key } : {}) }
      : key
        ? { Authorization: 'Bearer ' + key }
        : {};
  try {
    r = await fetch(baseURL + '/models', { headers, redirect: 'error', signal: AbortSignal.timeout(30000) });
  } catch {
    throw Error('Cannot reach server /models. Check the server URL, network and TLS.');
  }
  if (!r.ok) throw Error(`Server /models returned HTTP ${r.status}.`);
  const body = await r.json();
  return parseModels(Array.isArray(body) ? { data: body } : body.data ? body : { data: body.models || [] });
}
