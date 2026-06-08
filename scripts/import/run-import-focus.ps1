# PRODUKT-FOKUS: enskilt avlopp, C-anmalan, lokaliseringsutredning + Geo inlarning + Miljobeslut-GIS.
# EJ: Lastkajen/transport, 631 dataportal-GPKG-bulk.
# Loggar: logs/import-focus-YYYYMMDD-HHmm/
# TODO(Mimers Brunn): Migration debt. This runner still exports legacy D:\GEodata and
# D:\Geo inlärning paths. Point it at GEO_Master_Archive-backed manifests before reuse.
param(
    [switch]$SkipLmStac,
    [switch]$SkipSguBulk,
    [switch]$SkipEnvPython,
    [switch]$SkipGeoInlarning
)
$ErrorActionPreference = 'Continue'
$root = 'C:\Dev\miljobeslut-platform-recovery'
$logDir = Join-Path $root ('logs\import-focus-' + (Get-Date -Format 'yyyy-MM-dd-HHmm'))
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$env:DATABASE_URL = 'postgresql://miljobeslut:miljobeslut@127.0.0.1:5432/miljobeslut'
$env:GEODATA_DIR = 'D:\GEodata'
$env:SGU_DOWNLOAD_DIR = 'D:\GEodata'
$env:GEO_INLARNING_DIR = 'D:\Geo inlärning'
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

Write-Host @"

PRODUKT-FOKUS-IMPORT (Miljobeslut)
  Floden: enskilt avlopp, C-anmalan, lokaliseringsutredning
  - Fastighet (LM STAC)
  - Geo inlarning (MSB stabilitet + oversvamning)
  - Hydro + skyddat vatten/natur
  - SGU (brunnar, jord, grundvatten, infiltration)
  EJ: Lastkajen, transport, 631 GPKG-bulk

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

Write-Host "`nProdukt-fokus-import klar. Loggar: $logDir" -ForegroundColor Green
Write-Host "Verifiera: npm run demo:preflight; e2e staging-avlopp / staging-lokaliseringsutredning" -ForegroundColor Cyan
