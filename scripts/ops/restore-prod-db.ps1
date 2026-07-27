# Återställ lokal prod-DB från gzip:ad pg_dump
#
# Usage:
#   pwsh scripts/ops/restore-prod-db.ps1 -BackupFile backups/prod/miljobeslut_prod_20260727.sql.gz -Confirm
#
# KRÄVER -Confirm (human-in-the-loop). Skriver över aktiv databas.

param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,
  [switch]$Confirm,
  [string]$ComposeFile = "docker-compose.prod.yml"
)

$ErrorActionPreference = "Stop"

if (-not $Confirm) {
  Write-Error "Restore kräver explicit -Confirm. Detta skriver över miljobeslut_prod."
}

$Root = (Get-Location).Path
if (-not [System.IO.Path]::IsPathRooted($BackupFile)) {
  $BackupFile = Join-Path $Root $BackupFile
}

if (-not (Test-Path $BackupFile)) {
  Write-Error "Backup saknas: $BackupFile"
}

Write-Host "VARNING: Återställer miljobeslut_prod från $BackupFile"
Write-Host "App bör stoppas eller vara offline under restore."

Push-Location $Root
try {
  $manifestPath = $BackupFile -replace '\.sql\.gz$', '.manifest.json'
  if (Test-Path $manifestPath) {
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    $actualHash = (Get-FileHash -Path $BackupFile -Algorithm SHA256).Hash.ToLower()
    if ($manifest.sha256 -ne $actualHash) {
      Write-Error "SHA256 mismatch! Förväntat $($manifest.sha256), fick $actualHash"
    }
    Write-Host "Manifest SHA256 OK"
  }

  Write-Host "Dekomprimerar och återställer..."
  $inStream = [System.IO.File]::OpenRead($BackupFile)
  $gzip = New-Object System.IO.Compression.GZipStream($inStream, [System.IO.Compression.CompressionMode]::Decompress)
  $reader = New-Object System.IO.StreamReader($gzip)
  $sql = $reader.ReadToEnd()
  $reader.Close()
  $gzip.Close()
  $inStream.Close()

  $sql | docker compose -f $ComposeFile exec -T db psql -U miljobeslut -d miljobeslut_prod -v ON_ERROR_STOP=1 -f -

  if ($LASTEXITCODE -ne 0) {
    Write-Error "psql restore misslyckades (exit $LASTEXITCODE)"
  }

  Write-Host "Restore klar."
} finally {
  Pop-Location
}
