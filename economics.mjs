import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { jsonRead, writeJSON } from './lib.mjs';
import { stripTranslationIndicators, isSystemContextText } from './translator.mjs';

let encodeO200k = null;
let encodeO200kHarmony = null;
let encodeCl100k = null;
try {
  const o200kMod = await import('gpt-tokenizer/encoding/o200k_base');
  const o200kHarmonyMod = await import('gpt-tokenizer/encoding/o200k_harmony');
  const cl100kMod = await import('gpt-tokenizer/encoding/cl100k_base');
  encodeO200k = o200kMod.encode;
  encodeO200kHarmony = o200kHarmonyMod.encode;
  encodeCl100k = cl100kMod.encode;
} catch {
  // Fallback to deterministic UTF-8/BPE estimator if node_modules is unavailable
}

const MODEL_TARIFF_PRESETS = {
  'gpt-6.1-sol': {
    id: 'gpt-6.1-sol',
    name: 'GPT-6.1-Sol (Codex Workhorse)',
    encoding: 'o200k_base',
    priceInPerMillion: 2.5,
    priceCachedPerMillion: 0.25,
    cacheDiscountPercent: 90,
    priceCacheWrite30mPerMillion: 2.5,
    priceCacheWrite12hPerMillion: 5.0,
    priceOutPerMillion: 10.0,
    longContext: {
      priceInPerMillion: 4.0,
      priceCachedPerMillion: 0.2,
      priceCacheWrite30mPerMillion: 5.0,
      priceCacheWrite12hPerMillion: 10.0,
      priceOutPerMillion: 15.0
    },
    translatorCostPerRequest: 0.0,
    translatorPricePerMillion: 0.0
  },
  'gpt-6.1-terra': {
    id: 'gpt-6.1-terra',
    name: 'GPT-6.1-Terra',
    encoding: 'o200k_base',
    priceInPerMillion: 1.0,
    priceCachedPerMillion: 0.05,
    cacheDiscountPercent: 95,
    priceCacheWrite30mPerMillion: 1.25,
    priceCacheWrite12hPerMillion: 2.5,
    priceOutPerMillion: 5.0,
    longContext: {
      priceInPerMillion: 2.0,
      priceCachedPerMillion: 0.1,
      priceCacheWrite30mPerMillion: 2.5,
      priceCacheWrite12hPerMillion: 5.0,
      priceOutPerMillion: 7.5
    },
    translatorCostPerRequest: 0.0,
    translatorPricePerMillion: 0.0
  },
  'gpt-6-astra': {
    id: 'gpt-6-astra',
    name: 'GPT-6-Astra (Codex Frontier)',
    encoding: 'o200k_base',
    priceInPerMillion: 5.0,
    priceCachedPerMillion: 0.5,
    cacheDiscountPercent: 90,
    priceCacheWrite30mPerMillion: 12.5,
    priceCacheWrite12hPerMillion: 25.0,
    priceOutPerMillion: 20.0,
    longContext: {
      priceInPerMillion: 20.0,
      priceCachedPerMillion: 2.0,
      priceCacheWrite30mPerMillion: 25.0,
      priceCacheWrite12hPerMillion: 50.0,
      priceOutPerMillion: 75.0
    },
    translatorCostPerRequest: 0.0,
    translatorPricePerMillion: 0.0
  },
  'gpt-6-sol': {
    id: 'gpt-6-sol',
    name: 'GPT-6-Sol',
    encoding: 'o200k_base',
    priceInPerMillion: 2.0,
    priceCachedPerMillion: 0.2,
    cacheDiscountPercent: 90,
    priceCacheWrite30mPerMillion: 2.5,
    priceCacheWrite12hPerMillion: 5.0,
    priceOutPerMillion: 8.0,
    longContext: {
      priceInPerMillion: 4.0,
      priceCachedPerMillion: 0.4,
      priceCacheWrite30mPerMillion: 5.0,
      priceCacheWrite12hPerMillion: 10.0,
      priceOutPerMillion: 15.0
    },
    translatorCostPerRequest: 0.0,
    translatorPricePerMillion: 0.0
  },
  'gpt-6-luna': {
    id: 'gpt-6-luna',
    name: 'GPT-6-Luna (Codex Fast)',
    encoding: 'o200k_base',
    priceInPerMillion: 0.8,
    priceCachedPerMillion: 0.08,
    cacheDiscountPercent: 90,
    priceCacheWrite30mPerMillion: 0.125,
    priceCacheWrite12hPerMillion: 0.25,
    priceOutPerMillion: 3.2,
    longContext: {
      priceInPerMillion: 0.2,
      priceCachedPerMillion: 0.02,
      priceCacheWrite30mPerMillion: 0.25,
      priceCacheWrite12hPerMillion: 0.5,
      priceOutPerMillion: 0.75
    },
    translatorCostPerRequest: 0.0,
    translatorPricePerMillion: 0.0
  },
  'gpt-6-thinking': {
    id: 'gpt-6-thinking',
    name: 'GPT-6-Thinking',
    encoding: 'o200k_base',
    priceInPerMillion: 3.0,
    priceCachedPerMillion: 0.3,
    cacheDiscountPercent: 90,
    priceCacheWrite30mPerMillion: 3.75,
    priceCacheWrite12hPerMillion: 7.5,
    priceOutPerMillion: 12.0,
    translatorCostPerRequest: 0.0,
    translatorPricePerMillion: 0.0
  },
  'gpt-reserve': {
    id: 'gpt-reserve',
    name: 'GPT-Reserve',
    encoding: 'o200k_base',
    priceInPerMillion: 0.8,
    priceCachedPerMillion: 0.08,
    cacheDiscountPercent: 90,
    priceCacheWrite30mPerMillion: 1.0,
    priceCacheWrite12hPerMillion: 2.0,
    priceOutPerMillion: 3.2,
    translatorCostPerRequest: 0.0,
    translatorPricePerMillion: 0.0
  },
  'gpt-5.6-sol': {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6-Sol',
    encoding: 'o200k_base',
    priceInPerMillion: 1.5,
    priceCachedPerMillion: 0.15,
    cacheDiscountPercent: 90,
    priceCacheWrite30mPerMillion: 5.0,
    priceCacheWrite12hPerMillion: 10.0,
    priceOutPerMillion: 6.0,
    longContext: {
      priceInPerMillion: 8.0,
      priceCachedPerMillion: 0.8,
      priceCacheWrite30mPerMillion: 10.0,
      priceCacheWrite12hPerMillion: 20.0,
      priceOutPerMillion: 30.0
    },
    translatorCostPerRequest: 0.0,
    translatorPricePerMillion: 0.0
  },
  'gpt-5.6-terra': {
    id: 'gpt-5.6-terra',
    name: 'GPT-5.6-Terra',
    encoding: 'o200k_base',
    priceInPerMillion: 1.25,
    priceCachedPerMillion: 0.125,
    cacheDiscountPercent: 90,
    priceCacheWrite30mPerMillion: 2.5,
    priceCacheWrite12hPerMillion: 5.0,
    priceOutPerMillion: 5.0,
    longContext: {
      priceInPerMillion: 4.0,
      priceCachedPerMillion: 0.4,
      priceCacheWrite30mPerMillion: 5.0,
      priceCacheWrite12hPerMillion: 10.0,
      priceOutPerMillion: 18.0
    },
    translatorCostPerRequest: 0.0,
    translatorPricePerMillion: 0.0
  },
  'gpt-5.6-luna': {
    id: 'gpt-5.6-luna',
    name: 'GPT-5.6-Luna',
    encoding: 'o200k_base',
    priceInPerMillion: 0.6,
    priceCachedPerMillion: 0.06,
    cacheDiscountPercent: 90,
    priceCacheWrite30mPerMillion: 0.25,
    priceCacheWrite12hPerMillion: 0.5,
    priceOutPerMillion: 2.4,
    longContext: {
      priceInPerMillion: 0.4,
      priceCachedPerMillion: 0.04,
      priceCacheWrite30mPerMillion: 0.5,
      priceCacheWrite12hPerMillion: 1.0,
      priceOutPerMillion: 1.8
    },
    translatorCostPerRequest: 0.0,
    translatorPricePerMillion: 0.0
  },
  'gpt-5.6-cyber': {
    id: 'gpt-5.6-cyber',
    name: 'GPT-5.6-Cyber',
    encoding: 'o200k_base',
    priceInPerMillion: 12.5,
    priceCachedPerMillion: 1.25,
    cacheDiscountPercent: 90,
    priceCacheWrite30mPerMillion: 15.625,
    priceCacheWrite12hPerMillion: 31.25,
    priceOutPerMillion: 75.0,
    translatorCostPerRequest: 0.0,
    translatorPricePerMillion: 0.0
  },
  'gpt-6-rosalind': {
    id: 'gpt-6-rosalind',
    name: 'GPT-6-Rosalind',
    encoding: 'o200k_base',
    priceInPerMillion: 15.0,
    priceCachedPerMillion: 1.5,
    cacheDiscountPercent: 90,
    priceCacheWrite30mPerMillion: 18.75,
    priceCacheWrite12hPerMillion: 37.5,
    priceOutPerMillion: 75.0,
    translatorCostPerRequest: 0.0,
    translatorPricePerMillion: 0.0
  },
  'gpt-5.3-codex': {
    id: 'gpt-5.3-codex',
    name: 'GPT-5.3-Codex',
    encoding: 'o200k_base',
    priceInPerMillion: 1.75,
    priceCachedPerMillion: 0.175,
    cacheDiscountPercent: 90,
    priceCacheWrite30mPerMillion: 2.1875,
    priceCacheWrite12hPerMillion: 4.375,
    priceOutPerMillion: 14.0,
    translatorCostPerRequest: 0.0,
    translatorPricePerMillion: 0.0
  },
  'claude-3.7-sonnet': {
    id: 'claude-3.7-sonnet',
    name: 'Claude 3.5 / 3.7 Sonnet',
    encoding: 'cl100k_base',
    priceInPerMillion: 3.0,
    priceCachedPerMillion: 0.3,
    cacheDiscountPercent: 90,
    priceCacheWrite30mPerMillion: 3.75,
    priceCacheWrite12hPerMillion: 6.0,
    priceOutPerMillion: 15.0,
    translatorCostPerRequest: 0.0,
    translatorPricePerMillion: 0.0
  },
  'gpt-4o': {
    id: 'gpt-4o',
    name: 'GPT-4o',
    encoding: 'o200k_base',
    priceInPerMillion: 2.5,
    priceCachedPerMillion: 1.25,
    cacheDiscountPercent: 50,
    priceCacheWrite30mPerMillion: null,
    priceCacheWrite12hPerMillion: null,
    priceOutPerMillion: 10.0,
    translatorCostPerRequest: 0.0,
    translatorPricePerMillion: 0.0
  },
  'o3-mini': {
    id: 'o3-mini',
    name: 'o3-mini',
    encoding: 'o200k_base',
    priceInPerMillion: 1.1,
    priceCachedPerMillion: 0.55,
    cacheDiscountPercent: 50,
    priceCacheWrite30mPerMillion: null,
    priceCacheWrite12hPerMillion: null,
    priceOutPerMillion: 4.4,
    translatorCostPerRequest: 0.0,
    translatorPricePerMillion: 0.0
  },
  'gpt-5-codex': {
    id: 'gpt-5-codex',
    name: 'GPT-5 / Codex',
    encoding: 'o200k_base',
    priceInPerMillion: 1.25,
    priceCachedPerMillion: 0.125,
    cacheDiscountPercent: 90,
    priceCacheWrite30mPerMillion: 1.5625,
    priceCacheWrite12hPerMillion: 3.125,
    priceOutPerMillion: 10.0,
    translatorCostPerRequest: 0.0,
    translatorPricePerMillion: 0.0
  },
  custom: {
    id: 'custom',
    name: 'Custom (Ручной тариф)',
    encoding: 'o200k_base',
    priceInPerMillion: 2.5,
    priceCachedPerMillion: 1.25,
    cacheDiscountPercent: 50,
    priceCacheWrite30mPerMillion: 3.125,
    priceCacheWrite12hPerMillion: 6.25,
    priceOutPerMillion: 10.0,
    translatorCostPerRequest: 0.0,
    translatorPricePerMillion: 0.0
  }
};

const DEFAULT_OPENAI_PRICING_URL = 'https://developers.openai.com/api/docs/pricing';
const PRICING_SYNC_INTERVAL_MS = 4 * 60 * 60 * 1000;
const LONG_CONTEXT_THRESHOLD_TOKENS = 272000;

function formatLocalDateKey(dateInput = new Date()) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Resolves the exact OpenAI BPE tokenizer encoding for a given model ID.
 * - GPT-6.x, GPT-5.x, GPT-4.5, GPT-4.1, GPT-4o, o1, o3, o4, Codex -> o200k_base
 * - gpt-oss-20b / gpt-oss-120b -> o200k_harmony
 * - Legacy GPT-4, GPT-4-Turbo, GPT-3.5-Turbo, embeddings -> cl100k_base
 */
export function resolveOpenAiEncoding(modelId = '', fallbackEncoding = 'o200k_base') {
  const s = String(modelId || '').trim().toLowerCase();
  if (!s) {
    if (fallbackEncoding === 'cl100k_base' || fallbackEncoding === 'o200k_harmony') return fallbackEncoding;
    return 'o200k_base';
  }
  if (s.includes('gpt-oss') || s === 'o200k_harmony') return 'o200k_harmony';
  if (
    s === 'cl100k_base' ||
    s.includes('gpt-3.5') ||
    s.includes('text-embedding') ||
    s.includes('babbage-002') ||
    s.includes('davinci-002') ||
    s.includes('claude') ||
    (/\bgpt-4(?:-(?:turbo|0314|0613|1106|0125|32k|vision))?\b/.test(s) &&
      !s.includes('gpt-4o') &&
      !s.includes('gpt-4.1') &&
      !s.includes('gpt-4.5'))
  ) {
    return 'cl100k_base';
  }
  if (fallbackEncoding === 'cl100k_base' && !/\b(?:gpt-[56]|gpt-4o|gpt-4\.[15]|o[134]|codex)\b/.test(s)) {
    return 'cl100k_base';
  }
  return 'o200k_base';
}

/**
 * Local BPE tokenizer without network calls.
 * Uses official OpenAI BPE encodings (o200k_base, o200k_harmony, cl100k_base) with
 * allowedSpecial: 'all' so special tokens (e.g. <|endoftext|>, <|im_start|>) are counted
 * accurately as BPE tokens without throwing or falling back.
 */
export function countTokens(text, encoding = 'o200k_base') {
  if (typeof text !== 'string' || text.length === 0) return 0;
  try {
    const resolvedEnc = resolveOpenAiEncoding(encoding, encoding);
    const fn =
      resolvedEnc === 'cl100k_base'
        ? encodeCl100k
        : resolvedEnc === 'o200k_harmony'
          ? encodeO200kHarmony || encodeO200k
          : encodeO200k;
    if (typeof fn === 'function') {
      return fn(text, { allowedSpecial: 'all' }).length;
    }
  } catch {}
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    count += code > 0x007f ? 0.65 : 0.25;
  }
  return Math.max(1, Math.ceil(count));
}

