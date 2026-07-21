# Arkivering / backup av råfiler enligt disk-strategi (2026-06-03):
# TODO(Mimers Brunn): Migration debt. This helper still refers to legacy D:\GEodata and
# D:\Geo inlärning sources during the move to GEO_Master_Archive. Replace these source
# defaults with canonical archive manifests before next long-term use.
# - Plattform + PostGIS på C: (ren mapp, t.ex. C:\miljöbeslut).
# - Råfiler (bulk) lever på D: som tillfällig källa under import.
# - H: = primär backup-driv för råfiler (GeoData, Geo inlärning, Outlook/C-anmälan-dokument, etc.).
#   Användaren har redan kopierat D:\GEodata + D:\Geo inlärning till H:.
# - G: = sekundär/moln-backup (Google Drive) – valfritt extra lager.
#
# Stora rå-träd backup:as **från D: direkt till H:** (och ev. G:).
# De ska INTE bulk-kopieras in i plattforms-repot på C:.
#
# Användningsexempel:
#   npm run import:archive-product -- -CopyD_Geodata -CopyD_GeoInlarning   # D: -> H: (primärt) + G:
#   powershell -File ... -CopyD_DesktopProfile -SkipDrive                 # bara till C: curated + H: (om inte skip)
param(
    [switch]$WhatIf,
    [switch]$SkipDrive,
    [switch]$IncludeLastkajenBulk,
    [switch]$CopyD_Geodata,
    [switch]$CopyD_GeoInlarning,
    [switch]$CopyD_IngestArkiv,
    [switch]$CopyD_DesktopProfile
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'data-disk-layout.ps1')

$destC = $DataDiskLayout.ImportArchiveRoot
$destG = if ($DataDiskLayout.G_ArchiveRoot) { Join-Path $DataDiskLayout.G_ArchiveRoot 'raw' } else { $null }
$hArchive = if ($DataDiskLayout.H_ArchiveRoot) { $DataDiskLayout.H_ArchiveRoot } else { 'H:\miljobeslut-archive-2026' }
New-Item -ItemType Directory -Force -Path $destC, (Join-Path $destC 'manifests') | Out-Null
New-Item -ItemType Directory -Force -Path $hArchive | Out-Null

