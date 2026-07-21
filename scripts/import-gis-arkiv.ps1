$OGR      = 'C:\Program Files\GDAL\ogr2ogr.exe'
$PG_HOST  = 'localhost'
$PG_PORT  = '5432'
$PG_DB    = 'miljobeslut'
$PG_USER  = 'miljobeslut'
$PG_PASS  = 'miljobeslut'
$PG_CONN  = "PG:host=$PG_HOST port=$PG_PORT dbname=$PG_DB user=$PG_USER password=$PG_PASS"
$SOURCE   = 'D:\ingest-arkiv-2026-03-29'
$LOG      = 'C:\Dev\miljobeslut-platform-recovery\logs\import-gis.log'
$FAILLOG  = 'C:\Dev\miljobeslut-platform-recovery\logs\import-gis-fail.log'

New-Item -ItemType Directory -Force -Path (Split-Path $LOG) | Out-Null
'' | Set-Content $LOG; '' | Set-Content $FAILLOG

function wl($msg, $color='White') {
    $line = "[$(Get-Date -Format HH:mm:ss)] $msg"
    Write-Host $line -ForegroundColor $color
    Add-Content $LOG $line
}

function tbl($n) {
    $n = [System.IO.Path]::GetFileNameWithoutExtension($n)
    $n = [System.Uri]::UnescapeDataString($n)
    $n = $n -replace '[^a-zA-Z0-9]','_' -replace '_+','_'
    $n = $n.Trim('_').ToLower()
    if ($n.Length -gt 60) { $n = $n.Substring(0,60) }
    if ($n -match '^\d') { $n = "gis_$n" }
    return $n
}

wl '=== GIS Import Start ===' 'Cyan'
wl "ogr2ogr: $OGR" 'Cyan'

$files = @()
foreach ($ext in '*.gpkg','*.geojson','*.gml') {
    $files += Get-ChildItem $SOURCE -Recurse -Filter $ext -ErrorAction SilentlyContinue
}
$files = $files | Sort-Object Length
$total = $files.Count; $ok=0; $fail=0; $skip=0
wl "Found $total files" 'Yellow'

$i=0
foreach ($f in $files) {
    $i++
    $t   = tbl $f.Name
    $mb  = [math]::Round($f.Length/1MB,1)
    $pct = [math]::Round(($i/$total)*100)
    wl "[$i/$total $pct%] $($f.Name) -> $t ($mb MB)" 'Cyan'

    if ($f.Length -lt 2048) {
        wl '  SKIP - empty' 'DarkGray'; $skip++
        Add-Content $FAILLOG "SKIP`t$($f.FullName)"
        continue
    }

    $a = @('-f','PostgreSQL',$PG_CONN,$f.FullName,
        '-nln',$t,
        '--config','PG_USE_COPY','YES',
        '-overwrite',
        '-skipfailures',
        '-lco','GEOMETRY_NAME=geom',
        '-lco','FID=id',
        '-lco','SPATIAL_INDEX=NONE',
        '-progress')

    $out = & $OGR @a 2>&1
    if ($LASTEXITCODE -eq 0) {
        wl '  OK' 'Green'; $ok++
    } else {
        $e = ($out | Select-Object -First 2) -join ' '
        wl "  FAIL: $e" 'Red'; $fail++
        Add-Content $FAILLOG "FAIL`t$($f.FullName)`t$e"
    }
}

wl '=== DONE ===' 'Cyan'
wl "Total:$total OK:$ok Failed:$fail Skipped:$skip" 'White'