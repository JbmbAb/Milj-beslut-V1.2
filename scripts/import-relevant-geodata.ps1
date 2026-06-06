$ErrorActionPreference = 'Continue'

$OGR      = 'C:\Program Files\GDAL\ogr2ogr.exe'
$PG_HOST  = 'localhost'
$PG_PORT  = '5432'
$PG_DB    = 'miljobeslut'
$PG_USER  = 'miljobeslut'
$PG_PASS  = 'miljobeslut'
$PG_CONN  = "PG:host=$PG_HOST port=$PG_PORT dbname=$PG_DB user=$PG_USER password=$PG_PASS"

$SOURCE_DIRS = @('H:\Delade enheter\Milj*beslut\Geo inl*rning', 'H:\Delade enheter\Milj*beslut\GEodata')
$TEMP_DIR = 'D:\GEodata\temp_massive_extract'
$LOG      = 'C:\Dev\miljobeslut-platform-recovery\logs\import-relevant-zips.log'

New-Item -ItemType Directory -Force -Path (Split-Path $LOG) | Out-Null
'' | Set-Content $LOG

function wl($msg, $color='White') {
    $line = "[$(Get-Date -Format HH:mm:ss)] $msg"
    Write-Host $line -ForegroundColor $color
    Add-Content $LOG $line
}

function Clean-TableName($name) {
    $n = [System.IO.Path]::GetFileNameWithoutExtension($name)
    $n = [System.Uri]::UnescapeDataString($n)
    $n = $n -replace '[^a-zA-Z0-9]','_' -replace '_+','_'
    $n = $n.Trim('_').ToLower()
    if ($n.Length -gt 60) { $n = $n.Substring(0,60) }
    if ($n -match '^\d') { $n = "gis_$n" }
    return $n
}

$RELEVANT_TERMS = @(
    'jordart', 'berggrund', 'grundvatten', 'geofysik', 'malmer', 'brunnar', 
    'strandforskjutning', 'klimat', 'miljogift', 'natura', 'vardetrakt', 'biogeokemi',
    'fastmark', 'jordskred', 'stranderosion', 'svaghetszoner', 'avrinningsomrade',
    'mineral', 'kallor', 'vatten', 'skydd', 'miljo',
    'vatmark', 'riksintresse', 'naturolyckor', 'nitrat', 'betesmark', 'byggnad', 
    'fastighet', 'avvattning', 'gron_infrastruktur', 'olyckor', 'hotrisk', 'ang', 'naturtyper',
    'seveso', 'kust', 'hav', 'jordlager', 'torvlager', 'sulfatjord', 'sediment',
    'borrhal', 'bergkvalitet', 'bergart', 'israfflor'
)

wl '=== Strict Relevant GIS ZIP Import Start ===' 'Cyan'

$zipFiles = @()
foreach ($dir in $SOURCE_DIRS) {
    if (Test-Path $dir) {
        $zipFiles += Get-ChildItem $dir -Recurse -Filter '*.zip' -ErrorAction SilentlyContinue
    }
}
$zipFiles = $zipFiles | Sort-Object Length
$total = $zipFiles.Count; $ok=0; $fail=0; $skip=0
wl "Found $total ZIP files total" 'Yellow'

$i=0
foreach ($zip in $zipFiles) {
    $i++
    $nLower = $zip.Name.ToLower()
    
    $isRelevant = $false
    foreach ($term in $RELEVANT_TERMS) {
        if ($nLower.Contains($term)) {
            $isRelevant = $true
            break
        }
    }

    if (-not $isRelevant) {
        # Silent skip
        $skip++
        continue
    }

    $mb  = [math]::Round($zip.Length/1MB,1)
    wl "[$i/$total] Processing Relevant ZIP: $($zip.Name) ($mb MB)" 'Cyan'

    if ($zip.Length -lt 1024) { wl '  SKIP - empty zip' 'DarkGray'; continue }

    if (Test-Path $TEMP_DIR) { Remove-Item -Recurse -Force $TEMP_DIR }
    New-Item -ItemType Directory -Force -Path $TEMP_DIR | Out-Null

    try {
        Expand-Archive -Path $zip.FullName -DestinationPath $TEMP_DIR -Force -ErrorAction Stop
    } catch {
        wl "  FAIL: Could not extract ZIP" 'Red'
        continue
    }

    $spatialFiles = Get-ChildItem $TEMP_DIR -Recurse -Include '*.shp','*.gpkg','*.gml','*.geojson' -ErrorAction SilentlyContinue

    if ($spatialFiles.Count -eq 0) { wl '  SKIP - no spatial files' 'DarkGray'; continue }

    foreach ($file in $spatialFiles) {
        $t = Clean-TableName ("$($zip.Name)_$($file.Name)")
        wl "  -> Importing $($file.Name) as table '$t'" 'Yellow'

        $a = @('-f','PostgreSQL',$PG_CONN,$file.FullName,
            '-nln',$t,
            '-overwrite',
            '-skipfailures',
            '-nlt','GEOMETRY',
            '-lco','GEOMETRY_NAME=geom',
            '-lco','FID=id',
            '-lco','SPATIAL_INDEX=NONE',
            '-progress')

        $out = & $OGR @a 2>&1
        if ($LASTEXITCODE -eq 0) {
            wl "    OK ($t)" 'Green'; $ok++
        } else {
            $e = ($out | Select-Object -First 2) -join ' '
            wl "    FAIL ogr2ogr: $e" 'Red'; $fail++
        }
    }
}

if (Test-Path $TEMP_DIR) { Remove-Item -Recurse -Force $TEMP_DIR }
wl '=== DONE ===' 'Cyan'
wl "Total ZIPs processed: $total | OK imports: $ok | Failed: $fail | Skipped: $skip" 'White'
