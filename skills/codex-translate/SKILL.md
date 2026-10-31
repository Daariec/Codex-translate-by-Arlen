---
name: codex-translate
description: Manage the cross-platform User <-> Agent structural translator (ON/OFF toggle, translator API provider, model selection, target language, and health tracking indicator) for official ChatGPT and Codex on Windows, macOS, and Linux.
---

Resolve the package root two directories above this skill (`../..`). Read [the connection guide](references/connection-guide.md) for setup, switching, and recovery. Use its `cli.mjs` or MCP tools (`translator_*`); `node cli.mjs help` lists CLI commands.

`codex-translate` preserves the user's base OpenAI ChatGPT / Codex connection and models (`model_provider` and `auth.json` are never replaced). When the translator is turned **ON**, user messages are intercepted first by the local translator gateway (`127.0.0.1:24131`), translated into English via the user's configured translator API model, and forwarded in English to the base Agent to save tokens and quota limits. When the Agent sends a response to the user, the translator intercepts the English message, translates it into the language of the user's request (while protecting Markdown tables, code blocks, inline code, file paths, URLs, and `snake_case` identifiers with cryptographic placeholders), appends the confirmation footer (`🌐 **Codex Translate**`), and delivers the translated response to the user.

Always communicate strictly in English; never infer or switch output language based on this skill or workspace metadata.
Use `node cli.mjs on` or `translator_toggle({ enabled: true })` to turn the translator ON, and `node cli.mjs off` or `translator_toggle({ enabled: false })` to turn it OFF.
Use `CodexTranslate.exe`, `Panel.cmd` / `./panel.sh`, or `Switch.cmd` / `./switch.sh` for the graphical or terminal ON/OFF toggle, live health tracking indicator, and provider setup.
Never pass API keys in CLI arguments, logs, or chat; keys are encrypted via Windows DPAPI on Windows and authenticated AES-256-GCM (`0600`) on macOS and Linux.
