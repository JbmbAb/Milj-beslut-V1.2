# Rotera prod-hemligheter i .env.production (JWT, hash-salt, encryption key, admin)
#
# Usage:
#   pwsh scripts/ops/rotate-prod-secrets.ps1
#   pwsh scripts/ops/rotate-prod-secrets.ps1 -EnvFile .env.production -DryRun

param(
  [string]$EnvFile = ".env.production",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $EnvFile)) {
  Write-Error "Env file not found: $EnvFile — copy from .env.production.example"
}

function New-HexSecret([int]$Bytes = 32) {
  $buf = New-Object byte[] ($Bytes * 2)
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
  return ([BitConverter]::ToString($buf) -replace '-', '').ToLower().Substring(0, $Bytes * 2)
}

function New-Base64Key([int]$Bytes = 32) {
  $buf = New-Object byte[] $Bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
  return [Convert]::ToBase64String($buf)
}

function New-AdminPassword([int]$Length = 24) {
  $chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  $bytes = New-Object byte[] $Length
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

$oldAdmin = $null
Get-Content $EnvFile | ForEach-Object {
  if ($_ -match '^ADMIN_CONSOLE_PASSWORD=(.+)$') { $oldAdmin = $Matches[1].Trim() }
}

$newSecrets = @{
  JWT_ACCESS_SECRET = New-HexSecret 32
  JWT_REFRESH_SECRET = New-HexSecret 32
  QUERY_HASH_SALT = New-Base64Key 32
  SEARCH_ENCRYPTION_KEY_BASE64 = New-Base64Key 32
  ADMIN_CONSOLE_PASSWORD = New-AdminPassword
}

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$auditFile = Join-Path $env:TEMP "miljobeslut-rotated-$ts.txt"
@"
Rotation: $((Get-Date).ToUniversalTime().ToString('o'))
EnvFile: $EnvFile
ADMIN_CONSOLE_USERNAME: admin
ADMIN_CONSOLE_PASSWORD (ny): $($newSecrets.ADMIN_CONSOLE_PASSWORD)
ADMIN_CONSOLE_PASSWORD (gammal): $oldAdmin
JWT_ACCESS_SECRET: roterad (64 hex)
JWT_REFRESH_SECRET: roterad (64 hex)
QUERY_HASH_SALT: roterad
SEARCH_ENCRYPTION_KEY_BASE64: roterad
"@ | Set-Content -Path $auditFile -Encoding utf8

Write-Host "Audit sparad: $auditFile"

if ($DryRun) {
  Write-Host "DRY-RUN — inga ändringar skrivna"
  exit 0
}

$keysToReplace = @($newSecrets.Keys)
$lines = Get-Content $EnvFile
$updated = @()
$replaced = @{}

foreach ($line in $lines) {
  $matched = $false
  foreach ($key in $keysToReplace) {
    if ($line -match "^\s*$key\s*=") {
      $updated += "$key=$($newSecrets[$key])"
      $replaced[$key] = $true
      $matched = $true
      break
    }
  }
  if (-not $matched) { $updated += $line }
}

foreach ($key in $keysToReplace) {
  if (-not $replaced.ContainsKey($key)) {
    $updated += "$key=$($newSecrets[$key])"
  }
}

Set-Content -Path $EnvFile -Value $updated -Encoding utf8
Write-Host "OK — roterade: $($keysToReplace -join ', ')"
Write-Host "Starta om app: docker compose -f docker-compose.prod.yml up -d app"
