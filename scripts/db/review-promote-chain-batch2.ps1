# Waits for kommun-historik promote (batch 1), then runs CSV promote/quarantine (batch 2).
param(
  [int]$WaitPid = 94352
)

$ErrorActionPreference = 'Continue'
Set-Location 'C:\Dev\miljobeslut-platform-recovery'

Write-Host "Waiting for kommun batch PID $WaitPid to finish..."
try {
  Wait-Process -Id $WaitPid -ErrorAction Stop
  Write-Host "Kommun batch exited."
} catch {
  Write-Warning "Wait-Process failed ($($_.Exception.Message)). Starting batch 2 anyway in 30s..."
  Start-Sleep -Seconds 30
}

Write-Host "Starting batch 2: review-promote-from-csv.mjs --execute"
node scripts/db/review-promote-from-csv.mjs --execute 2>&1 |
  Tee-Object -FilePath 'storage/manifests/review-promote-from-csv-run.log'

Write-Host "Batch 2 finished with exit code $LASTEXITCODE"
