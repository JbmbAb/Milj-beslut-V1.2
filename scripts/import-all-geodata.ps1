$ErrorActionPreference = "Continue"

# GDAL (ogr2ogr) PATH
$env:PATH += ";C:\Program Files\GDAL;C:\Program Files\QGIS 4.0.2\bin;C:\Program Files\QGIS 3.28.11\bin"

$TARGET_DIRS = @(
    "H:\Delade enheter\Milj*beslut\Geo inl*rning",
    "H:\Delade enheter\Milj*beslut\GEodata"
)

$TEMP_EXTRACT_BASE = "D:\temp_geo_master"
$DB_URL = "PG:host=localhost user=miljobeslut dbname=miljobeslut password=miljobeslut"
$LOG_FILE = "C:\Dev\miljobeslut-platform-recovery\scripts\master-import.log"

# Skip files already being handled by the Topo background job
$EXCLUDE_FILES = @("Topo10.zip", "Topo50.zip", "Topo 250.zip", "Topo1 milj.zip")

function Write-Log($Message, $Color="White") {
    $timestamp = Get-Date -Format "HH:mm:ss"
    $logLine = "[$timestamp] $Message"
    Write-Host $logLine -ForegroundColor $Color
    Add-Content -Path $LOG_FILE -Value $logLine
}

if (Test-Path $LOG_FILE) { Remove-Item $LOG_FILE }
Write-Log "=== Master Geodata Import Start ===" "Cyan"

if (Test-Path $TEMP_EXTRACT_BASE) { Remove-Item -Recurse -Force $TEMP_EXTRACT_BASE }
New-Item -ItemType Directory -Path $TEMP_EXTRACT_BASE | Out-Null

function Import-SpatialFile {
    param(
        [string]$FilePath,
        [string]$TableName
    )
    
    # Rensa tabellnamn från ogiltiga tecken
    $cleanTable = $TableName.ToLower() -replace '[^a-z0-9]', '_'
    $cleanTable = $cleanTable -replace '^_+|_+$', '' # Trimma understreck

    # Begränsa längd till 63 tecken (PostgreSQL limit)
    if ($cleanTable.Length -gt 63) {
        $cleanTable = $cleanTable.Substring(0, 63)
    }

    Write-Log "   Importerar -> Tabell: $cleanTable" "DarkCyan"

    # Kör ogr2ogr
    try {
        & ogr2ogr -f "PostgreSQL" "PG:host=localhost user=miljobeslut dbname=miljobeslut password=miljobeslut" $FilePath -nln $cleanTable -nlt PROMOTE_TO_MULTI -unsetFieldWidth -overwrite -gt 65536 -lco GEOMETRY_NAME=geom -lco FID=id -lco SPATIAL_INDEX=GIST -makevalid --config PG_USE_COPY YES
        if ($LASTEXITCODE -eq 0) {
            Write-Log "      [OK] $cleanTable" "Green"
        } else {
            Write-Log "      [VARNING] ogr2ogr exit code $LASTEXITCODE för $cleanTable" "Yellow"
        }
    } catch {
        Write-Log "      [FEL] Kunde inte importera $FilePath" "Red"
    }
}

function Process-Directory {
    param([string]$DirPath)

    Write-Log "Söker igenom: $DirPath" "Gray"
    
    # Hitta spatiala filer direkt i mappen
    $spatialFiles = Get-ChildItem -Path $DirPath -File -Recurse -Include *.shp, *.gpkg, *.geojson -ErrorAction SilentlyContinue

    foreach ($file in $spatialFiles) {
        # Bygg ett namn baserat på mapp och fil för att undvika krockar
        $parentFolder = $file.Directory.Name
        $tableName = "geo_${parentFolder}_$($file.BaseName)"
        Import-SpatialFile -FilePath $file.FullName -TableName $tableName
    }

    # Hitta ZIP-filer
    $zipFiles = Get-ChildItem -Path $DirPath -File -Recurse -Filter *.zip -ErrorAction SilentlyContinue

    foreach ($zip in $zipFiles) {
        if ($EXCLUDE_FILES -contains $zip.Name) {
            Write-Log "Hoppar över $($zip.Name) (Hanteras av Topo-importen)" "Yellow"
            continue
        }

        Write-Log "Packar upp ZIP: $($zip.Name)" "Cyan"
        
        $tempDir = Join-Path $TEMP_EXTRACT_BASE $zip.BaseName
        if (Test-Path $tempDir) { Remove-Item -Recurse -Force $tempDir }
        New-Item -ItemType Directory -Path $tempDir | Out-Null
        
        try {
            & tar.exe -xf $zip.FullName -C $tempDir
            
            # Sök inuti den uppackade mappen
            $innerSpatialFiles = Get-ChildItem -Path $tempDir -File -Recurse -Include *.shp, *.gpkg, *.geojson
            
            foreach ($innerFile in $innerSpatialFiles) {
                # Använd zip-filens namn + filens namn som tabellnamn
                $tableName = "geo_$($zip.BaseName)_$($innerFile.BaseName)"
                Import-SpatialFile -FilePath $innerFile.FullName -TableName $tableName
            }
        } catch {
            Write-Log "Kunde inte packa upp $($zip.Name) - Kanske korrupt arkiv?" "Red"
        } finally {
            if (Test-Path $tempDir) { Remove-Item -Recurse -Force $tempDir }
        }
    }
}

foreach ($target in $TARGET_DIRS) {
    $resolvedTargets = Get-Item -Path $target -ErrorAction SilentlyContinue
    if ($resolvedTargets) {
        foreach ($res in $resolvedTargets) {
            Process-Directory -DirPath $res.FullName
        }
    } else {
        Write-Log "Mappen finns inte (eller hittades inte med wildcard): $target" "Red"
    }
}

Remove-Item -Recurse -Force $TEMP_EXTRACT_BASE
Write-Log "=== Master Geodata Import Klar ===" "Cyan"
