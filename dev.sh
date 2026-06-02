#!/usr/bin/env bash
# 一键启动所有开发服务（Sepolia 模式）
# 用法：./dev.sh [--local]
#   --local   使用本地 Hardhat 网络（端口 3002），默认 Sepolia（端口 3000）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT/apps/backend"
FRONTEND_DIR="$ROOT/apps/frontend"

# ── 参数解析 ──────────────────────────────────────────────
CHAIN_ENV="sepolia"
BACKEND_PORT=3000
if [[ "${1:-}" == "--local" ]]; then
  CHAIN_ENV="local"
  BACKEND_PORT=3002
fi

# ── 端口清理 ──────────────────────────────────────────────
kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  [[ -z "$pids" ]] && return 0
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    kill "$pid" 2>/dev/null || true
  done <<< "$pids"
  echo "  cleared port $port"
}

echo "▶ 停止占用端口..."
kill_port "$BACKEND_PORT"
kill_port 3001
kill_port 3005

# ── 依赖检查 ──────────────────────────────────────────────
echo "▶ 检查依赖..."
[[ ! -d "$BACKEND_DIR/node_modules" ]] && npm --prefix "$BACKEND_DIR" install --silent
[[ ! -d "$FRONTEND_DIR/node_modules" ]] && npm --prefix "$FRONTEND_DIR" install --silent

# ── 日志目录 ──────────────────────────────────────────────
LOG_DIR="$ROOT/.logs"
mkdir -p "$LOG_DIR"

# ── IPFS Daemon ───────────────────────────────────────────
IPFS_PID=""
if command -v ipfs &>/dev/null; then
  if curl -sf -X POST http://127.0.0.1:5001/api/v0/version > /dev/null 2>&1; then
    echo "▶ IPFS 已在运行     → http://127.0.0.1:5001"
  else
    echo "▶ 启动 IPFS daemon  → http://127.0.0.1:5001"
    ipfs daemon > "$LOG_DIR/ipfs.log" 2>&1 &
    IPFS_PID=$!
    # 等待 IPFS 就绪（最多 8 秒）
    for i in $(seq 1 8); do
      sleep 1
      curl -sf -X POST http://127.0.0.1:5001/api/v0/version > /dev/null 2>&1 && break
    done
  fi
else
  echo "▶ IPFS 未安装，跳过  (brew install ipfs)"
fi

# ── 启动服务 ──────────────────────────────────────────────
echo "▶ 启动认证服务      → http://127.0.0.1:3005"
AUTH_PORT=3005 node "$BACKEND_DIR/src/auth-server.js" \
  > "$LOG_DIR/auth.log" 2>&1 &
AUTH_PID=$!

echo "▶ 启动后端 ($CHAIN_ENV)  → http://127.0.0.1:$BACKEND_PORT"
CHAIN_ENV="$CHAIN_ENV" PORT="$BACKEND_PORT" node "$BACKEND_DIR/src/index.js" \
  > "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

echo "▶ 启动前端           → http://localhost:3001"
VITE_DEFAULT_NETWORK="$CHAIN_ENV" npm --prefix "$FRONTEND_DIR" run dev \
  > "$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!

# ── 健康检查 ──────────────────────────────────────────────
echo "▶ 等待服务就绪..."
for i in $(seq 1 15); do
  sleep 1
  AUTH_OK=false; BACKEND_OK=false; FRONT_OK=false
  curl -sf "http://127.0.0.1:3005/api/health" > /dev/null 2>&1 && AUTH_OK=true
  curl -sf "http://127.0.0.1:$BACKEND_PORT/api/health" > /dev/null 2>&1 && BACKEND_OK=true
  curl -sf "http://localhost:3001/" > /dev/null 2>&1 && FRONT_OK=true
  $AUTH_OK && $BACKEND_OK && $FRONT_OK && break
done

IPFS_OK=false
curl -sf -X POST http://127.0.0.1:5001/api/v0/version > /dev/null 2>&1 && IPFS_OK=true

echo ""
echo "┌─────────────────────────────────────────────┐"
if $AUTH_OK;    then echo "│  ✓ 认证服务   http://127.0.0.1:3005         │"
                else echo "│  ✗ 认证服务   启动失败（见 .logs/auth.log）  │"; fi
if $BACKEND_OK; then echo "│  ✓ 后端       http://127.0.0.1:$BACKEND_PORT ($CHAIN_ENV)  │"
                else echo "│  ✗ 后端       启动失败（见 .logs/backend.log）│"; fi
if $FRONT_OK;   then echo "│  ✓ 前端       http://localhost:3001          │"
                else echo "│  ✗ 前端       启动失败（见 .logs/frontend.log）│"; fi
if $IPFS_OK;    then echo "│  ✓ IPFS       http://127.0.0.1:5001          │"
                else echo "│  - IPFS       未运行（IPFS 功能不可用）        │"; fi
echo "└─────────────────────────────────────────────┘"
echo ""
echo "日志目录：$LOG_DIR"
echo "按 Ctrl+C 停止所有服务"

# ── 退出时清理 ────────────────────────────────────────────
trap 'echo ""; echo "▶ 停止服务..."; kill $AUTH_PID $BACKEND_PID $FRONTEND_PID ${IPFS_PID:-} 2>/dev/null; exit 0' INT TERM

wait
