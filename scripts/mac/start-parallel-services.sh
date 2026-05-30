#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_DIR="$ROOT/apps/backend"
FRONTEND_DIR="$ROOT/apps/frontend"

stop_port_owner_if_exists() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN || true)"
  [[ -z "$pids" ]] && return 0
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    kill -9 "$pid" || true
    echo "Cleared listener on port $port (PID=$pid)"
  done <<< "$pids"
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

echo "Starting parallel services (four new Terminal windows will open)..."
stop_port_owner_if_exists 3000
stop_port_owner_if_exists 3002
stop_port_owner_if_exists 3001
stop_port_owner_if_exists 3005

npm --prefix "$BACKEND_DIR" install
npm --prefix "$FRONTEND_DIR" install

open_terminal "cd \"$BACKEND_DIR\" && export AUTH_PORT=3005 && npm run dev:auth"
open_terminal "cd \"$BACKEND_DIR\" && export CHAIN_ENV=sepolia PORT=3000 && npm run dev"
open_terminal "cd \"$BACKEND_DIR\" && export CHAIN_ENV=local PORT=3002 && npm run dev"
open_terminal "cd \"$FRONTEND_DIR\" && export VITE_DEFAULT_NETWORK=sepolia && npm run dev"

echo "Started auth(3005), backend-sepolia(3000), backend-local(3002), frontend(3001)."
