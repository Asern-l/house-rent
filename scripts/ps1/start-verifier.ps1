$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$verifierDir = Join-Path $repoRoot 'verifier'
$nodeModulesDir = Join-Path $verifierDir 'node_modules'
$port = 3010

try {
  $existing = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $port -State Listen -ErrorAction Stop | Select-Object -First 1
  if ($existing) {
    Write-Host "Verifier is already running at http://127.0.0.1:$port"
    exit 0
  }
} catch {
}

if (-not (Test-Path $nodeModulesDir)) {
  Write-Host 'Missing verifier dependencies. Run:'
  Write-Host '  cd verifier'
  Write-Host '  npm install'
  exit 1
}

Push-Location $verifierDir
try {
  node server.js
} finally {
  Pop-Location
}
