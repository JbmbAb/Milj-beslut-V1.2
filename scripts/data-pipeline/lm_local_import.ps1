# scripts/data-pipeline/lm_local_import.ps1
# LM-import via LOCAL ogr2ogr directly from ZIP using native tar.exe for extraction
# Uses C drive for temporary extraction to resolve D drive space limits
# TODO(Mimers Brunn): Migration debt. This script still depends on D:\GEodata as source.
# Rewrite it to read archived LM deliveries from GEO_Master_Archive before reuse.

$zip = "D:\GEodata\Fastighetsinformation.zip"
# Extract to C drive where there is 38.4 GB of free space
$tempExtract = "C:\Dev\miljobeslut-platform-recovery\temp_lm_extract"
$db = "PG:dbname=miljobeslut host=127.0.0.1 user=miljobeslut password=miljobeslut port=5432"
$ogr2ogrPath = "C:\Program Files\GDAL\ogr2ogr.exe"

# Find psql
$psqlCandidates = @(
    'C:\Program Files\QGIS 4.0.2\bin\psql.exe',
    'C:\Program Files\PostgreSQL\16\bin\psql.exe',
    'C:\Program Files\PostgreSQL\15\bin\psql.exe',
    'C:\Program Files\PostgreSQL\17\bin\psql.exe'
)
$psqlPath = $psqlCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $psqlPath) {
    $psqlPath = (Get-Command psql -ErrorAction SilentlyContinue).Source
}

Write-Host "=== LM-import via local ogr2ogr ===" -ForegroundColor Green

# 1. Clean and Create temp dir on C drive
if (Test-Path $tempExtract) { 
    Write-Host "Rensar gammal temp-katalog på C-hårddisken..."
    Remove-Item $tempExtract -Recurse -Force -ErrorAction SilentlyContinue 
}
New-Item -ItemType Directory -Path $tempExtract -Force | Out-Null

# Clean up D drive temporary folder if any remained from previous crash
$dTempExtract = "D:\GEodata\temp_lm_extract"
if (Test-Path $dTempExtract) {
    Write-Host "Städar upp trasiga temp-filer på D-hårddisken..."
    Remove-Item $dTempExtract -Recurse -Force -ErrorAction SilentlyContinue
}

# 2. Extract main ZIP to C drive using native tar.exe (robust and fast)
Write-Host "[1/4] Extraherar Fastighetsinformation.zip till C-disk ($tempExtract)..."
& tar.exe -xf $zip -C $tempExtract
if ($LASTEXITCODE -ne 0) {
    Write-Error "Extrahering av huvud-ZIP misslyckades!"
    exit 1
}

# 3. Extract inner ZIPs on C drive
Write-Host "[2/4] Extraherar inre ZIP-filer på C-hårddisken..."
$fastighet_zip = "$tempExtract\fastighet\fastighetsamfallighet.zip"
$byggnad_zip = "$tempExtract\adress_byggnad\byggnad.zip"
$adress_zip = "$tempExtract\adress_byggnad\belagenhetsadress.zip"

if (Test-Path $fastighet_zip) {
    New-Item -ItemType Directory -Path "$tempExtract\fastighet\fastighet_xml" -Force | Out-Null
    Write-Host "  Extraherar fastighetsamfallighet.zip..."
    & tar.exe -xf $fastighet_zip -C "$tempExtract\fastighet\fastighet_xml"
    Write-Host "  OK: Fastighet extraherad"
}

if (Test-Path $byggnad_zip) {
    New-Item -ItemType Directory -Path "$tempExtract\adress_byggnad\byggnad_xml" -Force | Out-Null
    Write-Host "  Extraherar byggnad.zip..."
    & tar.exe -xf $byggnad_zip -C "$tempExtract\adress_byggnad\byggnad_xml"
    Write-Host "  OK: Byggnad extraherad"
}

if (Test-Path $adress_zip) {
    New-Item -ItemType Directory -Path "$tempExtract\adress_byggnad\adress_xml" -Force | Out-Null
    Write-Host "  Extraherar belagenhetsadress.zip..."
    & tar.exe -xf $adress_zip -C "$tempExtract\adress_byggnad\adress_xml"
    Write-Host "  OK: Adress extraherad"
}

# 4. Create schema
$env:PGPASSWORD = 'miljobeslut'
& $psqlPath -h 127.0.0.1 -U miljobeslut -d miljobeslut -c "CREATE SCHEMA IF NOT EXISTS lm;"

# 5. Import using local ogr2ogr
Write-Host "[3/4] Importerar XML-filer till PostGIS via lokal ogr2ogr..."

