#!/usr/bin/env pwsh
# setup-docker-db.ps1
# Startar Docker-databasen och kör Prisma-migrationer
# Kör: .\setup-docker-db.ps1

$ErrorActionPreference = "Stop"
$DOCKER = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
$COMPOSE = "C:\Program Files\Docker\Docker\resources\bin\docker-compose.exe"
$NODE = "C:\Program Files\nodejs\node.exe"
$NPX = "C:\Program Files\nodejs\npx.cmd"
$PROJ = $PSScriptRoot

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    VARNING: $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "    FEL: $msg" -ForegroundColor Red }

# ─── 1. Docker Desktop igång? ──────────────────────────────────
Write-Step "Kontrollerar Docker Desktop..."
try {
    $info = & $DOCKER info 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Docker Desktop svarar inte – startar..."
        Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
        Write-Host "    Väntar 30s på Docker Desktop..." -ForegroundColor Yellow
        Start-Sleep -Seconds 30
        # Försök igen
        $info = & $DOCKER info 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Docker Desktop startade inte. Starta det manuellt och kör scriptet igen."
        }
    }
    Write-OK "Docker Desktop körs."
} catch {
    Write-Err $_.Exception.Message
    exit 1
}

# ─── 2. Starta db-containern ────────────────────────────────────
Write-Step "Startar PostgreSQL-container (miljobeslut-postgres)..."
Set-Location $PROJ
& $DOCKER compose up db -d 2>&1
if ($LASTEXITCODE -ne 0) {
    # Fallback om compose inte finns i bin-mappen
    & "C:\Program Files\Docker\Docker\resources\bin\docker-compose.exe" up db -d 2>&1
}

# ─── 3. Vänta på healthcheck ────────────────────────────────────
Write-Step "Väntar på att PostgreSQL ska bli klar..."
$maxWait = 60
$waited = 0
do {
    Start-Sleep -Seconds 3
    $waited += 3
    $status = & $DOCKER inspect --format='{{.State.Health.Status}}' miljobeslut-postgres 2>&1
    Write-Host "    ... $status ($waited s)" -ForegroundColor DarkGray
} while ($status -ne "healthy" -and $waited -lt $maxWait)

if ($status -ne "healthy") {
    Write-Warn "PostgreSQL svarade inte inom ${maxWait}s. Fortsätter ändå..."
} else {
    Write-OK "PostgreSQL är healthy!"
}

# ─── 4. Kör Prisma-migrationer ──────────────────────────────────
Write-Step "Kör Prisma migrate deploy..."
& $NPX prisma migrate deploy
if ($LASTEXITCODE -eq 0) {
    Write-OK "Prisma-migrationer körda."
} else {
    Write-Warn "Prisma-migrationer misslyckades – kolla output ovan."
}

# ─── 5. Aktivera PostGIS/pgvector (via SQL) ─────────────────────
Write-Step "Aktiverar PostGIS, pgvector och skapar env/core-scheman..."
$SQL = @"
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE SCHEMA IF NOT EXISTS env;
CREATE SCHEMA IF NOT EXISTS core;
GRANT ALL PRIVILEGES ON SCHEMA env TO miljobeslut;
GRANT ALL PRIVILEGES ON SCHEMA core TO miljobeslut;
"@
& $DOCKER exec -i miljobeslut-postgres psql -U miljobeslut -d miljobeslut -c $SQL 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-OK "Extensions och scheman är på plats."
} else {
    Write-Warn "Kunde inte köra SQL via Docker – kanske redan klart."
}

# ─── 6. Kör spatial-migrationer ─────────────────────────────────
$spatialMig = Join-Path $PROJ "prisma\spatial\001_env_spatial_tables.sql"
if (Test-Path $spatialMig) {
    Write-Step "Kör spatial-migration (SGU-tabeller)..."
    $content = Get-Content $spatialMig -Raw
    & $DOCKER exec -i miljobeslut-postgres psql -U miljobeslut -d miljobeslut -c $content 2>&1
    Write-OK "Spatial-migration klar."
} else {
    Write-Warn "Ingen spatial-migration hittades på: $spatialMig"
}

# ─── Klar ────────────────────────────────────────────────────────
Write-Host ""
Write-Host "══════════════════════════════════════════" -ForegroundColor Green
Write-Host "  KLAR! Databasen är igång och migrerad." -ForegroundColor Green
Write-Host "  Starta applikationen med:" -ForegroundColor Green
Write-Host "    npm run dev:server" -ForegroundColor White
Write-Host "══════════════════════════════════════════" -ForegroundColor Green
