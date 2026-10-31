#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "$(uname -s 2>/dev/null || echo Linux)" in
  Darwin*)
    exec "$SCRIPT_DIR/Uninstall-Plugin for MacOS.sh" "$@"
    ;;
  *)
    exec "$SCRIPT_DIR/Uninstall-Plugin for Linux.sh" "$@"
    ;;
esac
