$ChainEnv = 'sepolia'

function Write-Log {
  param([string]$Message)
  Write-Host "[reset-redeploy] $Message"
}

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)
$backendDbPath = Join-Path $projectRoot ("apps\backend\data\database.{0}.sqlite" -f $ChainEnv)
$userDbPath = Join-Path $projectRoot ("apps\backend\data\users.{0}.sqlite" -f $ChainEnv)
$logPath = Join-Path $projectRoot "logs\sign-flow-error.log"
$blockchainDir = Join-Path $projectRoot "blockchain"
$deployJsonPath = Join-Path $blockchainDir "deployments-rental-sepolia.json"
$blockchainEnvPath = Join-Path $blockchainDir ".env"

if (-not (Test-Path $blockchainEnvPath)) {
  throw "Missing blockchain env file: $blockchainEnvPath"
}

function Wait-ForEnter {
  param([string]$Message = "Press Enter to exit...")
  if ([Environment]::UserInteractive) {
    Read-Host $Message | Out-Null
  }
}

Write-Log "Delete local data files"
if (Test-Path $backendDbPath) { Remove-Item -LiteralPath $backendDbPath -Force; Write-Log "Deleted database: $backendDbPath" }
if (Test-Path $userDbPath) { Remove-Item -LiteralPath $userDbPath -Force; Write-Log "Deleted user database: $userDbPath" }
if (Test-Path $logPath) { Remove-Item -LiteralPath $logPath -Force; Write-Log "Deleted log file: $logPath" }
if (Test-Path $deployJsonPath) { Remove-Item -LiteralPath $deployJsonPath -Force; Write-Log "Deleted old deployment file: $deployJsonPath" }

try {
  Write-Log "Compile and deploy contract (CHAIN_ENV=$ChainEnv)"
  Push-Location $blockchainDir
  try {
    & npm run compile
    if ($LASTEXITCODE -ne 0) { throw "Compile failed with exit code $LASTEXITCODE" }
    $oldPauseFlag = $env:NO_DEPLOY_PAUSE
    $env:NO_DEPLOY_PAUSE = '1'
    & npm run deploy:sepolia
    if ($LASTEXITCODE -ne 0) { throw "Deploy failed with exit code $LASTEXITCODE" }
  } finally {
    if ($null -eq $oldPauseFlag) {
      Remove-Item Env:NO_DEPLOY_PAUSE -ErrorAction SilentlyContinue
    } else {
      $env:NO_DEPLOY_PAUSE = $oldPauseFlag
    }
    Pop-Location
  }

  if (-not (Test-Path $deployJsonPath)) { throw "Deployment file not found: $deployJsonPath" }
  $deployInfo = Get-Content -LiteralPath $deployJsonPath -Raw | ConvertFrom-Json
  $newAddress = [string]$deployInfo.address
  if (-not $newAddress -or $newAddress -notmatch "^0x[a-fA-F0-9]{40}$") { throw "Invalid deployed address: $newAddress" }

  Write-Log "Reset and redeploy completed"
  Write-Log "New sepolia contract address: $newAddress"
  Write-Host ""
  Write-Host "Next steps:" -ForegroundColor Cyan
  Write-Host "1. Restart backend services"
  Write-Host "2. Restart frontend services"
  Write-Host "3. Create a new contract and retest payment plus fee split"
  Wait-ForEnter
} catch {
  Write-Error $_
  Wait-ForEnter "Script failed. Press Enter to exit..."
  throw
}
