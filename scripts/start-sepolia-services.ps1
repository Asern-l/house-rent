# Single-network startup script (Sepolia)
# Starts auth(3005) + backend(sepolia:3000) + frontend(3001)

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

Write-Host 'Starting Sepolia services (three new terminal windows will open)...'
Stop-PortOwnerIfExists -Port 3000
Stop-PortOwnerIfExists -Port 3001
Stop-PortOwnerIfExists -Port 3005

Push-Location $backend
npm install
$authProcess = Start-Process powershell -PassThru -ArgumentList '-NoExit', '-Command', "Set-Location '$backend'; `$env:AUTH_PORT='3005'; npm run dev:auth"
$backendProcess = Start-Process powershell -PassThru -ArgumentList '-NoExit', '-Command', "Set-Location '$backend'; `$env:CHAIN_ENV='sepolia'; `$env:PORT='3000'; npm run dev"
Pop-Location

Push-Location $frontend
npm install
$frontendProcess = Start-Process powershell -PassThru -ArgumentList '-NoExit', '-Command', "Set-Location '$frontend'; `$env:VITE_DEFAULT_NETWORK='sepolia'; npm run dev"
Pop-Location

Write-Host "Started: auth PID=$($authProcess.Id), backend-sepolia PID=$($backendProcess.Id), frontend PID=$($frontendProcess.Id)"
Write-Host 'Close each service window to stop that service process.'
