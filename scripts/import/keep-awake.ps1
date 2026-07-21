# Håller datorn vaken tills importprocesser är klara (eller tills du avbryter med Ctrl+C).
# Kör: powershell -File scripts/import/keep-awake.ps1

$ErrorActionPreference = 'SilentlyContinue'

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativePower {
  [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  public static extern uint SetThreadExecutionState(uint esFlags);
}
"@

# ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED | ES_DISPLAY_REQUIRED
$ES_CONTINUOUS = [uint32]0x80000000
$ES_SYSTEM_REQUIRED = [uint32]0x00000001
$ES_DISPLAY_REQUIRED = [uint32]0x00000002
$ES_AWAYMODE_REQUIRED = [uint32]0x00000040

function Set-Awake([bool]$on) {
  if ($on) {
    [void][NativePower]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED -bor $ES_DISPLAY_REQUIRED -bor $ES_AWAYMODE_REQUIRED)
  } else {
    [void][NativePower]::SetThreadExecutionState($ES_CONTINUOUS)
  }
}

# Spara nuvarande timeout (AC) för återställning
$saved = @{
  standby = (powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 2>$null | Select-String 'Current AC Power Setting Index' | ForEach-Object { ($_ -split '\s+')[-1] })
  monitor = (powercfg /query SCHEME_CURRENT SUB_VIDEO VIDEOIDLE 2>$null | Select-String 'Current AC Power Setting Index' | ForEach-Object { ($_ -split '\s+')[-1] })
}
$saved | ConvertTo-Json | Set-Content -Path (Join-Path $PSScriptRoot 'keep-awake-saved.json') -Encoding utf8

# Nollställ viloläge på nätadapter (AC)
powercfg /change standby-timeout-ac 0 | Out-Null
powercfg /change hibernate-timeout-ac 0 | Out-Null
powercfg /change monitor-timeout-ac 0 | Out-Null

Write-Host "Viloläge blockerat (AC: standby=0, skärm=0). Väntar på importprocesser..."
Write-Host "Avbryt med Ctrl+C — timeout återställs från keep-awake-saved.json om du kör restore-keep-awake.ps1"

Set-Awake $true

$importPatterns = @(
  'run-import-session',
  'import-sgu-bulk',
  'import-ingest-gpkg',
  'import_all_datasets',
  'import_lm_stac',
  'ogr2ogr'
)

try {
  while ($true) {
    $running = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object {
        $n = $_.Name
        $c = $_.CommandLine
        ($n -match 'powershell|python|node|tsx|ogr2ogr') -and (
          $importPatterns | Where-Object { $c -like "*$_*" }
        )
      }
    if (-not $running) {
      Write-Host "Inga importprocesser hittades — släpper vaken-lås om 60s..."
      Start-Sleep -Seconds 60
      $running = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
          $c = $_.CommandLine
          ($importPatterns | Where-Object { $c -like "*$_*" })
        }
      if (-not $running) { break }
    }
    Start-Sleep -Seconds 30
  }
} finally {
  Set-Awake $false
  Write-Host "Vaken-lås av. Kör scripts/import/restore-keep-awake.ps1 för att återställa timeout."
}
