#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && (pwd -W 2>/dev/null || pwd))"
cd "${TMPDIR:-/tmp}"

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/.asdf/shims:$HOME/.local/bin:/Applications/Codex.app/Contents/Resources:/Applications/Codex.app/Contents/MacOS:$PATH"
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

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "[!] Error: Node.js (node) was not found."
  exit 1
fi

if [ "$ISOLATED_MODE" -eq 0 ]; then
  pkill -f "gateway.mjs --daemon" >/dev/null 2>&1 || true
  CODEX_BIN="$("$NODE_BIN" "$SCRIPT_DIR/cli.mjs" guide >/dev/null 2>&1 && "$NODE_BIN" -e "import(process.argv[1]).then(m => console.log(m.resolveCodexExe()))" "file://$SCRIPT_DIR/lib.mjs" 2>/dev/null || true)"
  if [ -n "$CODEX_BIN" ] && { [ -x "$CODEX_BIN" ] || command -v "$CODEX_BIN" >/dev/null 2>&1; }; then
    "$CODEX_BIN" plugin remove codex-translate@codex-translate-local >/dev/null 2>&1 || true
  fi
fi

if [ "$CHECK_MODE" -eq 1 ]; then
  "$NODE_BIN" "$SCRIPT_DIR/cli.mjs" uninstall --json "${PASS_ARGS[@]}"
  exit 0
fi

"$NODE_BIN" "$SCRIPT_DIR/cli.mjs" uninstall --json "${PASS_ARGS[@]}" >/dev/null
echo "========================================================"
echo "  Codex Translate plugin uninstalled successfully on macOS!"
echo "  Background gateway stopped and config.toml restored."
echo "========================================================"
