param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ArgsList
)

$candidates = @(
    'C:\Program Files\GDAL\ogrinfo.exe',
    'C:\OSGeo4W\bin\ogrinfo.exe',
    'C:\Program Files\QGIS 3.34\bin\ogrinfo.exe',
    'C:\Program Files\QGIS 3.36.3\bin\ogrinfo.exe',
    'C:\Program Files\QGIS 3.38.0\bin\ogrinfo.exe'
)

$ogrinfo = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $ogrinfo) {
    throw 'ogrinfo.exe hittades inte i kända GDAL/QGIS-sökvägar.'
}

$binDir = Split-Path $ogrinfo
$projCandidates = @(
    (Join-Path $binDir 'projlib'),
    (Join-Path (Split-Path $binDir) 'share\proj')
)
$gdalDataCandidates = @(
    (Join-Path $binDir 'gdal-data'),
    (Join-Path (Split-Path $binDir) 'share\gdal')
)

foreach ($candidate in $projCandidates) {
    if (Test-Path $candidate) {
        $env:PROJ_LIB = $candidate
        break
    }
}

foreach ($candidate in $gdalDataCandidates) {
    if (Test-Path $candidate) {
        $env:GDAL_DATA = $candidate
        break
    }
}

Remove-Item Env:GDAL_DRIVER_PATH -ErrorAction SilentlyContinue

& $ogrinfo @ArgsList
exit $LASTEXITCODE
