#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && (pwd -W 2>/dev/null || pwd))"
NODE_BIN="$(command -v node || echo node)"

CHECK_MODE=0
PASS_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --check|-Check)
      CHECK_MODE=1
      shift
      ;;
    -DataDirectory)
      PASS_ARGS+=("--data-dir" "$2")
      shift 2
      ;;
    -CodexHome)
      PASS_ARGS+=("--codex-home" "$2")
      shift 2
      ;;
    *)
      PASS_ARGS+=("$1")
      shift
      ;;
  esac
done

if [ "$CHECK_MODE" -eq 1 ]; then
  RAW="$("$NODE_BIN" "$SCRIPT_DIR/cli.mjs" panel-url --json "${PASS_ARGS[@]}")"
  "$NODE_BIN" -e '
    const info = JSON.parse(process.argv[1]);
    console.log(JSON.stringify({
      phase: "PanelReady",
      port: info.port,
      uiUrl: info.uiUrl,
      dataDir: info.dataDir,
      codexHome: info.codexHome
    }));
  ' "$RAW"
  exit 0
fi

"$NODE_BIN" "$SCRIPT_DIR/cli.mjs" panel "${PASS_ARGS[@]}"
