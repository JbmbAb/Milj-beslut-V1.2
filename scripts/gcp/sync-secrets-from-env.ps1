# Synka hemligheter från .env.production till GCP Secret Manager
#
# Policy (2026-07-27):
#   - Lantmäteriet: CONSUMER_KEY + CONSUMER_SECRET
#   - Trafikverket: TRAFIKVERKET_API_KEY (lokal token vid behov, ej GCP-krav)
#   - OpenAI / legacy LM-nycklar / BankID: synkas endast om satt i env-filen
#
# Usage:
#   pwsh scripts/gcp/sync-secrets-from-env.ps1
#   pwsh scripts/gcp/sync-secrets-from-env.ps1 -EnvFile .env.production -ProjectId miljointelligens -DryRun
#   pwsh scripts/gcp/sync-secrets-from-env.ps1 -SkipDatabaseUrl
#
# Kräver: gcloud auth, Secret Manager admin (eller secretAccessor + versions add)

param(
  [string]$EnvFile = ".env.production",
  [string]$ProjectId = "miljointelligens",
  [switch]$DryRun,
  [switch]$SkipDatabaseUrl
)

$ErrorActionPreference = "Stop"

$SecretMap = [ordered]@{
  "DATABASE_URL" = "DATABASE_URL"
  "JWT_ACCESS_SECRET" = "JWT_ACCESS_SECRET"
  "JWT_REFRESH_SECRET" = "JWT_REFRESH_SECRET"
  "GEMINI_API_KEY" = "GEMINI_API_KEY"
  "SEARCH_ENCRYPTION_KEY_BASE64" = "SEARCH_ENCRYPTION_KEY_BASE64"
  "QUERY_HASH_SALT" = "QUERY_HASH_SALT"
  "ADMIN_CONSOLE_PASSWORD" = "ADMIN_CONSOLE_PASSWORD"
  "LANTMATERIET_CONSUMER_KEY" = "LANTMATERIET_CONSUMER_KEY"
  "LANTMATERIET_CONSUMER_SECRET" = "LANTMATERIET_CONSUMER_SECRET"
  "SLU_API_KEY" = "SLU_API_KEY"
  "TRAFIKVERKET_API_KEY" = "TRAFIKVERKET_API_KEY"
  "VISS_API_KEY" = "VISS_API_KEY"
  "OPENAI_API_KEY" = "OPENAI_API_KEY"
  "LANTMATERIET_API_KEY" = "LANTMATERIET_API_KEY"
  "LANTMATERIET_OPEN_SUBSCRIPTION_KEY" = "LANTMATERIET_OPEN_SUBSCRIPTION_KEY"
  "BANKID_PFX_PASSPHRASE" = "BANKID_PFX_PASSPHRASE"
  "BANKID_PFX_CONTENT" = "BANKID_PFX_CONTENT"
}

if (-not (Test-Path $EnvFile)) {
  Write-Error "Env file not found: $EnvFile — copy from .env.production.example"
}

$lines = Get-Content $EnvFile | Where-Object { $_ -match '^\s*[A-Za-z_][A-Za-z0-9_]*\s*=' -and $_ -notmatch '^\s*#' }
$envVars = @{}
foreach ($line in $lines) {
  $idx = $line.IndexOf("=")
  if ($idx -lt 1) { continue }
  $key = $line.Substring(0, $idx).Trim()
  $val = $line.Substring($idx + 1).Trim().Trim('"').Trim("'")
  if ($val) { $envVars[$key] = $val }
}

$updated = 0
$skipped = 0

foreach ($entry in $SecretMap.GetEnumerator()) {
  $envKey = $entry.Key
  $secretName = $entry.Value

  if ($SkipDatabaseUrl -and $envKey -eq "DATABASE_URL") {
    Write-Host "SKIP $secretName (SkipDatabaseUrl)"
    $skipped++
    continue
  }

  if (-not $envVars.ContainsKey($envKey) -or [string]::IsNullOrWhiteSpace($envVars[$envKey])) {
    Write-Host "SKIP $secretName (no value in $EnvFile for $envKey)"
    $skipped++
    continue
  }
  $value = $envVars[$envKey]
  if ($DryRun) {
    Write-Host "DRY-RUN would update $secretName (len=$($value.Length))"
    $updated++
    continue
  }
  $value | gcloud secrets versions add $secretName --project=$ProjectId --data-file=- 2>$null
  if ($LASTEXITCODE -ne 0) {
    $value | gcloud secrets create $secretName --project=$ProjectId --data-file=- 2>$null
  }
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to update secret: $secretName"
  }
  Write-Host "OK $secretName"
  $updated++
}

Write-Host "Done. Updated: $updated, skipped: $skipped"
if ($updated -eq 0) {
  Write-Host "Ingen secret uppdaterad — fyll i .env.production först."
  exit 1
}
