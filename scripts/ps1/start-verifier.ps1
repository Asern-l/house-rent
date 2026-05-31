$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$verifierDir = Join-Path $repoRoot 'verifier'
$nodeModulesDir = Join-Path $verifierDir 'node_modules'
$port = 3010

function Get-ListeningPid($Port) {
  try {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
    if ($conn) { return [int]$conn.OwningProcess }
  } catch {
  }

  $line = netstat -ano | Select-String -Pattern (":$Port\s") | Select-Object -First 1
  if ($line) {
    $parts = ($line.ToString() -split '\s+') | Where-Object { $_ }
    if ($parts.Length -ge 5) {
      return [int]$parts[-1]
    }
  }
  return $null
}

$existingPid = Get-ListeningPid -Port $port
if ($existingPid) {
  Write-Host "Stopping existing verifier process on http://127.0.0.1:$port ..."
  Stop-Process -Id $existingPid -Force -ErrorAction Stop
  Start-Sleep -Seconds 1
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
