param(
  [string]$Mode,

  [string]$Pdf,
  [string]$ListingId,
  [string]$SnapshotCid,
  [string]$SnapshotHash,
  [long]$AtSec,
  [ValidateSet('sepolia', 'local')]
  [string]$Network = 'sepolia',
  [string]$RpcUrl,
  [string]$ContractAddress
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $RepoRoot

function Show-Usage {
  Write-Host 'Usage:' -ForegroundColor Yellow
  Write-Host '  powershell -ExecutionPolicy Bypass -File scripts/ps1/verify-local.ps1 contract -Pdf D:\contracts\your-contract.pdf -Network sepolia'
  Write-Host '  powershell -ExecutionPolicy Bypass -File scripts/ps1/verify-local.ps1 listing -ListingId lst_xxx -Network sepolia'
  Write-Host ''
  Write-Host 'Or start the standalone verifier frontend with scripts/ps1/start-verifier.ps1.'
}

function Resolve-NodeCommand {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    throw 'node command not found in PATH.'
  }
  return $nodeCommand.Source
}

$node = Resolve-NodeCommand
$Mode = ([string]$Mode).Trim().ToLowerInvariant()

if (-not $Mode) {
  Show-Usage
  exit 1
}

if (@('contract', 'listing') -notcontains $Mode) {
  throw "Unsupported mode: $Mode. Use contract or listing."
}

if ($Mode -eq 'contract') {
  if (-not $Pdf) {
    throw 'Contract verification requires -Pdf <path>.'
  }
  $args = @('verifier/scripts/verify-contract-pdf.js', '--pdf', $Pdf, '--network', $Network)
} else {
  if (-not $ListingId) {
    throw 'Listing verification requires -ListingId <id>.'
  }
  $args = @('verifier/scripts/verify-listing.js', '--listing-id', $ListingId, '--network', $Network)
  if ($SnapshotCid) {
    $args += @('--snapshot-cid', $SnapshotCid)
  }
  if ($SnapshotHash) {
    $args += @('--snapshot-hash', $SnapshotHash)
  }
  if ($AtSec -gt 0) {
    $args += @('--at-sec', "$AtSec")
  }
}

if ($RpcUrl) {
  $args += @('--rpc-url', $RpcUrl)
}
if ($ContractAddress) {
  $args += @('--contract-address', $ContractAddress)
}

& $node @args
exit $LASTEXITCODE
