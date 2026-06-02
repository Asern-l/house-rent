#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BLOCKCHAIN_DIR="$ROOT/blockchain"
ENV_FILE="$BLOCKCHAIN_DIR/.env"
GANACHE_DB_PATH="$BLOCKCHAIN_DIR/.ganache-db"
GANACHE_LOCK_PATH="$GANACHE_DB_PATH/LOCK"

read_env_value() {
  local key="$1"
  [[ -f "$ENV_FILE" ]] || return 0
  grep -E "^[[:space:]]*${key}=" "$ENV_FILE" | head -n1 | sed -E "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*//"
}

normalize_private_key() {
  local value="${1:-}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  [[ -n "$value" ]] || { echo ""; return 0; }
  local body="$value"
  [[ "$body" == 0x* ]] && body="${body:2}"
  if [[ ! "$body" =~ ^[0-9a-fA-F]{64}$ ]]; then
    echo ""
    return 0
  fi
  echo "0x$body"
}

get_listening_pid_on_8545() {
  lsof -tiTCP:8545 -sTCP:LISTEN 2>/dev/null | head -n1 || true
}

stop_listening_process_on_8545() {
  local pid
  pid="$(get_listening_pid_on_8545)"
  [[ -n "$pid" ]] || return 0
  kill -9 "$pid" || true
  echo "Stopped existing Ganache on 127.0.0.1:8545 (PID=$pid)."
  sleep 2
}

echo "[start-persistent-local-node] Starting persistent local chain (Ganache) on 127.0.0.1:8545..."
if [[ -n "$(get_listening_pid_on_8545)" ]]; then
  stop_listening_process_on_8545
fi
if [[ -f "$GANACHE_LOCK_PATH" ]]; then
  echo "Found stale Ganache lock file. Removing blockchain/.ganache-db/LOCK before restart."
  rm -f "$GANACHE_LOCK_PATH"
fi
cd "$BLOCKCHAIN_DIR"
npm install
GANACHE_ARGS=(
  ganache
  --server.host 127.0.0.1
  --server.port 8545
  --chain.chainId 31337
  --wallet.totalAccounts 10
  --wallet.defaultBalance 1000
  --database.dbPath ./.ganache-db
)
npx "${GANACHE_ARGS[@]}"
