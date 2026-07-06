# Wait for batch 2 CSV promote, then run batch 3 (55 resolved manual-review rows).
param(
  [int]$WaitPid = 96292
)

$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $root

Write-Host "Waiting for batch 2 PID $WaitPid..."
while (Get-Process -Id $WaitPid -ErrorAction SilentlyContinue) {
  Start-Sleep -Seconds 30
}
Write-Host "Batch 2 exited. Starting batch 3 (55 rows, ~8.8 GB)..."

$prevErrorPref = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
node scripts/db/review-promote-from-csv.mjs `
  --csv=storage/manifests/review-manual-review-batch3.csv `
  --log-out=storage/manifests/review-promote-batch3.json `
  --execute *>&1 |
  Tee-Object -FilePath storage/manifests/review-promote-batch3-run.log
$batchExit = $LASTEXITCODE
$ErrorActionPreference = $prevErrorPref

Write-Host "Batch 3 finished with exit code $batchExit"
exit $batchExit
