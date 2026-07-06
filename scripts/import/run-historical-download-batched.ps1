# scripts/import/run-historical-download-batched.ps1
#
# Mimer Librarian — Batched Historical Maps Downloader
# Delar upp den stora 170k-fillistan i hanterbara batchar
# och kör aria2c sekventiellt genom dem.
#
# Totalt: 170 249 filer, ~1.15 TB
# Target: H:\Delade enheter\Miljöbeslut\GEO_Master_Archive\Data\LM\Historiska\

param(
    [int]$BatchSize = 2000,
    [int]$StartBatch = 1
)

$Aria2c = "C:\Users\jimmy\AppData\Local\Microsoft\WinGet\Packages\aria2.aria2_Microsoft.Winget.Source_8wekyb3d8bbwe\aria2-1.37.0-win-64bit-build1\aria2c.exe"
$InputFile = "storage\aria2c_historical_input.txt"
$LogDir = "storage\logs"
$BatchDir = "storage\batches"

# Skapa kataloger
foreach ($d in @($LogDir, $BatchDir)) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

# Läs inputfilen — varje "entry" är 2 rader (URL + dir=...)
Write-Host "Reading input file..." -ForegroundColor Cyan
$allLines = Get-Content $InputFile
$totalLines = $allLines.Count
$entriesPerFile = $BatchSize * 2  # 2 rader per fil
$totalEntries = [math]::Floor($totalLines / 2)
$totalBatches = [math]::Ceiling($totalLines / $entriesPerFile)

Write-Host "=== Mimers Brunn Batched Historical Downloader ===" -ForegroundColor Green
Write-Host "Total files in queue : $totalEntries" -ForegroundColor Yellow
Write-Host "Batch size           : $BatchSize files ($entriesPerFile lines)" -ForegroundColor Yellow
Write-Host "Total batches        : $totalBatches" -ForegroundColor Yellow
Write-Host "Starting from batch  : $StartBatch" -ForegroundColor Yellow
Write-Host ""

$completedFiles = 0
$startTime = Get-Date

for ($b = $StartBatch; $b -le $totalBatches; $b++) {
    $startIdx = ($b - 1) * $entriesPerFile
    $endIdx = [math]::Min($startIdx + $entriesPerFile - 1, $totalLines - 1)
    $batchLines = $allLines[$startIdx..$endIdx]
    $filesInBatch = [math]::Floor($batchLines.Count / 2)

    $batchFile = "$BatchDir\batch_$b.txt"
    $batchLog = "$LogDir\aria2c_batch_$b.log"

    # Skriv batchfil
    $batchLines | Set-Content -Path $batchFile -Encoding String

    $elapsed = ((Get-Date) - $startTime).ToString("hh\:mm\:ss")
    Write-Host "[$elapsed] Batch $b/$totalBatches ($filesInBatch files, total done: $completedFiles/$totalEntries)" -ForegroundColor Cyan

    # Kör aria2c synkront för denna batch
    $args = @(
        "-i", $batchFile,
        "-j", "4",
        "-x", "2",
        "-c",
        "--retry-wait=5",
        "--max-tries=10",
        "--auto-file-renaming=false",
        "--allow-overwrite=false",
        "--log=$batchLog",
        "--log-level=warn",
        "--summary-interval=60",
        "--console-log-level=notice"
    )

    & $Aria2c @args

    if ($LASTEXITCODE -ne 0) {
        Write-Host "  WARNING: Batch $b had errors (exit code $LASTEXITCODE). Check $batchLog" -ForegroundColor Yellow
    } else {
        Write-Host "  OK: Batch $b completed successfully." -ForegroundColor Green
    }

    $completedFiles += $filesInBatch

    # Rensa batchfilen för att spara diskutrymme
    Remove-Item $batchFile -Force -ErrorAction SilentlyContinue
}

$totalElapsed = ((Get-Date) - $startTime).ToString("hh\:mm\:ss")
Write-Host ""
Write-Host "=== ALL DONE ===" -ForegroundColor Green
Write-Host "Downloaded $completedFiles files in $totalElapsed" -ForegroundColor Green
Write-Host "Data location: H:\Delade enheter\Miljöbeslut\GEO_Master_Archive\Data\LM\Historiska\" -ForegroundColor Green