export function inferDefaultModelRate(modelId = '', displayName = '', description = '') {
  const id = String(modelId || '').trim() || 'gpt-6.1-sol';
  const baseSlug = id.replace(/-\d{4}-\d{2}-\d{2}$/, '');
  if (MODEL_TARIFF_PRESETS[id] || MODEL_TARIFF_PRESETS[baseSlug]) {
    const p = MODEL_TARIFF_PRESETS[id] || MODEL_TARIFF_PRESETS[baseSlug];
    return {
      id,
      name: displayName || p.name || id,
      description: description || '',
      encoding: p.encoding || 'o200k_base',
      priceInPerMillion: p.priceInPerMillion,
      priceCachedPerMillion: p.priceCachedPerMillion,
      cacheDiscountPercent:
        p.cacheDiscountPercent ??
        (p.priceInPerMillion > 0
          ? Number((((p.priceInPerMillion - p.priceCachedPerMillion) / p.priceInPerMillion) * 100).toFixed(1))
          : 90),
      priceCacheWrite30mPerMillion:
        p.priceCacheWrite30mPerMillion !== undefined
          ? p.priceCacheWrite30mPerMillion
          : Number((p.priceInPerMillion * 1.25).toFixed(6)),
      priceCacheWrite12hPerMillion:
        p.priceCacheWrite12hPerMillion !== undefined
          ? p.priceCacheWrite12hPerMillion
          : Number((p.priceInPerMillion * 2.5).toFixed(6)),
      priceOutPerMillion: p.priceOutPerMillion,
      ...(p.longContext ? { longContext: structuredClone(p.longContext) } : {}),
      ...(p.tiers ? { tiers: structuredClone(p.tiers) } : {}),
      customized: false
    };
  }

  const s = (id + ' ' + displayName).toLowerCase();
  let priceIn = 2.5;
  let discountPct = 90;
  let priceOut = 10.0;
  let hasCacheWrite = true;
  let encoding = resolveOpenAiEncoding(id);

  // Evaluate lightweight / mini / nano / luna / terra variants BEFORE broad model families
  if (s.includes('5.4-nano')) {
    priceIn = 0.2;
    discountPct = 90;
    priceOut = 1.25;
    hasCacheWrite = false;
  } else if (s.includes('5-nano')) {
    priceIn = 0.05;
    discountPct = 90;
    priceOut = 0.4;
    hasCacheWrite = false;
  } else if (s.includes('4.1-nano')) {
    priceIn = 0.1;
    discountPct = 75;
    priceOut = 0.4;
    hasCacheWrite = false;
  } else if (s.includes('4o-mini')) {
    priceIn = 0.15;
    discountPct = 50;
    priceOut = 0.6;
    hasCacheWrite = false;
  } else if (s.includes('5.4-mini')) {
    priceIn = 0.75;
    discountPct = 90;
    priceOut = 4.5;
    hasCacheWrite = false;
  } else if (s.includes('5-mini') || s.includes('codex-mini')) {
    priceIn = 0.25;
    discountPct = 90;
    priceOut = 2.0;
    hasCacheWrite = false;
  } else if (s.includes('4.1-mini')) {
    priceIn = 0.4;
    discountPct = 75;
    priceOut = 1.6;
    hasCacheWrite = false;
  } else if (s.includes('o4-mini')) {
    priceIn = 1.1;
    discountPct = 75;
    priceOut = 4.4;
    hasCacheWrite = false;
  } else if (s.includes('o3-mini')) {
    priceIn = 1.1;
    discountPct = 50;
    priceOut = 4.4;
    hasCacheWrite = false;
  } else if (s.includes('6.1-terra')) {
    priceIn = 1.0;
    discountPct = 95;
    priceOut = 5.0;
  } else if (s.includes('6-luna') || s.includes('reserve')) {
    priceIn = 0.8;
    discountPct = 90;
    priceOut = 3.2;
  } else if (s.includes('5.6-luna') || s.includes('flash') || s.includes('haiku') || s.includes('mini') || s.includes('nano')) {
    priceIn = 0.6;
    discountPct = 90;
    priceOut = 2.4;
  } else if (s.includes('cyber')) {
    priceIn = 12.5;
    discountPct = 90;
    priceOut = 75.0;
  } else if (s.includes('rosalind')) {
    priceIn = 15.0;
    discountPct = 90;
    priceOut = 75.0;
  } else if (s.includes('astra') || s.includes('opus') || s.includes('pro')) {
    priceIn = 5.0;
    discountPct = 90;
    priceOut = 20.0;
  } else if (s.includes('6.1-sol') || s.includes('sonnet')) {
    priceIn = 2.5;
    discountPct = 90;
    priceOut = 10.0;
  } else if (s.includes('6-sol') || s.includes('thinking') || s.includes('gpt-4.1')) {
    priceIn = 2.0;
    discountPct = s.includes('gpt-4.1') ? 75 : 90;
    priceOut = 8.0;
  } else if (s.includes('5.3-codex') || s.includes('5.2')) {
    priceIn = 1.75;
    discountPct = 90;
    priceOut = 14.0;
  } else if (s.includes('5.1') || s.includes('5-codex')) {
    priceIn = 1.25;
    discountPct = 90;
    priceOut = 10.0;
  } else if (s.includes('5.6-sol') || s.includes('gpt-5')) {
    priceIn = 1.5;
    discountPct = 90;
    priceOut = 6.0;
  } else if (s.includes('5.6-terra') || s.includes('o3') || s.includes('o4')) {
    priceIn = 1.25;
    discountPct = 90;
    priceOut = 5.0;
  }

  const priceCached = Number((priceIn * (1 - discountPct / 100)).toFixed(4));
  return {
    id,
    name: displayName || id,
    description: description || '',
    encoding,
    priceInPerMillion: priceIn,
    priceCachedPerMillion: priceCached,
    cacheDiscountPercent: discountPct,
    priceCacheWrite30mPerMillion: hasCacheWrite ? Number((priceIn * 1.25).toFixed(6)) : null,
    priceCacheWrite12hPerMillion: hasCacheWrite ? Number((priceIn * 2.5).toFixed(6)) : null,
    priceOutPerMillion: priceOut,
    customized: false
  };
}

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function unwrapAstroValue(v) {
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number') {
    if (v[0] === 1 && Array.isArray(v[1])) {
      return v[1].map(unwrapAstroValue);
    }
    return unwrapAstroValue(v[1]);
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, unwrapAstroValue(val)]));
  }
  return v;
}

function parseDollarNumber(val) {
  if (typeof val === 'number' && Number.isFinite(val) && val >= 0) return val;
  if (typeof val !== 'string') return null;
  const cleaned = val.replace(/<[^>]+>/g, '').trim();
  if (!cleaned || cleaned === '-' || cleaned === '—' || /^free$/i.test(cleaned)) return null;
  const m = /\$?\s*(\d+(?:\.\d+)?)/.exec(cleaned);
  return m ? Number(m[1]) : null;
}

function cleanModelIdFromPricingLabel(rawLabel) {
  if (typeof rawLabel === 'object' && rawLabel !== null && typeof rawLabel.__pricingHtml === 'string') {
    rawLabel = rawLabel.__pricingHtml;
  }
  if (typeof rawLabel !== 'string') return '';
  return rawLabel
    .replace(/<br\s*\/?>[\s\S]*$/i, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s*\([^)]*context length[^)]*\)/i, '')
    .replace(/\s+with data sharing$/i, '')
    .trim();
}

const DEFAULT_LONG_CONTEXT_BY_TIER = {
  standard: {
    'gpt-6-astra': { input: 20, cachedInput: 2, cacheWrite: 25, output: 75 },
    'gpt-6.1-sol': { input: 4, cachedInput: 0.2, cacheWrite: 5, output: 15 },
    'gpt-6.1-terra': { input: 2, cachedInput: 0.1, cacheWrite: 2.5, output: 7.5 },
    'gpt-6-sol': { input: 4, cachedInput: 0.4, cacheWrite: 5, output: 15 },
    'gpt-6-luna': { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 0.75 },
    'gpt-5.6-sol': { input: 8, cachedInput: 0.8, cacheWrite: 10, output: 30 },
    'gpt-5.6-terra': { input: 4, cachedInput: 0.4, cacheWrite: 5, output: 18 },
    'gpt-5.6-luna': { input: 0.4, cachedInput: 0.04, cacheWrite: 0.5, output: 1.8 },
    'gpt-5.5': { input: 10, cachedInput: 1, cacheWrite: null, output: 45 },
    'gpt-5.5-pro': { input: 60, cachedInput: null, cacheWrite: null, output: 270 },
    'gpt-5.4': { input: 5, cachedInput: 0.5, cacheWrite: null, output: 22.5 },
    'gpt-5.4-pro': { input: 60, cachedInput: null, cacheWrite: null, output: 270 }
  },
  fast: {
    'gpt-6-astra': { input: 40, cachedInput: 4, cacheWrite: 50, output: 150 },
    'gpt-6.1-sol': { input: 8, cachedInput: 0.4, cacheWrite: 10, output: 30 },
    'gpt-6.1-terra': { input: 4, cachedInput: 0.2, cacheWrite: 5, output: 15 },
    'gpt-6-sol': { input: 8, cachedInput: 0.8, cacheWrite: 10, output: 30 },
    'gpt-6-luna': { input: 0.4, cachedInput: 0.04, cacheWrite: 0.5, output: 1.5 },
    'gpt-5.6-sol': { input: 16, cachedInput: 1.6, cacheWrite: 20, output: 60 },
    'gpt-5.6-terra': { input: 8, cachedInput: 0.8, cacheWrite: 10, output: 36 },
    'gpt-5.6-luna': { input: 0.8, cachedInput: 0.08, cacheWrite: 1.0, output: 3.6 }
  },
  batch: {
    'gpt-6-astra': { input: 10, cachedInput: 1, cacheWrite: 12.5, output: 37.5 },
    'gpt-6.1-sol': { input: 2, cachedInput: 0.1, cacheWrite: 2.5, output: 7.5 },
    'gpt-6.1-terra': { input: 1, cachedInput: 0.05, cacheWrite: 1.25, output: 3.75 },
    'gpt-6-sol': { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 7.5 },
    'gpt-6-luna': { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.375 },
    'gpt-5.6-sol': { input: 4, cachedInput: 0.4, cacheWrite: 5, output: 15 },
    'gpt-5.6-terra': { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 9 },
    'gpt-5.6-luna': { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 0.9 }
  },
  ultrafast: {
    'gpt-6-astra': { input: 120, cachedInput: 12, cacheWrite: 150, output: 450 },
    'gpt-6.1-sol': { input: 24, cachedInput: 1.2, cacheWrite: 30, output: 90 }
  }
};

/**
 * Parses the official OpenAI pricing page HTML (`https://developers.openai.com/api/docs/pricing`)
 * including `<astro-island>` JSON props (`TextTokenPricingTables` & `GroupedPricingTable`) and HTML `<table>` fallback.
 */
