$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$verifierDir = Join-Path $repoRoot 'verifier'
$nodeModulesDir = Join-Path $verifierDir 'node_modules'
$port = 3010
$healthUrl = "http://127.0.0.1:$port/api/health"
$siteUrl = "http://127.0.0.1:$port"

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

function Wait-ForVerifierReady($Url, $TimeoutSeconds = 20) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
        return $true
      }
    } catch {
    }
    Start-Sleep -Milliseconds 500
  }
  return $false
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

$nodeCmd = Get-Command node -ErrorAction Stop
$proc = Start-Process -FilePath $nodeCmd.Source `
  -ArgumentList 'server.js' `
  -WorkingDirectory $verifierDir `
  -WindowStyle Hidden `
  -PassThru

if (-not (Wait-ForVerifierReady -Url $healthUrl)) {
  try {
    if (-not $proc.HasExited) {
      Stop-Process -Id $proc.Id -Force -ErrorAction Stop
    }
  } catch {
  }
  throw "Verifier failed to become ready at $healthUrl"
}

Write-Host "Verifier is ready at $siteUrl"
Start-Process $siteUrl
