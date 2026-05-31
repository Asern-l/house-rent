#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
VERIFIER_DIR="$REPO_ROOT/verifier"
PORT=3010

if command -v lsof >/dev/null 2>&1; then
  if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Verifier is already running at http://127.0.0.1:$PORT"
    exit 0
  fi
fi

if [ ! -d "$VERIFIER_DIR/node_modules" ]; then
  echo "Missing verifier dependencies. Run:"
  echo "  cd verifier"
  echo "  npm install"
  exit 1
fi

cd "$VERIFIER_DIR"
node server.js
