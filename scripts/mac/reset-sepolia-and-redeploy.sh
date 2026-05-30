#!/usr/bin/env bash
set -euo pipefail

CHAIN_ENV="sepolia"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_DB_PATH="$ROOT/apps/backend/data/database.${CHAIN_ENV}.sqlite"
USER_DB_PATH="$ROOT/apps/backend/data/users.${CHAIN_ENV}.sqlite"
LOG_PATH="$ROOT/logs/sign-flow-error.log"
BLOCKCHAIN_DIR="$ROOT/blockchain"
DEPLOY_JSON_PATH="$BLOCKCHAIN_DIR/deployments-rental-sepolia.json"
BLOCKCHAIN_ENV_PATH="$BLOCKCHAIN_DIR/.env"

log() {
  echo "[reset-redeploy] $1"
}

[[ -f "$BLOCKCHAIN_ENV_PATH" ]] || { echo "Missing blockchain env file: $BLOCKCHAIN_ENV_PATH" >&2; exit 1; }

log "Delete local data files"
rm -f "$BACKEND_DB_PATH" "$USER_DB_PATH" "$LOG_PATH" "$DEPLOY_JSON_PATH"

log "Compile and deploy contract (CHAIN_ENV=$CHAIN_ENV)"
(
  cd "$BLOCKCHAIN_DIR"
  npm install
  npm run compile
  npm run deploy:sepolia
)

[[ -f "$DEPLOY_JSON_PATH" ]] || { echo "Deployment file not found: $DEPLOY_JSON_PATH" >&2; exit 1; }

(
  cd "$ROOT"
  npm run sync:abi
)

log "Reset and redeploy completed"
