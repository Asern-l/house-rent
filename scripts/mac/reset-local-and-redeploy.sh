#!/usr/bin/env bash
set -euo pipefail

CHAIN_ENV="local"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_DB_PATH="$ROOT/apps/backend/data/database.${CHAIN_ENV}.sqlite"
USER_DB_PATH="$ROOT/apps/backend/data/users.${CHAIN_ENV}.sqlite"
LOG_PATH="$ROOT/logs/sign-flow-error.log"
BLOCKCHAIN_DIR="$ROOT/blockchain"
GANACHE_DB_PATH="$BLOCKCHAIN_DIR/.ganache-db"
DEPLOY_JSON_PATH="$BLOCKCHAIN_DIR/deployments-rental-localhost.json"
START_NODE_SCRIPT="$ROOT/scripts/mac/start-persistent-local-node.sh"

log() {
  echo "[reset-redeploy] $1"
}

stop_local_node_if_running() {
  local pids
  pids="$(lsof -tiTCP:8545 -sTCP:LISTEN || true)"
  [[ -z "$pids" ]] && return 0
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    kill -9 "$pid" || true
    log "Stopped local node process on 8545 (PID=$pid)"
  done <<< "$pids"
  sleep 2
}

open_terminal() {
  local cmd="$1"
  osascript - "$cmd" <<'OSA'
on run argv
  tell application "Terminal"
    do script (item 1 of argv)
    activate
  end tell
end run
OSA
}

wait_local_node_ready() {
  local i
  for ((i=0; i<30; i++)); do
    if curl -sSf -H 'Content-Type: application/json' \
      --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
      http://127.0.0.1:8545 >/dev/null 2>&1; then
      log "Local node is ready on 127.0.0.1:8545"
      return 0
    fi
    sleep 1
  done
  echo "Local node did not become ready on 127.0.0.1:8545" >&2
  exit 1
}

log "Delete local data files"
stop_local_node_if_running
rm -f "$BACKEND_DB_PATH" "$USER_DB_PATH" "$LOG_PATH" "$DEPLOY_JSON_PATH"
rm -rf "$GANACHE_DB_PATH"

open_terminal "\"$START_NODE_SCRIPT\""
log "Started persistent local node script"
wait_local_node_ready

log "Compile and deploy contract (CHAIN_ENV=$CHAIN_ENV)"
(
  cd "$BLOCKCHAIN_DIR"
  npm install
  npm run compile
  npm run deploy:local
)

[[ -f "$DEPLOY_JSON_PATH" ]] || { echo "Deployment file not found: $DEPLOY_JSON_PATH" >&2; exit 1; }

(
  cd "$ROOT"
  npm run sync:abi
)

log "Reset and redeploy completed"