function Robo-CopyDir([string]$src, [string]$dest, [string]$label) {
    if (-not (Test-Path -LiteralPath $src)) {
        Write-Host "Saknas: $src ($label)" -ForegroundColor Yellow
        return
    }
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    $args = @(
        $src.TrimEnd('\'),
        $dest,
        '/E', '/Z', '/R:2', '/W:5', '/XO', '/FFT', '/NP', '/J',
        '/NFL', '/NDL', '/NJH', '/NJS'
    )
    if ($WhatIf) {
        Write-Host "[WhatIf] robocopy $label : $src -> $dest"
        return
    }
    if ($label -match '^G-') {
        Write-Host "  (priming DriveFS for $dest to improve sync...)" -ForegroundColor DarkGray
        try { Start-Process explorer.exe -ArgumentList $dest -WindowStyle Hidden -ErrorAction SilentlyContinue | Out-Null } catch {}
        Start-Sleep -Milliseconds 1200
    }
    Write-Host "robocopy $label ..." -ForegroundColor Cyan
    $code = (Start-Process -FilePath 'robocopy.exe' -ArgumentList $args -Wait -PassThru).ExitCode
    # 0–7 = OK/kopierat; 8+ = fel. G: kan vara osynkad — avbryt inte hela körningen.
    if ($code -ge 8) {
        if ($label -match '^G-') {
            Write-Host "WARN: $label robocopy exit $code (synka Google Drive och kör igen)" -ForegroundColor Yellow
            return
        }
        throw "robocopy $label failed exit $code"
    }
}

# Lastkajen — endast produktpaket (buller, barriär, vilt)
$lkSrc = $DataDiskLayout.LastkajenIngest
$ids = @($LastkajenProductPackageIds + $LastkajenArchiveOnlyPackageIds)
if ($IncludeLastkajenBulk) {
    $ids = Get-ChildItem -LiteralPath $lkSrc -Directory -EA SilentlyContinue | ForEach-Object { $_.Name }
}
foreach ($id in $ids) {
    $folder = Join-Path $lkSrc ([string]$id)
    Robo-CopyDir $folder (Join-Path $destC "lastkajen\$id") "lastkajen-$id"
    if (-not $SkipDrive -and (Test-Path $DataDiskLayout.G_DriveGeoRoot)) {
        Robo-CopyDir $folder (Join-Path $destG "lastkajen\$id") "G-lastkajen-$id"
    }
}

# Stora rå-träd: kopiera ALDRIG hela trädet in i repo storage på C:.
# De hör på D: (källa) + H: (primär backup). G: är extra moln-backup.
$hArchive = if ($DataDiskLayout.H_ArchiveRoot) { $DataDiskLayout.H_ArchiveRoot } else { 'H:\miljobeslut-archive-2026' }

if ($CopyD_Geodata) {
    # Backup D:GEodata -> H: (användaren har redan en kopia på H:\GeoData; detta synkar/uppdaterar)
    Robo-CopyDir $DataDiskLayout.D_Geodata (Join-Path $hArchive 'geodata') 'H-GEodata'
    if (-not $SkipDrive -and (Test-Path $DataDiskLayout.G_DriveGeoRoot)) {
        Robo-CopyDir $DataDiskLayout.D_Geodata (Join-Path $destG 'geodata') 'G-GEodata'
    }
}
if ($CopyD_GeoInlarning) {
    Robo-CopyDir $DataDiskLayout.D_GeoInlarning (Join-Path $hArchive 'geo-inlarning') 'H-Geo-inlarning'
    if (-not $SkipDrive -and (Test-Path $DataDiskLayout.G_DriveGeoRoot)) {
        Robo-CopyDir $DataDiskLayout.D_GeoInlarning (Join-Path $destG 'geo-inlarning') 'G-Geo-inlarning'
    }
}
if ($CopyD_IngestArkiv) {
    Robo-CopyDir $DataDiskLayout.D_IngestArkiv (Join-Path $hArchive 'ingest-arkiv-2026-03-29') 'H-ingest-arkiv'
    if (-not $SkipDrive -and (Test-Path $DataDiskLayout.G_DriveGeoRoot)) {
        Robo-CopyDir $DataDiskLayout.D_IngestArkiv (Join-Path $destG 'ingest-arkiv-2026-03-29') 'G-ingest-arkiv'
    }
}
if ($CopyD_DesktopProfile) {
    # Desktop-profilen på D: (MiljoBeslut_Produktdata, OutlookExport med C-anmälan-dokument från kommuner etc.)
    # är råmaterial — backup till H:, inte in i C: repo storage.
    Robo-CopyDir $DataDiskLayout.D_Desktop_Miljo (Join-Path $hArchive 'desktop-profile\MiljoBeslut_Produktdata') 'H-Desktop-Miljo'
    Robo-CopyDir $DataDiskLayout.D_Desktop_Outlook (Join-Path $hArchive 'desktop-profile\OutlookExport') 'H-Desktop-Outlook'
    Robo-CopyDir $DataDiskLayout.D_Desktop_Kommuner (Join-Path $hArchive 'desktop-profile\kommuner\Mariestad') 'H-Desktop-Mariestad'
    if (-not $SkipDrive -and (Test-Path $DataDiskLayout.G_DriveGeoRoot)) {
        Robo-CopyDir $DataDiskLayout.D_Desktop_Miljo (Join-Path $destG 'desktop-profile\MiljoBeslut_Produktdata') 'G-Desktop-Miljo'
        Robo-CopyDir $DataDiskLayout.D_Desktop_Outlook (Join-Path $destG 'desktop-profile\OutlookExport') 'G-Desktop-Outlook'
        Robo-CopyDir $DataDiskLayout.D_Desktop_Kommuner (Join-Path $destG 'desktop-profile\kommuner\Mariestad') 'G-Desktop-Mariestad'
    }
}

$hExists = Test-Path 'H:\'
$gExists = $DataDiskLayout.G_DriveGeoRoot -and (Test-Path $DataDiskLayout.G_DriveGeoRoot)

$driveNote = if ($SkipDrive) { 'skipped' }
elseif (-not $hExists) { 'H: ej monterad — anslut H: och kör igen (primär backup)' }
else { 'H: primary (G: secondary if present)' }

@{
    at       = (Get-Date).ToString('o')
    destC    = $destC
    hArchive = $hArchive
    destG    = $destG
    drive    = $driveNote
    whatIf   = [bool]$WhatIf
    packages = $ids
} | ConvertTo-Json | Set-Content (Join-Path $destC 'manifests\archive-product-raw-last.json') -Encoding utf8

Write-Host "Klart. C: $destC | H: $hArchive | Drive: $driveNote"

if (-not $SkipDrive) {
    Write-Host @"

---
Backup-försök klara mot H: (primär) och G: (sekundär om monterad).

H: är nu den officiella backup-platsen för stora råfiler (GeoData, Geo inlärning, Outlook/C-anmälan-dokument m.m.).
Användaren har redan kopierat GeoData + Geo inlärning till H: — skriptet ovan synkar/uppdaterar vid behov.

Om G: gav exit 16: gör mappen "Available offline" i Google Drive och kör om med -SkipDrive eller specifika flaggor.

"@ -ForegroundColor Cyan
}
