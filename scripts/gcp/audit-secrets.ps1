# GCP Secret Manager — audit (ingen secret-värden skrivs ut)
#
# Policy (2026-07-27):
#   - Lantmäteriet: CONSUMER_KEY + CONSUMER_SECRET (OAuth2)
#   - Trafikverket: token lokalt vid behov (ej blockerande i GCP-audit)
#   - OpenAI: ej aktuell
#   - BankID: uppskjuten
#
# Usage:
#   pwsh scripts/gcp/audit-secrets.ps1
#   pwsh scripts/gcp/audit-secrets.ps1 -ProjectId miljointelligens

param(
  [string]$ProjectId = "miljointelligens"
)

$ErrorActionPreference = "Stop"

$RequiredSecrets = @(
  "DATABASE_URL",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "GEMINI_API_KEY",
  "SEARCH_ENCRYPTION_KEY_BASE64",
  "QUERY_HASH_SALT",
  "ADMIN_CONSOLE_PASSWORD",
  "LANTMATERIET_CONSUMER_KEY",
  "LANTMATERIET_CONSUMER_SECRET",
  "SLU_API_KEY",
  "VISS_API_KEY"
)

$LocalOptionalSecrets = @(
  "TRAFIKVERKET_API_KEY"
)

$DeferredSecrets = @(
  "BANKID_PFX_PASSPHRASE",
  "BANKID_PFX_CONTENT"
)

$NotApplicableSecrets = @(
  "OPENAI_API_KEY",
  "LANTMATERIET_API_KEY",
  "LANTMATERIET_OPEN_SUBSCRIPTION_KEY"
)

function Test-PlaceholderSecret {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return $true }
  if ($Value.Length -eq 64 -and $Value -match '^[0-9a-f]{64}$') { return $true }
  if ($Value -eq "placeholder") { return $true }
  return $false
}

function Get-SecretStatus {
  param([string]$Name)
  try {
    $value = (gcloud secrets versions access latest --secret=$Name --project=$ProjectId 2>$null | Out-String).Trim()
    if (-not $value) {
      return @{ Status = "MISSING"; IsPlaceholder = $true; Length = 0 }
    }
    $isPlaceholder = Test-PlaceholderSecret $value
    $status = if ($isPlaceholder) { "PLACEHOLDER" } else { "OK" }
    return @{ Status = $status; IsPlaceholder = $isPlaceholder; Length = $value.Length }
  } catch {
    return @{ Status = "ERROR"; IsPlaceholder = $true; Length = 0 }
  }
}

Write-Host "Secret audit — project: $ProjectId"
Write-Host ("-" * 60)

$requiredIssues = 0
Write-Host "[Krävs]"
foreach ($name in $RequiredSecrets) {
  $info = Get-SecretStatus $name
  if ($info.IsPlaceholder) { $requiredIssues++ }
  Write-Host "$name : len=$($info.Length) status=$($info.Status)"
}

Write-Host ""
Write-Host "[Lokal valfri — Trafikverket token i .env.production]"
foreach ($name in $LocalOptionalSecrets) {
  $info = Get-SecretStatus $name
  Write-Host "$name : len=$($info.Length) status=$($info.Status) (ej blockerande)"
}

Write-Host ""
Write-Host "[Uppskjutet — BankID]"
foreach ($name in $DeferredSecrets) {
  $info = Get-SecretStatus $name
  Write-Host "$name : len=$($info.Length) status=$($info.Status) (ej blockerande)"
}

Write-Host ""
Write-Host "[Ej aktuell / legacy]"
foreach ($name in $NotApplicableSecrets) {
  $info = Get-SecretStatus $name
  Write-Host "$name : len=$($info.Length) status=$($info.Status) (ignoreras)"
}

Write-Host ("-" * 60)
Write-Host "Krävda placeholders/missing: $requiredIssues / $($RequiredSecrets.Count)"
if ($requiredIssues -gt 0) {
  Write-Host "Fyll i .env.production och kör: pwsh scripts/gcp/sync-secrets-from-env.ps1"
  exit 1
}
exit 0
