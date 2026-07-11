#!/usr/bin/env bash
# OneWorks-scoped Cua Driver uninstaller. It intentionally leaves user data,
# recordings, agent skills, MCP configuration, and macOS TCC grants untouched.
set -euo pipefail

APP_BUNDLE="/Applications/CuaDriver.app"
APP_BINARY="$APP_BUNDLE/Contents/MacOS/cua-driver"
BIN_DIR="${CUA_DRIVER_BIN_DIR:-$HOME/.local/bin}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --bin-dir)
            if [[ -z "${2:-}" || "${2:0:1}" == "-" ]]; then
                printf 'error: --bin-dir requires a value\n' >&2
                exit 2
            fi
            BIN_DIR="$2"
            shift 2
            ;;
        --bin-dir=*)
            BIN_DIR="${1#*=}"
            shift
            ;;
        *)
            printf 'error: unknown option %q\n' "$1" >&2
            exit 2
            ;;
    esac
done

log() { printf '==> %s\n' "$*"; }

BIN_LINK="$BIN_DIR/cua-driver"
if [[ -L "$BIN_LINK" ]] && [[ "$(readlink "$BIN_LINK")" == "$APP_BINARY" ]]; then
    rm -f "$BIN_LINK"
    log "removed plugin-created link $BIN_LINK"
elif [[ -e "$BIN_LINK" ]] || [[ -L "$BIN_LINK" ]]; then
    log "kept unrelated path at $BIN_LINK"
else
    log "no plugin-created link at $BIN_LINK"
fi

if [[ -d "$APP_BUNDLE" ]]; then
    rm -rf "$APP_BUNDLE"
    log "removed $APP_BUNDLE"
else
    log "no app bundle at $APP_BUNDLE"
fi

cat <<'EOF'

Cua Driver app files were removed. User config, recordings, MCP config, agent
skills, and macOS Accessibility / Screen Recording grants were left untouched.
EOF
