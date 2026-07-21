# import-topo.ps1
# Detta skript är fristående och importerar Lantmäteriets Topo-kartor på ett stabilt och optimerat sätt.
# Eftersom Topo10 innehåller "nästlade" zippar (zippar inuti en zip), packar skriptet upp dem temporärt,
# läser in dem säkert via ogr2ogr, och rensar sedan upp efter sig.

$ErrorActionPreference = "Stop"

# GDAL (ogr2ogr) PATH (adjust based on user QGIS install, typical is OSGeo4W or QGIS bin)
$env:PATH += ";C:\Program Files\GDAL;C:\Program Files\QGIS 4.0.2\bin;C:\Program Files\QGIS 3.28.11\bin"


$TOPO_FILES = @("Topo10.zip", "Topo50.zip", "Topo 250.zip", "Topo1 milj.zip")
$SEARCH_DIR = "H:\Delade enheter\Milj*beslut\GEodata"
$TEMP_DIR = "D:\temp_topo_extract"

$DB_URL = "PG:host=localhost user=miljobeslut dbname=miljobeslut password=miljobeslut"

function Write-Log($Message, $Color="White") {
    $timestamp = Get-Date -Format "HH:mm:ss"
    Write-Host "[$timestamp] $Message" -ForegroundColor $Color
}

Write-Log "=== Optimerad Topo Import Start ===" "Cyan"

# Skapa temp-katalog
if (Test-Path $TEMP_DIR) { Remove-Item -Recurse -Force $TEMP_DIR }
New-Item -ItemType Directory -Path $TEMP_DIR | Out-Null

foreach ($topoName in $TOPO_FILES) {
    $topoFile = Get-ChildItem -Path $SEARCH_DIR -Recurse -Filter $topoName | Select-Object -First 1
    
    if (-not $topoFile) {
        Write-Log "Hittade inte $($topoName), hoppar över." "Yellow"
        continue
    }

    Write-Log "-> Behandlar $($topoFile.Name) ($([math]::Round($topoFile.Length / 1GB, 2)) GB)" "Green"
    
    $topoTempPath = Join-Path $TEMP_DIR $topoFile.BaseName
    New-Item -ItemType Directory -Path $topoTempPath | Out-Null

    Write-Log "   Packar upp huvud-zip till temporär mapp (kan ta tid)..." "Gray"
    Expand-Archive -Path $topoFile.FullName -DestinationPath $topoTempPath -Force

    # Nu letar vi efter alla underliggande ZIP-filer (t.ex. naturvard_sverige.zip) ELLER shapefiler/gpkg som låg direkt i.
    $innerZips = Get-ChildItem -Path $topoTempPath -Filter "*.zip" -Recurse
    
    foreach ($innerZip in $innerZips) {
        Write-Log "   --> Importerar nästlad fil: $($innerZip.Name)" "DarkCyan"
        
        # Säkerställ tabellnamn utan specialtecken
        $baseName = $innerZip.BaseName.ToLower() -replace '[^a-z0-9]', '_'
        $tableName = "topo_$($topoFile.BaseName.ToLower().Replace(' ','_'))_$baseName"

        $vsiPath = "/vsizip/$($innerZip.FullName.Replace('\', '/'))"

        try {
            & ogr2ogr -f "PostgreSQL" "PG:host=localhost user=miljobeslut dbname=miljobeslut password=miljobeslut" $vsiPath -nln $tableName -nlt GEOMETRY -overwrite -gt 65536 -lco GEOMETRY_NAME=geom -lco FID=id -lco SPATIAL_INDEX=GIST --config PG_USE_COPY YES
            if ($LASTEXITCODE -eq 0) {
                Write-Log "      OK (Tabell: $tableName)" "Green"
            } else {
                Write-Log "      VARNING (ogr2ogr exit code $LASTEXITCODE) för $tableName" "Yellow"
            }
        } catch {
            Write-Log "      FEL vid import av $($innerZip.Name)" "Red"
        }
    }
    
    # Rensa upp temp för denna topo-fil för att spara disk
    Write-Log "   Rensar temporära filer för $($topoFile.Name)..." "Gray"
    Remove-Item -Recurse -Force $topoTempPath
}

Remove-Item -Recurse -Force $TEMP_DIR
Write-Log "=== Topo Import Klar ===" "Cyan"
