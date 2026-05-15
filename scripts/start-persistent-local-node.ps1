# 文件说明：启动可持久化本地链节点。
# 功能：使用 Ganache 启动本地链，并将链状态持久化到磁盘目录。

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$blockchain = Join-Path $root 'blockchain'

Write-Host '启动可持久化本地链（Ganache，127.0.0.1:8545）...'
Push-Location $blockchain
try {
  npm install
  npm run node:local
} finally {
  Pop-Location
}
