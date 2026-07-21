$ErrorActionPreference = 'Stop'
Set-Location 'C:\Dev\miljobeslut-platform-recovery'
$logDir = 'storage\ingest\sgu'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'watchdog-console.log'
$cmd = "npx dotenv -e .env -- tsx scripts/import/sgu-import-watchdog.ts >> `"$log`" 2>&1"
Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-Command', $cmd) -WorkingDirectory (Get-Location) -WindowStyle Hidden
Write-Host "SGU watchdog startad. Log: $log"
