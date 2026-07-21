<#
.SYNOPSIS
Kopierar NMD-rasterfiler från Master-arkivet på H-disken till lokala C-disken.

.DESCRIPTION
Eftersom Docker Desktop på Windows inte kan montera Google Drive-volymer ("H:\Delade enheter...") 
direkt in i PostgreSQL-containern för Out-of-DB-användning, måste filerna kopieras lokalt.
Detta skript kopierar säkert alla NMD 2023 .tif-filer (~35 GB) och bevarar katalogstrukturen.

.EXAMPLE
.\scripts\ops\copy-nmd-local.ps1
#>

$ErrorActionPreference = "Stop"

$sourceRoot = "H:\Delade enheter\Milj*beslut\GEO_Master_Archive\_review\Ok*nd_Provider"
$destRoot = "C:\Dev\miljobeslut-platform-recovery\storage\nmd"

# Skapa målmappen om den inte finns
if (-not (Test-Path -Path $destRoot)) {
    Write-Host "Skapar målmapp: $destRoot" -ForegroundColor Cyan
    New-Item -ItemType Directory -Path $destRoot | Out-Null
}

Write-Host "Söker efter NMD 2023-filer på H-disken... (Detta kan ta en stund)" -ForegroundColor Yellow
$nmdFiles = Get-ChildItem -Path $sourceRoot -Recurse -Filter "*NMD*2023*.tif"

if ($nmdFiles.Count -eq 0) {
    Write-Host "Inga NMD-filer hittades!" -ForegroundColor Red
    exit 1
}

$totalSizeGB = ($nmdFiles | Measure-Object -Property Length -Sum).Sum / 1GB
Write-Host "Hittade $($nmdFiles.Count) filer. Total storlek: $([math]::Round($totalSizeGB, 2)) GB." -ForegroundColor Green
Write-Host "Kopierar till $destRoot..." -ForegroundColor Cyan

$copiedCount = 0

foreach ($file in $nmdFiles) {
    # Bevara mappstrukturen relativt till sourceRoot
    $relativePath = $file.FullName.Substring($sourceRoot.Length + 1)
    $destPath = Join-Path -Path $destRoot -ChildPath $relativePath
    $destDir = Split-Path -Path $destPath -Parent

    if (-not (Test-Path -Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir | Out-Null
    }

    if (-not (Test-Path -Path $destPath)) {
        Write-Host "Kopierar: $($file.Name) ($([math]::Round($file.Length / 1MB, 2)) MB)"
        Copy-Item -Path $file.FullName -Destination $destPath
        $copiedCount++
    } else {
        Write-Host "Hoppar över (finns redan): $($file.Name)" -ForegroundColor DarkGray
    }
}

Write-Host "`nKopiering slutförd! $copiedCount nya filer kopierades." -ForegroundColor Green
Write-Host "Du kan nu uppdatera docker-compose.yml att montera: ./storage/nmd:/mnt/geo_master_archive/nmd" -ForegroundColor Yellow
