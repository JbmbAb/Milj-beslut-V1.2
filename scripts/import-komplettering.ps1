$ErrorActionPreference = "Continue"
$env:PATH += ";C:\Program Files\GDAL;C:\Program Files\QGIS 4.0.2\bin;C:\Program Files\QGIS 3.28.11\bin"
$sourceDir = "D:\GEO komplettering"
$basePath = (Resolve-Path "H:\Delade enheter\Milj*beslut").Path
$targetDir = Join-Path $basePath "GEO komplettering_importerat"

# Skapa målmappen på H: om den inte finns
if (-not (Test-Path $targetDir)) {
    Write-Host "Skapar mapp: $targetDir" -ForegroundColor Cyan
    New-Item -ItemType Directory -Path $targetDir | Out-Null
}

$dbHost = "localhost"
$dbPort = "5432"
$dbUser = "miljobeslut"
$dbPass = "miljobeslut"
$dbName = "miljobeslut"
$pgConnectionStr = "PG:host=$dbHost port=$dbPort dbname=$dbName user=$dbUser password=$dbPass"

# 1. Importera PDF:er till AI Knowledge Base
Write-Host "=== Steg 1: Importera PDF-dokument till Databasen ===" -ForegroundColor Green
$pdfs = Get-ChildItem -Path $sourceDir -Filter *.pdf -Recurse
if ($pdfs.Count -gt 0) {
    Write-Host "Hittade $($pdfs.Count) PDF-filer. Kör PDF-importer..."
    # Anropa befintligt TS-skript för att läsa in PDF:erna till databasen
    npx tsx c:\Dev\miljobeslut-platform-recovery\scripts\import-raw-pdfs.ts --root-dir $sourceDir
} else {
    Write-Host "Inga PDF-filer att importera."
}

# 2. Importera GIS-data
Write-Host "`n=== Steg 2: Importera Geodata (ZIP/GPKG/SHP) ===" -ForegroundColor Green
$zips = Get-ChildItem -Path $sourceDir -Filter *.zip

foreach ($zip in $zips) {
    Write-Host "`nPackar upp ZIP: $($zip.Name)" -ForegroundColor Yellow
    $tempDir = "D:\temp_komplett_extract\$($zip.BaseName)"
    
    if (Test-Path $tempDir) {
        Remove-Item -Path $tempDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $tempDir | Out-Null
    
    try {
        # Använd tar.exe för oändlig maxstorlek och supersnabb uppackning
        & tar.exe -xf $zip.FullName -C $tempDir
        
        $innerSpatialFiles = Get-ChildItem -Path $tempDir -File -Recurse -Include *.shp, *.gpkg, *.geojson
        
        foreach ($file in $innerSpatialFiles) {
            $tableName = "geo_komplett_$($zip.BaseName)_$($file.BaseName)"
            $tableName = $tableName -replace '[^a-zA-Z0-9_]', '_'
            $tableName = $tableName.ToLower()
            if ($tableName.Length -gt 63) {
                $tableName = $tableName.Substring(0, 63)
            }
            
            Write-Host "   Importerar -> Tabell: $tableName"
            
            # Högprestanda-import (samma som master)
            $ogrArgs = @(
                "-f", "PostgreSQL",
                $pgConnectionStr,
                $file.FullName,
                "-nln", $tableName,
                "-overwrite",
                "-lco", "GEOMETRY_NAME=geom",
                "-lco", "FID=id",
                "-nlt", "PROMOTE_TO_MULTI",
                "-dim", "XY",
                "-unsetFieldWidth",
                "--config", "PG_USE_COPY", "YES",
                "-gt", "65536"
            )
            
            & ogr2ogr @ogrArgs
            
            if ($LASTEXITCODE -ne 0) {
                Write-Host "      [FEL] vid import av $tableName" -ForegroundColor Red
            } else {
                Write-Host "      [OK] $tableName" -ForegroundColor Green
            }
        }
    } catch {
        Write-Host "Kunde inte packa upp $($zip.Name) - Kanske korrupt arkiv?" -ForegroundColor Red
    } finally {
        if (Test-Path $tempDir) {
            Remove-Item -Path $tempDir -Recurse -Force
        }
    }
}

# 3. Flytta alla filer från D:\GEO komplettering till H:
Write-Host "`n=== Steg 3: Flyttar importerade filer till H: ===" -ForegroundColor Green
$allFiles = Get-ChildItem -Path $sourceDir -File -Recurse
foreach ($file in $allFiles) {
    $relativePath = $file.FullName.Substring($sourceDir.Length + 1)
    $destination = Join-Path $targetDir $relativePath
    $destFolder = Split-Path $destination
    
    if (-not (Test-Path $destFolder)) {
        New-Item -ItemType Directory -Path $destFolder | Out-Null
    }
    
    Write-Host "Flyttar: $($file.Name) -> H:"
    Move-Item -Path $file.FullName -Destination $destination -Force
}

Write-Host "`nAllt klart! D:\GEO komplettering är nu importerad och tömd." -ForegroundColor Green
