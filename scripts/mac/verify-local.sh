#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [[ $# -lt 1 ]]; then
  echo "Usage:" >&2
  echo "  bash scripts/mac/verify-local.sh contract --pdf <path> [--network sepolia|local] [--rpc-url <url>] [--contract-address <addr>]" >&2
  echo "  bash scripts/mac/verify-local.sh listing --listing-id <id> [--snapshot-cid <cid>] [--snapshot-hash <hash>] [--network sepolia|local] [--rpc-url <url>] [--contract-address <addr>]" >&2
  exit 1
fi

MODE="$1"
shift

case "$MODE" in
  contract)
    node verifier/scripts/verify-contract-pdf.js "$@"
    ;;
  listing)
    node verifier/scripts/verify-listing.js "$@"
    ;;
  *)
    echo "Unsupported mode: $MODE" >&2
    exit 1
    ;;
esac
