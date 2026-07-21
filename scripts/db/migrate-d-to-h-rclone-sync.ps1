# Sync local migration staging to Google Drive via rclone (canonical archive path)
# Catch-up: skips already uploaded files; brutal excludes for dev/metadata noise.
$ErrorActionPreference = 'Continue'
$root = 'C:\Dev\miljobeslut-platform-recovery'
$staging = Join-Path $root 'storage\migration_staging\2026-06-19'
$rcloneConfig = Join-Path $root 'storage\rclone'
$logDir = Join-Path $root 'storage\manifests'
$started = Get-Date

$RCLONE_EXCLUDES = @(
  '--exclude', 'node_modules/**',
  '--exclude', '.git/**',
  '--exclude', '**/metadata/**',
  '--exclude', '*.json',
  '--exclude', '**/.tmp.driveupload/**',
  '--exclude', '**/__pycache__/**',
  '--exclude', '**/.venv/**',
  '--exclude', '**/dist/**',
  '--exclude', '**/.next/**'
)

function Invoke-RcloneCopy($localRel, $remoteRel, $tag) {
  $local = Join-Path $staging $localRel
  if (-not (Test-Path -LiteralPath $local)) {
    Write-Host "[$tag] SKIP missing: $local"
    return @{ ok = $false; skipped = $true; local = $local }
  }
  $logFile = Join-Path $logDir "rclone-sync-$tag-filtered.log"
  Write-Host "[$tag] START $(Get-Date -Format o)"
  Write-Host "  local:  $local"
  Write-Host "  remote: drive:GEO_Master_Archive/$remoteRel"
  Write-Host "  excludes: node_modules, .git, metadata, *.json + transfers=8"
  docker run --rm `
    -v "${rcloneConfig}:/config/rclone:ro" `
    -v "${staging}:/staging:ro" `
    rclone/rclone copy "/staging/$($localRel -replace '\\','/')" "drive:GEO_Master_Archive/$remoteRel" `
    @RCLONE_EXCLUDES `
    --transfers 8 `
    --checkers 16 `
    --progress --stats 1m --retries 3 --low-level-retries 10 `
    --log-file "/dev/stdout" --log-level INFO 2>&1 | Tee-Object -FilePath $logFile -Append | Out-Null
  $exit = $LASTEXITCODE
  $ok = ($exit -ge 0 -and $exit -lt 8)
  Write-Host "[$tag] END exit=$exit ok=$ok log=$logFile"
  return @{ ok = $ok; exitCode = $exit; logFile = $logFile }
}

Write-Host "=== rclone filtered catch-up sync ==="
Write-Host "Started: $started"

$data = Invoke-RcloneCopy `
  'Data\_migration_from_D\2026-06-19' `
  'Data/_migration_from_D/2026-06-19' `
  'data'

$docs = Invoke-RcloneCopy `
  'Documents\Sources\_migration_from_D\2026-06-19' `
  'Documents/Sources/_migration_from_D/2026-06-19' `
  'docs'

Write-Host '[manifest] uploading execution report'
docker run --rm `
  -v "${rcloneConfig}:/config/rclone:ro" `
  -v "${logDir}:/staging:ro" `
  rclone/rclone copy /staging/D_to_H_migration_executed.json `
  'drive:GEO_Master_Archive/_manifests/D_to_H_migration_executed.json' `
  --transfers 4 `
  --log-level INFO 2>&1 | Tee-Object -FilePath (Join-Path $logDir 'rclone-sync-manifest-filtered.log') | Out-Null

$finished = Get-Date
$summary = @{
  startedAt  = $started.ToString('o')
  finishedAt = $finished.ToString('o')
  elapsedMin = [math]::Round(($finished - $started).TotalMinutes, 1)
  mode       = 'filtered_catch_up'
  dataSync   = $data
  docsSync   = $docs
  excludes   = @('node_modules/**', '.git/**', '**/metadata/**', '*.json')
  transfers  = 8
  note       = 'Aborted JSON crawl; final pass for pdf/geodata only'
}
$summaryPath = Join-Path $logDir 'D_to_H_rclone_sync_summary.json'
$summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $summaryPath -Encoding UTF8
Write-Host "Summary: $summaryPath"
Write-Host "DONE elapsed=$($summary.elapsedMin) min"
