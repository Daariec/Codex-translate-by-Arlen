#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && (pwd -W 2>/dev/null || pwd))"
NODE_BIN="$(command -v node || echo node)"

while true; do
  echo ""
  echo "Codex Translate — CLI Manager (User <-> Agent): $SCRIPT_DIR"
  echo "Your base ChatGPT / Codex connection and models are preserved."
  echo "1 Turn ON Translator | 2 Turn OFF Translator | 3 Add Translator API Provider"
  echo "4 Status & Connections | 5 Refresh Models (/v1/models) | 6 Search / Select Translator Model"
  echo "7 Open Control Panel (Panel) | W Quick Switcher (Switch) | 0 Exit"
  read -r -p "Select an action: " choice
  case "$choice" in
    1) "$NODE_BIN" "$SCRIPT_DIR/cli.mjs" on ;;
    2) "$NODE_BIN" "$SCRIPT_DIR/cli.mjs" off ;;
    3)
      read -r -p "Connection ID (letters/digits/hyphen, default: default): " cid
      cid="${cid:-default}"
      read -r -p "Server Base URL (e.g. https://api.openai.com/v1): " curl_url
      read -r -p "Protocol [responses|chat_completions|anthropic|omniroute] (default: responses): " ckind
      ckind="${ckind:-responses}"
      read -r -s -p "API Key (input hidden): " ckey
      echo ""
      printf '%s' "$ckey" | "$NODE_BIN" "$SCRIPT_DIR/cli.mjs" configure --id "$cid" --url "$curl_url" --kind "$ckind" --stdin-key
      unset ckey
      ;;
    4) "$NODE_BIN" "$SCRIPT_DIR/cli.mjs" status ;;
    5) "$NODE_BIN" "$SCRIPT_DIR/cli.mjs" sync ;;
    6)
      read -r -p "Search model (leave empty for all): " msearch
      if [ -n "$msearch" ]; then
        "$NODE_BIN" "$SCRIPT_DIR/cli.mjs" models --search "$msearch"
      else
        "$NODE_BIN" "$SCRIPT_DIR/cli.mjs" models
      fi
      read -r -p "Exact model ID for translator: " mid
      if [ -n "$mid" ]; then
        read -r -p "Reasoning effort (low, medium, high, none; leave empty for default): " meffort
        if [ -n "$meffort" ]; then
          "$NODE_BIN" "$SCRIPT_DIR/cli.mjs" select --model "$mid" --effort "$meffort"
        else
          "$NODE_BIN" "$SCRIPT_DIR/cli.mjs" select --model "$mid"
        fi
      fi
      ;;
    7) "$NODE_BIN" "$SCRIPT_DIR/cli.mjs" panel ;;
    [wW]) "$SCRIPT_DIR/switch.sh" ;;
    0) exit 0 ;;
    *) echo "Unknown command" ;;
  esac
done
