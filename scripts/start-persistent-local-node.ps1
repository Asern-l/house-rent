# 文件说明：启动可持久化的本地链节点。
# 功能：使用 Ganache 启动本地链，并把链状态持久化到磁盘目录。

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
chcp 65001 > $null

$root = Split-Path -Parent $PSScriptRoot
$blockchain = Join-Path $root 'blockchain'

Write-Host 'Starting persistent local chain (Ganache) on 127.0.0.1:8545...'
Push-Location $blockchain
try {
  npm install
  npm run node:local
} finally {
  Pop-Location
}
