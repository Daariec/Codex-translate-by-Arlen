#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && (pwd -W 2>/dev/null || pwd))"
NODE_BIN="$(command -v node || echo node)"

CHECK_MODE=0
ACTION=""
PASS_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --check|-Check)
      CHECK_MODE=1
      shift
      ;;
    --on|--off|--toggle)
      ACTION="${1#--}"
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
  UI_JSON="$("$NODE_BIN" "$SCRIPT_DIR/cli.mjs" ui-data "${PASS_ARGS[@]}")"
  "$NODE_BIN" -e '
    const data = JSON.parse(process.argv[1]);
    const conn = data.connections?.[0] || null;
    console.log(JSON.stringify({
      phase: "SwitchReady",
      interfaceLanguage: data.uiLanguage || "en",
      translatorEnabled: data.translator?.enabled === true,
      configuredRoute: data.routing?.configuredRoute || "base",
      selected: data.selected || (conn ? conn.id : ""),
      url: conn ? conn.baseURL : "",
      keyMasked: true,
      connectionsCount: (data.connections || []).length,
      modelsCount: conn ? (conn.models || []).length : 0,
      selectedModel: data.translator?.model || (conn ? conn.model : ""),
      selectedEffort: data.translator?.effort || (conn ? conn.effort : "none"),
      toggleButtonPresent: true
    }));
  ' "$UI_JSON"
  exit 0
fi

if [ -n "$ACTION" ]; then
  "$NODE_BIN" "$SCRIPT_DIR/cli.mjs" "$ACTION" --json "${PASS_ARGS[@]}"
  exit 0
fi

while true; do
  STATUS_JSON="$("$NODE_BIN" "$SCRIPT_DIR/cli.mjs" status "${PASS_ARGS[@]}")"
  "$NODE_BIN" -e '
    const s = JSON.parse(process.argv[1]);
    const on = s.translator?.enabled ? "ON" : "OFF";
    const model = s.translator?.model || "(none)";
    const lang = s.translator?.targetLanguage || "ru";
    const route = s.routing?.interceptActive ? "Active (" + s.routing.interceptUrl + ")" : "Direct (base)";
    console.log("\n=== Codex Translate — Quick Switcher (" + process.platform + ") ===");
    console.log("Translator: " + on + " | Model: " + model + " | Fallback Lang: " + lang);
    console.log("Interception: " + route);
    console.log("1) Toggle Translator (ON <-> OFF)");
    console.log("2) Turn ON Translator");
    console.log("3) Turn OFF Translator");
    console.log("4) Open Full Web Control Panel");
    console.log("0) Exit");
  ' "$STATUS_JSON"
  read -r -p "Select an action: " choice
  case "$choice" in
    1) "$NODE_BIN" "$SCRIPT_DIR/cli.mjs" toggle "${PASS_ARGS[@]}" ;;
    2) "$NODE_BIN" "$SCRIPT_DIR/cli.mjs" on "${PASS_ARGS[@]}" ;;
    3) "$NODE_BIN" "$SCRIPT_DIR/cli.mjs" off "${PASS_ARGS[@]}" ;;
    4) "$NODE_BIN" "$SCRIPT_DIR/cli.mjs" panel "${PASS_ARGS[@]}" ;;
    0|"") exit 0 ;;
    *) echo "Unknown option: $choice" ;;
  esac
done
