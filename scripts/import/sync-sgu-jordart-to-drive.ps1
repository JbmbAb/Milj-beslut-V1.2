# Upload Jordart Tier 1 bundle to Drive (passed manifest + raw ZIP/GPKG).
$ErrorActionPreference = 'Continue'
$root = 'C:\Dev\miljobeslut-platform-recovery'
$rcloneConfig = Join-Path $root 'storage\rclone'
$logDir = Join-Path $root 'storage\manifests'
$version = '2026-06-24'
$dataset = 'Jordarters25k100k'
$localRaw = Join-Path $root 'storage\manifests\sgu-jordart-zip\raw'
$localManifest = Join-Path $root 'storage\manifests\sgu-jordarter25k100k-plan\manifest.json'
$remoteBase = "drive:GEO_Master_Archive/Data/SGU/$dataset/$version"
$logFile = Join-Path $logDir "rclone-sgu-jordart-$version.log"
$started = Get-Date

Write-Host "=== Jordart Drive sync (DNS 8.8.8.8) ==="
Write-Host "Started: $started"
Write-Host "  local raw: $localRaw"
Write-Host "  remote:    $remoteBase"
Write-Host "  log:       $logFile"

docker run --rm --dns 8.8.8.8 `
  -v "${rcloneConfig}:/config/rclone:ro" `
  -v "${localRaw}:/data:ro" `
  rclone/rclone copy /data "${remoteBase}/raw" `
  --config /config/rclone/rclone.conf `
  --transfers 4 --checkers 8 --retries 3 --low-level-retries 10 `
  --progress --stats 1m --log-level INFO 2>&1 | Tee-Object -FilePath $logFile -Append

$rawExit = $LASTEXITCODE

docker run --rm --dns 8.8.8.8 `
  -v "${rcloneConfig}:/config/rclone:ro" `
  -v "${localManifest}:/tmp/manifest.json:ro" `
  rclone/rclone copyto /tmp/manifest.json "${remoteBase}/manifest.json" `
  --config /config/rclone/rclone.conf `
  --retries 3 --log-level INFO 2>&1 | Tee-Object -FilePath $logFile -Append

$manifestExit = $LASTEXITCODE
$finished = Get-Date
$summary = @{
  startedAt = $started.ToString('o')
  finishedAt = $finished.ToString('o')
  elapsedMin = [math]::Round(($finished - $started).TotalMinutes, 1)
  rawExit = $rawExit
  manifestExit = $manifestExit
  ok = ($rawExit -ge 0 -and $rawExit -lt 8 -and $manifestExit -ge 0 -and $manifestExit -lt 8)
  remoteBase = $remoteBase
}
$summaryPath = Join-Path $logDir "rclone-sgu-jordart-$version-summary.json"
$summary | ConvertTo-Json | Set-Content -Encoding utf8 $summaryPath
Write-Host "END ok=$($summary.ok) rawExit=$rawExit manifestExit=$manifestExit elapsedMin=$($summary.elapsedMin)"
Write-Host "Summary: $summaryPath"
