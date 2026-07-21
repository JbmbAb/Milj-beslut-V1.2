# run-full-raster-pipeline.ps1
# Mimers Brunn — Wait for download and register all rasters Out-of-DB automatically

$ErrorActionPreference = "Stop"
$logFile = "raster_pipeline_run.log"

function Write-Log($msg) {
    $time = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $formatted = "[$time] $msg"
    Write-Host $formatted
    Add-Content -Path $logFile -Value $formatted
}

# Clear previous run log
if (Test-Path $logFile) { Remove-Item $logFile }

Write-Log "Starting automatic Mimers Brunn Raster pipeline..."

# Step 1: Start aria2c download in Polite Mode to prevent server blocks
Write-Log "Launching aria2c in Polite Mode for Naturvårdsverket + Lantmäteriet..."
try {
    # If aria2c is already running, kill it to start with the new settings
    $existingProc = Get-Process -Name "aria2c" -ErrorAction SilentlyContinue
    if ($existingProc) {
        Write-Log "Killing existing aria2c instance to apply new rate-limit parameters..."
        Stop-Process -Name "aria2c" -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }

    # Delete old logs
    Remove-Item "aria2c_download.log" -Force -ErrorAction SilentlyContinue

    # Launch aria2c in background using absolute path
    # -j 2: max 2 concurrent downloads
    # -x 2: max 2 connections per server
    # --retry-wait 5: wait 5s before retrying failed chunks
    $ariaPath = "C:\Users\jimmy\AppData\Local\Microsoft\WinGet\Packages\aria2.aria2_Microsoft.Winget.Source_8wekyb3d8bbwe\aria2-1.37.0-win-64bit-build1\aria2c.exe"
    Start-Process -FilePath $ariaPath -ArgumentList "-i aria2c_all_input.txt -j 2 -x 2 -s 2 --auto-file-renaming=false --summary-interval=15 --console-log-level=warn --log-level=warn --log=aria2c_download.log --retry-wait=5" -WindowStyle Hidden
    Write-Log "Aria2c background process started successfully."
} catch {
    Write-Log "Failed to start aria2c: $_"
    exit 1
}

# Step 2: Wait for download completion
Write-Log "Monitoring download progress..."
$waiting = $true
while ($waiting) {
    $proc = Get-Process -Name "aria2c" -ErrorAction SilentlyContinue
    if ($proc) {
        Write-Log "Aria2c download is active. Waiting for download to complete..."
        Start-Sleep -Seconds 60
    } else {
        Write-Log "Aria2c downloader has completed."
        $waiting = $false
    }
}

# Step 3: Register all downloaded raster files Out-of-DB in PostGIS
Write-Log "Registering all downloaded raster files Out-of-DB in PostGIS..."
try {
    & npx tsx scripts/import/import-raster-outdb.ts --all *>&1 | Out-String | ForEach-Object {
        Write-Log $_.Trim()
    }
    Write-Log "Out-of-DB raster registration completed."
} catch {
    Write-Log "Non-fatal error during raster registration: $_"
}

# Step 4: Merge and Import Lantmäteriet STAC Vector datasets to PostGIS
Write-Log "Importing Lantmäteriet STAC Vector datasets (fastigheter, byggnader, etc.) to PostGIS..."
$lmDatasets = @(
    "Fastighetsindelning_Nationell/Registerenhetsomradesytor",
    "Fastighetsindelning_Nationell/Registerenhetsomradeslinjer",
    "Byggnader_Nationell/Byggnad",
    "Marktacke_Nationell/Mark",
    "Ortnamn_Nationell/Ortnamn"
)

foreach ($dataset in $lmDatasets) {
    Write-Log "Processing STAC dataset: $dataset..."
    try {
        & npx tsx scripts/import/run-lm-stac-librarian-pipeline.ts --dataset=$dataset *>&1 | Out-String | ForEach-Object {
            Write-Log $_.Trim()
        }
        Write-Log "Successfully imported $dataset"
    } catch {
        Write-Log "Error importing dataset: $_"
    }
}

# Step 5: Print final status table and check DoD
Write-Log "Checking final registration status..."
try {
    & npx tsx scripts/db/check-raster-status.ts *>&1 | Out-String | ForEach-Object {
        Write-Log $_.Trim()
    }
} catch {
    Write-Log "Error checking registration status: $_"
}

Write-Log "Pipeline run completed successfully!"
