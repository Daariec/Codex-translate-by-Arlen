# Validation & Verification Report (`Codex Translate` v1.0.0)

## 1. Automated Tests (`npm test`)

All **43 / 43** tests in `test/*.test.mjs` pass across Windows, macOS, and Linux, including localization, zero-leakage, cross-platform POSIX support, platform installers (`Install-Plugin for Windows.cmd`, `Install-Plugin for MacOS.command`, `Install-Plugin for MacOS.sh`, `Install-Plugin for Linux.sh`), and live OpenAI pricing regressions:

- **`test/localization.test.mjs`**:
  - English, Russian, and Chinese coverage for every interface translation key, including placeholders and accessible labels.
  - Empty and populated economics tables; model status, progress, reasoning labels, probe results, and notifications.
  - Native quick-switcher rendering in all three languages while preserving reasoning API values.
  - Shared native language preferences and installation-cache inclusion of the guide and language resources.

Browser checks also exercised all four sections in each language with empty and populated disposable profiles (24 section/language checks), with no browser errors. These checks made no calls to a real translator provider.

- **`test/economics.test.mjs`**:
  - Offline model-specific BPE tokenization (`gpt-tokenizer` `o200k_base`, `o200k_harmony`, and `cl100k_base` with `allowedSpecial: 'all'`) counting Cyrillic vs. English tokens, special tokens (`<|endoftext|>`), and preserving code blocks.
  - Exact unit-economics formulas (`Cost_actual`, `Cost_virtual`, `Saved_tokens`, `Saved_USD`, `CacheSaved_USD`, 4-Scenario blocks, and Consolidated Summary).
  - Automatic Codex model & reasoning effort discovery (`gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-*`), per-model custom pricing, and historical tariff preservation (updating a tariff today only recalculates today's turns).
  - Live OpenAI pricing parser (`https://developers.openai.com/api/docs/pricing`), unconditional launch-time sync and 4-hour timer reset, `30m write` / `12h write` time-bound cache accounting, `>272K` long-context tiering, and non-inflated `K_ratio` dialogue scaling.
- **`test/leak-and-intercept.test.mjs`**:
  - Zero-leakage guarantees across steered mid-turn user prompts, uncached history, attachment path aliasing, `function_call` / `tool_use` / `tool_calls` and `function_call_output` / `tool_result` round-trips, composite system envelopes (`AGENTS.md`, `RETAINED USER INSTRUCTIONS`, `MEMORY_SUMMARY`, helper & `codex-auto-review` requests), inline backticks/code comments, MCP tool filtering, and fail-closed error handling.
- **`test/lib.test.mjs`**:
  - URL normalization, HTTPS enforcement for remote servers, context window resolution, and reasoning effort tier filtering.
  - `patchCodexTranslate` and `stripCodexTranslate` preserving base model, effort, `[desktop]`, and runtime pipes.
  - Cross-platform Linux (`XDG_DATA_HOME` / `~/.local/share`) and macOS (`~/Library/Application Support`) data directory resolution, POSIX binary discovery (`resolveCodexExe`), and authenticated `AES-256-GCM` (`ct-aes256gcm:v1`) credential encryption, decryption, and tamper rejection.
- **`test/routing.test.mjs`**:
  - Atomic route switching (`translate` <-> `base`), NUL-corruption self-healing, and third-party `openai_base_url` preservation.
- **`test/translator.test.mjs`**:
  - Placeholder protection (`__CT_<hex>_<id>__`) for Markdown tables, code blocks, inline code, Windows and POSIX (`/Users/...`, `/home/...`, `/etc/...`, `~/...`) file paths, URLs, and machine identifiers, plus non-ASCII POSIX attachment aliasing.
  - Multi-language detection and streaming SSE translation with real-time tool-call passthrough.
- **`test/gateway-intercept.test.mjs`**:
  - End-to-end `User -> Translator -> Base Agent -> Translator -> User` interception (including `zstd`-compressed request payloads).
- **`test/ui-and-plugin.test.mjs`**:
  - Plugin manifests (`.codex-plugin/plugin.json`, `plugin.json`, `.mcp.json`, `hooks.json`), CLI (`on`, `off`, `toggle`), native launcher (`CodexTranslate.exe --check`, `Switch.ps1 -Check`), platform installers (`Install-Plugin for Windows.cmd`, `Install-Plugin for MacOS.command`, `Install-Plugin for MacOS.sh`, `Install-Plugin for Linux.sh`), POSIX `hooks.json` `SessionStart` execution, and MCP stdio server tools (`translator_status`, `translator_toggle`, `translator_configure`).

---

## 2. Live End-to-End Verification (`node verify-native.mjs --configured`)

End-to-end verification is supported through the local Codex engine with any base model (`gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-luna`, etc.) and any configured translator provider:

1. **User Prompt (Native Language):**
   `Привет! Объясни в одном коротком предложении, для чего нужен файл package.json и поле main_entry в Node.js. Не используй инструменты.`
2. **Intercepted & Translated to English (`user->agent`):**
   `Hello! Explain in one short sentence what the package.json file and the main_entry field are for in Node.js. Do not use tools.`
3. **Processed by Base Agent in English & Translated Back (`agent->user`):**
   Delivered to the user in their native language with code and identifiers preserved and BPE token economics recorded in `TokenEconomicsEngine`.
