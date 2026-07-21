# Sync local staging to H: GEO_Master_Archive (Google Drive safe paths)
$ErrorActionPreference = 'Continue'
$staging = 'C:\Dev\miljobeslut-platform-recovery\storage\migration_staging\2026-06-19'
$stagingData = Join-Path $staging 'Data\_migration_from_D\2026-06-19'
$stagingDocs = Join-Path $staging 'Documents\Sources\_migration_from_D\2026-06-19'
$logDir = 'C:\Dev\miljobeslut-platform-recovery\storage\manifests'

$hRoot = Get-ChildItem -LiteralPath 'H:\Delade enheter' | Where-Object { $_.Name -like 'Milj*beslut' } | Select-Object -First 1
if (-not $hRoot) { throw 'H: Miljöbeslut folder not found' }

$master = Join-Path $hRoot.FullName 'GEO_Master_Archive'
$hData = Join-Path $master 'Data\_migration_from_D\2026-06-19'
$hDocs = Join-Path $master 'Documents\Sources\_migration_from_D\2026-06-19'

Write-Host "H root: $($hRoot.FullName)"
Write-Host "Sync data: $stagingData -> $hData"
$dataLog = Join-Path $logDir 'h-sync-ps-data.log'
robocopy $stagingData $hData /E /COPY:DAT /R:3 /W:10 /MT:4 "/LOG+:$dataLog" /NP
$dataExit = $LASTEXITCODE
Write-Host "Data robocopy exit: $dataExit"

Write-Host "Sync docs: $stagingDocs -> $hDocs"
$docsLog = Join-Path $logDir 'h-sync-ps-docs.log'
robocopy $stagingDocs $hDocs /E /COPY:DAT /R:3 /W:10 /MT:4 "/LOG+:$docsLog" /NP
$docsExit = $LASTEXITCODE
Write-Host "Docs robocopy exit: $docsExit"

$manifestSrc = Join-Path $logDir 'D_to_H_migration_executed.json'
$manifestDest = Join-Path $master '_manifests\D_to_H_migration_executed.json'
New-Item -ItemType Directory -Force -Path (Split-Path $manifestDest) | Out-Null
Copy-Item -LiteralPath $manifestSrc -Destination $manifestDest -Force
Write-Host "Manifest copied to $manifestDest"
Write-Host "DONE dataExit=$dataExit docsExit=$docsExit"
