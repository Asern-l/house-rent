param(
  [int]$ApiPort = 5001,
  [int]$GatewayPort = 8080,
  [int]$SwarmPort = 4001
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
chcp 65001 > $null

function Pause-IfExplorerLaunch {
  try {
    $current = Get-CimInstance Win32_Process -Filter "ProcessId = $PID"
    if (-not $current -or -not $current.ParentProcessId) {
      return
    }
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($current.ParentProcessId)"
    if ($parent -and $parent.Name -ieq 'explorer.exe') {
      Read-Host 'Press Enter to close this window'
    }
  } catch {
  }
}

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ipfsPath = Join-Path $root '.ipfs-data'
$ipfsExe = Join-Path $root '.tools\ipfs\windows-amd64\current\ipfs.exe'

if (-not (Test-Path $ipfsExe)) {
  throw "Missing Kubo binary: $ipfsExe`nRun scripts/ps1/setup-local-ipfs.ps1 first."
}

New-Item -ItemType Directory -Force -Path $ipfsPath | Out-Null
$env:IPFS_PATH = $ipfsPath

try {
  $running = @"
fetch('http://127.0.0.1:$ApiPort/api/v0/version', { method: 'POST' })
  .then((response) => response.ok ? response.text() : Promise.reject(new Error(String(response.status))))
  .then((text) => { console.log(text); })
  .catch(() => { process.exit(1); });
"@
  $null = $running | node -
  if ($LASTEXITCODE -eq 0) {
    Write-Host "Project-local IPFS node is already running on http://127.0.0.1:$ApiPort/api/v0"
    Pause-IfExplorerLaunch
    exit 0
  }
} catch {
}

if (-not (Test-Path (Join-Path $ipfsPath 'config'))) {
  Write-Host "Initializing project-local IPFS repo at $ipfsPath"
  & $ipfsExe init
}

& $ipfsExe config Addresses.API "/ip4/127.0.0.1/tcp/$ApiPort"
& $ipfsExe config Addresses.Gateway "/ip4/127.0.0.1/tcp/$GatewayPort"
& $ipfsExe config --json Addresses.Swarm "[`"/ip4/0.0.0.0/tcp/$SwarmPort`", `"/ip6/::/tcp/$SwarmPort`"]"
& $ipfsExe config --json API.HTTPHeaders.Access-Control-Allow-Origin '["http://127.0.0.1:3001", "http://localhost:3001"]'
& $ipfsExe config --json API.HTTPHeaders.Access-Control-Allow-Methods '["PUT", "POST", "GET"]'

Write-Host "Starting project-local IPFS node..."
Write-Host "IPFS_PATH      : $ipfsPath"
Write-Host "API endpoint   : http://127.0.0.1:$ApiPort/api/v0"
Write-Host "Gateway        : http://127.0.0.1:$GatewayPort/ipfs/"
Write-Host "Kubo binary    : $ipfsExe"

& $ipfsExe daemon
