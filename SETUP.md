# Setup & Configuration Guide (`Codex Translate`)

For the complete current instructions in English, Russian, and Chinese, including installation on another PC, daily launch, updates, and troubleshooting, use **[INSTALLATION.md](INSTALLATION.md)**.

Step-by-step instructions for installing and configuring `Codex Translate` with **OpenAI ChatGPT / Codex Desktop** and **Codex CLI** on **Windows, macOS, and Linux**.

---

## 1. Initial Plugin Installation

1. Open the repository directory (e.g., `D:\Codex translate` on Windows or `~/codex-translate` on macOS/Linux).
2. Run the installer:
   - **Windows:** Run **`Install-Plugin for Windows.cmd`** (or `Install-Plugin.cmd`, or launch **`CodexTranslate.exe`** and click **"Install / Enable Interception"**).
   - **macOS:** Double-click **`Install-Plugin for MacOS.command`** in Finder, or run `chmod +x *.sh *.command && ./"Install-Plugin for MacOS.sh"`.
   - **Linux:** Run `chmod +x *.sh && ./"Install-Plugin for Linux.sh"`.
3. The installer registers the plugin in `~/.codex/config.toml`, backs up your original configuration, enables the local loopback gateway (`http://127.0.0.1:24131/v1`), and launches the system tray icon (`CT`).

> **Non-Intrusive Routing:** The plugin never modifies `auth.json`, never replaces your base OpenAI/Codex models (`gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-luna`, `gpt-5.6-*`), and preserves your selected `model_reasoning_effort`.

---

## 2. Configuring a Translator API Provider

### Option A — Via the Main Control Panel (`CodexTranslate.exe` / `Panel.cmd`)
1. Open **`CodexTranslate.exe`** / **`Panel.cmd`** (Windows) or **`./panel.sh`** / `node cli.mjs panel` (macOS & Linux).
2. Switch interface language if desired (**English** [default], **Русский**, or **中文**).
3. Go to the **"API Providers"** tab and click **"＋ Add Translator API Provider"**.
4. Fill in:
   - **Connection Name** (e.g., `Translator API Provider`)
   - **Translator API Protocol** (`OpenAI Responses API`, `OpenAI Chat Completions`, `Anthropic Messages`, or `OmniRoute Gateway`)
   - **Translator Server Base URL** (e.g., `https://api.openai.com/v1`)
   - **API Key** (encrypted via Windows DPAPI on Windows or AES-256-GCM on macOS/Linux)
5. Click **"Load / Refresh Models"**.
6. Go to **"Translator (ON/OFF)"**, choose your translator model, and click **"Test Translation"**.

### Option B — Via Terminal / PowerShell CLI
```powershell
# Windows PowerShell:
cd "D:\Codex Translate"
"YOUR_API_KEY" | node cli.mjs configure --id default --url "https://api.openai.com/v1" --kind responses --effort "low" --stdin-key
node cli.mjs on
```

```bash
# macOS / Linux (Bash / Zsh):
cd ~/codex-translate
printf '%s' "YOUR_API_KEY" | node cli.mjs configure --id default --url "https://api.openai.com/v1" --kind responses --effort "low" --stdin-key
node cli.mjs on
```

---

## 3. Toggling the Translator (`ON` / `OFF`)

- **Control Panel (`CodexTranslate.exe` / `./panel.sh`):** Use the **Turn ON** / **Turn OFF** buttons in the left sidebar or main dashboard.
- **Quick Switcher (`Switch.cmd` / `./switch.sh`):** Use the **ON / OFF** toggle button or terminal menu.
- **Windows System Tray (`CT` icon):** Right-click the tray icon to toggle ON/OFF or open the Control Panel.
- **CLI / Shortcuts:**
  ```bash
  node cli.mjs on
  node cli.mjs off
  node cli.mjs toggle
  ```
