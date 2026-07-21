$ErrorActionPreference = "Stop"
$env:PATH += ";C:\Program Files\GDAL;C:\Program Files\QGIS 4.0.2\bin;C:\Program Files\QGIS 3.28.11\bin"

$TOPO_FILES = @("Topo50.zip", "Topo 250.zip", "Topo1 milj.zip")
$SEARCH_DIR = "H:\Delade enheter\Milj*beslut\GEodata"
$TEMP_DIR = "D:\temp_topo_extract"

function Write-Log($Message, $Color="White") {
    $timestamp = Get-Date -Format "HH:mm:ss"
    Write-Host "[$timestamp] $Message" -ForegroundColor $Color
}

Write-Log "=== Optimerad Topo Import (50, 250, 1M) ===" "Cyan"

if (Test-Path $TEMP_DIR) { Remove-Item -Recurse -Force $TEMP_DIR }
New-Item -ItemType Directory -Path $TEMP_DIR | Out-Null

foreach ($topoName in $TOPO_FILES) {
    $topoFile = Get-ChildItem -Path $SEARCH_DIR -Recurse -Filter $topoName | Select-Object -First 1
    
    if (-not $topoFile) {
        Write-Log "Hittade inte $($topoName), hoppar över." "Yellow"
        continue
    }

    Write-Log "-> Behandlar $($topoFile.Name)" "Green"
    
    $topoTempPath = Join-Path $TEMP_DIR $topoFile.BaseName
    New-Item -ItemType Directory -Path $topoTempPath | Out-Null

    Write-Log "   Packar upp huvud-zip till temporär mapp..." "Gray"
    Expand-Archive -Path $topoFile.FullName -DestinationPath $topoTempPath -Force

    $innerZips = Get-ChildItem -Path $topoTempPath -Filter "*.zip" -Recurse
    
    foreach ($innerZip in $innerZips) {
        Write-Log "   --> Importerar: $($innerZip.Name)" "DarkCyan"
        
        $baseName = $innerZip.BaseName.ToLower() -replace '[^a-z0-9]', '_'
        $tableName = "topo_$($topoFile.BaseName.ToLower().Replace(' ','_'))_$baseName"

        # Specialhantering: För att slippa /vsizip/ krash på Topo50 Mark, packar vi upp den
        $innerTempDir = Join-Path $topoTempPath ($innerZip.BaseName + "_ext")
        New-Item -ItemType Directory -Path $innerTempDir | Out-Null
        Expand-Archive -Path $innerZip.FullName -DestinationPath $innerTempDir -Force
        
        $geoFile = Get-ChildItem -Path $innerTempDir -Recurse -File | Where-Object { $_.Extension -match "\.(shp|gpkg|tab)$" } | Select-Object -First 1

        if ($geoFile) {
            try {
                & ogr2ogr -f "PostgreSQL" "PG:host=localhost user=miljobeslut dbname=miljobeslut password=miljobeslut" "$($geoFile.FullName)" -nln $tableName -nlt GEOMETRY -overwrite -gt 131072 -lco GEOMETRY_NAME=geom -lco FID=id -lco SPATIAL_INDEX=GIST --config PG_USE_COPY YES
                if ($LASTEXITCODE -eq 0) {
                    Write-Log "      OK (Tabell: $tableName)" "Green"
                } else {
                    Write-Log "      VARNING (ogr2ogr exit code $LASTEXITCODE) för $tableName" "Yellow"
                }
            } catch {
                Write-Log "      FEL vid import av $($innerZip.Name)" "Red"
            }
        }
    }
    Write-Log "   Rensar temp för $($topoFile.Name)..." "Gray"
    Remove-Item -Recurse -Force $topoTempPath
}

Remove-Item -Recurse -Force $TEMP_DIR
Write-Log "=== Klart ===" "Cyan"
