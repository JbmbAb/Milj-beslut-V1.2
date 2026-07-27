# Daglig prod-rutin: backup + verify (anropas av schemalagt jobb eller manuellt)
#
# Usage:
#   pwsh scripts/ops/prod-daily.ps1

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Push-Location $Root

$logDir = Join-Path $Root "backups/prod/logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ("daily-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

function Log([string]$Msg) {
  $line = "{0} {1}" -f (Get-Date -Format "o"), $Msg
  Add-Content -Path $logFile -Value $line
  Write-Host $line
}

try {
  Log "prod-daily start"
  & pwsh (Join-Path $PSScriptRoot "backup-prod-db.ps1")
  if ($LASTEXITCODE -ne 0) { throw "backup failed exit $LASTEXITCODE" }
  & pwsh (Join-Path $PSScriptRoot "verify-prod.ps1")
  if ($LASTEXITCODE -ne 0) { throw "verify failed exit $LASTEXITCODE" }
  Log "prod-daily OK"
} catch {
  Log "prod-daily FAIL: $($_.Exception.Message)"
  exit 1
} finally {
  Pop-Location
}
