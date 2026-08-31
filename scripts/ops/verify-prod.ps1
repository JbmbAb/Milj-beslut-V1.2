# Verifiera lokal prod-stack (health, ready, DB, archive mount)
#
# Usage:
#   pwsh scripts/ops/verify-prod.ps1
#   pwsh scripts/ops/verify-prod.ps1 -BaseUrl http://127.0.0.1:8080
#   pwsh scripts/ops/verify-prod.ps1 -ComposeFile docker-compose.staging.yml

param(
  [string]$BaseUrl = "http://127.0.0.1:8080",
  [string]$ComposeFile = "docker-compose.prod.yml"
)

$ErrorActionPreference = "Continue"
$failures = 0

$webService = if ($ComposeFile -match 'staging') { 'web' } else { 'app' }
$workerService = if ($ComposeFile -match 'staging') { 'worker' } else { $null }
$dbName = if ($ComposeFile -match 'staging') { 'miljobeslut_staging' } else { 'miljobeslut_prod' }

function Test-Step([string]$Name, [scriptblock]$Block) {
  try {
    & $Block
    if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) { throw "exit $LASTEXITCODE" }
    Write-Host "[OK] $Name"
  } catch {
    Write-Host "[FAIL] $Name — $($_.Exception.Message)"
    $script:failures++
  }
}

Write-Host "Verifierar prod: $BaseUrl (compose: $ComposeFile, web=$webService)"
Write-Host ("-" * 50)

Test-Step "docker compose ps" {
  $ps = docker compose -f $ComposeFile ps --format json 2>$null | ConvertFrom-Json
  if (-not $ps) { throw "compose ps tomt" }
  $app = $ps | Where-Object { $_.Service -eq $webService -and $_.State -eq "running" }
  $db = $ps | Where-Object { $_.Service -eq "db" -and $_.State -eq "running" }
  if (-not $app) { throw "$webService körs inte" }
  if (-not $db) { throw "db körs inte" }
  if ($workerService) {
    $worker = $ps | Where-Object { $_.Service -eq $workerService -and $_.State -eq "running" }
    if (-not $worker) { throw "$workerService körs inte" }
  }
}

Test-Step "GET /health" {
  $r = Invoke-RestMethod -Uri "$BaseUrl/health" -TimeoutSec 15
  if (-not $r.ok) { throw "ok=false" }
}

Test-Step "GET /ready" {
  $r = Invoke-RestMethod -Uri "$BaseUrl/ready" -TimeoutSec 15
  if ($r.database -ne "ok") { throw "database=$($r.database)" }
}

Test-Step "DB pg_isready" {
  docker compose -f $ComposeFile exec -T db pg_isready -U miljobeslut -d $dbName 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "pg_isready failed" }
}

Test-Step "Archive mount (container /data/geo_master)" {
  $out = docker compose -f $ComposeFile exec -T $webService sh -c "test -d /data/geo_master && ls /data/geo_master | head -1" 2>&1
  if ($LASTEXITCODE -ne 0) { throw "mount saknas eller tom: $out" }
}

Write-Host ("-" * 50)
if ($failures -gt 0) {
  Write-Host "FAILED: $failures check(s)"
  exit 1
}
Write-Host "All checks passed."
exit 0
