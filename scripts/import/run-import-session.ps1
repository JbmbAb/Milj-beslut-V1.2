# Wrapper: standard = FOKUS (demo). Bulk/transport ar opt-in.
# TODO(Mimers Brunn): Migration debt. This runner still exports legacy D:\GEodata and
# D:\Geo inlärning paths. Point it at GEO_Master_Archive-backed manifests before reuse.
param(
    [switch]$FullBulk,
    [switch]$IncludeTransport
)
$focusScript = Join-Path $PSScriptRoot 'run-import-focus.ps1'
if (-not $FullBulk -and -not $IncludeTransport) {
    & $focusScript @PSBoundParameters
    exit $LASTEXITCODE
}

$ErrorActionPreference = 'Continue'
$root = 'C:\Dev\miljobeslut-platform-recovery'
$logDir = Join-Path $root ('logs\import-run-' + (Get-Date -Format 'yyyy-MM-dd-HHmm'))
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

Write-Host 'FullBulk/transport: icke-fokus-korning. Anvand helst: scripts/import/run-import-focus.ps1' -ForegroundColor Red

$env:DATABASE_URL = 'postgresql://miljobeslut:miljobeslut@127.0.0.1:5432/miljobeslut'
$env:GEODATA_DIR = 'D:\GEodata'
$env:SGU_DOWNLOAD_DIR = 'D:\GEodata'
$env:GEO_INLARNING_DIR = 'D:\Geo inlärning'
$env:PGOPTIONS = '-c synchronous_commit=off -c maintenance_work_mem=2GB'

function Run-Step($name, $command) {
    $log = Join-Path $logDir ($name + '.log')
    Write-Host "`n========== $name ==========" -ForegroundColor Cyan
    Push-Location $root
    try {
        Invoke-Expression $command *>&1 | Tee-Object -FilePath $log
    } finally {
        Pop-Location
    }
}

& $focusScript

if ($FullBulk) {
    Run-Step 'bulk-d-geodata' 'npx dotenv -e .env -- tsx scripts/import/import-d-geodata-vectors.ts'
    Run-Step 'bulk-n2k' 'npx dotenv -e .env -- tsx scripts/import/import-n2k-gml.ts'
    Run-Step 'bulk-nvr' 'python scripts/data-pipeline/import_all_datasets.py nvr'
    Run-Step 'bulk-natura2000' 'python scripts/data-pipeline/import_all_datasets.py natura2000'
    Run-Step 'bulk-msb' 'python scripts/data-pipeline/import_all_datasets.py msb'
    $total = 631
    $batch = 40
    for ($off = 0; $off -lt $total; $off += $batch) {
        Run-Step ('bulk-gpkg-' + $off) "npx dotenv -e .env -- tsx scripts/import/import-ingest-gpkg-batch.ts --offset=$off --limit=$batch"
    }
}

if ($IncludeTransport) {
    Run-Step 'transport-lastkajen' 'npx dotenv -e .env -- tsx scripts/import/import-lastkajen-all-downloaded.ts'
}

Write-Host "`nSession klar. Loggar: $logDir" -ForegroundColor Green
