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
  NO_DEPLOY_PAUSE=1 npm run deploy:sepolia
)

[[ -f "$DEPLOY_JSON_PATH" ]] || { echo "Deployment file not found: $DEPLOY_JSON_PATH" >&2; exit 1; }

log "Reset and redeploy completed"
NEW_ADDRESS="$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(p.address||''));" "$DEPLOY_JSON_PATH")"
log "New sepolia contract address: $NEW_ADDRESS"
echo
echo "Next steps:"
echo "1. Restart backend services"
echo "2. Restart frontend services"
echo "3. Create a new contract and retest payment plus fee split"
if [[ -t 0 && "${CI:-}" != "true" ]]; then
  read -r -p "Press Enter to exit..." _
fi