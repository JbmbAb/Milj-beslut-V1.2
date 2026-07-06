# scripts/import/run-historical-download.ps1
#
# Mimer Librarian — Historical Maps Download Runner.
# Startar aria2c för att ladda ner alla 170 249 historiska kartor (1.15 TB)
# anonymt från Lantmäteriets FTP-server direkt till H-disken.

$InputFile = "storage\aria2c_historical_input.txt"
$LogFile = "storage\logs\aria2c_historical.log"

# Skapa loggkatalogen om den inte finns
if (-not (Test-Path "storage\logs")) {
    New-Item -ItemType Directory -Path "storage\logs" -Force | Out-Null
}

Write-Host "=== Starting Mimers Brunn Historical Maps Downloader ===" -ForegroundColor Green
Write-Host "Input queue:  $InputFile" -ForegroundColor Yellow
Write-Host "Log output:   $LogFile" -ForegroundColor Yellow
Write-Host "Target:       H:\Delade enheter\Miljöbeslut\GEO_Master_Archive\Data\LM\Historiska\" -ForegroundColor Green
Write-Host "Mode:         Polite background execution" -ForegroundColor Green

# Parametrar för aria2c:
#   -j 4 : Max 4 samtidiga filnedladdningar (snällt mot FTP-servern)
#   -x 2 : Max 2 kopplingar per fil
#   -c   : Fortsätt avbrutna nedladdningar (idempotent)
#   --retry-wait=5 : Vänta 5 sekunder vid fel innan omförsök
#   --max-tries=10 : Omförsök upp till 10 gånger per fil
#   --log-level=info : Detaljerad loggning till loggfilen
#   --log=$LogFile : Spara loggarna
#   -i $InputFile : Input-filen med alla länkar

$Arguments = @(
    "-j", "4",
    "-x", "2",
    "-c",
    "--retry-wait=5",
    "--max-tries=10",
    "--log-level=info",
    "--log=$LogFile",
    "-i", $InputFile
)

Write-Host "Launching aria2c background process..." -ForegroundColor Cyan

$Aria2cPath = "C:\Users\jimmy\AppData\Local\Microsoft\WinGet\Packages\aria2.aria2_Microsoft.Winget.Source_8wekyb3d8bbwe\aria2-1.37.0-win-64bit-build1\aria2c.exe"

# Starta aria2c i bakgrunden
$Process = Start-Process -FilePath $Aria2cPath -ArgumentList $Arguments -PassThru -NoNewWindow

if ($Process) {
    Write-Host "aria2c started successfully in background with Process ID: $($Process.Id)" -ForegroundColor Green
    Write-Host "Check progress in the log: Get-Content $LogFile -Tail 20" -ForegroundColor Cyan
} else {
    Write-Host "Failed to start aria2c process." -ForegroundColor Red
}
