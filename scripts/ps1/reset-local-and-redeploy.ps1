$ChainEnv = 'local'

function Write-Log {
  param([string]$Message)
  Write-Host "[reset-redeploy] $Message"
}

function Stop-LocalNodeIfRunning {
  $conn = Get-NetTCPConnection -LocalPort 8545 -State Listen -ErrorAction SilentlyContinue
  if ($conn) {
    Stop-Process -Id $conn.OwningProcess -Force
    Write-Log "Stopped local node process on 8545 (PID=$($conn.OwningProcess))"
    Start-Sleep -Seconds 2
  }
}

function Start-LocalNode {
  $startScript = Join-Path $projectRoot "scripts\ps1\start-persistent-local-node.ps1"
  Start-Process powershell -ArgumentList '-ExecutionPolicy', 'Bypass', '-File', $startScript | Out-Null
  Write-Log "Started persistent local node script"
}

function Wait-LocalNodeReady {
  for ($i = 0; $i -lt 30; $i++) {
    try {
      $response = Invoke-RestMethod -Uri 'http://127.0.0.1:8545' -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' -TimeoutSec 2
      if ($response.result) {
        Write-Log "Local node is ready on 127.0.0.1:8545"
        return
      }
    } catch {}
    Start-Sleep -Seconds 1
  }
  throw "Local node did not become ready on 127.0.0.1:8545"
}

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)
$backendDbPath = Join-Path $projectRoot ("apps\backend\data\database.{0}.sqlite" -f $ChainEnv)
$userDbPath = Join-Path $projectRoot ("apps\backend\data\users.{0}.sqlite" -f $ChainEnv)
$logPath = Join-Path $projectRoot "logs\sign-flow-error.log"
$blockchainDir = Join-Path $projectRoot "blockchain"
$ganacheDbPath = Join-Path $blockchainDir ".ganache-db"
$deployJsonPath = Join-Path $blockchainDir "deployments-rental-localhost.json"
$frontendEnvPath = Join-Path $projectRoot "apps\frontend\.env"
$abiSourcePath = Join-Path $blockchainDir "artifacts\contracts\RentalChain.sol\RentalChain.json"
$abiTargetPath = Join-Path $projectRoot "apps\frontend\src\shared\blockchain\RentalChainABI.json"

Write-Log "Delete local data files"
Stop-LocalNodeIfRunning
if (Test-Path $backendDbPath) { Remove-Item -LiteralPath $backendDbPath -Force; Write-Log "Deleted database: $backendDbPath" }
if (Test-Path $userDbPath) { Remove-Item -LiteralPath $userDbPath -Force; Write-Log "Deleted user database: $userDbPath" }
if (Test-Path $logPath) { Remove-Item -LiteralPath $logPath -Force; Write-Log "Deleted log file: $logPath" }
if (Test-Path $deployJsonPath) { Remove-Item -LiteralPath $deployJsonPath -Force; Write-Log "Deleted old deployment file: $deployJsonPath" }
if (Test-Path $ganacheDbPath) { Remove-Item -LiteralPath $ganacheDbPath -Recurse -Force; Write-Log "Deleted Ganache database: $ganacheDbPath" }
Start-LocalNode
Wait-LocalNodeReady

Write-Log "Compile and deploy contract (CHAIN_ENV=$ChainEnv)"
Push-Location $blockchainDir
try {
  & npm run compile
  & npm run deploy:local
} finally {
  Pop-Location
}

if (-not (Test-Path $deployJsonPath)) { throw "Deployment file not found: $deployJsonPath" }
$deployInfo = Get-Content -LiteralPath $deployJsonPath -Raw | ConvertFrom-Json
$newAddress = [string]$deployInfo.address
if (-not $newAddress -or $newAddress -notmatch "^0x[a-fA-F0-9]{40}$") { throw "Invalid deployed address: $newAddress" }

$envLines = @()
if (Test-Path $frontendEnvPath) { $envLines = Get-Content -LiteralPath $frontendEnvPath }
$targetKey = 'VITE_CONTRACT_ADDRESS_LOCAL'
$found = $false
$updated = foreach ($line in $envLines) {
  if ($line -match ("^\s*" + [regex]::Escape($targetKey) + "\s*=")) { $found = $true; "$targetKey=$newAddress" } else { $line }
}
if (-not $found) { $updated += "$targetKey=$newAddress" }
Set-Content -LiteralPath $frontendEnvPath -Value $updated -Encoding UTF8

if (-not (Test-Path $abiSourcePath)) { throw "ABI source not found: $abiSourcePath" }
$artifact = Get-Content -LiteralPath $abiSourcePath -Raw | ConvertFrom-Json
$abiJson = $artifact.abi | ConvertTo-Json -Depth 100
Set-Content -LiteralPath $abiTargetPath -Value $abiJson -Encoding UTF8

Write-Log "Reset and redeploy completed"
