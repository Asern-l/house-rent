param(
  [string]$Version = 'latest'
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
chcp 65001 > $null

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$toolsRoot = Join-Path $root '.tools\ipfs'
$tmpRoot = Join-Path $toolsRoot 'tmp'
$installRoot = Join-Path $toolsRoot 'windows-amd64'

New-Item -ItemType Directory -Force -Path $toolsRoot, $tmpRoot, $installRoot | Out-Null

if ($Version -eq 'latest') {
  Write-Host 'Resolving latest stable Kubo release from dist.ipfs.tech...'
  $versionsText = Invoke-WebRequest -Uri 'https://dist.ipfs.tech/kubo/versions' -UseBasicParsing | Select-Object -ExpandProperty Content
  $stableVersions = $versionsText -split "`n" |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -and ($_ -notmatch '-rc') }
  if (-not $stableVersions -or $stableVersions.Count -eq 0) {
    throw 'Unable to resolve a stable Kubo version from dist.ipfs.tech'
  }
  $Version = $stableVersions[-1].TrimStart('v')
}

$archiveName = "kubo_v$Version`_windows-amd64.zip"
$downloadUrl = "https://dist.ipfs.tech/kubo/v$Version/$archiveName"
$archivePath = Join-Path $tmpRoot $archiveName
$extractDir = Join-Path $tmpRoot "kubo-v$Version"
$targetDir = Join-Path $installRoot "kubo-v$Version"
$currentDir = Join-Path $installRoot 'current'

if (-not (Test-Path $archivePath)) {
  Write-Host "Downloading Kubo v$Version from $downloadUrl"
  Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath
} else {
  Write-Host "Using cached archive: $archivePath"
}

if (Test-Path $extractDir) {
  Remove-Item -LiteralPath $extractDir -Recurse -Force
}
Expand-Archive -LiteralPath $archivePath -DestinationPath $extractDir -Force

if (Test-Path $targetDir) {
  Remove-Item -LiteralPath $targetDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
Copy-Item -Path (Join-Path $extractDir 'kubo\*') -Destination $targetDir -Recurse -Force

if (Test-Path $currentDir) {
  Remove-Item -LiteralPath $currentDir -Recurse -Force
}
Copy-Item -Path $targetDir -Destination $currentDir -Recurse -Force

$ipfsExe = Join-Path $currentDir 'ipfs.exe'
if (-not (Test-Path $ipfsExe)) {
  throw "ipfs.exe not found after extraction: $ipfsExe"
}

Write-Host ''
Write-Host 'Kubo installed successfully.'
Write-Host "Version : $Version"
Write-Host "Binary  : $ipfsExe"
Write-Host ''
Write-Host 'Next step:'
Write-Host 'powershell -ExecutionPolicy Bypass -File scripts/ps1/start-local-ipfs.ps1'
