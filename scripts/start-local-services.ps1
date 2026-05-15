# Single-network startup script (Local)
# Starts auth(3005) + backend(local:3002) + frontend(3001)
# Note: start scripts/start-persistent-local-node.ps1 first.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'apps\backend'
$frontend = Join-Path $root 'apps\frontend'

function Stop-PortOwnerIfExists {
  param([int]$Port)
  $listeners = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  if (-not $listeners) { return }
  $pids = $listeners | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 0 }
  foreach ($procId in $pids) {
    try {
      Stop-Process -Id $procId -Force -ErrorAction Stop
      Write-Host "Cleared listener on port $Port (PID=$procId)"
    } catch {
      Write-Host "Failed to clear port $Port (PID=$procId): $($_.Exception.Message)"
    }
  }
}

Write-Host 'Starting Local services (three new terminal windows will open)...'
Stop-PortOwnerIfExists -Port 3002
Stop-PortOwnerIfExists -Port 3001
Stop-PortOwnerIfExists -Port 3005

Push-Location $backend
npm install
$authProcess = Start-Process powershell -PassThru -ArgumentList '-NoExit', '-Command', "Set-Location '$backend'; `$env:AUTH_PORT='3005'; npm run dev:auth"
$backendProcess = Start-Process powershell -PassThru -ArgumentList '-NoExit', '-Command', "Set-Location '$backend'; `$env:CHAIN_ENV='local'; `$env:PORT='3002'; npm run dev"
Pop-Location

Push-Location $frontend
npm install
$frontendProcess = Start-Process powershell -PassThru -ArgumentList '-NoExit', '-Command', "Set-Location '$frontend'; `$env:VITE_DEFAULT_NETWORK='local'; npm run dev"
Pop-Location

Write-Host "Started: auth PID=$($authProcess.Id), backend-local PID=$($backendProcess.Id), frontend PID=$($frontendProcess.Id)"
Write-Host 'Close each service window to stop that service process.'
