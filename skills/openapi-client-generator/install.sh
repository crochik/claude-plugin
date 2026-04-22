#!/usr/bin/env bash
# Install the OpenApiClientGenerator.Core CLI by downloading the
# pre-built binary for the current host OS/arch and extracting it to
# $INSTALL_DIR. Idempotent: exits 0 if the tool is already installed.
#
# Configure the constants below for the release location and asset
# naming convention, then invoke the script with no arguments.

set -euo pipefail

# --- Configuration ---------------------------------------------------
# Base URL that serves the per-platform zip archives.
# Each archive is expected to be named with the OS/arch suffix appended,
# e.g. OpenApiClientGenerator.Core-linux-x64.zip.
RELEASE_URL_BASE="${OPENAPI_GENERATOR_RELEASE_URL_BASE:-https://example.invalid/openapi-client-generator/latest}"

# Directory the extracted executable will be placed in. Must be on PATH.
INSTALL_DIR="${OPENAPI_GENERATOR_INSTALL_DIR:-$HOME/.local/bin}"

# Name of the final executable on disk (after extraction).
EXECUTABLE_NAME="OpenApiClientGenerator.Core"
# ---------------------------------------------------------------------

log() { printf '[install-openapi-generator] %s\n' "$*" >&2; }
die() { log "error: $*"; exit 1; }

# Short-circuit if already on PATH.
if command -v "$EXECUTABLE_NAME" >/dev/null 2>&1; then
    log "$EXECUTABLE_NAME already installed at $(command -v "$EXECUTABLE_NAME")"
    exit 0
fi

# Detect OS.
uname_s="$(uname -s 2>/dev/null || echo unknown)"
case "$uname_s" in
    Linux*)                     os="linux" ;;
    Darwin*)                    os="osx" ;;
    MINGW*|MSYS*|CYGWIN*|Windows_NT) os="win" ;;
    *)                          die "unsupported OS: $uname_s" ;;
esac

# Detect architecture.
uname_m="$(uname -m 2>/dev/null || echo unknown)"
case "$uname_m" in
    x86_64|amd64)   arch="x64" ;;
    arm64|aarch64)  arch="arm64" ;;
    *)              die "unsupported architecture: $uname_m" ;;
esac

archive_name="${EXECUTABLE_NAME}-${os}-${arch}.zip"
archive_url="${RELEASE_URL_BASE}/${archive_name}"

log "host: ${os}-${arch}"
log "downloading ${archive_url}"

mkdir -p "$INSTALL_DIR"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

archive_path="${tmp_dir}/${archive_name}"
if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$archive_url" -o "$archive_path"
elif command -v wget >/dev/null 2>&1; then
    wget -q "$archive_url" -O "$archive_path"
else
    die "neither curl nor wget is available"
fi

log "extracting into ${INSTALL_DIR}"
if command -v unzip >/dev/null 2>&1; then
    unzip -q -o "$archive_path" -d "$INSTALL_DIR"
else
    die "unzip is not available"
fi

# Windows archives ship a .exe; strip the extension from the expected
# executable name when checking PATH.
if [ "$os" = "win" ] && [ -f "${INSTALL_DIR}/${EXECUTABLE_NAME}.exe" ]; then
    chmod +x "${INSTALL_DIR}/${EXECUTABLE_NAME}.exe" || true
elif [ -f "${INSTALL_DIR}/${EXECUTABLE_NAME}" ]; then
    chmod +x "${INSTALL_DIR}/${EXECUTABLE_NAME}"
else
    die "expected ${EXECUTABLE_NAME} in ${INSTALL_DIR} after extraction but did not find it"
fi

# Verify.
if ! command -v "$EXECUTABLE_NAME" >/dev/null 2>&1; then
    log "installed to ${INSTALL_DIR} but ${EXECUTABLE_NAME} is not on PATH"
    log "add this to your shell profile:  export PATH=\"${INSTALL_DIR}:\$PATH\""
    exit 2
fi

log "installed $(command -v "$EXECUTABLE_NAME")"
