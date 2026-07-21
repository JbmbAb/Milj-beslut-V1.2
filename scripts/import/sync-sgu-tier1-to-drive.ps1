# Upload SGU Tier 1 passed bundles (Jordskred, Grundvatten, Aktsamhet, Fastmark) to Drive.
# Uses Docker rclone with explicit DNS to avoid googleapis.com lookup failures.
$ErrorActionPreference = 'Continue'
$root = 'C:\Dev\miljobeslut-platform-recovery'
$rcloneConfig = Join-Path $root 'storage\rclone'
$logDir = Join-Path $root 'storage\manifests'
$version = '2026-06-24'
$started = Get-Date

$bundles = @(
  @{ tag = 'jordskred'; dataset = 'Jordskred'; zipDir = 'sgu-jordskred-zip'; planDir = 'sgu-jordskred-plan' },
  @{ tag = 'grundvatten'; dataset = 'Grundvatten'; zipDir = 'sgu-grundvatten-zip'; planDir = 'sgu-grundvatten-plan' },
  @{ tag = 'aktsamhet'; dataset = 'AktsamhetEfterarbetad'; zipDir = 'sgu-aktsamhetefterarbetad-zip'; planDir = 'sgu-aktsamhetefterarbetad-plan' },
  @{ tag = 'fastmark'; dataset = 'Fastmark'; zipDir = 'sgu-fastmark-zip'; planDir = 'sgu-fastmark-plan' }
)

function Invoke-DockerRclone($args) {
  docker run --rm --dns 8.8.8.8 `
    -v "${rcloneConfig}:/config/rclone:ro" `
    @args `
    rclone/rclone @args `
    --config /config/rclone/rclone.conf
}

function Sync-SguBundle($bundle) {
  $tag = $bundle.tag
  $dataset = $bundle.dataset
  $localRaw = Join-Path $root "storage\manifests\$($bundle.zipDir)\raw"
  $localManifest = Join-Path $root "storage\manifests\$($bundle.planDir)\manifest.json"
  $remoteBase = "drive:GEO_Master_Archive/Data/SGU/$dataset/$version"
  $logFile = Join-Path $logDir "rclone-sgu-tier1-$tag-$version.log"

  if (-not (Test-Path -LiteralPath $localRaw)) {
    Write-Host "[$tag] SKIP missing raw: $localRaw"
    return @{ ok = $false; skipped = $true }
  }

  Write-Host "[$tag] START $(Get-Date -Format o) -> $remoteBase"
  Write-Host "  log: $logFile"

  docker run --rm --dns 8.8.8.8 `
    -v "${rcloneConfig}:/config/rclone:ro" `
    -v "${localRaw}:/data:ro" `
    rclone/rclone copy /data "${remoteBase}/raw" `
    --config /config/rclone/rclone.conf `
    --transfers 4 --checkers 8 --retries 3 --low-level-retries 10 `
    --progress --stats 1m --log-level INFO 2>&1 | Tee-Object -FilePath $logFile -Append

  $rawExit = $LASTEXITCODE

  if (Test-Path -LiteralPath $localManifest) {
    docker run --rm --dns 8.8.8.8 `
      -v "${rcloneConfig}:/config/rclone:ro" `
      -v "${localManifest}:/tmp/manifest.json:ro" `
      rclone/rclone copyto /tmp/manifest.json "${remoteBase}/manifest.json" `
      --config /config/rclone/rclone.conf `
      --retries 3 --log-level INFO 2>&1 | Tee-Object -FilePath $logFile -Append
  } else {
    Write-Host "[$tag] WARN missing plan manifest: $localManifest"
  }

  $manifestExit = $LASTEXITCODE
  $ok = ($rawExit -ge 0 -and $rawExit -lt 8 -and $manifestExit -ge 0 -and $manifestExit -lt 8)
  Write-Host "[$tag] END rawExit=$rawExit manifestExit=$manifestExit ok=$ok"
  return @{ ok = $ok; rawExit = $rawExit; manifestExit = $manifestExit; logFile = $logFile }
}

Write-Host "=== SGU Tier 1 Drive archive sync (DNS 8.8.8.8) ==="
Write-Host "Started: $started"

$results = @()
foreach ($b in $bundles) {
  $results += @{ bundle = $b.tag; result = (Sync-SguBundle $b) }
}

$finished = Get-Date
$summary = @{
  startedAt = $started.ToString('o')
  finishedAt = $finished.ToString('o')
  elapsedMin = [math]::Round(($finished - $started).TotalMinutes, 1)
  version = $version
  dns = '8.8.8.8'
  results = $results
}
$summaryPath = Join-Path $logDir "rclone-sgu-tier1-$version-summary.json"
$summary | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 $summaryPath
Write-Host "Summary: $summaryPath"
Write-Host "Finished: $finished (elapsed $($summary.elapsedMin) min)"
