# Mimers Brunn — archive audit (importRegistry LM + SGU)
#
# Usage:
#   pwsh scripts/ops/archive-audit.ps1
#   pwsh scripts/ops/archive-audit.ps1 -Hash
#   pwsh scripts/ops/archive-audit.ps1 -Provider SGU

param(
  [switch]$Hash,
  [string]$Provider = "",
  [string]$ArchiveRoot = ""
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

if ($ArchiveRoot) {
  $env:GEO_MASTER_ARCHIVE = $ArchiveRoot
} elseif (-not $env:GEO_MASTER_ARCHIVE) {
  $default = "H:\Delade enheter\Miljöbeslut\GEO_Master_Archive"
  if (Test-Path $default) {
    $env:GEO_MASTER_ARCHIVE = $default
  }
}

$args = @("scripts/db/archive-local-verify-registry.mjs")
if ($Hash) { $args += "--hash" }
if ($Provider) { $args += "--provider=$Provider" }

Push-Location $Root
try {
  node @args
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  $report = Join-Path $Root "storage/manifests/archive-local-verify-registry.json"
  if (Test-Path $report) {
    $data = Get-Content $report -Raw | ConvertFrom-Json
    $rows = @($data.rows)
    $checksumMissing = @($rows | Where-Object { $_.status -eq "checksum_missing" }).Count
    $legacy = @($rows | Where-Object { $_.status -eq "legacy_path_mismatch" }).Count
    Write-Host ""
    Write-Host "Summary: $($rows.Count) datasets, checksum_missing=$checksumMissing, legacy_path_mismatch=$legacy"
    if ($checksumMissing -gt 0 -or $legacy -gt 0) {
      Write-Host "Definition of Done ej uppfylld — se docs/ops/local-prod-fas2.md"
      exit 1
    }
    Write-Host "Archive audit OK (0 % checksum_missing)"
  }
} finally {
  Pop-Location
}
