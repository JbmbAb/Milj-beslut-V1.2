@echo off
REM ============================================================
REM  PREREQUISITES CHECK – Miljobeslut Geodata Bulk Import
REM  Körs som: scripts\import\check-prerequisites.bat
REM ============================================================
echo.
echo ============================================================
echo  SYSTEM CHECK FOR 100M–500M ROW GEODATA IMPORT
echo ============================================================
echo.

echo [1/9] GDAL ogr2ogr version...
"C:\Program Files\GDAL\ogr2ogr.exe" --version 2>&1
if errorlevel 1 (
    echo  ❌ GDAL NOT FOUND at C:\Program Files\GDAL\ogr2ogr.exe
    echo     Install from: https://trac.osgeo.org/osgeo4w/
) else (
    echo  ✅ GDAL OK
)
echo.

echo [2/9] Disk space (alla enheter)...
wmic logicaldisk get deviceid,freespace,size,volumename /format:list 2>&1
echo.

echo [3/9] RAM...
wmic OS get TotalVisibleMemorySize,FreePhysicalMemory /format:list 2>&1
echo.

echo [4/9] CPU-kärnor...
wmic cpu get NumberOfCores,NumberOfLogicalProcessors /format:list 2>&1
echo.

echo [5/9] PostgreSQL process...
tasklist /FI "IMAGENAME eq postgres.exe" 2>&1
pg_isready -h localhost -p 5432 2>&1
if errorlevel 1 (
    echo  ❌ PostgreSQL svarar inte på localhost:5432
) else (
    echo  ✅ PostgreSQL OK
)
echo.

echo [6/9] Download-katalog (C:\Dev\miljobeslut-platform-recovery\storage\ingest\platform-downloads)...
if exist "C:\Dev\miljobeslut-platform-recovery\storage\ingest\platform-downloads" (
    echo  ✅ Katalog finns
    dir /s /q "C:\Dev\miljobeslut-platform-recovery\storage\ingest\platform-downloads" 2>&1 | findstr /C:"File(s)" /C:"Dir(s)"
) else (
    echo  ⚠️  Katalog saknas – skapar...
    mkdir "C:\Dev\miljobeslut-platform-recovery\storage\ingest\platform-downloads"
    echo  ✅ Skapad
)
echo.

echo [7/9] E:-enhet (källdata)...
if exist "E:\MiljoBeslut_Produktdata_Sources" (
    dir /s /-c "E:\MiljoBeslut_Produktdata_Sources" 2>&1 | findstr /C:"File(s)" /C:"Dir(s)" /C:"bytes free"
    echo  ✅ E:-källdata finns
) else (
    echo  ❌ E:\MiljoBeslut_Produktdata_Sources saknas
)
echo.

echo [8/9] D:-enhet (arkiv)...
if exist "D:\ingest-arkiv-2026-03-29" (
    dir /s /-c "D:\ingest-arkiv-2026-03-29" 2>&1 | findstr /C:"File(s)" /C:"Dir(s)" /C:"bytes free"
    echo  ✅ D:-arkiv finns
) else (
    echo  ❌ D:\ingest-arkiv-2026-03-29 saknas
)
echo.

echo [9/9] Tunga processer som kan stängas under import...
echo  (Processer sorterade efter minneanvändning)
powershell -Command "Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 25 | Format-Table Name, @{N='RAM_MB';E={[math]::Round($_.WorkingSet64/1MB,0)}}, CPU -AutoSize" 2>&1
echo.

echo ============================================================
echo  REKOMMENDATION: Stäng processer med hög RAM-användning
echo  som INTE behövs (browsers, IDEs, Discord, Slack, etc.)
echo  Mål: minst 8GB fritt RAM för PostgreSQL maintenance_work_mem
echo ============================================================
pause
