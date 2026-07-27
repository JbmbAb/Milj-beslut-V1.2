# Registrera Windows Task Scheduler — daglig backup + verify (03:00)
#
# Usage (kräver admin PowerShell):
#   pwsh scripts/ops/register-prod-backup-task.ps1
#   pwsh scripts/ops/register-prod-backup-task.ps1 -Unregister

param(
  [switch]$Unregister,
  [string]$TaskName = "Miljobeslut-Prod-Daily",
  [string]$Time = "03:00"
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$DailyScript = Join-Path $PSScriptRoot "prod-daily.ps1"
$Action = New-ScheduledTaskAction -Execute "pwsh.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$DailyScript`"" -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -Daily -At $Time
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -AllowStartIfOnBatteries

if ($Unregister) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Avregistrerad: $TaskName"
  exit 0
}

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Miljobeslut lokal prod: pg_dump + verify-prod" -Force | Out-Null
Write-Host "OK — schemalagt $TaskName kl $Time dagligen"
Write-Host "Loggar: backups/prod/logs/"
Write-Host "Testkör: pwsh scripts/ops/prod-daily.ps1"