export function parseOpenAiPricingHtml(html) {
  const models = {};
  if (typeof html !== 'string' || !html.trim()) return { models, count: 0 };

  const buildRateEntry = (modelId, { input, cachedInput, cacheWrite30m, cacheWrite12h, output }) => {
    const pIn = parseDollarNumber(input);
    const pOut = parseDollarNumber(output);
    if (pIn === null || pOut === null) return null;
    const pCachedRaw = parseDollarNumber(cachedInput);
    const pCached = pCachedRaw !== null ? pCachedRaw : pIn;
    const discountPct = pIn > 0 ? Number((Math.max(0, (pIn - pCached) / pIn) * 100).toFixed(2)) : 0;
    const w30 = parseDollarNumber(cacheWrite30m);
    const w12 = parseDollarNumber(cacheWrite12h) ?? (w30 !== null ? Number((pIn * 2.5).toFixed(6)) : null);
    return {
      priceInPerMillion: pIn,
      priceCachedPerMillion: pCached,
      cacheDiscountPercent: discountPct,
      priceCacheWrite30mPerMillion: w30,
      priceCacheWrite12hPerMillion: w12,
      priceOutPerMillion: pOut
    };
  };

  const recordTierRate = (rawName, tier, rateObj, longContextObj = null) => {
    const id = cleanModelIdFromPricingLabel(rawName);
    if (!id || !/^[a-zA-Z0-9._-]+$/.test(id)) return;
    const entry = buildRateEntry(id, rateObj);
    if (!entry) return;
    const normTier = tier === 'flex' ? 'batch' : tier || 'standard';
    const rec = (models[id] ||= {
      id,
      name: MODEL_TARIFF_PRESETS[id]?.name || id,
      encoding: id.includes('claude') ? 'cl100k_base' : 'o200k_base',
      tiers: {},
      longContext: null
    });
    rec.tiers[normTier] = entry;
    if (normTier === 'standard' || rec.priceInPerMillion === undefined) {
      Object.assign(rec, entry);
    }
    const lcSource = longContextObj || DEFAULT_LONG_CONTEXT_BY_TIER[normTier]?.[id];
    if (lcSource) {
      const lcEntry = buildRateEntry(id, {
        input: lcSource.input,
        cachedInput: lcSource.cachedInput,
        cacheWrite30m: lcSource.cacheWrite ?? lcSource.cacheWrite30m,
        cacheWrite12h: lcSource.cacheWrite12h,
        output: lcSource.output
      });
      if (lcEntry) {
        rec.tiers[normTier].longContext = lcEntry;
        if (normTier === 'standard' || !rec.longContext) {
          rec.longContext = lcEntry;
        }
      }
    }
  };

  // 1. Primary parser: <astro-island> structured props
  for (const [, rawProps, rawOpts] of html.matchAll(/<astro-island[^>]*props="([^"]+)"[^>]*opts="([^"]+)"/gi)) {
    try {
      const opts = JSON.parse(decodeHtmlEntities(rawOpts));
      const props = unwrapAstroValue(JSON.parse(decodeHtmlEntities(rawProps)));
      if (opts?.name === 'TextTokenPricingTables' && Array.isArray(props?.rows)) {
        const tier = String(props.tier || 'standard').toLowerCase();
        const lcMap = props.longContextRows && typeof props.longContextRows === 'object' ? props.longContextRows : null;
        for (const row of props.rows) {
          if (!Array.isArray(row) || row.length < 4) continue;
          const modelId = cleanModelIdFromPricingLabel(row[0]);
          const isFiveTuple = row.length >= 5;
          recordTierRate(
            modelId,
            tier,
            {
              input: row[1],
              cachedInput: row[2],
              cacheWrite30m: isFiveTuple ? row[3] : null,
              output: isFiveTuple ? row[4] : row[3]
            },
            lcMap?.[modelId] || null
          );
        }
      } else if (opts?.name === 'GroupedPricingTable' && Array.isArray(props?.groups)) {
        const headings = (props.headings || []).map(h => cleanModelIdFromPricingLabel(h).toLowerCase());
        const hasCategory = headings[0] === 'category' && headings[1] === 'model';
        if (hasCategory) {
          for (const g of props.groups) {
            for (const r of g?.rows || []) {
              if (!Array.isArray(r) || r.length < 4) continue;
              const mId = cleanModelIdFromPricingLabel(r[0]);
              const targetTier = models[mId]?.tiers?.standard ? 'fast' : 'standard';
              recordTierRate(mId, targetTier, {
                input: r[1],
                output: r[2],
                cachedInput: r[3],
                cacheWrite30m: null
              });
            }
          }
        }
      }
    } catch {}
  }

  // 2. Fallback parser: HTML <table> rows
  if (Object.keys(models).length === 0) {
    for (const tableMatch of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
      const trs = [...tableMatch[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(tr =>
        [...tr[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c =>
          c[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        )
      );
      const headerRow = trs.find(r => r.some(c => /^model$/i.test(c)) && r.some(c => /^input$/i.test(c)));
      if (!headerRow) continue;
      const mIdx = headerRow.findIndex(c => /^model$/i.test(c));
      const inIdx = headerRow.findIndex(c => /^input$/i.test(c));
      const outIdx = headerRow.findIndex(c => /^output$/i.test(c));
      const cacheIdx = headerRow.findIndex(c => /^cached input$/i.test(c));
      const w30Idx = headerRow.findIndex(c => /30m write/i.test(c));
      const w12Idx = headerRow.findIndex(c => /12h write/i.test(c));
      if (mIdx < 0 || inIdx < 0 || outIdx < 0) continue;
      for (const r of trs) {
        if (r === headerRow || r.length <= Math.max(mIdx, inIdx, outIdx)) continue;
        const mName = r[mIdx];
        if (!mName || /^model$/i.test(mName)) continue;
        if (models[cleanModelIdFromPricingLabel(mName)]) continue;
        recordTierRate(mName, 'standard', {
          input: r[inIdx],
          output: r[outIdx],
          cachedInput: cacheIdx >= 0 ? r[cacheIdx] : null,
          cacheWrite30m: w30Idx >= 0 ? r[w30Idx] : null,
          cacheWrite12h: w12Idx >= 0 ? r[w12Idx] : null
        });
      }
    }
  }

  return { models, count: Object.keys(models).length };
}

function normalizeModelRate(id, raw = {}, fallbackMeta = {}) {
  const cleanId = String(id || raw.id || 'gpt-6.1-sol').trim();
  const base = inferDefaultModelRate(
    cleanId,
    raw.name || fallbackMeta.name || cleanId,
    raw.description || fallbackMeta.description || ''
  );
  const numOr = (val, fb) => {
    const n = Number(val);
    return Number.isFinite(n) && n >= 0 ? n : fb;
  };
  const priceInPerMillion = numOr(raw.priceInPerMillion, base.priceInPerMillion);
  let priceCachedPerMillion;
  let cacheDiscountPercent;

  if (raw.priceCachedPerMillion !== undefined && raw.priceCachedPerMillion !== null && raw.priceCachedPerMillion !== '') {
    priceCachedPerMillion = numOr(raw.priceCachedPerMillion, base.priceCachedPerMillion);
    cacheDiscountPercent =
      priceInPerMillion > 0
        ? Number((Math.max(0, (priceInPerMillion - priceCachedPerMillion) / priceInPerMillion) * 100).toFixed(2))
        : 0;
  } else if (raw.cacheDiscountPercent !== undefined && raw.cacheDiscountPercent !== null && raw.cacheDiscountPercent !== '') {
    cacheDiscountPercent = Math.min(100, Math.max(0, numOr(raw.cacheDiscountPercent, base.cacheDiscountPercent)));
    priceCachedPerMillion = Number((priceInPerMillion * (1 - cacheDiscountPercent / 100)).toFixed(6));
  } else {
    priceCachedPerMillion = base.priceCachedPerMillion;
    cacheDiscountPercent = base.cacheDiscountPercent;
  }

  const priceOutPerMillion = numOr(raw.priceOutPerMillion, base.priceOutPerMillion);
  const defaultWrite30m =
    base.priceCacheWrite30mPerMillion !== undefined && base.priceCacheWrite30mPerMillion !== null
      ? base.priceCacheWrite30mPerMillion
      : Number((priceInPerMillion * 1.25).toFixed(6));
  const defaultWrite12h =
    base.priceCacheWrite12hPerMillion !== undefined && base.priceCacheWrite12hPerMillion !== null
      ? base.priceCacheWrite12hPerMillion
      : Number((priceInPerMillion * 2.5).toFixed(6));
  const priceCacheWrite30mPerMillion =
    raw.priceCacheWrite30mPerMillion === null
      ? null
      : numOr(raw.priceCacheWrite30mPerMillion, defaultWrite30m);
  const priceCacheWrite12hPerMillion =
    raw.priceCacheWrite12hPerMillion === null
      ? null
      : numOr(raw.priceCacheWrite12hPerMillion, defaultWrite12h);
  return {
    id: cleanId,
    name: raw.name || fallbackMeta.name || base.name,
    description: raw.description ?? fallbackMeta.description ?? base.description ?? '',
    contextWindow: raw.contextWindow ?? fallbackMeta.contextWindow ?? null,
    maxContextWindow: raw.maxContextWindow ?? fallbackMeta.maxContextWindow ?? null,
    encoding: resolveOpenAiEncoding(cleanId, raw.encoding || base.encoding),
    priceInPerMillion,
    priceCachedPerMillion,
    cacheDiscountPercent,
    priceCacheWrite30mPerMillion,
    priceCacheWrite12hPerMillion,
    priceOutPerMillion,
    ...(raw.longContext || base.longContext ? { longContext: raw.longContext || base.longContext } : {}),
    ...(raw.tiers || base.tiers ? { tiers: raw.tiers || base.tiers } : {}),
    customized: raw.customized === true
  };
}

function discoverCodexModelState(codexHome) {
  const out = {
    activeModel: null,
    reasoningEffort: null,
    serviceTier: 'default',
    configModel: null,
    configEffort: null,
    configMtimeMs: 0,
    recentModel: null,
    recentEffort: null,
    latestThreadId: null,
    latestThreadModel: null,
    latestThreadEffort: null,
    latestThreadUpdatedAtMs: 0,
    latestThreadSignature: null,
    models: [],
    threadModels: {},
    threadEfforts: {}
  };
  if (!codexHome || !fs.existsSync(codexHome)) return out;

  const byId = new Map();
  let configMtimeMs = 0;
  const upsertModel = (slug, info = {}) => {
    if (!slug || typeof slug !== 'string') return;
    const clean = slug.trim();
    if (!clean) return;
    const prev = byId.get(clean) || {};
    byId.set(clean, {
      id: clean,
      name: info.name || prev.name || clean,
      description: info.description || prev.description || '',
      contextWindow: info.contextWindow ?? prev.contextWindow ?? null,
      maxContextWindow: info.maxContextWindow ?? prev.maxContextWindow ?? null,
      visibility: info.visibility || prev.visibility || 'list',
      source: info.source || prev.source || 'codex'
    });
  };

  // 1. Read ~/.codex/config.toml
  try {
    const cfgPath = path.join(codexHome, 'config.toml');
    if (fs.existsSync(cfgPath)) {
      configMtimeMs = fs.statSync(cfgPath).mtimeMs || 0;
      const rootPart = fs.readFileSync(cfgPath, 'utf8').replace(/\0+/g, '').split(/^\s*\[/m)[0];
      const mModel = /^\s*model\s*=\s*["']([^"']+)["']/m.exec(rootPart);
      const mEffort = /^\s*model_reasoning_effort\s*=\s*["']([^"']+)["']/m.exec(rootPart);
      const mTier = /^\s*service_tier\s*=\s*["']([^"']+)["']/m.exec(rootPart);
      if (mModel?.[1]) {
        out.activeModel = mModel[1].trim();
        out.configModel = out.activeModel;
        upsertModel(out.activeModel, { source: 'config.toml' });
      }
      if (mEffort?.[1]) {
        out.reasoningEffort = mEffort[1].trim();
        out.configEffort = out.reasoningEffort;
      }
      if (mTier?.[1]) out.serviceTier = mTier[1].trim();
    }
  } catch {}
  out.configMtimeMs = configMtimeMs;

  // 2. Read ~/.codex/models_cache.json
  try {
    const cachePath = path.join(codexHome, 'models_cache.json');
    if (fs.existsSync(cachePath)) {
      const mc = jsonRead(cachePath, null);
      const list = Array.isArray(mc) ? mc : mc?.models || mc?.data || [];
      for (const m of list) {
        const slug = m?.slug || m?.id;
        if (!slug) continue;
        upsertModel(slug, {
          name: m.display_name || m.title || m.name || slug,
          description: m.description || '',
          contextWindow: m.context_window || null,
          maxContextWindow: m.max_context_window || null,
          visibility: m.visibility || 'list',
          source: 'models_cache.json'
        });
      }
    }
  } catch {}

  // 3. Read ~/.codex/.codex-global-state.json for recent models in ChatGPT / Codex UI
  try {
    const gsPath = path.join(codexHome, '.codex-global-state.json');
    if (fs.existsSync(gsPath)) {
      const gs = jsonRead(gsPath, null);
      const atoms = gs?.['electron-persisted-atom-state'] || {};
      const recent = atoms['composer-recent-model-configurations-v1'];
      if (Array.isArray(recent)) {
        for (const r of recent) {
          if (r?.model) {
            upsertModel(r.model, { source: 'recent-codex' });
            if (!out.activeModel) out.activeModel = r.model;
          }
        }
        const topRecent = recent[0];
        if (topRecent?.model) {
          out.recentModel = String(topRecent.model).trim();
          if (!out.activeModel) out.activeModel = out.recentModel;
        }
        if (topRecent?.reasoningEffort) {
          out.recentEffort = String(topRecent.reasoningEffort).trim();
          if (!out.reasoningEffort) out.reasoningEffort = out.recentEffort;
        }
      }
      const lastSelected = atoms['chatgpt-last-selected-model-v1'];
      if (lastSelected?.slug) {
        upsertModel(lastSelected.slug, { source: 'chatgpt-selected' });
      }
      for (const [k, v] of Object.entries(atoms)) {
        if (k.startsWith('chatgpt-work-models-v1') && Array.isArray(v?.response?.models)) {
          for (const wm of v.response.models) {
            const slug = wm?.slug || wm?.id;
            if (!slug) continue;
            upsertModel(slug, {
              name: wm.title || wm.display_name || slug,
              description: wm.description || '',
              contextWindow: wm.max_tokens || null,
              source: 'chatgpt-work-models'
            });
          }
        }
      }
    }
  } catch {}

  // 4. Read ~/.codex/state_5.sqlite (if available) to map threadId -> actual model used in Codex
  try {
    const stateDbPath = path.join(codexHome, 'state_5.sqlite');
    if (fs.existsSync(stateDbPath)) {
      const { DatabaseSync } = globalThis.process?.getBuiltinModule?.('node:sqlite') || {};
      if (DatabaseSync) {
        const db = new DatabaseSync(stateDbPath, { open: true, readOnly: true });
        try {
          const rows = db
            .prepare(
              'SELECT id, model, reasoning_effort, updated_at, updated_at_ms, rollout_path FROM threads WHERE model IS NOT NULL ORDER BY COALESCE(updated_at_ms, updated_at * 1000) DESC'
            )
            .all();
          for (const r of rows) {
            if (r?.id && r?.model) {
              let tModel = String(r.model).trim();
              let tEffort = r.reasoning_effort ? String(r.reasoning_effort).trim() : null;
              let tUpdatedMs = Number(r.updated_at_ms || (r.updated_at ? r.updated_at * 1000 : 0)) || 0;

              if (tModel !== 'codex-auto-review' && !out.latestThreadId) {
                const rawRolloutPath = String(r.rollout_path || '').replace(/^\\\\\?\\/, '');
                if (rawRolloutPath && fs.existsSync(rawRolloutPath)) {
                  try {
                    const st = fs.statSync(rawRolloutPath);
                    if (st.mtimeMs > tUpdatedMs) tUpdatedMs = st.mtimeMs;
                    const tailBytes = Math.min(st.size, 32768);
                    if (tailBytes > 0) {
                      const fd = fs.openSync(rawRolloutPath, 'r');
                      try {
                        const buf = Buffer.alloc(tailBytes);
                        fs.readSync(fd, buf, 0, tailBytes, Math.max(0, st.size - tailBytes));
                        const lines = buf.toString('utf8').trim().split(/\r?\n/);
                        for (let i = lines.length - 1; i >= 0; i--) {
                          try {
                            const ev = JSON.parse(lines[i]);
                            if (ev?.type === 'event_msg' && ev.payload?.type === 'thread_settings_applied' && ev.payload?.thread_settings) {
                              const tsSettings = ev.payload.thread_settings;
                              if (tsSettings.model) tModel = String(tsSettings.model).trim();
                              const eff = tsSettings.reasoning_effort || tsSettings.collaboration_mode?.settings?.reasoning_effort;
                              if (eff) tEffort = String(eff).trim();
                              const evMs = ev.timestamp ? Date.parse(ev.timestamp) : 0;
                              if (evMs > tUpdatedMs) tUpdatedMs = evMs;
                              break;
                            }
                            if (ev?.type === 'turn_context' && ev.payload) {
                              if (ev.payload.model) tModel = String(ev.payload.model).trim();
                              const eff = ev.payload.effort || ev.payload.collaboration_mode?.settings?.reasoning_effort;
                              if (eff) tEffort = String(eff).trim();
                              break;
                            }
                          } catch {}
                        }
                      } finally {
                        try { fs.closeSync(fd); } catch {}
                      }
                    }
                  } catch {}
                }
                out.latestThreadId = r.id;
                out.latestThreadModel = tModel;
                out.latestThreadEffort = tEffort;
                out.latestThreadUpdatedAtMs = tUpdatedMs;
                out.latestThreadSignature = `${r.id}:${tModel}:${tEffort || ''}:${Math.floor(tUpdatedMs)}`;
              }

              out.threadModels[r.id] = tModel;
              if (tEffort) {
                out.threadEfforts[r.id] = tEffort;
              }
              if (tModel !== 'codex-auto-review') {
                upsertModel(tModel, { source: 'state_5.sqlite' });
              }
            }
          }
        } finally {
          try { db.close(); } catch {}
        }
      }
    }
  } catch {}

  if (!out.activeModel && out.latestThreadModel) {
    out.activeModel = out.latestThreadModel;
  }
  if (!out.reasoningEffort && out.latestThreadEffort) {
    out.reasoningEffort = out.latestThreadEffort;
  }
  if (out.latestThreadUpdatedAtMs > configMtimeMs && out.latestThreadModel) {
    out.activeModel = out.latestThreadModel;
    if (out.latestThreadEffort) out.reasoningEffort = out.latestThreadEffort;
  }

  out.models = [...byId.values()];
  return out;
}

function normalizePricingConfig(raw = {}) {
  const candidateId = raw.presetId || raw.id;
  const presetId =
    candidateId && MODEL_TARIFF_PRESETS[candidateId]
      ? candidateId
      : candidateId && typeof candidateId === 'string'
        ? candidateId
        : 'gpt-4o';
  const base = MODEL_TARIFF_PRESETS[presetId] || inferDefaultModelRate(presetId, raw.name);
  const numOr = (val, fallback) => {
    const n = Number(val);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const priceInPerMillion = numOr(raw.priceInPerMillion, base.priceInPerMillion);
  let priceCachedPerMillion;
  let cacheDiscountPercent;
  if (raw.priceCachedPerMillion !== undefined && raw.priceCachedPerMillion !== null && raw.priceCachedPerMillion !== '') {
    priceCachedPerMillion = numOr(raw.priceCachedPerMillion, base.priceCachedPerMillion);
    cacheDiscountPercent =
      priceInPerMillion > 0
        ? Number((Math.max(0, (priceInPerMillion - priceCachedPerMillion) / priceInPerMillion) * 100).toFixed(2))
        : 0;
  } else if (raw.cacheDiscountPercent !== undefined && raw.cacheDiscountPercent !== null && raw.cacheDiscountPercent !== '') {
    cacheDiscountPercent = Math.min(100, Math.max(0, numOr(raw.cacheDiscountPercent, base.cacheDiscountPercent ?? 50)));
    priceCachedPerMillion = Number((priceInPerMillion * (1 - cacheDiscountPercent / 100)).toFixed(6));
  } else {
    priceCachedPerMillion = numOr(base.priceCachedPerMillion, priceInPerMillion * 0.5);
    cacheDiscountPercent =
      priceInPerMillion > 0
        ? Number((Math.max(0, (priceInPerMillion - priceCachedPerMillion) / priceInPerMillion) * 100).toFixed(2))
        : 0;
  }
  return {
    presetId,
    name: raw.name || base.name,
    encoding: resolveOpenAiEncoding(presetId, raw.encoding || base.encoding),
    priceInPerMillion,
    priceCachedPerMillion,
    cacheDiscountPercent,
    priceCacheWrite30mPerMillion:
      raw.priceCacheWrite30mPerMillion === null
        ? null
        : numOr(raw.priceCacheWrite30mPerMillion, base.priceCacheWrite30mPerMillion ?? Number((priceInPerMillion * 1.25).toFixed(6))),
    priceCacheWrite12hPerMillion:
      raw.priceCacheWrite12hPerMillion === null
        ? null
        : numOr(raw.priceCacheWrite12hPerMillion, base.priceCacheWrite12hPerMillion ?? Number((priceInPerMillion * 2.5).toFixed(6))),
    priceOutPerMillion: numOr(raw.priceOutPerMillion, base.priceOutPerMillion),
    ...(raw.longContext || base.longContext ? { longContext: raw.longContext || base.longContext } : {}),
    ...(raw.tiers || base.tiers ? { tiers: raw.tiers || base.tiers } : {}),
    translatorCostPerRequest: numOr(raw.translatorCostPerRequest, base.translatorCostPerRequest ?? 0),
    translatorPricePerMillion: numOr(raw.translatorPricePerMillion, base.translatorPricePerMillion ?? 0)
  };
}

/**
 * Extracts normalized text from a single request message/item for tokenization and prefix matching.
 */
function extractMessageText(item) {
  if (!item || typeof item !== 'object') return '';
  if (typeof item.content === 'string') return item.content;
  if (Array.isArray(item.content)) {
    return item.content
      .map(part => {
        if (!part || typeof part !== 'object') return '';
        if (typeof part.text === 'string') return part.text;
        if (part.type === 'input_image' || part.type === 'image_url') return '[image]';
        if (part.type === 'input_file' || part.type === 'file') return `[file:${part.filename || 'attachment'}]`;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (item.type === 'function_call' || item.type === 'custom_tool_call') {
    return `${item.name || 'tool'}(${item.arguments || item.input || ''})`;
  }
  if (item.type === 'function_call_output' || item.type === 'custom_tool_call_output') {
    return typeof item.output === 'string' ? item.output : JSON.stringify(item.output || '');
  }
  return '';
}

/**
 * Extracts actual input, cached, and output tokens from an API usage object
 * across OpenAI Responses, OpenAI Chat Completions, and Anthropic Messages formats.
 */
export function parseApiUsage(usage) {
  if (!usage || typeof usage !== 'object') {
    return {
      hasApiUsage: false,
      hasApiCache: false,
      inUncached: 0,
      inCached: 0,
      inCacheWrite: 0,
      cacheWriteTtl: null,
      reasoningTokens: 0,
      outEn: 0,
      totalIn: 0
    };
  }

  const outEn = Math.max(0, Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0);
  const reasoningTokens = Math.max(
    0,
    Number(
      usage.output_tokens_details?.reasoning_tokens ??
        usage.completion_tokens_details?.reasoning_tokens ??
        usage.reasoning_tokens ??
        0
    ) || 0
  );
  const rawTtl =
    usage.cache_write_ttl ??
    usage.input_tokens_details?.cache_write_ttl ??
    usage.prompt_tokens_details?.cache_write_ttl ??
    (Number(usage.input_tokens_details?.cache_creation?.ephemeral_12h_input_tokens || 0) > 0 ? '12h' : null);
  const cacheWriteTtl = rawTtl === '12h' || rawTtl === '30m' ? rawTtl : null;

  // Check Anthropic-style cache fields first when cache_read_input_tokens is explicitly present
  if (usage.cache_read_input_tokens !== undefined || usage.cache_creation_input_tokens !== undefined) {
    const inCached = Math.max(0, Number(usage.cache_read_input_tokens || 0));
    const cacheCreated = Math.max(0, Number(usage.cache_creation_input_tokens || 0));
    const rawIn = Math.max(0, Number(usage.input_tokens ?? usage.prompt_tokens ?? 0));
    // In Anthropic Messages API, input_tokens is uncached input after cache reads
    const inUncached = rawIn + cacheCreated;
    const totalIn = inUncached + inCached;
    return {
      hasApiUsage: totalIn > 0 || outEn > 0,
      hasApiCache: true,
      inUncached,
      inCached,
      inCacheWrite: cacheCreated,
      cacheWriteTtl: cacheWriteTtl || (cacheCreated > 0 ? '30m' : null),
      reasoningTokens,
      outEn,
      totalIn
    };
  }

  const rawPromptTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const totalIn = Math.max(0, Number.isFinite(rawPromptTokens) ? rawPromptTokens : 0);

  const explicitCached =
    usage.prompt_tokens_details?.cached_tokens ??
    usage.input_tokens_details?.cached_tokens ??
    usage.cached_tokens;
  const explicitCacheWrite =
    usage.prompt_tokens_details?.cache_write_tokens ??
    usage.input_tokens_details?.cache_write_tokens ??
    usage.input_tokens_details?.cache_creation_input_tokens ??
    usage.cache_write_tokens ??
    0;

  const hasApiCache = explicitCached !== undefined && explicitCached !== null;
  const inCached = hasApiCache ? Math.min(totalIn, Math.max(0, Number(explicitCached) || 0)) : 0;
  const inUncached = Math.max(0, totalIn - inCached);
  const inCacheWrite = Math.min(inUncached, Math.max(0, Number(explicitCacheWrite) || 0));

  return {
    hasApiUsage: totalIn > 0 || outEn > 0,
    hasApiCache,
    inUncached,
    inCached,
    inCacheWrite,
    cacheWriteTtl: cacheWriteTtl || (inCacheWrite > 0 ? '30m' : null),
    reasoningTokens,
    outEn,
    totalIn
  };
}

/**
 * Computes unit economics metrics for a single turn given token counts and pricing configuration.
 * Follows Section 3.2 and Section 4 formulas strictly.
 */
export function calculateTurnEconomics({
  inUncached = 0,
  inCached = 0,
  inCacheWrite = 0,
  cacheWriteWindow = '30m',
  nonTranslatedInTokens = 0,
  outEn = 0,
  historyNativeTokens = 0,
  historyEnTokens = 0,
  virtualOutTokens = 0,
  translatorTokens = 0,
  pricing = MODEL_TARIFF_PRESETS['gpt-4o']
}) {
  const p = normalizePricingConfig(pricing);
  const safeInUncached = Math.max(0, Number(inUncached) || 0);
  const safeInCached = Math.max(0, Number(inCached) || 0);
  const safeInCacheWrite = Math.min(safeInUncached, Math.max(0, Number(inCacheWrite) || 0));
  const regularInUncached = Math.max(0, safeInUncached - safeInCacheWrite);
  const safeOutEn = Math.max(0, Number(outEn) || 0);
  const actualInTotal = safeInUncached + safeInCached;

  const safeHistEn = Math.max(0, Number(historyEnTokens) || 0);
  const safeHistNative = Math.max(0, Number(historyNativeTokens) || 0);

  // Compression ratio K_ratio = tokenize(History_native) / tokenize(History_en)
  const kRatio =
    safeHistEn > 0 && safeHistNative > 0
      ? safeHistNative / safeHistEn
      : 1.0;

  // When nonTranslatedInTokens > 0 (English system prompt, tool definitions, tool outputs),
  // keep the non-translated portion at 1.0x and only scale the translatable dialogue share by kRatio.
  const safeNonTrans = Math.min(actualInTotal, Math.max(0, Number(nonTranslatedInTokens) || 0));
  let virtualCached;
  let virtualUncached;
  let virtualCacheWrite;
  if (safeNonTrans > 0 && actualInTotal > 0) {
    const dialogueShare = Math.max(0, actualInTotal - safeNonTrans) / actualInTotal;
    const effectiveInputMultiplier = 1 + dialogueShare * (kRatio - 1);
    virtualCached = Math.round(safeInCached * effectiveInputMultiplier);
    virtualUncached = Math.round(safeInUncached * effectiveInputMultiplier);
    virtualCacheWrite = Math.min(virtualUncached, Math.round(safeInCacheWrite * effectiveInputMultiplier));
  } else {
    virtualCached = Math.round(safeInCached * kRatio);
    virtualUncached = Math.round(safeInUncached * kRatio);
    virtualCacheWrite = Math.min(virtualUncached, Math.round(safeInCacheWrite * kRatio));
  }
  const virtualRegularUncached = Math.max(0, virtualUncached - virtualCacheWrite);
  const virtualIn =
    actualInTotal > 0
      ? virtualCached + virtualUncached
      : safeHistNative;
  const virtualOut = Math.max(0, Math.round(Number(virtualOutTokens) || 0));

  const pIn = p.priceInPerMillion / 1_000_000;
  const pCached = p.priceCachedPerMillion / 1_000_000;
  const pOut = p.priceOutPerMillion / 1_000_000;
  const pWrite30m =
    (p.priceCacheWrite30mPerMillion !== null && p.priceCacheWrite30mPerMillion !== undefined
      ? p.priceCacheWrite30mPerMillion
      : p.priceInPerMillion) / 1_000_000;
  const pWrite12h =
    (p.priceCacheWrite12hPerMillion !== null && p.priceCacheWrite12hPerMillion !== undefined
      ? p.priceCacheWrite12hPerMillion
      : p.priceInPerMillion) / 1_000_000;
  const activeWriteRate = cacheWriteWindow === '12h' ? pWrite12h : pWrite30m;

  const translatorTokenCost =
    (Math.max(0, Number(translatorTokens) || 0) * (p.translatorPricePerMillion || 0)) / 1_000_000;
  const translationCost = (p.translatorCostPerRequest || 0) + translatorTokenCost;

  const actualCacheWriteCost = safeInCacheWrite * activeWriteRate;
  const actualUncachedCost = regularInUncached * pIn + actualCacheWriteCost;
  const actualCachedCost = safeInCached * pCached;
  const modelActualCost =
    actualUncachedCost +
    actualCachedCost +
    safeOutEn * pOut;
  const costActual = modelActualCost + translationCost;

  const actualInNoCacheCost = actualInTotal * pIn;
  const actualOutCost = safeOutEn * pOut;
  const modelActualNoCacheCost = actualInNoCacheCost + actualOutCost;
  const costActualNoCache = modelActualNoCacheCost + translationCost;

  const virtualInNoCacheCost = virtualIn * pIn;
  const virtualCacheWriteCost = virtualCacheWrite * activeWriteRate;
  const virtualUncachedCost = virtualRegularUncached * pIn + virtualCacheWriteCost;
  const virtualCachedCost = virtualCached * pCached;
  const virtualOutCost = virtualOut * pOut;
  const costVirtualNoCache = virtualInNoCacheCost + virtualOutCost;

  const costVirtual =
    virtualUncachedCost +
    virtualCachedCost +
    virtualOut * pOut;

  // Reference costs if all uncached input on this turn were written under 30m vs 12h TTL
  const costWrite30mUsd = safeInUncached * pWrite30m;
  const costWrite12hUsd = safeInUncached * pWrite12h;

  const inputSavedTokens = virtualIn - actualInTotal;
  const uncachedInputSavedTokens = virtualUncached - safeInUncached;
  const cachedInputSavedTokens = virtualCached - safeInCached;
  const outputSavedTokens = virtualOut - safeOutEn;
  const savedTokens = virtualIn + virtualOut - (actualInTotal + safeOutEn);
  const savedUsd = costVirtual - costActual;
  const savedNoCacheUsd = costVirtualNoCache - costActualNoCache;
  const totalSavedVsRawNoCacheUsd = costVirtualNoCache - costActual;
  const cacheSavedUsd = safeInCached * (pIn - pCached);
  const virtualCacheSavedUsd = virtualCached * (pIn - pCached);
  const savingsPercent = costVirtual > 0 ? (savedUsd / costVirtual) * 100 : 0;
  const savingsNoCachePercent = costVirtualNoCache > 0 ? (savedNoCacheUsd / costVirtualNoCache) * 100 : 0;
  const totalSavingsVsRawPercent = costVirtualNoCache > 0 ? (totalSavedVsRawNoCacheUsd / costVirtualNoCache) * 100 : 0;
  const cacheHitRate = actualInTotal > 0 ? (safeInCached / actualInTotal) * 100 : 0;
  const virtualCacheHitRate = virtualIn > 0 ? (virtualCached / virtualIn) * 100 : 0;

  return {
    inUncached: safeInUncached,
    inCached: safeInCached,
    inCacheWrite: safeInCacheWrite,
    cacheWriteWindow: cacheWriteWindow === '12h' ? '12h' : '30m',
    actualInTotal,
    outEn: safeOutEn,
    historyNativeTokens: safeHistNative,
    historyEnTokens: safeHistEn,
    kRatio: Number(kRatio.toFixed(4)),
    virtualCached,
    virtualUncached,
    virtualCacheWrite,
    virtualIn,
    virtualOut,
    inputSavedTokens,
    uncachedInputSavedTokens,
    cachedInputSavedTokens,
    outputSavedTokens,
    savedTokens,
    translatorTokens: Math.max(0, Number(translatorTokens) || 0),
    actualUncachedCost: Number(actualUncachedCost.toFixed(8)),
    actualCachedCost: Number(actualCachedCost.toFixed(8)),
    actualCacheWriteCost: Number(actualCacheWriteCost.toFixed(8)),
    costWrite30mUsd: Number(costWrite30mUsd.toFixed(8)),
    costWrite12hUsd: Number(costWrite12hUsd.toFixed(8)),
    actualInNoCacheCost: Number(actualInNoCacheCost.toFixed(8)),
    actualOutCost: Number(actualOutCost.toFixed(8)),
    modelActualCost: Number(modelActualCost.toFixed(8)),
    modelActualNoCacheCost: Number(modelActualNoCacheCost.toFixed(8)),
    translationCost: Number(translationCost.toFixed(8)),
    costActual: Number(costActual.toFixed(8)),
    costActualNoCache: Number(costActualNoCache.toFixed(8)),
    virtualUncachedCost: Number(virtualUncachedCost.toFixed(8)),
    virtualCachedCost: Number(virtualCachedCost.toFixed(8)),
    virtualInNoCacheCost: Number(virtualInNoCacheCost.toFixed(8)),
    virtualOutCost: Number(virtualOutCost.toFixed(8)),
    costVirtual: Number(costVirtual.toFixed(8)),
    costVirtualNoCache: Number(costVirtualNoCache.toFixed(8)),
    savedUsd: Number(savedUsd.toFixed(8)),
    savedNoCacheUsd: Number(savedNoCacheUsd.toFixed(8)),
    totalSavedVsRawNoCacheUsd: Number(totalSavedVsRawNoCacheUsd.toFixed(8)),
    cacheSavedUsd: Number(cacheSavedUsd.toFixed(8)),
    virtualCacheSavedUsd: Number(virtualCacheSavedUsd.toFixed(8)),
    savingsPercent: Number(savingsPercent.toFixed(2)),
    savingsNoCachePercent: Number(savingsNoCachePercent.toFixed(2)),
    totalSavingsVsRawPercent: Number(totalSavingsVsRawPercent.toFixed(2)),
    cacheHitRate: Number(cacheHitRate.toFixed(2)),
    virtualCacheHitRate: Number(virtualCacheHitRate.toFixed(2))
  };
}

export class TokenEconomicsEngine {
  constructor({ dataDir, codexHome = null } = {}) {
    this.dataDir = dataDir ? path.resolve(dataDir) : null;
    this.codexHome = codexHome ? path.resolve(codexHome) : null;
    this.filePath = this.dataDir ? path.join(this.dataDir, 'token-economics.json') : null;
    // In-memory prefix cache and virtual native history per threadId
    this.threadMemory = new Map();
    this.pricingSyncTimer = null;
    if (this.filePath && !fs.existsSync(this.filePath)) {
      this.initializeFromExistingTranslatorState();
    }
  }

  /**
   * Fetches and parses current model tariffs from https://developers.openai.com/api/docs/pricing
   * and updates non-customized model rates in the store.
   */
  async syncLivePricing({
    fetchImpl = fetch,
    pricingUrl = DEFAULT_OPENAI_PRICING_URL,
    force = true
  } = {}) {
    const store = this.loadStore();
    const nowMs = Date.now();
    const lastSyncedMs = store.pricingSyncedAt ? Date.parse(store.pricingSyncedAt) || 0 : 0;
    if (!force && lastSyncedMs > 0 && nowMs - lastSyncedMs < PRICING_SYNC_INTERVAL_MS) {
      return {
        synced: false,
        cached: true,
        pricingSyncedAt: store.pricingSyncedAt,
        nextPricingSyncAt: store.nextPricingSyncAt || new Date(lastSyncedMs + PRICING_SYNC_INTERVAL_MS).toISOString(),
        modelsCount: Object.keys(store.liveCatalog || {}).length
      };
    }

    try {
      const res = await fetchImpl(pricingUrl, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CodexTranslate/1.0',
          accept: 'text/html,application/xhtml+xml,*/*'
        },
        signal: AbortSignal.timeout(15000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const parsed = parseOpenAiPricingHtml(html);
      if (!parsed.count) throw new Error('No pricing rows found on page');

      store.liveCatalog = parsed.models;
      store.modelRates ||= {};
      for (const [mId, liveRate] of Object.entries(parsed.models)) {
        const existing = store.modelRates[mId];
        if (existing?.customized) {
          // Keep user's custom In/Cache/Out rates, but attach official tiers and longContext metadata
          store.modelRates[mId] = {
            ...existing,
            tiers: liveRate.tiers || existing.tiers,
            longContext: liveRate.longContext || existing.longContext
          };
        } else {
          store.modelRates[mId] = normalizeModelRate(
            mId,
            {
              ...(existing || {}),
              ...liveRate,
              customized: false
            },
            existing || {}
          );
        }
      }

      if (store.autoDetectModel !== false) {
        const activeId = store.activeCodexModel || store.pricing?.presetId || 'gpt-6.1-sol';
        if (store.modelRates[activeId] && !store.modelRates[activeId].customized) {
          store.pricing = normalizePricingConfig({
            ...store.modelRates[activeId],
            presetId: activeId,
            translatorCostPerRequest: store.pricing?.translatorCostPerRequest ?? 0,
            translatorPricePerMillion: store.pricing?.translatorPricePerMillion ?? 0
          });
        }
      }

      const syncedIso = new Date().toISOString();
      const nextSyncIso = new Date(Date.now() + PRICING_SYNC_INTERVAL_MS).toISOString();
      store.pricingSyncedAt = syncedIso;
      store.nextPricingSyncAt = nextSyncIso;
      store.pricingSyncStatus = 'online';
      store.pricingSyncError = null;
      store.pricingModelsSyncedCount = parsed.count;
      this.saveStore(store);

      return {
        synced: true,
        pricingSyncedAt: syncedIso,
        nextPricingSyncAt: nextSyncIso,
        modelsCount: parsed.count,
        models: parsed.models
      };
    } catch (err) {
      store.pricingSyncStatus = 'offline_fallback';
      store.pricingSyncError = err.message;
      store.nextPricingSyncAt = new Date(Date.now() + PRICING_SYNC_INTERVAL_MS).toISOString();
      this.saveStore(store);
      return {
        synced: false,
        error: err.message,
        pricingSyncedAt: store.pricingSyncedAt || null,
        nextPricingSyncAt: store.nextPricingSyncAt
      };
    }
  }

  /**
   * Unconditionally triggers a fresh pricing parse upon launch and resets the 4-hour counter anew.
   */
  startAutoPricingSync({
    intervalMs = PRICING_SYNC_INTERVAL_MS,
    fetchImpl = fetch,
    pricingUrl = DEFAULT_OPENAI_PRICING_URL,
    runImmediately = true
  } = {}) {
    this.stopAutoPricingSync();
    const effectiveInterval = Number.isFinite(Number(intervalMs)) && Number(intervalMs) > 0 ? Number(intervalMs) : PRICING_SYNC_INTERVAL_MS;
    const initialPromise = runImmediately
      ? this.syncLivePricing({ fetchImpl, pricingUrl, force: true })
      : Promise.resolve({ synced: false });
    this.pricingSyncTimer = setInterval(() => {
      void this.syncLivePricing({ fetchImpl, pricingUrl, force: true });
    }, effectiveInterval);
    this.pricingSyncTimer.unref?.();
    return initialPromise;
  }

  stopAutoPricingSync() {
    if (this.pricingSyncTimer) {
      clearInterval(this.pricingSyncTimer);
      this.pricingSyncTimer = null;
    }
  }

  defaultModelRates() {
    const rates = {};
    for (const id of [
      'gpt-6.1-sol',
      'gpt-6.1-terra',
      'gpt-6-astra',
      'gpt-6-sol',
      'gpt-6-luna',
      'gpt-6-thinking',
      'gpt-reserve',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.6-cyber',
      'gpt-5.3-codex'
    ]) {
      rates[id] = normalizeModelRate(id, MODEL_TARIFF_PRESETS[id]);
    }
    return rates;
  }

  defaultStore() {
    const codexState = discoverCodexModelState(this.codexHome);
    const activeCodex = codexState.activeModel || null;
    const modelRates = this.defaultModelRates();
    for (const m of codexState.models) {
      modelRates[m.id] = normalizeModelRate(m.id, modelRates[m.id] || {}, m);
    }
    const defaultPresetId = activeCodex || 'gpt-4o';
    const baseRate = modelRates[defaultPresetId] || MODEL_TARIFF_PRESETS[defaultPresetId] || MODEL_TARIFF_PRESETS['gpt-4o'];
    return {
      version: 1,
      seededFromHistory: true,
      autoDetectModel: true,
      activeCodexModel: activeCodex,
      codexReasoningEffort: codexState.reasoningEffort || null,
      codexServiceTier: codexState.serviceTier || 'default',
      lastConfigModel: codexState.configModel || null,
      lastConfigEffort: codexState.configEffort || null,
      lastRecentModel: codexState.recentModel || null,
      lastRecentEffort: codexState.recentEffort || null,
      lastThreadSignature: codexState.latestThreadSignature || null,
      pricing: normalizePricingConfig({ ...baseRate, presetId: defaultPresetId }),
      modelRates,
      sessionStartedAt: new Date().toISOString(),
      turns: [],
      daily: {},
      threads: {}
    };
  }

  initializeFromExistingTranslatorState() {
    if (!this.dataDir || !this.filePath) return;
    const transStatePath = path.join(this.dataDir, 'translator-state.json');
    if (!fs.existsSync(transStatePath)) return;
    try {
      const transState = jsonRead(transStatePath, null);
      if (!transState || typeof transState !== 'object' || !transState.threads) return;
      const store = this.defaultStore();
      const encoding = store.pricing.encoding || 'o200k_base';
      const rawTurns = [];

      for (const [threadId, thread] of Object.entries(transState.threads || {})) {
        const msgs = Object.values(thread?.messages || {})
          .filter(m => m && m.originalText && m.translatedText)
          .sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')));
        if (!msgs.length) continue;

        let runningEnTokens = 0;
        let runningNativeTokens = 0;
        let pendingUserEn = 0;
        let pendingUserNat = 0;
        let pendingAt = null;

        const flushTurn = (outEn, outNat, atIso) => {
          const inCached = Math.max(0, runningEnTokens - pendingUserEn);
          const inUncached = Math.max(1, pendingUserEn || Math.round(outEn * 0.35) || 12);
          const histEn = Math.max(inCached + inUncached, runningEnTokens || inUncached);
          const histNat = Math.max(
            histEn,
            runningNativeTokens || Math.round(histEn * 1.45)
          );
          const metrics = calculateTurnEconomics({
            inUncached,
            inCached,
            outEn,
            historyNativeTokens: histNat,
            historyEnTokens: histEn,
            virtualOutTokens: outNat,
            translatorTokens: pendingUserNat + pendingUserEn + outEn + outNat,
            pricing: store.pricing
          });
          rawTurns.push({
            id: crypto.randomUUID(),
            threadId,
            model: store.activeCodexModel || store.pricing.presetId || 'gpt-6.1-sol',
            translatorModel: '',
            cacheSource: inCached > 0 ? 'local_prefix' : 'api',
            at: atIso || new Date().toISOString(),
            ...metrics
          });
          runningEnTokens = histEn + outEn;
          runningNativeTokens = histNat + outNat;
          pendingUserEn = 0;
          pendingUserNat = 0;
          pendingAt = null;
        };

        for (const m of msgs) {
          if (m.kind === 'user') {
            const natText = stripTranslationIndicators(String(m.originalText || ''));
            const enText = stripTranslationIndicators(String(m.translatedText || ''));
            const natTok = countTokens(natText, encoding);
            const enTok = countTokens(enText, encoding);
            pendingUserNat += natTok;
            pendingUserEn += enTok;
            runningNativeTokens += natTok;
            runningEnTokens += enTok;
            pendingAt = m.updatedAt || pendingAt;
          } else if (m.kind === 'assistant') {
            const enText = stripTranslationIndicators(String(m.originalText || ''));
            const natText = stripTranslationIndicators(String(m.translatedText || ''));
            const outEn = countTokens(enText, encoding);
            const outNat = countTokens(natText, encoding);
            flushTurn(outEn, outNat, m.updatedAt || pendingAt);
          }
        }

        if (pendingUserEn > 0) {
          flushTurn(0, 0, pendingAt);
        }
      }

      if (rawTurns.length > 0) {
        rawTurns.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
        store.turns = rawTurns.slice(-500).map((t, idx) => ({ ...t, step: idx + 1 }));
        store.sessionStartedAt = store.turns[0]?.at || store.sessionStartedAt;
        this.rebuildDailyAggregates(store);
        this.saveStore(store);
      }
    } catch {}
  }

  loadStore() {
    if (!this.filePath) {
      this._memStore ||= this.defaultStore();
      this.syncCodexModelsIntoStore(this._memStore);
      return this._memStore;
    }
    const data = jsonRead(this.filePath, null);
    if (!data || typeof data !== 'object') {
      const initial = this.defaultStore();
      this.syncCodexModelsIntoStore(initial);
      return initial;
    }
    data.version = 1;
    data.autoDetectModel = data.autoDetectModel !== false;
    data.modelRates = data.modelRates && typeof data.modelRates === 'object' ? data.modelRates : this.defaultModelRates();
    for (const [k, v] of Object.entries(this.defaultModelRates())) {
      if (!data.modelRates[k]) data.modelRates[k] = v;
      else data.modelRates[k] = normalizeModelRate(k, data.modelRates[k]);
    }
    data.pricing = normalizePricingConfig(data.pricing || {});
    data.sessionStartedAt ||= new Date().toISOString();
    data.turns = Array.isArray(data.turns) ? data.turns : [];
    data.daily = data.daily && typeof data.daily === 'object' ? data.daily : {};
    data.threads = data.threads && typeof data.threads === 'object' ? data.threads : {};
    data.liveCatalog = data.liveCatalog && typeof data.liveCatalog === 'object' ? data.liveCatalog : {};
    this.syncCodexModelsIntoStore(data);
    return data;
  }

  syncCodexModelsIntoStore(store) {
    if (!store) return;
    const codexState = discoverCodexModelState(this.codexHome);
    let storeChanged = false;

    const configModelChanged =
      !!codexState.configModel && codexState.configModel !== store.lastConfigModel;
    const configEffortChanged =
      !!codexState.configEffort && codexState.configEffort !== store.lastConfigEffort;
    const threadSigChanged =
      !!codexState.latestThreadSignature && codexState.latestThreadSignature !== store.lastThreadSignature;
    const recentEffortChanged =
      !!codexState.recentEffort &&
      store.lastRecentEffort !== undefined &&
      codexState.recentEffort !== store.lastRecentEffort;
    const recentModelChanged =
      !!codexState.recentModel &&
      store.lastRecentModel !== undefined &&
      codexState.recentModel !== store.lastRecentModel;

    if (configModelChanged || configEffortChanged) {
      if (codexState.configModel && store.activeCodexModel !== codexState.configModel) {
        store.activeCodexModel = codexState.configModel;
        storeChanged = true;
      }
      if (codexState.configEffort && store.codexReasoningEffort !== codexState.configEffort) {
        store.codexReasoningEffort = codexState.configEffort;
        storeChanged = true;
      }
      if (configEffortChanged && store.lastConfigEffort !== undefined) {
        store.lastConfigChangedAtMs = Date.now();
        storeChanged = true;
      }
    } else if (threadSigChanged && codexState.latestThreadUpdatedAtMs > (codexState.configMtimeMs || 0)) {
      if (codexState.latestThreadModel && store.activeCodexModel !== codexState.latestThreadModel) {
        store.activeCodexModel = codexState.latestThreadModel;
        storeChanged = true;
      }
      if (codexState.latestThreadEffort && store.codexReasoningEffort !== codexState.latestThreadEffort) {
        store.codexReasoningEffort = codexState.latestThreadEffort;
        storeChanged = true;
      }
    } else if (recentModelChanged || recentEffortChanged) {
      if (codexState.recentModel && store.activeCodexModel !== codexState.recentModel) {
        store.activeCodexModel = codexState.recentModel;
        storeChanged = true;
      }
      if (codexState.recentEffort && store.codexReasoningEffort !== codexState.recentEffort) {
        store.codexReasoningEffort = codexState.recentEffort;
        storeChanged = true;
      }
    }

    if (!store.activeCodexModel && codexState.activeModel) {
      store.activeCodexModel = codexState.activeModel;
      storeChanged = true;
    }
    if (!store.codexReasoningEffort && codexState.reasoningEffort) {
      store.codexReasoningEffort = codexState.reasoningEffort;
      storeChanged = true;
    }

    if (store.lastConfigModel !== codexState.configModel) {
      store.lastConfigModel = codexState.configModel;
      storeChanged = true;
    }
    if (store.lastConfigEffort !== codexState.configEffort) {
      store.lastConfigEffort = codexState.configEffort;
      storeChanged = true;
    }
    if (store.lastRecentModel !== codexState.recentModel) {
      store.lastRecentModel = codexState.recentModel;
      storeChanged = true;
    }
    if (store.lastRecentEffort !== codexState.recentEffort) {
      store.lastRecentEffort = codexState.recentEffort;
      storeChanged = true;
    }
    if (store.lastThreadSignature !== codexState.latestThreadSignature) {
      store.lastThreadSignature = codexState.latestThreadSignature;
      storeChanged = true;
    }

    store.codexServiceTier = codexState.serviceTier || 'default';

    for (const m of codexState.models) {
      const existing = store.modelRates[m.id];
      if (!existing) {
        store.modelRates[m.id] = normalizeModelRate(m.id, {}, m);
      } else {
        store.modelRates[m.id] = normalizeModelRate(m.id, existing, m);
      }
    }

    for (const t of store.turns || []) {
      if (t?.model && !store.modelRates[t.model] && t.model !== 'GPT-4o') {
        store.modelRates[t.model] = normalizeModelRate(t.model, {});
      }
    }

    if (store.activeCodexModel || codexState.activeModel) {
      if (store.autoDetectModel !== false) {
        const currentActive = store.activeCodexModel || codexState.activeModel;
        const rate = store.modelRates[currentActive] || normalizeModelRate(currentActive, {});
        store.modelRates[currentActive] = rate;
        store.pricing = normalizePricingConfig({
          ...rate,
          presetId: currentActive,
          translatorCostPerRequest: store.pricing?.translatorCostPerRequest ?? 0,
          translatorPricePerMillion: store.pricing?.translatorPricePerMillion ?? 0
        });
      }
    }

    // Upgrade legacy seeded 'GPT-4o' placeholder turns when an actual Codex model is known
    let upgradedLegacy = false;
    const fallbackCodexModel = store.activeCodexModel || 'gpt-6.1-sol';
    const threadModels = codexState.threadModels || {};
    const threadEfforts = codexState.threadEfforts || {};
    const beforeCount = (store.turns || []).length;
    store.turns = (store.turns || []).filter(t => {
      const mapped = t.threadId && threadModels[t.threadId] ? threadModels[t.threadId] : t.model;
      return mapped !== 'codex-auto-review' && t.model !== 'codex-auto-review';
    });
    if (store.turns.length !== beforeCount) {
      upgradedLegacy = true;
    }
    for (let i = 0; i < (store.turns || []).length; i++) {
      const t = store.turns[i];
      t.step = i + 1;
      const mappedThreadModel = t.threadId && threadModels[t.threadId] ? threadModels[t.threadId] : null;
      const mappedThreadEffort = t.threadId && threadEfforts[t.threadId] ? threadEfforts[t.threadId] : null;
      if (mappedThreadEffort && !t.reasoningEffort) {
        t.reasoningEffort = mappedThreadEffort;
        upgradedLegacy = true;
      }
      if (mappedThreadModel && mappedThreadModel !== 'codex-auto-review' && store.seededFromHistory && t.model !== mappedThreadModel) {
        t.model = mappedThreadModel;
        if (!store.modelRates[mappedThreadModel]) {
          store.modelRates[mappedThreadModel] = normalizeModelRate(mappedThreadModel, {});
        }
        upgradedLegacy = true;
      }
      if (t.model === 'GPT-4o' && store.seededFromHistory) {
        t.model = fallbackCodexModel;
        upgradedLegacy = true;
      }
      if ((t.virtualOut || 0) < (t.outEn || 0) && (t.kRatio || 1) >= 1) {
        t.virtualOut = Math.round((t.outEn || 0) * Math.max(1, t.kRatio || 1));
        upgradedLegacy = true;
      }
      if (t.costVirtualNoCache === undefined || upgradedLegacy) {
        const turnPricing = this.resolvePricingForTurn(store, t.model);
        const recalc = calculateTurnEconomics({
          inUncached: t.inUncached,
          inCached: t.inCached,
          outEn: t.outEn,
          historyNativeTokens: t.historyNativeTokens,
          historyEnTokens: t.historyEnTokens,
          virtualOutTokens: t.virtualOut,
          translatorTokens: t.translatorTokens || 0,
          pricing: turnPricing
        });
        store.turns[i] = { ...t, ...recalc };
      }
    }
    if (upgradedLegacy) {
      this.rebuildDailyAggregates(store);
    }
    if ((upgradedLegacy || storeChanged) && this.filePath) {
      try { writeJSON(this.filePath, store); } catch {}
    }
  }

  resolvePricingForTurn(store, modelId, { totalInputTokens = 0, speedTier = null } = {}) {
    if (!store) return normalizePricingConfig();
    if (store.autoDetectModel === false && store.pricing?.presetId === 'custom') {
      return store.pricing;
    }
    const cleanModel = String(modelId || store.activeCodexModel || store.pricing?.presetId || '').trim();
    const rateEntry =
      (cleanModel && store.modelRates?.[cleanModel]) ||
      (cleanModel && store.liveCatalog?.[cleanModel]) ||
      (cleanModel && MODEL_TARIFF_PRESETS[cleanModel]) ||
      null;
    if (rateEntry) {
      let selected = { ...rateEntry };
      if (!rateEntry.customized && speedTier && rateEntry.tiers?.[speedTier]) {
        selected = { ...selected, ...rateEntry.tiers[speedTier] };
      }
      const isLongContext = Number(totalInputTokens) > LONG_CONTEXT_THRESHOLD_TOKENS;
      if (!rateEntry.customized && isLongContext) {
        const lc = selected.longContext || rateEntry.longContext;
        if (lc) {
          selected = { ...selected, ...lc };
        }
      }
      return normalizePricingConfig({
        ...selected,
        presetId: cleanModel,
        translatorCostPerRequest: store.pricing?.translatorCostPerRequest ?? 0,
        translatorPricePerMillion: store.pricing?.translatorPricePerMillion ?? 0
      });
    }
    return store.pricing;
  }

  recalculateTurns(store, { recalculatePastPeriods = false, targetModelId = null } = {}) {
    const todayPrefix = formatLocalDateKey(new Date());
    store.turns = (store.turns || []).map(turn => {
      const turnDay = turn.at ? formatLocalDateKey(turn.at) : todayPrefix;
      const isToday = !turnDay || turnDay === todayPrefix;
      if (!recalculatePastPeriods && !isToday) {
        return turn;
      }
      if (targetModelId && turn.model && turn.model !== targetModelId && store.autoDetectModel !== false) {
        return turn;
      }
      const turnPricing =
        store.autoDetectModel === false
          ? store.pricing
          : this.resolvePricingForTurn(store, turn.model, {
              totalInputTokens: (turn.inUncached || 0) + (turn.inCached || 0),
              speedTier: turn.speedTier || null
            });
      const recalc = calculateTurnEconomics({
        inUncached: turn.inUncached,
        inCached: turn.inCached,
        inCacheWrite: turn.inCacheWrite || 0,
        cacheWriteWindow: turn.cacheWriteWindow || '30m',
        nonTranslatedInTokens: turn.nonTranslatedInTokens || 0,
        outEn: turn.outEn,
        historyNativeTokens: turn.historyNativeTokens,
        historyEnTokens: turn.historyEnTokens,
        virtualOutTokens: turn.virtualOut,
        translatorTokens: turn.translatorTokens || 0,
        pricing: turnPricing
      });
      return {
        ...turn,
        appliedPricing: {
          priceInPerMillion: turnPricing.priceInPerMillion,
          priceCachedPerMillion: turnPricing.priceCachedPerMillion,
          cacheDiscountPercent: turnPricing.cacheDiscountPercent,
          priceCacheWrite30mPerMillion: turnPricing.priceCacheWrite30mPerMillion,
          priceCacheWrite12hPerMillion: turnPricing.priceCacheWrite12hPerMillion,
          priceOutPerMillion: turnPricing.priceOutPerMillion
        },
        ...recalc
      };
    });
    this.rebuildDailyAggregates(store);
  }

  saveStore(store) {
    if (Array.isArray(store.turns) && store.turns.length > 500) {
      store.turns = store.turns.slice(-500);
    }
    if (!this.filePath) {
      this._memStore = store;
      return store;
    }
    writeJSON(this.filePath, store);
    return store;
  }

  getPricing() {
    return this.loadStore().pricing;
  }

  setPricing(patch = {}) {
    const store = this.loadStore();
    if (typeof patch.autoDetectModel === 'boolean') {
      store.autoDetectModel = patch.autoDetectModel;
    } else if (patch.presetId === 'auto') {
      store.autoDetectModel = true;
    } else if (patch.presetId) {
      store.autoDetectModel = false;
    }

    const targetId =
      patch.presetId === 'auto'
        ? store.activeCodexModel || store.pricing.presetId || 'gpt-6.1-sol'
        : patch.presetId || patch.modelId || store.pricing.presetId || store.activeCodexModel || 'gpt-6.1-sol';

    const basePreset =
      store.modelRates?.[targetId] ||
      MODEL_TARIFF_PRESETS[targetId] ||
      inferDefaultModelRate(targetId);

    const isPresetSwitchOnly =
      patch.presetId &&
      patch.presetId !== 'custom' &&
      patch.priceInPerMillion === undefined &&
      patch.priceCachedPerMillion === undefined &&
      patch.cacheDiscountPercent === undefined &&
      patch.priceOutPerMillion === undefined;

    const merged = isPresetSwitchOnly
      ? {
          ...basePreset,
          presetId: targetId,
          translatorCostPerRequest:
            patch.translatorCostPerRequest ?? store.pricing.translatorCostPerRequest ?? 0,
          translatorPricePerMillion:
            patch.translatorPricePerMillion ?? store.pricing.translatorPricePerMillion ?? 0
        }
      : {
          ...store.pricing,
          ...patch,
          presetId: targetId
        };

    store.pricing = normalizePricingConfig(merged);

    // If editing a concrete model rate (not just 'custom'), also update store.modelRates[targetId]
    const modelToUpdate = patch.modelId || (targetId !== 'custom' && !isPresetSwitchOnly ? targetId : null);
    if (modelToUpdate) {
      store.modelRates ||= {};
      store.modelRates[modelToUpdate] = normalizeModelRate(modelToUpdate, {
        ...(store.modelRates[modelToUpdate] || {}),
        ...patch,
        priceInPerMillion: store.pricing.priceInPerMillion,
        priceCachedPerMillion: store.pricing.priceCachedPerMillion,
        cacheDiscountPercent: store.pricing.cacheDiscountPercent,
        priceOutPerMillion: store.pricing.priceOutPerMillion,
        customized: true
      });
    }

    this.recalculateTurns(store, {
      recalculatePastPeriods: patch.recalculatePastPeriods === true,
      targetModelId: modelToUpdate
    });
    this.saveStore(store);
    return store.pricing;
  }

  setModelRate(modelId, patch = {}) {
    const cleanId = String(modelId || '').trim();
    if (!cleanId) throw Error('Укажите ID модели для сохранения тарифа.');
    const store = this.loadStore();
    store.modelRates ||= {};
    const existing = store.modelRates[cleanId] || inferDefaultModelRate(cleanId);
    const updated = normalizeModelRate(cleanId, {
      ...existing,
      ...patch,
      customized: true
    });
    store.modelRates[cleanId] = updated;
    if (patch.translatorPricePerMillion !== undefined) {
      store.pricing.translatorPricePerMillion = Math.max(0, Number(patch.translatorPricePerMillion) || 0);
    }
    if (patch.translatorCostPerRequest !== undefined) {
      store.pricing.translatorCostPerRequest = Math.max(0, Number(patch.translatorCostPerRequest) || 0);
    }
    if (store.pricing.presetId === cleanId || (store.autoDetectModel && store.activeCodexModel === cleanId)) {
      store.pricing = normalizePricingConfig({
        ...updated,
        presetId: cleanId,
        translatorCostPerRequest: store.pricing.translatorCostPerRequest,
        translatorPricePerMillion: store.pricing.translatorPricePerMillion
      });
    }
    this.recalculateTurns(store, {
      recalculatePastPeriods: patch.recalculatePastPeriods === true,
      targetModelId: cleanId
    });
    this.saveStore(store);
    return updated;
  }

  resetModelRate(modelId) {
    const cleanId = String(modelId || '').trim();
    if (!cleanId) throw Error('Укажите ID модели для сброса тарифа.');
    const store = this.loadStore();
    store.modelRates ||= {};
    const prev = store.modelRates[cleanId] || {};
    const liveDefault = store.liveCatalog?.[cleanId];
    const baseDefault = liveDefault
      ? { ...inferDefaultModelRate(cleanId, prev.name, prev.description), ...liveDefault }
      : inferDefaultModelRate(cleanId, prev.name, prev.description);
    const fresh = normalizeModelRate(cleanId, baseDefault, prev);
    fresh.customized = false;
    store.modelRates[cleanId] = fresh;
    if (store.pricing.presetId === cleanId || (store.autoDetectModel && store.activeCodexModel === cleanId)) {
      store.pricing = normalizePricingConfig({
        ...fresh,
        presetId: cleanId,
        translatorCostPerRequest: store.pricing.translatorCostPerRequest,
        translatorPricePerMillion: store.pricing.translatorPricePerMillion
      });
    }
    this.recalculateTurns(store, {
      recalculatePastPeriods: false,
      targetModelId: cleanId
    });
    this.saveStore(store);
    return fresh;
  }

  rebuildDailyAggregates(store) {
    const daily = {};
    for (const t of store.turns || []) {
      const dayKey = formatLocalDateKey(t.at || new Date());
      const d = (daily[dayKey] ||= {
        date: dayKey,
        turnsCount: 0,
        inUncached: 0,
        inCached: 0,
        outEn: 0,
        virtualIn: 0,
        virtualOut: 0,
        savedTokens: 0,
        costActual: 0,
        costVirtual: 0,
        savedUsd: 0,
        cacheSavedUsd: 0
      });
      d.turnsCount += 1;
      d.inUncached += t.inUncached || 0;
      d.inCached += t.inCached || 0;
      d.outEn += t.outEn || 0;
      d.virtualIn += t.virtualIn || 0;
      d.virtualOut += t.virtualOut || 0;
      d.savedTokens += t.savedTokens || 0;
      d.costActual = Number((d.costActual + (t.costActual || 0)).toFixed(8));
      d.costVirtual = Number((d.costVirtual + (t.costVirtual || 0)).toFixed(8));
      d.savedUsd = Number((d.savedUsd + (t.savedUsd || 0)).toFixed(8));
      d.cacheSavedUsd = Number((d.cacheSavedUsd + (t.cacheSavedUsd || 0)).toFixed(8));
    }
    store.daily = daily;
  }

  /**
   * Builds parallel Native vs EN dialogue histories and computes local prefix-cache tokens
   * before or during a request turn.
   */
  prepareTurnContext({
    threadId = 'default',
    rawRequestBody = null,
    translatedRequestBody = null,
    translatorState = null
  } = {}) {
    const store = this.loadStore();
    const reqModel = translatedRequestBody?.model || rawRequestBody?.model || store.activeCodexModel || '';
    const encoding = resolveOpenAiEncoding(reqModel, store.pricing?.encoding || 'o200k_base');
    const rawInput = Array.isArray(rawRequestBody?.input) ? rawRequestBody.input : [];
    const enInput = Array.isArray(translatedRequestBody?.input) ? translatedRequestBody.input : rawInput;

    const threadTrans = translatorState?.threads?.[threadId]?.messages || {};
    const allTransMessages = Object.values(threadTrans);

    // Build lookup maps to recover native text for prior messages if needed
    const nativeByTranslated = new Map();
    for (const m of allTransMessages) {
      if (!m || !m.originalText || !m.translatedText) continue;
      if (m.kind === 'user') {
        // user message: originalText is Native, translatedText is EN
        nativeByTranslated.set(m.translatedText.trim(), m.originalText);
      } else if (m.kind === 'assistant') {
        // assistant message: originalText is EN, translatedText is Native
        nativeByTranslated.set(m.originalText.trim(), stripTranslationIndicators(m.translatedText));
      }
    }

    const enItems = [];
    const nativeItems = [];
    let dialogueEnTokens = 0;
    let dialogueNativeTokens = 0;
    let nonTranslatedEnTokens = 0;

    const count = Math.max(rawInput.length, enInput.length);
    for (let i = 0; i < count; i++) {
      const rawItem = rawInput[i] ?? enInput[i];
      const enItem = enInput[i] ?? rawItem;
      const role = enItem?.role || rawItem?.role || enItem?.type || 'user';
      const rawText = stripTranslationIndicators(extractMessageText(rawItem));
      const enText = stripTranslationIndicators(extractMessageText(enItem));

      // Determine virtual native text for this item
      let nativeText = rawText;
      if (role === 'user' && !isSystemContextText(rawText)) {
        if (rawText === enText && nativeByTranslated.has(enText.trim())) {
          nativeText = nativeByTranslated.get(enText.trim());
        }
      } else if (role === 'assistant') {
        if (rawText === enText && nativeByTranslated.has(enText.trim())) {
          nativeText = nativeByTranslated.get(enText.trim());
        }
      }

      const enTok = countTokens(enText, encoding);
      const natTok = countTokens(nativeText, encoding);

      const fingerprint = crypto
        .createHash('sha256')
        .update(`${role}:${enText}`)
        .digest('hex')
        .slice(0, 24);

      enItems.push({ role, text: enText, tokens: enTok, fingerprint });
      nativeItems.push({ role, text: nativeText, tokens: natTok });

      const isDialogueMessage =
        (role === 'user' || role === 'assistant') &&
        !['function_call', 'custom_tool_call', 'function_call_output', 'custom_tool_call_output'].includes(enItem?.type) &&
        !isSystemContextText(rawText);
      if (isDialogueMessage && (nativeText !== enText || natTok !== enTok)) {
        dialogueEnTokens += enTok;
        dialogueNativeTokens += natTok;
      } else if (!isDialogueMessage) {
        nonTranslatedEnTokens += enTok;
      }
    }

    // Include instructions if present
    const instrText = typeof translatedRequestBody?.instructions === 'string'
      ? translatedRequestBody.instructions
      : typeof rawRequestBody?.instructions === 'string'
        ? rawRequestBody.instructions
        : '';
    const instrTokens = instrText ? countTokens(instrText, encoding) : 0;
    nonTranslatedEnTokens += instrTokens;

    const fullEnTokens = instrTokens + enItems.reduce((acc, x) => acc + x.tokens, 0);
    const fullNativeTokens = instrTokens + nativeItems.reduce((acc, x) => acc + x.tokens, 0);

    // Local prefix-cache matching against previous request on this threadId
    const prevFingerprints =
      this.threadMemory.get(threadId)?.fingerprints ||
      store.threads?.[threadId]?.fingerprints ||
      [];

    let localCachedTokens = 0;
    let matchedPrefixLen = 0;
    if (prevFingerprints.length > 0) {
      localCachedTokens += instrTokens;
      const maxPrefix = Math.min(prevFingerprints.length, enItems.length);
      for (let i = 0; i < maxPrefix; i++) {
        if (prevFingerprints[i] === enItems[i].fingerprint) {
          localCachedTokens += enItems[i].tokens;
          matchedPrefixLen = i + 1;
        } else {
          break;
        }
      }
    }

    let currentTurnUserTransTokens = 0;
    for (let i = matchedPrefixLen; i < enItems.length; i++) {
      const eIt = enItems[i];
      const nIt = nativeItems[i];
      if (eIt.role === 'user' && nIt && eIt.text !== nIt.text) {
        currentTurnUserTransTokens += (nIt.tokens || 0) + (eIt.tokens || 0);
      }
    }

    // Use dialogue tokens for K_ratio when user/assistant natural language is present,
    // otherwise fall back to full history token counts
    const historyEnTokens = dialogueEnTokens > 0 ? dialogueEnTokens : Math.max(1, fullEnTokens);
    const historyNativeTokens = dialogueNativeTokens > 0 ? dialogueNativeTokens : Math.max(historyEnTokens, fullNativeTokens);

    return {
      threadId,
      encoding,
      enItems,
      nativeItems,
      fullEnTokens,
      fullNativeTokens,
      historyEnTokens,
      historyNativeTokens,
      nonTranslatedInTokens: nonTranslatedEnTokens,
      currentTurnUserTransTokens,
      localCachedTokens,
      fingerprints: enItems.map(x => x.fingerprint)
    };
  }

  noteActiveCodexRequest({ model = '', reasoningEffort = '', serviceTier = '' } = {}) {
    const store = this.loadStore();
    let changed = false;
    const cleanModel = String(model || '').trim();
    if (cleanModel && cleanModel !== 'codex-auto-review' && cleanModel !== 'custom') {
      if (!store.modelRates?.[cleanModel]) {
        store.modelRates ||= {};
        store.modelRates[cleanModel] = normalizeModelRate(cleanModel, {});
        changed = true;
      }
      if (store.activeCodexModel !== cleanModel) {
        store.activeCodexModel = cleanModel;
        changed = true;
      }
      if (store.autoDetectModel !== false) {
        store.pricing = this.resolvePricingForTurn(store, cleanModel);
        changed = true;
      }
    }
    const cleanEffort = String(reasoningEffort || '').trim();
    if (cleanEffort && store.codexReasoningEffort !== cleanEffort) {
      store.codexReasoningEffort = cleanEffort;
      changed = true;
    }
    const cleanTier = String(serviceTier || '').trim();
    if (cleanTier && store.codexServiceTier !== cleanTier) {
      store.codexServiceTier = cleanTier;
      changed = true;
    }
    if (changed) {
      this.saveStore(store);
    }
  }

  resolveEffectiveRequestSettings({ threadId = 'default', model = '', reasoningEffort = '', serviceTier = '' } = {}) {
    const store = this.loadStore();
    const cleanModel = String(model || store.activeCodexModel || '').trim();
    const incomingEffort = String(reasoningEffort || '').trim();
    const threadRec = store.threads?.[threadId] || {};
    const prevSentEffort = threadRec.lastSentEffort || null;
    const prevSentAtMs = Number(threadRec.lastSentAtMs || 0);
    const configChangedAfterLastSend =
      Number(store.lastConfigChangedAtMs || 0) > prevSentAtMs &&
      !!store.codexReasoningEffort;

    let effectiveEffort = incomingEffort;
    if (!incomingEffort) {
      effectiveEffort = store.codexReasoningEffort || '';
    } else if (prevSentEffort && incomingEffort === prevSentEffort && configChangedAfterLastSend) {
      effectiveEffort = store.codexReasoningEffort;
    }

    store.threads ||= {};
    store.threads[threadId] = {
      ...threadRec,
      lastSentEffort: incomingEffort || effectiveEffort || null,
      lastSentAtMs: Date.now()
    };
    this.saveStore(store);
    this.noteActiveCodexRequest({
      model: cleanModel,
      reasoningEffort: effectiveEffort,
      serviceTier
    });
    return {
      model: cleanModel,
      reasoningEffort: effectiveEffort
    };
  }

  /**
   * Records a completed turn in the economics engine and persists the updated state.
   */
  recordTurn({
    threadId = 'default',
    model = '',
    reasoningEffort = '',
    translatorModel = '',
    turnContext = null,
    apiUsage = null,
    replyEnText = '',
    replyNativeText = '',
    translatorTokens = 0,
    at = new Date().toISOString()
  } = {}) {
    const store = this.loadStore();
    const effectiveModelForEncoding = String(model || store.activeCodexModel || store.pricing?.presetId || 'gpt-6.1-sol').trim();
    const encoding = resolveOpenAiEncoding(effectiveModelForEncoding, turnContext?.encoding || store.pricing?.encoding || 'o200k_base');
    const ctx =
      turnContext ||
      this.prepareTurnContext({
        threadId,
        rawRequestBody: { input: [] },
        translatedRequestBody: { input: [] }
      });

    const parsedUsage = parseApiUsage(apiUsage);
    const cleanReplyEn = stripTranslationIndicators(String(replyEnText || ''));
    const cleanReplyNative = stripTranslationIndicators(String(replyNativeText || cleanReplyEn));

    const localOutEn = countTokens(cleanReplyEn, encoding);
    const localOutNative = countTokens(cleanReplyNative, encoding);

    // Time-window binding per thread (30m default cache TTL vs 12h extended cache TTL)
    const turnNowMs = Date.parse(at) || Date.now();
    const prevThreadRec = store.threads?.[threadId] || {};
    const prevTurnAtMs = Number(prevThreadRec.lastTurnAtMs || (prevThreadRec.updatedAt ? Date.parse(prevThreadRec.updatedAt) : 0) || 0);
    const elapsedMs = prevTurnAtMs > 0 ? Math.max(0, turnNowMs - prevTurnAtMs) : 0;
    const THIRTY_MIN_MS = 30 * 60 * 1000;
    const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

    let cacheWriteWindow = parsedUsage.cacheWriteTtl || ctx.cacheWriteWindow || prevThreadRec.cacheWindow || '30m';
    let cacheExpiredByTime = false;
    if (prevTurnAtMs > 0) {
      if (elapsedMs > TWELVE_HOURS_MS) {
        cacheExpiredByTime = true;
      } else if (elapsedMs > THIRTY_MIN_MS) {
        if (parsedUsage.hasApiCache && parsedUsage.inCached > 0) {
          // API confirmed cache hit across >30m gap -> thread is bound to 12h cache retention
          cacheWriteWindow = '12h';
        } else if (cacheWriteWindow !== '12h') {
          // Standard 30m cache expired after 30 minutes
          cacheExpiredByTime = true;
        }
      }
    }

    let inCached = 0;
    let inUncached = 0;
    let outEn = parsedUsage.outEn > 0 ? parsedUsage.outEn : localOutEn;
    const reasoningOutTokens = Math.min(outEn, parsedUsage.reasoningTokens || 0);
    const translatableExtraOut = Math.max(0, outEn - localOutEn - reasoningOutTokens);
    const outRatio =
      localOutEn > 0 && localOutNative > 0
        ? localOutNative / localOutEn
        : localOutEn === 0 && translatableExtraOut === 0
          ? 1.0
          : ctx.historyEnTokens > 0 && ctx.historyNativeTokens > 0
          ? ctx.historyNativeTokens / ctx.historyEnTokens
          : 1.0;
    const virtualOutTokens = localOutNative + reasoningOutTokens + Math.round(translatableExtraOut * outRatio);
    let cacheSource = 'api';

    if (parsedUsage.hasApiUsage && parsedUsage.totalIn > 0) {
      if (parsedUsage.hasApiCache) {
        inCached = parsedUsage.inCached;
        inUncached = parsedUsage.inUncached;
        cacheSource = 'api';
      } else {
        // API returned prompt_tokens/input_tokens but omitted cached_tokens -> use local prefix detection
        const effectiveLocalCached = cacheExpiredByTime ? 0 : ctx.localCachedTokens || 0;
        inCached = Math.min(parsedUsage.totalIn, effectiveLocalCached);
        inUncached = Math.max(0, parsedUsage.totalIn - inCached);
        cacheSource = 'local_prefix';
      }
    } else {
      // No API usage returned -> calculate both input and cache locally
      const totalLocalIn = Math.max(ctx.fullEnTokens || 0, ctx.historyEnTokens || 0);
      const effectiveLocalCached = cacheExpiredByTime ? 0 : ctx.localCachedTokens || 0;
      inCached = Math.min(totalLocalIn, effectiveLocalCached);
      inUncached = Math.max(0, totalLocalIn - inCached);
      cacheSource = 'local_prefix';
    }
    const inCacheWrite = Math.min(
      inUncached,
      Math.max(0, Number(parsedUsage.inCacheWrite || ctx.inCacheWrite || 0))
    );

    // Append current assistant reply fingerprint so the next turn can match it in the prefix cache
    const nextFingerprints = [...(ctx.fingerprints || [])];
    if (cleanReplyEn) {
      const replyFp = crypto
        .createHash('sha256')
        .update(`assistant:${cleanReplyEn}`)
        .digest('hex')
        .slice(0, 24);
      nextFingerprints.push(replyFp);
    }
    this.threadMemory.set(threadId, { fingerprints: nextFingerprints });
    store.threads ||= {};
    store.threads[threadId] = {
      ...(store.threads[threadId] || {}),
      fingerprints: nextFingerprints.slice(-120),
      cacheWindow: cacheWriteWindow,
      lastTurnAtMs: turnNowMs,
      updatedAt: at
    };

    const totalTurnInTokens = inUncached + inCached;
    const contextLengthTier = totalTurnInTokens > LONG_CONTEXT_THRESHOLD_TOKENS ? 'long' : 'short';
    const effectiveModelId = String(model || store.activeCodexModel || store.pricing?.presetId || 'gpt-6.1-sol').trim();
    if (effectiveModelId && effectiveModelId !== 'custom') {
      store.modelRates ||= {};
      if (!store.modelRates[effectiveModelId]) {
        store.modelRates[effectiveModelId] = normalizeModelRate(effectiveModelId, {});
      }
      if (model) {
        store.activeCodexModel = effectiveModelId;
      }
      if (store.autoDetectModel !== false) {
        store.pricing = this.resolvePricingForTurn(store, effectiveModelId);
      }
    }
    const cleanEffort = String(reasoningEffort || store.codexReasoningEffort || '').trim();
    if (cleanEffort && effectiveModelId !== 'codex-auto-review') {
      store.codexReasoningEffort = cleanEffort;
    }
    const turnPricing =
      store.autoDetectModel === false
        ? store.pricing
        : this.resolvePricingForTurn(store, effectiveModelId, {
            totalInputTokens: totalTurnInTokens
          });

    const metrics = calculateTurnEconomics({
      inUncached,
      inCached,
      inCacheWrite,
      cacheWriteWindow,
      nonTranslatedInTokens: ctx.nonTranslatedInTokens || 0,
      outEn,
      historyNativeTokens: ctx.historyNativeTokens,
      historyEnTokens: ctx.historyEnTokens,
      virtualOutTokens,
      translatorTokens,
      pricing: turnPricing
    });

    const stepNumber = (store.turns?.length || 0) + 1;
    const turnRecord = {
      id: crypto.randomUUID(),
      step: stepNumber,
      threadId,
      model: effectiveModelId,
      reasoningEffort: cleanEffort || null,
      translatorModel: translatorModel || '',
      cacheSource,
      contextLengthTier,
      elapsedSincePrevTurnMs: elapsedMs,
      nonTranslatedInTokens: ctx.nonTranslatedInTokens || 0,
      at,
      appliedPricing: {
        priceInPerMillion: turnPricing.priceInPerMillion,
        priceCachedPerMillion: turnPricing.priceCachedPerMillion,
        cacheDiscountPercent: turnPricing.cacheDiscountPercent,
        priceCacheWrite30mPerMillion: turnPricing.priceCacheWrite30mPerMillion,
        priceCacheWrite12hPerMillion: turnPricing.priceCacheWrite12hPerMillion,
        priceOutPerMillion: turnPricing.priceOutPerMillion
      },
      ...metrics
    };

    store.turns.push(turnRecord);
    this.rebuildDailyAggregates(store);
    this.saveStore(store);
    return turnRecord;
  }

  resetSession() {
    const store = this.loadStore();
    store.turns = [];
    store.daily = {};
    store.threads = {};
    store.sessionStartedAt = new Date().toISOString();
    this.threadMemory.clear();
    this.saveStore(store);
    return this.getDashboardData();
  }

  aggregateTurnsSubset(turns = [], store = null) {
    const activeStore = store || this.loadStore();
    let totalInUncached = 0;
    let totalInCached = 0;
    let totalInCacheWrite = 0;
    let totalOutEn = 0;
    let totalVirtualIn = 0;
    let totalVirtualOut = 0;
    let totalVirtualCached = 0;
    let totalVirtualUncached = 0;
    let totalInputSavedTokens = 0;
    let totalUncachedInputSavedTokens = 0;
    let totalCachedInputSavedTokens = 0;
    let totalOutputSavedTokens = 0;
    let totalSavedTokens = 0;
    let totalActualUncachedCost = 0;
    let totalActualCachedCost = 0;
    let totalActualCacheWriteCost = 0;
    let totalWrite30mCost = 0;
    let totalWrite12hCost = 0;
    let totalActualInNoCacheCost = 0;
    let totalActualOutCost = 0;
    let totalModelCost = 0;
    let totalModelNoCacheCost = 0;
    let totalTranslatorCost = 0;
    let totalActualCost = 0;
    let totalActualNoCacheCost = 0;
    let totalVirtualUncachedCost = 0;
    let totalVirtualCachedCost = 0;
    let totalVirtualInNoCacheCost = 0;
    let totalVirtualOutCost = 0;
    let totalVirtualCost = 0;
    let totalVirtualNoCacheCost = 0;
    let totalSavedUsd = 0;
    let totalSavedNoCacheUsd = 0;
    let totalSavedVsRawNoCacheUsd = 0;
    let totalCacheSavedUsd = 0;
    let totalVirtualCacheSavedUsd = 0;

    const modelMap = new Map();
    const series = [];

    for (let i = 0; i < turns.length; i++) {
      const t = turns[i];
      const inUnc = t.inUncached || 0;
      const inCac = t.inCached || 0;
      const inWrt = t.inCacheWrite || 0;
      const outE = t.outEn || 0;
      const vIn = t.virtualIn || 0;
      const vOut = t.virtualOut || 0;
      const vCac = t.virtualCached || 0;
      const vUnc = t.virtualUncached || 0;
      const inSaved = t.inputSavedTokens || 0;
      const outSaved = t.outputSavedTokens || 0;
      const tokSaved = t.savedTokens || 0;

      totalInUncached += inUnc;
      totalInCached += inCac;
      totalInCacheWrite += inWrt;
      totalOutEn += outE;
      totalVirtualIn += vIn;
      totalVirtualOut += vOut;
      totalVirtualCached += vCac;
      totalVirtualUncached += vUnc;
      totalInputSavedTokens += inSaved;
      totalUncachedInputSavedTokens += vUnc - inUnc;
      totalCachedInputSavedTokens += vCac - inCac;
      totalOutputSavedTokens += outSaved;
      totalSavedTokens += tokSaved;
      totalActualUncachedCost += t.actualUncachedCost || 0;
      totalActualCachedCost += t.actualCachedCost || 0;
      totalActualCacheWriteCost += t.actualCacheWriteCost || 0;
      totalWrite30mCost += t.costWrite30mUsd || 0;
      totalWrite12hCost += t.costWrite12hUsd || 0;
      totalActualInNoCacheCost += t.actualInNoCacheCost || 0;
      totalActualOutCost += t.actualOutCost || 0;
      totalModelCost += t.modelActualCost || 0;
      totalModelNoCacheCost += t.modelActualNoCacheCost || 0;
      totalTranslatorCost += t.translationCost || 0;
      totalActualCost += t.costActual || 0;
      totalActualNoCacheCost += t.costActualNoCache || 0;
      totalVirtualUncachedCost += t.virtualUncachedCost || 0;
      totalVirtualCachedCost += t.virtualCachedCost || 0;
      totalVirtualInNoCacheCost += t.virtualInNoCacheCost || 0;
      totalVirtualOutCost += t.virtualOutCost || 0;
      totalVirtualCost += t.costVirtual || 0;
      totalVirtualNoCacheCost += t.costVirtualNoCache || 0;
      totalSavedUsd += t.savedUsd || 0;
      totalSavedNoCacheUsd += t.savedNoCacheUsd || 0;
      totalSavedVsRawNoCacheUsd += t.totalSavedVsRawNoCacheUsd || 0;
      totalCacheSavedUsd += t.cacheSavedUsd || 0;
      totalVirtualCacheSavedUsd += t.virtualCacheSavedUsd || 0;

      series.push({
        step: i + 1,
        at: t.at,
        cumulativeActualUsd: Number(totalActualCost.toFixed(6)),
        cumulativeVirtualUsd: Number(totalVirtualCost.toFixed(6)),
        cumulativeVirtualNoCacheUsd: Number(totalVirtualNoCacheCost.toFixed(6)),
        cumulativeActualNoCacheUsd: Number(totalActualNoCacheCost.toFixed(6)),
        turnActualUsd: Number((t.costActual || 0).toFixed(6)),
        turnVirtualUsd: Number((t.costVirtual || 0).toFixed(6))
      });

      const mId = String(t.model || activeStore.activeCodexModel || 'gpt-6.1-sol').trim();
      let mAgg = modelMap.get(mId);
      if (!mAgg) {
        const rateInfo = activeStore.modelRates?.[mId] || normalizeModelRate(mId, {});
        mAgg = {
          model: mId,
          name: rateInfo.name || mId,
          pricing: {
            priceInPerMillion: rateInfo.priceInPerMillion,
            priceCachedPerMillion: rateInfo.priceCachedPerMillion,
            cacheDiscountPercent: rateInfo.cacheDiscountPercent,
            priceCacheWrite30mPerMillion: rateInfo.priceCacheWrite30mPerMillion,
            priceCacheWrite12hPerMillion: rateInfo.priceCacheWrite12hPerMillion,
            priceOutPerMillion: rateInfo.priceOutPerMillion
          },
          turnsCount: 0,
          inUncached: 0,
          inCached: 0,
          inCacheWrite: 0,
          actualInTotal: 0,
          outEn: 0,
          totalActualTokens: 0,
          virtualUncached: 0,
          virtualCached: 0,
          virtualIn: 0,
          virtualOut: 0,
          totalVirtualTokens: 0,
          inputSavedTokens: 0,
          outputSavedTokens: 0,
          savedTokens: 0,
          cacheSavedUsd: 0,
          virtualCacheSavedUsd: 0,
          costActualUsd: 0,
          costActualNoCacheUsd: 0,
          translatorCostUsd: 0,
          costVirtualUsd: 0,
          costVirtualNoCacheUsd: 0,
          savedUsd: 0,
          savedNoCacheUsd: 0,
          totalSavedVsRawNoCacheUsd: 0
        };
        modelMap.set(mId, mAgg);
      }
      mAgg.turnsCount += 1;
      mAgg.inUncached += inUnc;
      mAgg.inCached += inCac;
      mAgg.inCacheWrite += inWrt;
      mAgg.actualInTotal += inUnc + inCac;
      mAgg.outEn += outE;
      mAgg.totalActualTokens += inUnc + inCac + outE;
      mAgg.virtualUncached += vUnc;
      mAgg.virtualCached += vCac;
      mAgg.virtualIn += vIn;
      mAgg.virtualOut += vOut;
      mAgg.totalVirtualTokens += vIn + vOut;
      mAgg.inputSavedTokens += inSaved;
      mAgg.outputSavedTokens += outSaved;
      mAgg.savedTokens += tokSaved;
      mAgg.cacheSavedUsd += t.cacheSavedUsd || 0;
      mAgg.virtualCacheSavedUsd += t.virtualCacheSavedUsd || 0;
      mAgg.costActualUsd += t.costActual || 0;
      mAgg.costActualNoCacheUsd += t.costActualNoCache || 0;
      mAgg.translatorCostUsd += t.translationCost || 0;
      mAgg.costVirtualUsd += t.costVirtual || 0;
      mAgg.costVirtualNoCacheUsd += t.costVirtualNoCache || 0;
      mAgg.savedUsd += t.savedUsd || 0;
      mAgg.savedNoCacheUsd += t.savedNoCacheUsd || 0;
      mAgg.totalSavedVsRawNoCacheUsd += t.totalSavedVsRawNoCacheUsd || 0;
    }

    const byModel = [...modelMap.values()]
      .map(m => {
        const cacheHitRatePercent = m.actualInTotal > 0 ? (m.inCached / m.actualInTotal) * 100 : 0;
        const avgKRatio = m.totalActualTokens > 0 ? m.totalVirtualTokens / m.totalActualTokens : 1.0;
        const savingsPercent = m.costVirtualUsd > 0 ? (m.savedUsd / m.costVirtualUsd) * 100 : 0;
        const totalSavingsVsRawPercent =
          m.costVirtualNoCacheUsd > 0 ? (m.totalSavedVsRawNoCacheUsd / m.costVirtualNoCacheUsd) * 100 : 0;
        return {
          ...m,
          avgKRatio: Number(avgKRatio.toFixed(2)),
          cacheHitRatePercent: Number(cacheHitRatePercent.toFixed(2)),
          cacheSavedUsd: Number(m.cacheSavedUsd.toFixed(6)),
          virtualCacheSavedUsd: Number(m.virtualCacheSavedUsd.toFixed(6)),
          costActualUsd: Number(m.costActualUsd.toFixed(6)),
          costActualNoCacheUsd: Number(m.costActualNoCacheUsd.toFixed(6)),
          translatorCostUsd: Number(m.translatorCostUsd.toFixed(6)),
          costVirtualUsd: Number(m.costVirtualUsd.toFixed(6)),
          costVirtualNoCacheUsd: Number(m.costVirtualNoCacheUsd.toFixed(6)),
          savedUsd: Number(m.savedUsd.toFixed(6)),
          savingsPercent: Number(savingsPercent.toFixed(2)),
          savedNoCacheUsd: Number(m.savedNoCacheUsd.toFixed(6)),
          totalSavedVsRawNoCacheUsd: Number(m.totalSavedVsRawNoCacheUsd.toFixed(6)),
          totalSavingsVsRawPercent: Number(totalSavingsVsRawPercent.toFixed(2))
        };
      })
      .sort((a, b) => b.totalActualTokens - a.totalActualTokens || b.turnsCount - a.turnsCount);

    const totalActualIn = totalInUncached + totalInCached;
    const totalActualTokens = totalActualIn + totalOutEn;
    const totalVirtualTokens = totalVirtualIn + totalVirtualOut;
    const netSavingsPercent = totalVirtualCost > 0 ? (totalSavedUsd / totalVirtualCost) * 100 : 0;
    const noCacheSavingsPercent = totalVirtualNoCacheCost > 0 ? (totalSavedNoCacheUsd / totalVirtualNoCacheCost) * 100 : 0;
    const totalVsRawNoCachePercent = totalVirtualNoCacheCost > 0 ? (totalSavedVsRawNoCacheUsd / totalVirtualNoCacheCost) * 100 : 0;
    const cacheHitRate = totalActualIn > 0 ? (totalInCached / totalActualIn) * 100 : 0;
    const virtualCacheHitRate = totalVirtualIn > 0 ? (totalVirtualCached / totalVirtualIn) * 100 : 0;

    const cutOffInputTokens = Math.max(0, totalInputSavedTokens);
    const barDenom = Math.max(1, totalInCached + totalInUncached + cutOffInputTokens);
    const inputStructure = {
      cachedTokens: totalInCached,
      uncachedEnTokens: totalInUncached,
      cutOffByTranslationTokens: cutOffInputTokens,
      cachedPercent: Number(((totalInCached / barDenom) * 100).toFixed(2)),
      uncachedEnPercent: Number(((totalInUncached / barDenom) * 100).toFixed(2)),
      cutOffPercent: Number(((cutOffInputTokens / barDenom) * 100).toFixed(2))
    };

    const blocks = {
      withoutTranslationNoCache: {
        title: '1. Без перевода · Без кэширования',
        subtitle: 'Родной язык (Native) · 100% полный тариф Input',
        inputTokens: totalVirtualIn,
        uncachedInputTokens: totalVirtualIn,
        cachedInputTokens: 0,
        outputTokens: totalVirtualOut,
        totalTokens: totalVirtualTokens,
        inputCostUsd: Number(totalVirtualInNoCacheCost.toFixed(6)),
        outputCostUsd: Number(totalVirtualOutCost.toFixed(6)),
        cacheSavedUsd: 0,
        translatorCostUsd: 0,
        totalCostUsd: Number(totalVirtualNoCacheCost.toFixed(6))
      },
      withoutTranslationWithCache: {
        title: '2. Без перевода · С кэшированием',
        subtitle: 'Родной язык (Native) · с учётом скидки Prompt Caching',
        inputTokens: totalVirtualIn,
        uncachedInputTokens: totalVirtualUncached,
        cachedInputTokens: totalVirtualCached,
        outputTokens: totalVirtualOut,
        totalTokens: totalVirtualTokens,
        uncachedInputCostUsd: Number(totalVirtualUncachedCost.toFixed(6)),
        cachedInputCostUsd: Number(totalVirtualCachedCost.toFixed(6)),
        inputCostUsd: Number((totalVirtualUncachedCost + totalVirtualCachedCost).toFixed(6)),
        outputCostUsd: Number(totalVirtualOutCost.toFixed(6)),
        cacheHitRatePercent: Number(virtualCacheHitRate.toFixed(2)),
        cacheSavedUsd: Number(totalVirtualCacheSavedUsd.toFixed(6)),
        translatorCostUsd: 0,
        totalCostUsd: Number(totalVirtualCost.toFixed(6))
      },
      withTranslationNoCache: {
        title: '3. С переводом (EN) · Без кэширования',
        subtitle: 'Перевод на английский · без скидки кэша',
        inputTokens: totalActualIn,
        uncachedInputTokens: totalActualIn,
        cachedInputTokens: 0,
        outputTokens: totalOutEn,
        totalTokens: totalActualTokens,
        inputCostUsd: Number(totalActualInNoCacheCost.toFixed(6)),
        outputCostUsd: Number(totalActualOutCost.toFixed(6)),
        modelCostUsd: Number(totalModelNoCacheCost.toFixed(6)),
        translatorCostUsd: Number(totalTranslatorCost.toFixed(6)),
        cacheSavedUsd: 0,
        savedVsNativeNoCacheUsd: Number(totalSavedNoCacheUsd.toFixed(6)),
        savedVsNativeNoCachePercent: Number(noCacheSavingsPercent.toFixed(2)),
        totalCostUsd: Number(totalActualNoCacheCost.toFixed(6))
      },
      withTranslationWithCache: {
        title: '4. С переводом (EN) · С кэшированием (ФАКТ)',
        subtitle: 'Реальный расход: EN-перевод + Prompt Caching',
        inputTokens: totalActualIn,
        uncachedInputTokens: totalInUncached,
        cachedInputTokens: totalInCached,
        outputTokens: totalOutEn,
        totalTokens: totalActualTokens,
        uncachedInputCostUsd: Number(totalActualUncachedCost.toFixed(6)),
        cachedInputCostUsd: Number(totalActualCachedCost.toFixed(6)),
        inputCostUsd: Number((totalActualUncachedCost + totalActualCachedCost).toFixed(6)),
        outputCostUsd: Number(totalActualOutCost.toFixed(6)),
        modelCostUsd: Number(totalModelCost.toFixed(6)),
        translatorCostUsd: Number(totalTranslatorCost.toFixed(6)),
        cacheHitRatePercent: Number(cacheHitRate.toFixed(2)),
        cacheSavedUsd: Number(totalCacheSavedUsd.toFixed(6)),
        totalCostUsd: Number(totalActualCost.toFixed(6))
      },
      consolidatedSummary: {
        withoutTranslation: {
          uncachedInputTokens: totalVirtualUncached,
          uncachedInputCostUsd: Number(totalVirtualUncachedCost.toFixed(6)),
          cachedInputTokens: totalVirtualCached,
          cachedInputCostUsd: Number(totalVirtualCachedCost.toFixed(6)),
          totalInputTokens: totalVirtualIn,
          totalInputCostWithCacheUsd: Number((totalVirtualUncachedCost + totalVirtualCachedCost).toFixed(6)),
          totalInputCostNoCacheUsd: Number(totalVirtualInNoCacheCost.toFixed(6)),
          outputTokens: totalVirtualOut,
          outputCostUsd: Number(totalVirtualOutCost.toFixed(6)),
          totalTokens: totalVirtualTokens,
          translatorCostUsd: 0,
          costNoCacheUsd: Number(totalVirtualNoCacheCost.toFixed(6)),
          cacheSavingsUsd: Number(totalVirtualCacheSavedUsd.toFixed(6)),
          finalTotalCostUsd: Number(totalVirtualCost.toFixed(6))
        },
        withTranslation: {
          uncachedInputTokens: totalInUncached,
          uncachedInputCostUsd: Number(totalActualUncachedCost.toFixed(6)),
          cachedInputTokens: totalInCached,
          cachedInputCostUsd: Number(totalActualCachedCost.toFixed(6)),
          totalInputTokens: totalActualIn,
          totalInputCostWithCacheUsd: Number((totalActualUncachedCost + totalActualCachedCost).toFixed(6)),
          totalInputCostNoCacheUsd: Number(totalActualInNoCacheCost.toFixed(6)),
          outputTokens: totalOutEn,
          outputCostUsd: Number(totalActualOutCost.toFixed(6)),
          totalTokens: totalActualTokens,
          translatorCostUsd: Number(totalTranslatorCost.toFixed(6)),
          costNoCacheUsd: Number(totalActualNoCacheCost.toFixed(6)),
          cacheSavingsUsd: Number(totalCacheSavedUsd.toFixed(6)),
          finalTotalCostUsd: Number(totalActualCost.toFixed(6))
        },
        delta: {
          uncachedInputTokensSaved: totalUncachedInputSavedTokens,
          uncachedInputCostSavedUsd: Number((totalVirtualUncachedCost - totalActualUncachedCost).toFixed(6)),
          cachedInputTokensSaved: totalCachedInputSavedTokens,
          cachedInputCostSavedUsd: Number((totalVirtualCachedCost - totalActualCachedCost).toFixed(6)),
          totalInputTokensSaved: totalInputSavedTokens,
          totalInputCostSavedUsd: Number(
            (totalVirtualUncachedCost + totalVirtualCachedCost - (totalActualUncachedCost + totalActualCachedCost)).toFixed(6)
          ),
          outputTokensSaved: totalOutputSavedTokens,
          outputCostSavedUsd: Number((totalVirtualOutCost - totalActualOutCost).toFixed(6)),
          totalTokensSaved: totalSavedTokens,
          translationOnlySavedNoCacheUsd: Number(totalSavedNoCacheUsd.toFixed(6)),
          translationOnlySavedNoCachePercent: Number(noCacheSavingsPercent.toFixed(2)),
          netSavedWithCacheUsd: Number(totalSavedUsd.toFixed(6)),
          netSavedWithCachePercent: Number(netSavingsPercent.toFixed(2)),
          totalSavedVsNoCacheBaselineUsd: Number(totalSavedVsRawNoCacheUsd.toFixed(6)),
          totalSavedVsNoCacheBaselinePercent: Number(totalVsRawNoCachePercent.toFixed(2))
        }
      }
    };

    return {
      kpi: {
        totalSpentUsd: Number(totalActualCost.toFixed(6)),
        modelSpentUsd: Number(totalModelCost.toFixed(6)),
        translatorSpentUsd: Number(totalTranslatorCost.toFixed(6)),
        virtualTotalUsd: Number(totalVirtualCost.toFixed(6)),
        virtualNoCacheTotalUsd: Number(totalVirtualNoCacheCost.toFixed(6)),
        actualNoCacheTotalUsd: Number(totalActualNoCacheCost.toFixed(6)),
        netSavedUsd: Number(totalSavedUsd.toFixed(6)),
        netSavingsPercent: Number(netSavingsPercent.toFixed(2)),
        savedNoCacheUsd: Number(totalSavedNoCacheUsd.toFixed(6)),
        savedVsRawNoCacheUsd: Number(totalSavedVsRawNoCacheUsd.toFixed(6)),
        savedVsRawNoCachePercent: Number(totalVsRawNoCachePercent.toFixed(2)),
        tokensSavedTotal: totalSavedTokens,
        inputSavedTokens: totalInputSavedTokens,
        outputSavedTokens: totalOutputSavedTokens,
        cacheHitRatePercent: Number(cacheHitRate.toFixed(2)),
        cacheSavedUsd: Number(totalCacheSavedUsd.toFixed(6)),
        virtualCacheSavedUsd: Number(totalVirtualCacheSavedUsd.toFixed(6)),
        totalInCached,
        totalInUncached,
        totalInCacheWrite,
        totalCacheWriteCostUsd: Number(totalActualCacheWriteCost.toFixed(6)),
        totalWrite30mCostUsd: Number(totalWrite30mCost.toFixed(6)),
        totalWrite12hCostUsd: Number(totalWrite12hCost.toFixed(6)),
        totalActualIn,
        totalOutEn,
        totalActualTokens,
        totalVirtualIn,
        totalVirtualOut,
        totalVirtualTokens,
        turnsCount: turns.length
      },
      byModel,
      blocks,
      inputStructure,
      series,
      recentTurns: turns.slice(-100).reverse()
    };
  }

  getDashboardData() {
    const store = this.loadStore();
    const turns = store.turns || [];
    const modelRatesList = Object.values(store.modelRates || {});

    // Compute period breakdowns: Today, Week (7 days), Month (30 days), and All Time
    const nowMs = Date.now();
    const latestTurnMs = turns.length > 0 ? Date.parse(turns[turns.length - 1]?.at || '') || nowMs : nowMs;
    const refMs = Math.max(nowMs, latestTurnMs);
    const refDayPrefix = formatLocalDateKey(new Date(refMs));
    const weekCutoffMs = refMs - 7 * 24 * 60 * 60 * 1000;
    const monthCutoffMs = refMs - 30 * 24 * 60 * 60 * 1000;

    const todayTurns = turns.filter(t => formatLocalDateKey(t.at || refMs) === refDayPrefix);
    const weekTurns = turns.filter(t => {
      const ms = Date.parse(t.at || '');
      return Number.isFinite(ms) ? ms >= weekCutoffMs : true;
    });
    const monthTurns = turns.filter(t => {
      const ms = Date.parse(t.at || '');
      return Number.isFinite(ms) ? ms >= monthCutoffMs : true;
    });

    const periodToday = this.aggregateTurnsSubset(todayTurns, store);
    const periodWeek = this.aggregateTurnsSubset(weekTurns, store);
    const periodMonth = this.aggregateTurnsSubset(monthTurns, store);
    const periodAll = this.aggregateTurnsSubset(turns, store);

    return {
      version: 1,
      sessionStartedAt: store.sessionStartedAt,
      autoDetectModel: store.autoDetectModel !== false,
      activeCodexModel: store.activeCodexModel || store.pricing?.presetId || 'gpt-6.1-sol',
      codexReasoningEffort: store.codexReasoningEffort || null,
      codexServiceTier: store.codexServiceTier || 'default',
      pricingSyncedAt: store.pricingSyncedAt || null,
      nextPricingSyncAt: store.nextPricingSyncAt || null,
      pricingSyncStatus: store.pricingSyncStatus || 'preset_default',
      pricingModelsSyncedCount: store.pricingModelsSyncedCount || 0,
      pricing: store.pricing,
      modelRates: modelRatesList,
      presets: Object.values(MODEL_TARIFF_PRESETS),
      byModel: periodAll.byModel,
      periods: {
        today: { key: 'today', label: `Сегодня (${refDayPrefix})`, ...periodToday },
        week: { key: 'week', label: 'За неделю (7 дней)', ...periodWeek },
        month: { key: 'month', label: 'За месяц (30 дней)', ...periodMonth },
        all: { key: 'all', label: 'За всё время', ...periodAll }
      },
      blocks: periodAll.blocks,
      kpi: periodAll.kpi,
      inputStructure: periodAll.inputStructure,
      series: periodAll.series,
      recentTurns: periodAll.recentTurns,
      daily: Object.values(store.daily || {}).sort((a, b) => b.date.localeCompare(a.date))
    };
  }

  exportData(format = 'json') {
    const data = this.getDashboardData();
    if (String(format).toLowerCase() === 'csv') {
      const headers = [
        'step',
        'at',
        'threadId',
        'model',
        'inCached',
        'inUncached',
        'outEn',
        'kRatio',
        'virtualCached',
        'virtualUncached',
        'virtualOut',
        'savedTokens',
        'costActualUsd',
        'costVirtualUsd',
        'savedUsd',
        'cacheSavedUsd'
      ];
      const escapeCsv = val => {
        const s = String(val ?? '');
        return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const rows = [...data.recentTurns]
        .reverse()
        .map(t =>
          [
            t.step,
            t.at,
            t.threadId,
            t.model,
            t.inCached,
            t.inUncached,
            t.outEn,
            t.kRatio,
            t.virtualCached,
            t.virtualUncached,
            t.virtualOut,
            t.savedTokens,
            t.costActual,
            t.costVirtual,
            t.savedUsd,
            t.cacheSavedUsd
          ]
            .map(escapeCsv)
            .join(',')
        );
      return {
        format: 'csv',
        filename: `codex-translate-economics-${new Date().toISOString().slice(0, 10)}.csv`,
        content: [headers.join(','), ...rows].join('\n') + '\n'
      };
    }
    return {
      format: 'json',
      filename: `codex-translate-economics-${new Date().toISOString().slice(0, 10)}.json`,
      content: JSON.stringify(data, null, 2) + '\n'
    };
  }
}