# FASTIGHET
if (Test-Path "$tempExtract\fastighet\fastighet_xml") {
    $files = @(Get-ChildItem "$tempExtract\fastighet\fastighet_xml\*.xml" | Sort-Object Name)
    Write-Host "  Fastighet: $($files.Count) filer..."
    if ($files.Count -gt 0) {
        $firstFile = $files[0]
        & $ogr2ogrPath -f PostgreSQL $db $firstFile.FullName -nln lm.fastighet -t_srs EPSG:3006 -nlt PROMOTE_TO_MULTI --config PG_USE_COPY YES -skipfailures -overwrite
        Write-Host "    [1/$($files.Count)] Skapade tabellen lm.fastighet med $($firstFile.Name)"
        
        for ($i = 1; $i -lt $files.Count; $i++) {
            $count = $i + 1
            $file = $files[$i]
            if ($count % 25 -eq 0 -or $count -eq $files.Count) { 
                Write-Host "    [$count/$($files.Count)] Importerar $($file.Name)..." 
            }
            & $ogr2ogrPath -f PostgreSQL $db $file.FullName -nln lm.fastighet -t_srs EPSG:3006 -nlt PROMOTE_TO_MULTI --config PG_USE_COPY YES -skipfailures -append
        }
    }
    Write-Host "    OK: Fastighet importerad"
}

# BYGGNAD
if (Test-Path "$tempExtract\adress_byggnad\byggnad_xml") {
    $files = @(Get-ChildItem "$tempExtract\adress_byggnad\byggnad_xml\*.xml" | Sort-Object Name)
    Write-Host "  Byggnad: $($files.Count) filer..."
    if ($files.Count -gt 0) {
        $firstFile = $files[0]
        & $ogr2ogrPath -f PostgreSQL $db $firstFile.FullName -nln lm.byggnad -t_srs EPSG:3006 -nlt PROMOTE_TO_MULTI --config PG_USE_COPY YES -skipfailures -overwrite
        Write-Host "    [1/$($files.Count)] Skapade tabellen lm.byggnad med $($firstFile.Name)"
        
        for ($i = 1; $i -lt $files.Count; $i++) {
            $count = $i + 1
            $file = $files[$i]
            if ($count % 50 -eq 0 -or $count -eq $files.Count) { 
                Write-Host "    [$count/$($files.Count)] Importerar $($file.Name)..." 
            }
            & $ogr2ogrPath -f PostgreSQL $db $file.FullName -nln lm.byggnad -t_srs EPSG:3006 -nlt PROMOTE_TO_MULTI --config PG_USE_COPY YES -skipfailures -append
        }
    }
    Write-Host "    OK: Byggnad importerad"
}

# ADRESS
if (Test-Path "$tempExtract\adress_byggnad\adress_xml") {
    $files = @(Get-ChildItem "$tempExtract\adress_byggnad\adress_xml\*.xml" | Sort-Object Name)
    Write-Host "  Adress: $($files.Count) filer..."
    if ($files.Count -gt 0) {
        $firstFile = $files[0]
        & $ogr2ogrPath -f PostgreSQL $db $firstFile.FullName -nln lm.adress -t_srs EPSG:3006 -nlt PROMOTE_TO_MULTI --config PG_USE_COPY YES -skipfailures -overwrite
        Write-Host "    [1/$($files.Count)] Skapade tabellen lm.adress med $($firstFile.Name)"
        
        for ($i = 1; $i -lt $files.Count; $i++) {
            $count = $i + 1
            $file = $files[$i]
            if ($count % 50 -eq 0 -or $count -eq $files.Count) { 
                Write-Host "    [$count/$($files.Count)] Importerar $($file.Name)..." 
            }
            & $ogr2ogrPath -f PostgreSQL $db $file.FullName -nln lm.adress -t_srs EPSG:3006 -nlt PROMOTE_TO_MULTI --config PG_USE_COPY YES -skipfailures -append
        }
    }
    Write-Host "    OK: Adress importerad"
}

# 6. VACUUM ANALYZE & spatial index
Write-Host "[4/4] Skapar spatiala index och kor VACUUM ANALYZE..."
& $psqlPath -h 127.0.0.1 -U miljobeslut -d miljobeslut -c "
CREATE INDEX IF NOT EXISTS fastighet_shape_idx ON lm.fastighet USING GIST (wkb_geometry);
CREATE INDEX IF NOT EXISTS byggnad_shape_idx ON lm.byggnad USING GIST (wkb_geometry);
CREATE INDEX IF NOT EXISTS adress_shape_idx ON lm.adress USING GIST (wkb_geometry);
VACUUM ANALYZE lm.fastighet;
VACUUM ANALYZE lm.byggnad;
VACUUM ANALYZE lm.adress;
"
Write-Host "  OK: Optimeringar klara"

# RESULTS
Write-Host "=== RESULTAT ===" -ForegroundColor Green
& $psqlPath -h 127.0.0.1 -U miljobeslut -d miljobeslut -c "
SELECT 'fastighet' AS tabell, COUNT(*) as rader FROM lm.fastighet
UNION ALL
SELECT 'byggnad', COUNT(*) FROM lm.byggnad
UNION ALL
SELECT 'adress', COUNT(*) FROM lm.adress
ORDER BY tabell;
"

# Clean temp from C drive
Write-Host "Rensar temp-filer från C-disken..."
Remove-Item $tempExtract -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "Klart!" -ForegroundColor Green
