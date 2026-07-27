# GCP Secret Manager — audit (ingen secret-värden skrivs ut)
#
# Usage:
#   pwsh scripts/gcp/audit-secrets.ps1
#   pwsh scripts/gcp/audit-secrets.ps1 -ProjectId miljointelligens

param(
  [string]$ProjectId = "miljointelligens"
)

$ErrorActionPreference = "Stop"

$SecretNames = @(
  "DATABASE_URL",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "SEARCH_ENCRYPTION_KEY_BASE64",
  "QUERY_HASH_SALT",
  "ADMIN_CONSOLE_PASSWORD",
  "LANTMATERIET_API_KEY",
  "LANTMATERIET_CONSUMER_KEY",
  "LANTMATERIET_CONSUMER_SECRET",
  "LANTMATERIET_OPEN_SUBSCRIPTION_KEY",
  "SLU_API_KEY",
  "TRAFIKVERKET_API_KEY",
  "VISS_API_KEY",
  "BANKID_PFX_PASSPHRASE",
  "BANKID_PFX_CONTENT"
)

function Test-PlaceholderSecret {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return $true }
  # Bootstrap placeholders: 64 hex chars from openssl rand -hex 64
  if ($Value.Length -eq 64 -and $Value -match '^[0-9a-f]{64}$') { return $true }
  if ($Value -eq "placeholder") { return $true }
  return $false
}

Write-Host "Secret audit — project: $ProjectId"
Write-Host ("-" * 60)

$placeholderCount = 0
foreach ($name in $SecretNames) {
  try {
    $value = (gcloud secrets versions access latest --secret=$name --project=$ProjectId 2>$null | Out-String).Trim()
    if (-not $value) {
      Write-Host "$name : MISSING"
      $placeholderCount++
      continue
    }
    $isPlaceholder = Test-PlaceholderSecret $value
    if ($isPlaceholder) { $placeholderCount++ }
    $status = if ($isPlaceholder) { "PLACEHOLDER" } else { "OK" }
    Write-Host "$name : len=$($value.Length) status=$status"
  } catch {
    Write-Host "$name : ERROR"
    $placeholderCount++
  }
}

Write-Host ("-" * 60)
Write-Host "Placeholders/missing: $placeholderCount / $($SecretNames.Count)"
if ($placeholderCount -gt 0) {
  Write-Host "Uppdatera från .env.production: pwsh scripts/gcp/sync-secrets-from-env.ps1"
  exit 1
}
exit 0
