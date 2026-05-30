# File: start persistent local blockchain node.
# Uses Ganache and persists chain state under blockchain/.ganache-db.

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
chcp 65001 > $null

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$blockchain = Join-Path $root 'blockchain'

Write-Host 'Starting persistent local chain (Ganache) on 127.0.0.1:8545...'
Push-Location $blockchain
try {
  npm install
  npm run node:local
} finally {
  Pop-Location
}
