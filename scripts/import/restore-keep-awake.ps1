# Återställ standby/skärm-timeout efter keep-awake.ps1
$savedPath = Join-Path $PSScriptRoot 'keep-awake-saved.json'
if (-not (Test-Path $savedPath)) {
  Write-Host 'Ingen keep-awake-saved.json — sätter 30 min standby, 15 min skärm (standardvärden).'
  powercfg /change standby-timeout-ac 30
  powercfg /change monitor-timeout-ac 15
  exit 0
}
$saved = Get-Content $savedPath -Raw | ConvertFrom-Json
function IndexToMinutes($hexIndex) {
  if (-not $hexIndex) { return 30 }
  $v = [Convert]::ToInt32($hexIndex, 16)
  if ($v -eq 0) { return 0 }
  return [math]::Round($v / 60)
}
$standbyMin = IndexToMinutes $saved.standby
$monitorMin = IndexToMinutes $saved.monitor
if ($standbyMin -gt 0) { powercfg /change standby-timeout-ac $standbyMin } else { powercfg /change standby-timeout-ac 0 }
if ($monitorMin -gt 0) { powercfg /change monitor-timeout-ac $monitorMin } else { powercfg /change monitor-timeout-ac 0 }
Write-Host "Återställt: standby=$standbyMin min, monitor=$monitorMin min (AC)"
Remove-Item $savedPath -Force -ErrorAction SilentlyContinue
