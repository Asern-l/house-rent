#!/usr/bin/env bash
# start-demo.sh — 一键启动完整演示环境（Sepolia + Local 双链）
#
# 启动顺序：
#   1. Ganache 本地链 (8545) — 新 Terminal 窗口
#   2. Auth 服务 (3005)       — 新 Terminal 窗口
#   3. Sepolia 后端 (3000)    — 新 Terminal 窗口
#   4. Local 后端 (3002)      — 新 Terminal 窗口
#   5. 前端 Vite (3001)       — 新 Terminal 窗口
#   6. 链上验真 (3010)         — 新 Terminal 窗口
#
# 用法：bash scripts/mac/start-demo.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_DIR="$ROOT/apps/backend"
FRONTEND_DIR="$ROOT/apps/frontend"
BLOCKCHAIN_DIR="$ROOT/blockchain"
VERIFIER_DIR="$ROOT/verifier"

# ── 工具函数 ──────────────────────────────────────────────────
stop_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  [[ -z "$pids" ]] && return 0
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    kill -9 "$pid" 2>/dev/null || true
    echo "  ✓ 清理端口 $port (PID $pid)"
  done <<< "$pids"
}

open_tab() {
  local title="$1"
  local cmd="$2"
  osascript - "$title" "$cmd" <<'OSA'
on run argv
  tell application "Terminal"
    do script (item 2 of argv)
    set custom title of front window to (item 1 of argv)
    activate
  end tell
end run
OSA
}

# ── 前置检查 ──────────────────────────────────────────────────
echo ""
echo "╔════════════════════════════════════════════╗"
echo "║   链上安居 · 演示环境一键启动               ║"
echo "║   Sepolia + Local 双链模式                  ║"
echo "╚════════════════════════════════════════════╝"
echo ""

# 检查 node_modules
echo "📦 检查依赖..."
npm --prefix "$BACKEND_DIR" install --silent
npm --prefix "$FRONTEND_DIR" install --silent
if [ -d "$VERIFIER_DIR" ] && [ -f "$VERIFIER_DIR/package.json" ]; then
  npm --prefix "$VERIFIER_DIR" install --silent
fi
echo "   依赖已就绪"
echo ""

# 清理端口
echo "🧹 清理已占用端口..."
stop_port 8545
stop_port 3005
stop_port 3000
stop_port 3002
stop_port 3001
stop_port 3010
echo ""

# ── 启动各服务 ────────────────────────────────────────────────
echo "🚀 启动服务（共 6 个 Terminal 窗口）..."

# 1. Ganache 本地链
GANACHE_LOCK="$BLOCKCHAIN_DIR/.ganache-db/LOCK"
[[ -f "$GANACHE_LOCK" ]] && rm -f "$GANACHE_LOCK"
open_tab "⛓ Local Chain :8545" \
  "cd \"$BLOCKCHAIN_DIR\" && npm install --silent && npx ganache \
    --server.host 127.0.0.1 \
    --server.port 8545 \
    --chain.chainId 31337 \
    --chain.allowUnlimitedContractSize true \
    --wallet.totalAccounts 10 \
    --wallet.defaultBalance 1000 \
    --database.dbPath ./.ganache-db"
echo "   [1/6] Ganache 本地链 → 127.0.0.1:8545"
sleep 1

# 2. Auth 服务
open_tab "🔐 Auth :3005" \
  "cd \"$BACKEND_DIR\" && export AUTH_PORT=3005 && npm run dev:auth"
echo "   [2/6] Auth 服务 → :3005"

# 3. Sepolia 后端
open_tab "🌐 Backend Sepolia :3000" \
  "cd \"$BACKEND_DIR\" && export CHAIN_ENV=sepolia PORT=3000 && npm run dev"
echo "   [3/6] Sepolia 后端 → :3000"

# 4. Local 后端
open_tab "🏠 Backend Local :3002" \
  "cd \"$BACKEND_DIR\" && export CHAIN_ENV=local PORT=3002 && npm run dev"
echo "   [4/6] Local 后端 → :3002"

# 5. 前端
open_tab "⚡ Frontend :3001" \
  "cd \"$FRONTEND_DIR\" && npm run dev"
echo "   [5/6] 前端 → http://127.0.0.1:3001"

# 6. 验真服务
if [ -d "$VERIFIER_DIR" ] && [ -f "$VERIFIER_DIR/package.json" ]; then
  open_tab "🔍 Verifier :3010" \
    "cd \"$VERIFIER_DIR\" && node server.js"
  echo "   [6/6] 链上验真 → http://127.0.0.1:3010"
else
  echo "   [6/6] 验真目录不存在，已跳过"
fi

# ── 汇总 ──────────────────────────────────────────────────────
echo ""
echo "✅ 全部启动完成！等待各窗口初始化（约 5-10 秒）后访问："
echo ""
echo "   🌍 主应用    http://127.0.0.1:3001"
echo "   🔍 链上验真  http://127.0.0.1:3010"
echo ""
echo "   网络切换：右上角下拉框 Sepolia ↔ Local"
echo "   Local 账号：MetaMask 导入 Hardhat 私钥（助记词 test test...junk）"
echo ""
