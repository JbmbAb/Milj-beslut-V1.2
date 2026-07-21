$ErrorActionPreference = "Stop"

$env:PATH += ";C:\Program Files\GDAL;C:\Program Files\QGIS 4.0.2\bin;C:\Program Files\QGIS 3.28.11\bin"

$ZIP_FILE = "D:\temp_topo_extract\Topo10\mark_sverige.zip"
$EXTRACT_DIR = "D:\temp_mark_extract"
$TABLE_NAME = "topo_topo10_mark_sverige"

function Write-Log($Message, $Color="White") {
    $timestamp = Get-Date -Format "HH:mm:ss"
    Write-Host "[$timestamp] $Message" -ForegroundColor $Color
}

Write-Log "=== Manuell optimerad import av mark_sverige ===" "Cyan"

if (Test-Path $EXTRACT_DIR) {
    Write-Log "Rensar gammal extraheringsmapp..." "Gray"
    Remove-Item -Recurse -Force $EXTRACT_DIR
}
New-Item -ItemType Directory -Path $EXTRACT_DIR | Out-Null

Write-Log "Packar upp den 6.4 GB stora ZIP-filen helt och hållet till disk... (Detta tar några minuter men förhindrar CPU-hängningen)" "Yellow"
Expand-Archive -Path $ZIP_FILE -DestinationPath $EXTRACT_DIR -Force

$geoFile = Get-ChildItem -Path $EXTRACT_DIR -Recurse -File | Where-Object { $_.Extension -match "\.(shp|gpkg|tab)$" } | Select-Object -First 1

if (-not $geoFile) {
    Write-Log "Kunde inte hitta någon SHP eller GPKG i zipfilen!" "Red"
    exit 1
}

Write-Log "Kör ogr2ogr direkt på oförpackad fil: $($geoFile.FullName)" "Green"
try {
    & ogr2ogr -f "PostgreSQL" "PG:host=localhost user=miljobeslut dbname=miljobeslut password=miljobeslut" "$($geoFile.FullName)" -nln $TABLE_NAME -nlt GEOMETRY -overwrite -gt 131072 -lco GEOMETRY_NAME=geom -lco FID=id -lco SPATIAL_INDEX=GIST --config PG_USE_COPY YES
    if ($LASTEXITCODE -eq 0) {
        Write-Log "OK! Mark_sverige är fullständigt importerad." "Green"
    } else {
        Write-Log "VARNING: ogr2ogr avslutades med kod $LASTEXITCODE" "Yellow"
    }
} catch {
    Write-Log "FEL vid körning av ogr2ogr" "Red"
}

Write-Log "Rensar upp $EXTRACT_DIR..." "Gray"
Remove-Item -Recurse -Force $EXTRACT_DIR
Write-Log "=== Klart ===" "Cyan"
