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

function Resolve-DataRoot {
    param(
        [string]$ArchivePath,
        [string]$LegacyPath,
        [string]$Label
    )
    if (Test-Path -LiteralPath $ArchivePath) {
        Write-Host "[$Label] Using GEO_Master_Archive: $ArchivePath" -ForegroundColor Green
        return $ArchivePath
    }
    if (Test-Path -LiteralPath $LegacyPath) {
        Write-Host "[$Label] WARN: Archive path missing — fallback to legacy: $LegacyPath" -ForegroundColor Yellow
        return $LegacyPath
    }
    Write-Host "[$Label] WARN: Neither archive nor legacy path exists. Steps may no-op." -ForegroundColor Yellow
    return $LegacyPath
}

function Run-Step {
    param(
        [string]$Name,
        [string]$Command
    )
    $log = Join-Path $script:LogDir ($Name + '.log')
    Write-Host "`n========== $Name ==========" -ForegroundColor Cyan
    Write-Host "Log: $log"
    Push-Location $script:Root
    try {
        Invoke-Expression $Command *>&1 | Tee-Object -FilePath $log
        $code = $LASTEXITCODE
        if ($null -eq $code) { $code = 0 }
        if ($code -ne 0) {
            Write-Host "WARN: $Name exit $code" -ForegroundColor Yellow
        }
    } finally {
        Pop-Location
    }
}

function Import-ManifestsFromArchive {
    $manifestRoot = Join-Path $script:GeoMasterArchive 'metadata\manifests'
    if (-not (Test-Path -LiteralPath $manifestRoot)) {
        Write-Host "No manifest directory at $manifestRoot — skip V2 promote" -ForegroundColor DarkYellow
        return
    }
    $manifests = Get-ChildItem -LiteralPath $manifestRoot -Filter 'manifest.json' -Recurse -ErrorAction SilentlyContinue
    if (-not $manifests -or $manifests.Count -eq 0) {
        Write-Host "No manifest.json files under $manifestRoot" -ForegroundColor DarkYellow
        return
    }
    foreach ($manifest in $manifests) {
        $name = '10-manifest-' + ($manifest.Directory.Name -replace '[^\w\-]', '_')
        Run-Step $name "npx dotenv -e .env -- tsx scripts/import/import-librarian-manifest.ts --manifest `"$($manifest.FullName)`" --mode promote"
    }
}

$script:Root = 'C:\Dev\miljobeslut-platform-recovery'
$script:LogDir = Join-Path $script:Root ('logs\import-focus-' + (Get-Date -Format 'yyyy-MM-dd-HHmm'))
New-Item -ItemType Directory -Force -Path $script:LogDir | Out-Null

$defaultArchive = 'H:\Delade enheter\Miljöbeslut\GEO_Master_Archive'
$script:GeoMasterArchive = if ($env:GEO_MASTER_ARCHIVE) { $env:GEO_MASTER_ARCHIVE } else { $defaultArchive }
$archiveVectors = Join-Path $script:GeoMasterArchive 'Data\Vectors'
$archiveGeoInlarning = Join-Path $script:GeoMasterArchive 'Data\GeoInlarning'

$legacyGeodata = 'D:\GEodata'
$legacyGeoInlarning = 'D:\Geo inlärning'

$env:DATABASE_URL = if ($env:DATABASE_URL) { $env:DATABASE_URL } else { 'postgresql://miljobeslut:miljobeslut@127.0.0.1:5432/miljobeslut' }
$env:GEO_MASTER_ARCHIVE = $script:GeoMasterArchive
$env:GEODATA_DIR = Resolve-DataRoot -ArchivePath $archiveVectors -LegacyPath $legacyGeodata -Label 'GEODATA'
$sguLegacyRaw = Join-Path $script:GeoMasterArchive 'Data\SGU\Legacy_Archive\2026-06-10\raw'
if (Test-Path -LiteralPath $sguLegacyRaw) {
    $env:SGU_DOWNLOAD_DIR = $sguLegacyRaw
    Write-Host "[SGU] Using legacy raw zips from GEO_Master_Archive: $sguLegacyRaw" -ForegroundColor Green
} else {
    $env:SGU_DOWNLOAD_DIR = $env:GEODATA_DIR
}
$env:GEO_INLARNING_DIR = Resolve-DataRoot -ArchivePath $archiveGeoInlarning -LegacyPath $legacyGeoInlarning -Label 'GEO_INLARNING'
$env:PGOPTIONS = '-c synchronous_commit=off -c maintenance_work_mem=1GB'

Write-Host @"

PRODUKT-FOKUS-IMPORT (Miljobeslut / Mimers Brunn)
  Archive root: $($script:GeoMasterArchive)
  GEODATA_DIR:  $($env:GEODATA_DIR)
  SGU_DOWNLOAD: $($env:SGU_DOWNLOAD_DIR)
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
    Run-Step '08-sgu-bulk' "npx dotenv -e .env -- tsx scripts/import/import-sgu-bulk.ts --only=$sguOnly --resume"
}

Run-Step '09-sgu-gap-audit' 'npx dotenv -e .env -- tsx scripts/import/sgu-import-gap.ts'

if (-not $SkipManifestPromote) {
    Import-ManifestsFromArchive
}

Write-Host "`nProdukt-fokus-import klar. Loggar: $($script:LogDir)" -ForegroundColor Green
Write-Host "Verifiera: npm run demo:preflight; e2e staging-avlopp / staging-lokaliseringsutredning" -ForegroundColor Cyan
