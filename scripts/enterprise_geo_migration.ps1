<#
.SYNOPSIS
Enterprise Geo Migration Script (Fas 2)

.DESCRIPTION
Läser manifesten från Fas 1.
Genomför en säker, en-fil-i-taget uppackning av D-diskens zippar.
Flyttar zipparna till karantän. Kopierar PDF:er och skapar redirects.
#>
# TODO(Mimers Brunn): Migration debt. This script still migrates from legacy roots on
# D:\GEodata / D:\Geo inlärning / C:\GEO PDF. Rewrite it to consume manifests rooted in
# H:\Delade enheter\Miljöbeslut\GEO_Master_Archive and retire the legacy paths afterward.
[CmdletBinding()]
param (
    [switch]$ExecuteMigration = $false
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

# --- Konfiguration & Sökvägar ---
$H_DRIVE_ROOT = (Get-Item "H:\Delade enheter\Milj*beslut" -ErrorAction SilentlyContinue).FullName
$MASTER_ARCHIVE = Join-Path $H_DRIVE_ROOT "GEO_Master_Archive"

$MANIFEST_DIR = Join-Path $MASTER_ARCHIVE "_manifests"
$LOG_DIR = Join-Path $MASTER_ARCHIVE "_logs"
$QUARANTINE_D = Join-Path $MASTER_ARCHIVE "_quarantine\zips-from-d"
$REVIEW_DIR = Join-Path $MASTER_ARCHIVE "_review\Okänd_Provider"
$PDF_TARGET_DIR = Join-Path $MASTER_ARCHIVE "Documents\Sources\C_Drive_Import"
$TEMP_EXTRACT_DIR = "D:\temp_geo_extract"

$D_INDEX_FILE = Join-Path $MANIFEST_DIR "d_drive_index.csv"
$PDF_INDEX_FILE = Join-Path $MANIFEST_DIR "pdf_source_index.csv"
$PDF_REDIRECT_FILE = Join-Path $MANIFEST_DIR "pdf_redirect_map.csv"
$TIMESTAMP = Get-Date -Format "yyyyMMdd_HHmmss"
$LOG_FILE = Join-Path $LOG_DIR "migration_log_$TIMESTAMP.txt"

function Write-Log($Message, $Color="White") {
    $ts = Get-Date -Format "HH:mm:ss"
    $logLine = "[$ts] $Message"
    Write-Host $logLine -ForegroundColor $Color
    Add-Content -Path $LOG_FILE -Value $logLine
}

Write-Log "=== FAS 2: MIGRATION & EXTRACTION ===" "Cyan"

if (-not $ExecuteMigration) {
    Write-Log "VARNING: Skriptet körs i DryRun-läge." "Yellow"
    Write-Log "Lägg till flaggan -ExecuteMigration för att faktiskt packa upp och flytta filer." "Yellow"
    exit
}

# Skapa kataloger
foreach ($dir in @($QUARANTINE_D, $REVIEW_DIR, $TEMP_EXTRACT_DIR, $PDF_TARGET_DIR)) {
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
}

# --- Hantera D-diskens Zippar ---
if (Test-Path $D_INDEX_FILE) {
    Write-Log "Läser D-diskens manifest..." "Gray"
    $dFiles = Import-Csv $D_INDEX_FILE
    
    $i = 1
    foreach ($file in $dFiles) {
        if (-not (Test-Path $file.Path)) {
            Write-Log "Fil saknas (raderad sedan Fas 1?): $($file.Path)" "Red"
            continue
        }

        Write-Log "[$i/$($dFiles.Count)] Behandlar: $($file.FileName)" "Cyan"
        
        # 1. Hård Free-Space Check
        $dDrive = Get-PSDrive D
        $freeSpaceGB = $dDrive.Free / 1GB
        $zipSizeGB = [double]$file.SizeBytes / 1GB
        $estimatedExpandedGB = $zipSizeGB * 4 # Räknar med 400% expansion för GIS-data
        
        if ($estimatedExpandedGB -gt $freeSpaceGB) {
            Write-Log "SKIPPAS: Risk för utrymmesbrist på D:. Kräver $estimatedExpandedGB GB, finns $freeSpaceGB GB." "Red"
            continue
        }

        $baseName = [System.IO.Path]::GetFileNameWithoutExtension($file.FileName)
        $extractTarget = Join-Path $TEMP_EXTRACT_DIR $baseName
        $finalReviewTarget = Join-Path $REVIEW_DIR $baseName
        
        if (-not (Test-Path $extractTarget)) { New-Item -ItemType Directory -Force -Path $extractTarget | Out-Null }
        if (-not (Test-Path $finalReviewTarget)) { New-Item -ItemType Directory -Force -Path $finalReviewTarget | Out-Null }

        try {
            # 2. Packa upp till D:\temp_geo_extract
            Write-Log "Packar upp till temp-mapp..." "Gray"
            [System.IO.Compression.ZipFile]::ExtractToDirectory($file.Path, $extractTarget)

            # 3. Sanity check: Leta efter TIF och försök köra gdalinfo om möjligt
            $tifs = Get-ChildItem -Path $extractTarget -Filter "*.tif" -Recurse -File
            foreach ($tif in $tifs) {
                if (Get-Command gdalinfo -ErrorAction SilentlyContinue) {
                    Write-Log "Kör gdalinfo på $($tif.Name)..." "DarkGray"
                    $gdalOut = gdalinfo $tif.FullName 2>&1
                    if ($LASTEXITCODE -ne 0) { Write-Log "GDAL VARNING på $($tif.Name)" "Red" }
                }
            }

            # 4. Flytta uppackade filer till H:\...\_review\Okänd_Provider\
            Write-Log "Flyttar uppackat innehåll till Master Archive (_review)..." "Gray"
            Move-Item -Path "$extractTarget\*" -Destination $finalReviewTarget -Force -ErrorAction Stop

            # 5. Flytta Zippen till Karantän på H:
            Write-Log "Flyttar original-zippen till karantän..." "Gray"
            $quarantinePath = Join-Path $QUARANTINE_D $file.FileName
            Move-Item -Path $file.Path -Destination $quarantinePath -Force -ErrorAction Stop

            Write-Log "Klar med $($file.FileName)" "Green"

        } catch {
            Write-Log "FEL vid hantering av $($file.FileName): $_" "Red"
        } finally {
            # Städa temp-mappen inför nästa fil
            if (Test-Path $extractTarget) { Remove-Item -Path $extractTarget -Recurse -Force -ErrorAction SilentlyContinue }
        }
        $i++
    }
}

# --- Hantera PDF från C:\GEO PDF ---
if (Test-Path $PDF_INDEX_FILE) {
    Write-Log "Börjar hantera PDF-filer (Kopiering + Link Migration)..." "Gray"
    $pdfFiles = Import-Csv $PDF_INDEX_FILE
    
    $redirects = @()
    
    $i = 1
    foreach ($pdf in $pdfFiles) {
        if (-not (Test-Path $pdf.Path)) { continue }
        
        Write-Log "[$i/$($pdfFiles.Count)] Kopierar PDF: $($pdf.FileName)" "Cyan"
        
        $newPath = Join-Path $PDF_TARGET_DIR $pdf.FileName
        
        try {
            # Kopiera (Flytta ej, för att inte bryta app-länkar direkt)
            Copy-Item -Path $pdf.Path -Destination $newPath -Force -ErrorAction Stop
            
            $redirects += [PSCustomObject]@{
                OldPath = $pdf.Path
                NewPath = $newPath
                SHA256  = $pdf.SHA256
            }
        } catch {
            Write-Log "Kunde inte kopiera $($pdf.FileName): $_" "Red"
        }
        $i++
    }
    
    if ($redirects.Count -gt 0) {
        Write-Log "Sparar $($redirects.Count) PDF-redirects till $PDF_REDIRECT_FILE" "Green"
        $redirects | Export-Csv -Path $PDF_REDIRECT_FILE -NoTypeInformation -Encoding UTF8 -Append
    }
}

Write-Log "=== FAS 2 SLUTFÖRD ===" "Green"
Write-Log "Granska loggen i $LOG_FILE" "Green"
