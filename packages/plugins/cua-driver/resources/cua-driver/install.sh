#!/usr/bin/env bash
# Adapted from trycua/cua's MIT-licensed cua-driver installer for the
# OneWorks plugin. This variant deliberately does not install global agent
# skills or register MCP servers; those capabilities remain plugin-scoped.
set -euo pipefail

REPO="trycua/cua"
APP_NAME="CuaDriver.app"
BINARY_NAME="cua-driver"
TAG_PREFIX="cua-driver-v"
APP_DEST="/Applications/$APP_NAME"
BIN_DIR="${CUA_DRIVER_BIN_DIR:-$HOME/.local/bin}"
NO_MODIFY_PATH="${CUA_DRIVER_NO_MODIFY_PATH:-0}"
DEFAULT_VERSION="0.2.0"

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
        --no-modify-path)
            NO_MODIFY_PATH=1
            shift
            ;;
        *)
            printf 'error: unknown option %q\n' "$1" >&2
            exit 2
            ;;
    esac
done

log() { printf '==> %s\n' "$*"; }
err() { printf 'error: %s\n' "$*" >&2; }

if [[ "$(uname -s)" != "Darwin" ]]; then
    err "the bundled CuaDriver.app installer is macOS-only"
    exit 1
fi

for command in curl tar ditto; do
    if ! command -v "$command" >/dev/null 2>&1; then
        err "$command not found on PATH"
        exit 1
    fi
done

ARCH="$(uname -m)"
case "$ARCH" in
    arm64|x86_64) ;;
    *)
        err "unsupported macOS architecture: $ARCH"
        exit 1
        ;;
esac

VERSION="${CUA_DRIVER_VERSION:-$DEFAULT_VERSION}"
VERSION="${VERSION#v}"
TAG="${TAG_PREFIX}${VERSION}"
TARBALL="cua-driver-${VERSION}-darwin-${ARCH}.tar.gz"
URL="https://github.com/$REPO/releases/download/$TAG/$TARBALL"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

log "downloading $URL"
if ! curl -fsSL --retry 3 --retry-delay 1 -o "$TMP_DIR/$TARBALL" "$URL"; then
    err "download failed; set CUA_DRIVER_VERSION to a known release if needed"
    exit 1
fi

log "extracting $TARBALL"
tar -xzf "$TMP_DIR/$TARBALL" -C "$TMP_DIR"

if [[ ! -d "$TMP_DIR/$APP_NAME" ]]; then
    err "$APP_NAME not found inside the release archive"
    exit 1
fi

if command -v codesign >/dev/null 2>&1; then
    log "verifying app signature"
    codesign --verify --deep --strict "$TMP_DIR/$APP_NAME"
fi

if [[ -e "$APP_DEST" ]]; then
    log "removing existing $APP_DEST"
    rm -rf "$APP_DEST"
fi

log "installing $APP_DEST"
ditto "$TMP_DIR/$APP_NAME" "$APP_DEST"

APP_BINARY="$APP_DEST/Contents/MacOS/$BINARY_NAME"
if [[ ! -x "$APP_BINARY" ]]; then
    err "driver binary missing at $APP_BINARY"
    exit 1
fi

mkdir -p "$BIN_DIR"
if [[ ! -w "$BIN_DIR" ]]; then
    err "$BIN_DIR is not writable; choose a user-writable --bin-dir"
    exit 1
fi

BIN_LINK="$BIN_DIR/$BINARY_NAME"
ln -sfn "$APP_BINARY" "$BIN_LINK"
log "linked $BIN_LINK -> $APP_BINARY"

case ":$PATH:" in
    *":$BIN_DIR:"*) PATH_NEEDS_FIX=0 ;;
    *) PATH_NEEDS_FIX=1 ;;
esac

if [[ "$PATH_NEEDS_FIX" == "1" ]]; then
    if [[ "$NO_MODIFY_PATH" == "1" ]]; then
        log "$BIN_DIR is not on PATH (skipping shell config edit)"
    elif [[ "$BIN_DIR" != "$HOME/.local/bin" ]]; then
        log "add $BIN_DIR to PATH manually"
    else
        SHELL_NAME="$(basename "${SHELL:-/bin/zsh}")"
        case "$SHELL_NAME" in
            zsh) RC_FILE="$HOME/.zshrc" ;;
            bash) RC_FILE="$HOME/.bash_profile" ;;
            fish) RC_FILE="$HOME/.config/fish/config.fish" ;;
            *) RC_FILE="" ;;
        esac

        if [[ -n "$RC_FILE" ]]; then
            mkdir -p "$(dirname "$RC_FILE")"
            EXPORT_LINE='export PATH="$HOME/.local/bin:$PATH"'
            [[ "$SHELL_NAME" == "fish" ]] && EXPORT_LINE='set -gx PATH $HOME/.local/bin $PATH'
            if [[ -f "$RC_FILE" ]] && grep -qF "$HOME/.local/bin" "$RC_FILE"; then
                log "$HOME/.local/bin is already referenced in $RC_FILE"
            else
                {
                    printf '\n# Added by @oneworks/plugin-cua-driver\n'
                    printf '%s\n' "$EXPORT_LINE"
                } >> "$RC_FILE"
                log "added $HOME/.local/bin to $RC_FILE"
            fi
        else
            log "add $HOME/.local/bin to PATH manually"
        fi
    fi
fi

log "cua-driver $VERSION installed"
cat <<'EOF'

Run `ow-cua-driver ensure` to start the daemon and request the required
Accessibility and Screen Recording permission checks.
EOF
