# PRODUKT-FOKUS: enskilt avlopp, C-anmalan, lokaliseringsutredning + Geo inlarning + Miljobeslut-GIS.
# EJ: Lastkajen/transport, 631 dataportal-GPKG-bulk.
# Loggar: logs/import-focus-YYYYMMDD-HHmm/
#
# Mimers Brunn: läser från GEO_Master_Archive när sökvägar finns; faller tillbaka till
# legacy D: endast om archive-sökvägar saknas (migration debt — loggas som WARN).
param(
    [switch]$SkipLmStac,
    [switch]$SkipSguBulk,
    [switch]$SkipEnvPython,
    [switch]$SkipGeoInlarning,
    [switch]$SkipManifestPromote
)
$ErrorActionPreference = 'Continue'
$root = 'C:\Dev\miljobeslut-platform-recovery'
$logDir = Join-Path $root ('logs\import-focus-' + (Get-Date -Format 'yyyy-MM-dd-HHmm'))
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$defaultArchive = 'H:\Delade enheter\Miljöbeslut\GEO_Master_Archive'
$geoMasterArchive = if ($env:GEO_MASTER_ARCHIVE) { $env:GEO_MASTER_ARCHIVE } else { $defaultArchive }
$archiveVectors = Join-Path $geoMasterArchive 'Data\Vectors'
$archiveGeoInlarning = Join-Path $geoMasterArchive 'Data\GeoInlarning'

$legacyGeodata = 'D:\GEodata'
$legacyGeoInlarning = 'D:\Geo inlärning'

function Resolve-DataRoot($archivePath, $legacyPath, $label) {
    if (Test-Path $archivePath) {
        Write-Host "[$label] Using GEO_Master_Archive: $archivePath" -ForegroundColor Green
        return $archivePath
    }
    if (Test-Path $legacyPath) {
        Write-Host "[$label] WARN: Archive path missing — fallback to legacy: $legacyPath" -ForegroundColor Yellow
        return $legacyPath
    }
    Write-Host "[$label] WARN: Neither archive nor legacy path exists. Steps may no-op." -ForegroundColor Yellow
    return $legacyPath
}

$env:DATABASE_URL = if ($env:DATABASE_URL) { $env:DATABASE_URL } else { 'postgresql://miljobeslut:miljobeslut@127.0.0.1:5432/miljobeslut' }
$env:GEO_MASTER_ARCHIVE = $geoMasterArchive
$env:GEODATA_DIR = Resolve-DataRoot $archiveVectors $legacyGeodata 'GEODATA'
$env:SGU_DOWNLOAD_DIR = $env:GEODATA_DIR
$env:GEO_INLARNING_DIR = Resolve-DataRoot $archiveGeoInlarning $legacyGeoInlarning 'GEO_INLARNING'
$env:PGOPTIONS = '-c synchronous_commit=off -c maintenance_work_mem=1GB'

function Run-Step($name, $command) {
    $log = Join-Path $logDir ($name + '.log')
    Write-Host "`n========== $name ==========" -ForegroundColor Cyan
    Write-Host "Log: $log"
    Push-Location $root
    try {
        Invoke-Expression $command *>&1 | Tee-Object -FilePath $log
        $code = $LASTEXITCODE
        if ($null -eq $code) { $code = 0 }
        if ($code -ne 0) {
            Write-Host "WARN: $name exit $code" -ForegroundColor Yellow
        }
    } finally {
        Pop-Location
    }
}

function Import-ManifestsFromArchive {
    $manifestRoot = Join-Path $geoMasterArchive 'metadata\manifests'
    if (-not (Test-Path $manifestRoot)) {
        Write-Host "No manifest directory at $manifestRoot — skip V2 promote" -ForegroundColor DarkYellow
        return
    }
    $manifests = Get-ChildItem -Path $manifestRoot -Filter 'manifest.json' -Recurse -ErrorAction SilentlyContinue
    if (-not $manifests -or $manifests.Count -eq 0) {
        Write-Host "No manifest.json files under $manifestRoot" -ForegroundColor DarkYellow
        return
    }
    foreach ($manifest in $manifests) {
        $name = '10-manifest-' + ($manifest.Directory.Name -replace '[^\w\-]', '_')
        Run-Step $name "npx dotenv -e .env -- tsx scripts/import/import-librarian-manifest.ts --manifest `"$($manifest.FullName)`" --mode promote"
    }
}

Write-Host @"

PRODUKT-FOKUS-IMPORT (Miljobeslut / Mimers Brunn)
  Archive root: $geoMasterArchive
  GEODATA_DIR:  $($env:GEODATA_DIR)
  GEO_INLARNING: $($env:GEO_INLARNING_DIR)
  Floden: enskilt avlopp, C-anmalan, lokaliseringsutredning

"@ -ForegroundColor Green

if (-not $SkipLmStac) {
    Run-Step '01-lm-stac-fastighetsindelning' 'python scripts/data-pipeline/import_lm_stac.py fastighetsindelning'
} else {
    Write-Host 'SkipLmStac' -ForegroundColor DarkYellow
}

if (-not $SkipGeoInlarning) {
    Run-Step '02-geo-inlarning-stabilitet' 'npx dotenv -e .env -- tsx scripts/import/import-stability-mapping.ts'
    Run-Step '03-geo-inlarning-msb-flood' 'python scripts/data-pipeline/import_all_datasets.py geo_inlarning'
} else {
    Write-Host 'SkipGeoInlarning' -ForegroundColor DarkYellow
}

Run-Step '04-hydro-vectors' 'npx dotenv -e .env -- tsx scripts/import/import-d-geodata-vectors.ts'

if (-not $SkipEnvPython) {
    Run-Step '05-python-nvr' 'python scripts/data-pipeline/import_all_datasets.py nvr'
    Run-Step '06-python-natura2000' 'python scripts/data-pipeline/import_all_datasets.py natura2000'
    Run-Step '07-n2k-gml' 'npx dotenv -e .env -- tsx scripts/import/import-n2k-gml.ts'
}

if (-not $SkipSguBulk) {
    $sguOnly = @(
        'brunnar',
        'jordarter25k',
        'jorddjup',
        'genomslapplighet',
        'grundvatten',
        'fastmark',
        'jordskred',
        'forutsattningar',
        'hydraulisk'
    ) -join ','
    Run-Step '08-sgu-bulk' "npx dotenv -e .env -- tsx scripts/import/import-sgu-bulk.ts --only=$sguOnly"
}

Run-Step '09-sgu-gap-audit' 'npx dotenv -e .env -- tsx scripts/import/sgu-import-gap.ts'

if (-not $SkipManifestPromote) {
    Import-ManifestsFromArchive
}

Write-Host "`nProdukt-fokus-import klar. Loggar: $logDir" -ForegroundColor Green
Write-Host "Verifiera: npm run demo:preflight; e2e staging-avlopp / staging-lokaliseringsutredning" -ForegroundColor Cyan
