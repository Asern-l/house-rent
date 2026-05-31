#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-latest}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOLS_ROOT="$ROOT/.tools/ipfs"
TMP_ROOT="$TOOLS_ROOT/tmp"

ARCH="$(uname -m)"
case "$ARCH" in
  arm64) PLATFORM="darwin-arm64" ;;
  x86_64) PLATFORM="darwin-amd64" ;;
  *) echo "Unsupported macOS architecture: $ARCH" >&2; exit 1 ;;
esac

INSTALL_ROOT="$TOOLS_ROOT/$PLATFORM"
mkdir -p "$TMP_ROOT" "$INSTALL_ROOT"

if [[ "$VERSION" == "latest" ]]; then
  echo "[setup-local-ipfs] Resolving latest stable Kubo release from dist.ipfs.tech..."
  VERSION="$(curl -fsSL https://dist.ipfs.tech/kubo/versions | grep -v '\-rc' | tail -n 1 | sed 's/^v//')"
  if [[ -z "$VERSION" ]]; then
    echo "Unable to resolve a stable Kubo version from dist.ipfs.tech." >&2
    exit 1
  fi
fi

ARCHIVE_NAME="kubo_v${VERSION}_${PLATFORM}.tar.gz"
DOWNLOAD_URL="https://dist.ipfs.tech/kubo/v${VERSION}/${ARCHIVE_NAME}"
ARCHIVE_PATH="$TMP_ROOT/$ARCHIVE_NAME"
EXTRACT_DIR="$TMP_ROOT/kubo-v${VERSION}-${PLATFORM}"
TARGET_DIR="$INSTALL_ROOT/kubo-v${VERSION}"
CURRENT_LINK="$INSTALL_ROOT/current"

if [[ ! -f "$ARCHIVE_PATH" ]]; then
  echo "[setup-local-ipfs] Downloading Kubo v$VERSION from $DOWNLOAD_URL"
  curl -fL "$DOWNLOAD_URL" -o "$ARCHIVE_PATH"
else
  echo "[setup-local-ipfs] Using cached archive: $ARCHIVE_PATH"
fi

rm -rf "$EXTRACT_DIR" "$TARGET_DIR"
mkdir -p "$EXTRACT_DIR" "$TARGET_DIR"
tar -xzf "$ARCHIVE_PATH" -C "$EXTRACT_DIR"
cp -R "$EXTRACT_DIR/kubo/." "$TARGET_DIR/"

rm -f "$CURRENT_LINK"
ln -s "$TARGET_DIR" "$CURRENT_LINK"

if [[ ! -x "$CURRENT_LINK/ipfs" ]]; then
  echo "ipfs binary not found after extraction: $CURRENT_LINK/ipfs" >&2
  exit 1
fi

echo
echo "[setup-local-ipfs] Kubo installed successfully."
echo "[setup-local-ipfs] Version : $VERSION"
echo "[setup-local-ipfs] Binary  : $CURRENT_LINK/ipfs"
echo
echo "[setup-local-ipfs] Next step:"
echo "bash scripts/mac/start-local-ipfs.sh"
