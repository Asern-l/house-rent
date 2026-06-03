# File: start persistent local blockchain node.
# Uses Ganache and persists chain state under blockchain/.ganache-db.

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
chcp 65001 > $null

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$blockchain = Join-Path $root 'blockchain'
$envFile = Join-Path $blockchain '.env'
$ganacheDbPath = Join-Path $blockchain '.ganache-db'
$ganacheLockPath = Join-Path $ganacheDbPath 'LOCK'

function Get-ListeningProcessOn8545 {
  try {
    return Get-NetTCPConnection -LocalPort 8545 -State Listen -ErrorAction Stop | Select-Object -First 1
  } catch {
    return $null
  }
}

function Stop-ListeningProcessOn8545 {
  $conn = Get-ListeningProcessOn8545
  if (-not $conn) { return }
  try {
    Stop-Process -Id $conn.OwningProcess -Force -ErrorAction Stop
    Write-Host "Stopped existing Ganache on 127.0.0.1:8545 (PID=$($conn.OwningProcess))."
    Start-Sleep -Seconds 2
  } catch {
    throw "Failed to stop existing Ganache process on 8545: $($_.Exception.Message)"
  }
}

function Get-BlockchainEnvValue {
  param([string]$Key)
  if (-not (Test-Path $envFile)) { return '' }
  $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match ("^\s*" + [regex]::Escape($Key) + "\s*=") } | Select-Object -First 1
  if (-not $line) { return '' }
  return ($line -replace ("^\s*" + [regex]::Escape($Key) + "\s*=\s*"), '').Trim()
}

function Normalize-PrivateKey {
  param([string]$Raw)
  $value = if ($null -eq $Raw) { '' } else { [string]$Raw }
  $value = $value.Trim()
  if (-not $value) { return '' }
  $body = if ($value.StartsWith('0x')) { $value.Substring(2) } else { $value }
  if ($body -notmatch '^[0-9a-fA-F]{64}$') { return '' }
  return "0x$body"
}

Write-Host 'Starting persistent local chain (Ganache) on 127.0.0.1:8545...'
if (Get-ListeningProcessOn8545) {
  Stop-ListeningProcessOn8545
}
if (Test-Path $ganacheLockPath) {
  Write-Host 'Found stale Ganache lock file. Removing blockchain/.ganache-db/LOCK before restart.'
  Remove-Item -LiteralPath $ganacheLockPath -Force -ErrorAction SilentlyContinue
}
Push-Location $blockchain
try {
  npm install
  $ganacheArgs = @(
    'ganache',
    '--server.host', '127.0.0.1',
    '--server.port', '8545',
    '--chain.chainId', '31337',
    '--chain.allowUnlimitedContractSize', 'true',
    '--wallet.totalAccounts', '10',
    '--wallet.defaultBalance', '1000',
    '--database.dbPath', './.ganache-db'
  )
  & npx @ganacheArgs
} finally {
  Pop-Location
}
