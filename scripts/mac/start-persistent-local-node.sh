#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BLOCKCHAIN_DIR="$ROOT/blockchain"

echo "[start-persistent-local-node] Starting persistent local chain (Ganache) on 127.0.0.1:8545..."
cd "$BLOCKCHAIN_DIR"
npm install
npm run node:local
