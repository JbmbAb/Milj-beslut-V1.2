# bootstrap-sharp-demo.ps1
# Förbereder lokal skarp demo: DB, migrationer, preflight.
# Kräver Docker Desktop (valfritt db-profil) och ifylld .env.
#
# Användning:
#   powershell -ExecutionPolicy Bypass -File scripts/demo/bootstrap-sharp-demo.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/demo/bootstrap-sharp-demo.ps1 -SkipDocker

param(
  [switch]$SkipDocker
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root

Write-Host "`n=== Miljobeslut — bootstrap skarp demo ===`n"

if (-not (Test-Path ".env")) {
  if (Test-Path ".env.example") {
    Copy-Item ".env.example" ".env"
    Write-Host "Skapade .env från .env.example — fyll i DATABASE_URL, JWT_* och integrationer."
  } else {
    throw ".env saknas och .env.example hittades inte."
  }
}

if (-not $SkipDocker) {
  Write-Host "Startar PostGIS (docker-compose --profile docker-db)..."
  docker compose --profile docker-db up -d db
  if ($LASTEXITCODE -ne 0) { throw "docker compose up misslyckades" }

  Write-Host "Väntar på Postgres..."
  $retries = 30
  while ($retries -gt 0) {
    docker compose exec -T db pg_isready -U miljobeslut -d miljobeslut 2>$null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 2
    $retries--
  }
  if ($retries -le 0) { throw "Postgres blev inte redo inom timeout" }
}

Write-Host "Prisma generate + migrate..."
npm run prisma:generate
if ($LASTEXITCODE -ne 0) { throw "prisma generate misslyckades" }

npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) { throw "prisma migrate deploy misslyckades" }

Write-Host "Preflight (env)..."
npm run demo:preflight -- --env-only
if ($LASTEXITCODE -ne 0) { throw "demo:preflight misslyckades — kontrollera .env" }

Write-Host @"

Klart. Starta demo:
  Terminal 1: npm run dev:server
  Terminal 2: npm run dev
  Webbläsare: http://localhost:3000 (admin-inloggning)

P3 E2E lokalt (API utan browser-steg):
  npm run e2e:staging

Staging E2E (sätt PLAYWRIGHT_BASE_URL + admin-credentials):
  npm run e2e:staging:all

"@
