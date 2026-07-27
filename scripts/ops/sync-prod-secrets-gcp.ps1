# Synka roterade prod-hemligheter till GCP Secret Manager (skippar DATABASE_URL)
#
# Usage:
#   pwsh scripts/ops/sync-prod-secrets-gcp.ps1
#   pwsh scripts/ops/sync-prod-secrets-gcp.ps1 -DryRun

param(
  [switch]$DryRun
)

$args = @("-SkipDatabaseUrl")
if ($DryRun) { $args += "-DryRun" }

$sync = Join-Path (Split-Path $PSScriptRoot -Parent) "gcp/sync-secrets-from-env.ps1"
& pwsh $sync @args
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Kör audit:"
& pwsh (Join-Path (Split-Path $PSScriptRoot -Parent) "gcp/audit-secrets.ps1")
