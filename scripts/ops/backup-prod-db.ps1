# pg_dump av lokal prod-DB (docker-compose.prod.yml)
#
# Usage:
#   pwsh scripts/ops/backup-prod-db.ps1
#   pwsh scripts/ops/backup-prod-db.ps1 -ComposeFile docker-compose.prod.yml -OutDir backups/prod

param(
  [string]$ComposeFile = "docker-compose.prod.yml",
  [string]$OutDir = "backups/prod"
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

$OutPath = Join-Path $Root $OutDir
New-Item -ItemType Directory -Force -Path $OutPath | Out-Null

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$baseName = "miljobeslut_prod_$ts"
$sqlFile = Join-Path $OutPath "$baseName.sql"
$gzFile = "$sqlFile.gz"
$manifestFile = Join-Path $OutPath "$baseName.manifest.json"

Push-Location $Root
try {
  $running = docker compose -f $ComposeFile ps --status running --services 2>$null
  if ($running -notcontains "db") {
    Write-Error "db-service körs inte. Starta: docker compose -f $ComposeFile up -d db"
  }

  Write-Host "Kör pg_dump..."
  docker compose -f $ComposeFile exec -T db pg_dump -U miljobeslut -d miljobeslut_prod --no-owner --no-acl | Set-Content -Path $sqlFile -Encoding utf8

  if (-not (Test-Path $sqlFile) -or (Get-Item $sqlFile).Length -lt 100) {
    Write-Error "pg_dump misslyckades eller gav tom fil"
  }

  $bytes = [System.IO.File]::ReadAllBytes($sqlFile)
  $ms = New-Object System.IO.MemoryStream
  $gzip = New-Object System.IO.Compression.GZipStream($ms, [System.IO.Compression.CompressionMode]::Compress)
  $gzip.Write($bytes, 0, $bytes.Length)
  $gzip.Close()
  [System.IO.File]::WriteAllBytes($gzFile, $ms.ToArray())
  Remove-Item $sqlFile -Force

  $hash = (Get-FileHash -Path $gzFile -Algorithm SHA256).Hash.ToLower()
  $size = (Get-Item $gzFile).Length

  $manifest = @{
    id = $baseName
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    file = (Split-Path $gzFile -Leaf)
    path = $gzFile
    sha256 = $hash
    sizeBytes = $size
    database = "miljobeslut_prod"
    composeFile = $ComposeFile
  } | ConvertTo-Json -Depth 4

  Set-Content -Path $manifestFile -Value $manifest -Encoding utf8

  Write-Host "OK backup: $gzFile"
  Write-Host "    SHA256: $hash"
  Write-Host "    Size:   $size bytes"
  Write-Host "    Manifest: $manifestFile"
} finally {
  Pop-Location
}
