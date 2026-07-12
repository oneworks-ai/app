#!/usr/bin/env bash
# Adapted from trycua/cua's MIT-licensed cua-driver installer for the
# OneWorks plugin. This variant deliberately does not install global agent
# skills or register MCP servers; those capabilities remain plugin-scoped.
set -euo pipefail

REPO="trycua/cua"
APP_NAME="CuaDriver.app"
BINARY_NAME="cua-driver"
TAG_PREFIX="cua-driver-rs-v"
APP_DEST="/Applications/$APP_NAME"
BIN_DIR="${CUA_DRIVER_BIN_DIR:-$HOME/.local/bin}"
NO_MODIFY_PATH="${CUA_DRIVER_NO_MODIFY_PATH:-0}"
DEFAULT_VERSION="0.7.1"
EXPECTED_TEAM_ID="YCK386LBJ7"
EXPECTED_IDENTIFIER="com.trycua.driver"

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

for command in curl tar ditto shasum codesign shlock; do
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

VERSION="${CUA_DRIVER_RS_VERSION:-${CUA_DRIVER_VERSION:-$DEFAULT_VERSION}}"
VERSION="${VERSION#v}"
TAG="${TAG_PREFIX}${VERSION}"
TARBALL="cua-driver-rs-${VERSION}-darwin-${ARCH}.tar.gz"
URL="https://github.com/$REPO/releases/download/$TAG/$TARBALL"
TMP_DIR="$(mktemp -d)"
LOCK_DIR="$HOME/Library/Caches/oneworks-cua"
LOCK_FILE="$LOCK_DIR/cua-driver-install.lock"
STAGED_APP="/Applications/.${APP_NAME}.oneworks-stage.$$"
BACKUP_APP="/Applications/.${APP_NAME}.oneworks-backup.$$"
LOCK_HELD=0
INSTALL_COMMITTED=0
REPLACEMENT_STARTED=0

cleanup() {
    exit_status=$?
    if [[ "$INSTALL_COMMITTED" != "1" && -d "$BACKUP_APP" ]]; then
        rm -rf "$APP_DEST"
        mv "$BACKUP_APP" "$APP_DEST" || true
    elif [[ "$INSTALL_COMMITTED" != "1" && "$REPLACEMENT_STARTED" == "1" ]]; then
        rm -rf "$APP_DEST"
    fi
    rm -rf "$TMP_DIR" "$STAGED_APP"
    if [[ "$LOCK_HELD" == "1" ]]; then rm -f "$LOCK_FILE"; fi
    exit "$exit_status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

case "$VERSION:$ARCH" in
    0.7.1:arm64) EXPECTED_SHA256="91327c24a01e544ee3bf0a7af802b4b81aaee185ad9f167e0f937f344ce0c2c9" ;;
    0.7.1:x86_64) EXPECTED_SHA256="fbf32f03ccea299370f879f9b7504f3aa865e96a7f59faca4d4d5925a743f743" ;;
    *)
        EXPECTED_SHA256="${CUA_DRIVER_RS_SHA256:-}"
        if [[ -z "$EXPECTED_SHA256" ]]; then
            err "no pinned SHA-256 for cua-driver-rs $VERSION ($ARCH); set CUA_DRIVER_RS_SHA256 explicitly"
            exit 1
        fi
        ;;
esac

verify_app() {
    app_path="$1"
    codesign --verify --deep --strict "$app_path"
    signature="$(codesign -dv --verbose=4 "$app_path" 2>&1)"
    if ! grep -q "^Identifier=$EXPECTED_IDENTIFIER$" <<<"$signature" ||
       ! grep -q "^TeamIdentifier=$EXPECTED_TEAM_ID$" <<<"$signature" ||
       ! grep -q "^Authority=Developer ID Application: Cua AI, Inc. ($EXPECTED_TEAM_ID)$" <<<"$signature"; then
        err "unexpected CuaDriver signing identity"
        return 1
    fi
}

log "downloading $URL"
if ! curl -fsSL --retry 3 --retry-delay 1 -o "$TMP_DIR/$TARBALL" "$URL"; then
    err "download failed; set CUA_DRIVER_VERSION to a known release if needed"
    exit 1
fi

ACTUAL_SHA256="$(shasum -a 256 "$TMP_DIR/$TARBALL" | awk '{print $1}')"
if [[ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]]; then
    err "SHA-256 mismatch for $TARBALL"
    exit 1
fi

log "extracting $TARBALL"
tar -xzf "$TMP_DIR/$TARBALL" -C "$TMP_DIR"

RELEASE_DIR="$TMP_DIR/cua-driver-rs-${VERSION}-darwin-${ARCH}"
if [[ ! -d "$RELEASE_DIR/$APP_NAME" ]]; then
    err "$APP_NAME not found inside the release archive"
    exit 1
fi

log "verifying app signature and publisher"
verify_app "$RELEASE_DIR/$APP_NAME"

log "staging $APP_NAME"
ditto "$RELEASE_DIR/$APP_NAME" "$STAGED_APP"
verify_app "$STAGED_APP"

mkdir -p "$LOCK_DIR"
for _attempt in $(seq 1 600); do
    if shlock -f "$LOCK_FILE" -p $$; then
        LOCK_HELD=1
        break
    fi
    sleep 0.1
done
if [[ "$LOCK_HELD" != "1" ]]; then
    err "timed out waiting for another CuaDriver installation"
    exit 1
fi

APP_BINARY="$APP_DEST/Contents/MacOS/$BINARY_NAME"
if [[ -x "$APP_BINARY" ]] &&
   [[ "$($APP_BINARY --version 2>/dev/null || true)" == "cua-driver $VERSION" ]] &&
   verify_app "$APP_DEST"; then
    log "cua-driver $VERSION is already installed"
    rm -rf "$STAGED_APP"
else
    if [[ -x "$APP_BINARY" ]]; then "$APP_BINARY" stop >/dev/null 2>&1 || true; fi
    rm -rf "$BACKUP_APP"
    if [[ -e "$APP_DEST" ]]; then
        log "preserving the existing app for rollback"
        mv "$APP_DEST" "$BACKUP_APP"
    fi
    REPLACEMENT_STARTED=1

    log "installing $APP_DEST"
    mv "$STAGED_APP" "$APP_DEST"
    verify_app "$APP_DEST"
    APP_BINARY="$APP_DEST/Contents/MacOS/$BINARY_NAME"
    if [[ ! -x "$APP_BINARY" ]]; then
        err "driver binary missing at $APP_BINARY"
        exit 1
    fi
    INSTALL_COMMITTED=1
    rm -rf "$BACKUP_APP"
fi
INSTALL_COMMITTED=1

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
