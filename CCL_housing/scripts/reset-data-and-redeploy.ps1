function Write-Log {
  param(
    [string]$Message
  )
  Write-Host "[reset-redeploy] $Message"
}

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$backendDbPath = Join-Path $projectRoot "apps\backend\data\database.sqlite"
$logPath = Join-Path $projectRoot "logs\sign-flow-error.log"
$blockchainDir = Join-Path $projectRoot "blockchain"
$deployJsonPath = Join-Path $blockchainDir "deployments-rental-sepolia.json"
$blockchainEnvPath = Join-Path $blockchainDir ".env"
$frontendEnvPath = Join-Path $projectRoot "apps\frontend\.env"
$abiSourcePath = Join-Path $blockchainDir "artifacts\contracts\RentalChain.sol\RentalChain.json"
$abiTargetPath = Join-Path $projectRoot "apps\frontend\src\shared\blockchain\RentalChainABI.json"

if (-not (Test-Path $blockchainEnvPath)) {
  throw "Missing blockchain env file: $blockchainEnvPath"
}

Write-Log "Delete local data files"

if (Test-Path $backendDbPath) {
  Remove-Item -LiteralPath $backendDbPath -Force
  Write-Log "Deleted database: $backendDbPath"
} else {
  Write-Log "Database not found, skip: $backendDbPath"
}

if (Test-Path $logPath) {
  Remove-Item -LiteralPath $logPath -Force
  Write-Log "Deleted log file: $logPath"
}

if (Test-Path $deployJsonPath) {
  Remove-Item -LiteralPath $deployJsonPath -Force
  Write-Log "Deleted old deployment file: $deployJsonPath"
}

Write-Log "Compile and deploy contract to Sepolia"

Push-Location $blockchainDir
try {
  & npx hardhat compile
  & npx hardhat run scripts/deploy_rental.js --network sepolia
} finally {
  Pop-Location
}

if (-not (Test-Path $deployJsonPath)) {
  throw "Deployment file not found: $deployJsonPath"
}

$deployInfo = Get-Content -LiteralPath $deployJsonPath -Raw | ConvertFrom-Json
$newAddress = [string]$deployInfo.address
if (-not $newAddress -or $newAddress -notmatch "^0x[a-fA-F0-9]{40}$") {
  throw "Invalid deployed address: $newAddress"
}
Write-Log "New contract address: $newAddress"

$envLines = @()
if (Test-Path $frontendEnvPath) {
  $envLines = Get-Content -LiteralPath $frontendEnvPath
}

$found = $false
$updated = foreach ($line in $envLines) {
  if ($line -match "^\s*VITE_CONTRACT_ADDRESS\s*=") {
    $found = $true
    "VITE_CONTRACT_ADDRESS=$newAddress"
  } else {
    $line
  }
}
if (-not $found) {
  $updated += "VITE_CONTRACT_ADDRESS=$newAddress"
}
Set-Content -LiteralPath $frontendEnvPath -Value $updated -Encoding UTF8
Write-Log "Updated frontend env: $frontendEnvPath"

if (-not (Test-Path $abiSourcePath)) {
  throw "ABI source not found: $abiSourcePath"
}
$artifact = Get-Content -LiteralPath $abiSourcePath -Raw | ConvertFrom-Json
$abiJson = $artifact.abi | ConvertTo-Json -Depth 100
Set-Content -LiteralPath $abiTargetPath -Value $abiJson -Encoding UTF8
Write-Log "Synced ABI: $abiTargetPath"

Write-Log "Reset and redeploy completed"
Write-Host ""
Write-Host "Next steps:"
Write-Host "1. npm --prefix apps/backend run dev"
Write-Host "2. npm --prefix apps/frontend run dev"
