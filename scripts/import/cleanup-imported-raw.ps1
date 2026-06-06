# Raderar råfiler som verifierats importerade (logg 2026-06-02-session).
# Rör INTE G:\ (Google Drive) eller storage/ingest/lastkajen.
$ErrorActionPreference = 'Stop'
$logDir = Join-Path $PSScriptRoot '..\..\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$manifest = Join-Path $logDir ("cleanup-raw-" + (Get-Date -Format 'yyyy-MM-dd-HHmmss') + '.json')

$deleted = @()
$skipped = @()
$errors = @()

function Remove-IfExists([string]$path, [string]$reason) {
    if (-not (Test-Path -LiteralPath $path)) {
        $script:skipped += @{ path = $path; reason = 'saknas' }
        return
    }
    $item = Get-Item -LiteralPath $path -Force
    $bytes = if ($item.PSIsContainer) {
        (Get-ChildItem -LiteralPath $path -Recurse -File -Force -EA SilentlyContinue | Measure-Object Length -Sum).Sum
    } else { $item.Length }
    try {
        Remove-Item -LiteralPath $path -Recurse -Force
        $script:deleted += @{ path = $path; reason = $reason; bytes = $bytes }
        Write-Host "Raderat: $path ($([math]::Round($bytes/1MB,1)) MB)"
    } catch {
        $script:errors += @{ path = $path; error = $_.Exception.Message }
        Write-Host "FEL: $path - $($_.Exception.Message)" -ForegroundColor Red
    }
}

# 1) Ingest GPKG (631/631 OK i import-run-2026-06-02-2010)
$ingestRoot = 'D:\ingest-arkiv-2026-03-29\dataportal-env'
if (Test-Path $ingestRoot) {
    $gpkg = Get-ChildItem -LiteralPath $ingestRoot -Recurse -Filter '*.gpkg' -File -Force
    Write-Host "Raderar $($gpkg.Count) GPKG under $ingestRoot ..."
    foreach ($f in $gpkg) {
        Remove-IfExists $f.FullName 'ingest-gpkg-batch-klar'
    }
} else {
    $skipped += @{ path = $ingestRoot; reason = 'hela mappen saknas' }
}

# 2) D:\GEodata - steg 01-d-geodata-vectors (alla OK)
$geoDone = @(
    'D:\GEodata\SVARO_2016.zip',
    'D:\GEodata\VARO_2016.zip',
    'D:\GEodata\InspireMSB_APSFR.zip',
    'D:\GEodata\geologiskt-intressanta-platser.gpkg'
)
foreach ($p in $geoDone) {
    Remove-IfExists $p '01-d-geodata-vectors-ok'
}

$summary = @{
    at = (Get-Date).ToString('o')
    deletedCount = $deleted.Count
    deletedBytes = ($deleted | ForEach-Object { $_.bytes } | Measure-Object -Sum).Sum
    deleted = $deleted
    skipped = $skipped
    errors = $errors
    notTouched = @(
        'G:\Min enhet\GeoData',
        'C:\Dev\miljobeslut-platform-recovery\storage\ingest\lastkajen',
        'D:\GEodata (övrigt)'
    )
}
$summary | ConvertTo-Json -Depth 6 | Set-Content -Path $manifest -Encoding utf8
Write-Host "`nManifest: $manifest"
Write-Host "Raderat: $($deleted.Count) objekt, $([math]::Round($summary.deletedBytes/1GB,2)) GB"
if ($errors.Count -gt 0) { exit 1 }
