#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && (pwd -W 2>/dev/null || pwd))"
cd "$SCRIPT_DIR"

# Augment PATH for Linux (usr/local, snap, NVM, fnm, Volta, asdf, ~/.local/bin, ~/.npm-global/bin)
export PATH="/usr/local/bin:/usr/bin:/snap/bin:$HOME/.volta/bin:$HOME/.asdf/shims:$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"
if [ -d "$HOME/.nvm/versions/node" ]; then
  LATEST_NVM_NODE="$(ls -1d "$HOME/.nvm/versions/node/"* 2>/dev/null | sort -V | tail -n 1 || true)"
  if [ -n "$LATEST_NVM_NODE" ] && [ -d "$LATEST_NVM_NODE/bin" ]; then
    export PATH="$LATEST_NVM_NODE/bin:$PATH"
  fi
fi
if [ -d "$HOME/.local/share/fnm/aliases/default/bin" ]; then
  export PATH="$HOME/.local/share/fnm/aliases/default/bin:$PATH"
fi

CHECK_MODE=0
NO_PROMPT=0
ISOLATED_MODE=0
PASS_ARGS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --check)
      CHECK_MODE=1
      NO_PROMPT=1
      shift
      ;;
    --no-prompt)
      NO_PROMPT=1
      shift
      ;;
    --data-dir)
      ISOLATED_MODE=1
      PASS_ARGS+=("--data-dir" "$2")
      shift 2
      ;;
    --codex-home)
      ISOLATED_MODE=1
      PASS_ARGS+=("--codex-home" "$2")
      shift 2
      ;;
    *)
      PASS_ARGS+=("$1")
      shift
      ;;
  esac
done

if [ "$CHECK_MODE" -eq 0 ]; then
  echo "========================================================"
  echo "  Installing Codex Translate plugin for ChatGPT & Codex"
  echo "  Platform: Linux ($(uname -m))"
  echo "========================================================"
  echo ""
fi

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "[!] Error: Node.js (node) was not found. Please install Node.js 22+ from https://nodejs.org/"
  exit 1
fi

chmod +x "$SCRIPT_DIR"/*.sh "$SCRIPT_DIR"/*.command 2>/dev/null || true

if [ ! -d "$SCRIPT_DIR/node_modules/gpt-tokenizer" ] && [ -f "$SCRIPT_DIR/package.json" ]; then
  if [ "$CHECK_MODE" -eq 0 ]; then
    echo "Installing npm dependencies..."
  fi
  npm install --no-audit --no-fund >/dev/null 2>&1
fi

if [ "$ISOLATED_MODE" -eq 0 ]; then
  CODEX_BIN="$("$NODE_BIN" -e "import('./lib.mjs').then(m => console.log(m.resolveCodexExe()))" 2>/dev/null || true)"
  if [ -n "$CODEX_BIN" ] && { [ -x "$CODEX_BIN" ] || command -v "$CODEX_BIN" >/dev/null 2>&1; }; then
    "$CODEX_BIN" plugin remove codex-translate@codex-translate-local >/dev/null 2>&1 || true
    "$CODEX_BIN" plugin marketplace add "$SCRIPT_DIR" >/dev/null 2>&1 || true
    "$CODEX_BIN" plugin add codex-translate@codex-translate-local >/dev/null 2>&1 || true
  fi
fi

if [ "$CHECK_MODE" -eq 1 ]; then
  "$NODE_BIN" "$SCRIPT_DIR/cli.mjs" install --json "${PASS_ARGS[@]}"
  exit 0
fi

if ! "$NODE_BIN" "$SCRIPT_DIR/cli.mjs" install --json "${PASS_ARGS[@]}" >/dev/null 2>&1; then
  echo ""
  echo "[!] Error installing Codex Translate plugin."
  exit 1
fi

echo ""
echo "========================================================"
echo "  Codex Translate plugin installed successfully on Linux!"
echo "  The local gateway daemon is running on 127.0.0.1:24131."
echo "  Control Panel URL: http://127.0.0.1:24131/"
echo "========================================================"
echo ""

if [ "$NO_PROMPT" -eq 1 ]; then
  exit 0
fi

if [ -t 0 ]; then
  read -r -p "Open the Codex Translate Control Panel now? [Y/n]: " userchoice
  case "${userchoice:-Y}" in
    [nN]*) exit 0 ;;
    *) "$NODE_BIN" "$SCRIPT_DIR/cli.mjs" panel "${PASS_ARGS[@]}" >/dev/null 2>&1 || true ;;
  esac
fi
