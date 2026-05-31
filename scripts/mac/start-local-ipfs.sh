#!/usr/bin/env bash
set -euo pipefail

API_PORT="${IPFS_API_PORT:-5001}"
GATEWAY_PORT="${IPFS_GATEWAY_PORT:-8080}"
SWARM_PORT="${IPFS_SWARM_PORT:-4001}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IPFS_PATH_DIR="$ROOT/.ipfs-data"

ARCH="$(uname -m)"
case "$ARCH" in
  arm64) PLATFORM="darwin-arm64" ;;
  x86_64) PLATFORM="darwin-amd64" ;;
  *) echo "Unsupported macOS architecture: $ARCH" >&2; exit 1 ;;
esac

IPFS_BIN="$ROOT/.tools/ipfs/$PLATFORM/current/ipfs"
if [[ ! -x "$IPFS_BIN" ]]; then
  echo "Missing Kubo binary: $IPFS_BIN" >&2
  echo "Run scripts/mac/setup-local-ipfs.sh first." >&2
  exit 1
fi

mkdir -p "$IPFS_PATH_DIR"
export IPFS_PATH="$IPFS_PATH_DIR"

if node -e "fetch('http://127.0.0.1:${API_PORT}/api/v0/version',{method:'POST'}).then(r=>{if(!r.ok) process.exit(1)}).catch(()=>process.exit(1))" >/dev/null 2>&1; then
  echo "[start-local-ipfs] Project-local IPFS node is already running on http://127.0.0.1:${API_PORT}/api/v0"
  exit 0
fi

if [[ ! -f "$IPFS_PATH/config" ]]; then
  echo "[start-local-ipfs] Initializing project-local IPFS repo at $IPFS_PATH"
  "$IPFS_BIN" init
fi

"$IPFS_BIN" config Addresses.API "/ip4/127.0.0.1/tcp/$API_PORT"
"$IPFS_BIN" config Addresses.Gateway "/ip4/127.0.0.1/tcp/$GATEWAY_PORT"
"$IPFS_BIN" config --json Addresses.Swarm "[\"/ip4/0.0.0.0/tcp/$SWARM_PORT\", \"/ip6/::/tcp/$SWARM_PORT\"]"
"$IPFS_BIN" config --json API.HTTPHeaders.Access-Control-Allow-Origin "[\"http://127.0.0.1:3001\", \"http://localhost:3001\"]"
"$IPFS_BIN" config --json API.HTTPHeaders.Access-Control-Allow-Methods "[\"PUT\", \"POST\", \"GET\"]"

echo "[start-local-ipfs] Starting project-local IPFS node..."
echo "[start-local-ipfs] IPFS_PATH   : $IPFS_PATH"
echo "[start-local-ipfs] API endpoint: http://127.0.0.1:$API_PORT/api/v0"
echo "[start-local-ipfs] Gateway     : http://127.0.0.1:$GATEWAY_PORT/ipfs/"
echo "[start-local-ipfs] Binary      : $IPFS_BIN"

"$IPFS_BIN" daemon
