param(
    [ValidateSet('prep', 'start', 'status', 'finalize')]
    [string]$Mode = 'status'
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$psqlCandidates = @(
    'C:\Program Files\QGIS 4.0.2\bin\psql.exe',
    'C:\Program Files\PostgreSQL\16\bin\psql.exe'
)
$psqlPath = $psqlCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $psqlPath) {
    throw 'psql.exe hittades inte i vanliga sokvagar.'
}

$dbArgs = @(
    '-h', '127.0.0.1',
    '-U', 'miljobeslut',
    '-d', 'miljobeslut',
    '-v', 'ON_ERROR_STOP=1',
    '-P', 'pager=off'
)

function Invoke-Psql {
    param([string]$Sql)

    $env:PGPASSWORD = 'miljobeslut'
    & $psqlPath @dbArgs '-c' $Sql
    if ($LASTEXITCODE -ne 0) {
        throw "psql misslyckades: $Sql"
    }
}

function Get-NmdProcesses {
    Get-CimInstance Win32_Process |
        Where-Object {
            ($_.Name -match 'python|ogr2ogr') -and
            ($_.CommandLine -match 'import_all_datasets.py nmd|env\.land_cover')
        }
}

function Stop-NmdProcesses {
    $processes = Get-NmdProcesses
    foreach ($process in $processes) {
        try {
            Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
        }
        catch {
            Write-Warning "Kunde inte stoppa process $($process.ProcessId): $($_.Exception.Message)"
        }
    }
}

switch ($Mode) {
    'prep' {
        Write-Host 'Stoppar aktiv NMD-import och forbereder snabb bulkimport...'
        Stop-NmdProcesses

        Invoke-Psql "ALTER SYSTEM SET synchronous_commit = 'off';"
        Invoke-Psql "ALTER SYSTEM SET wal_compression = 'on';"
        Invoke-Psql "ALTER SYSTEM SET checkpoint_timeout = '30min';"
        Invoke-Psql "ALTER SYSTEM SET max_wal_size = '16GB';"
        Invoke-Psql 'SELECT pg_reload_conf();'

        Invoke-Psql 'DROP INDEX IF EXISTS env.land_cover_shape_geom_idx;'
        Invoke-Psql 'TRUNCATE TABLE env.land_cover RESTART IDENTITY;'
        Invoke-Psql 'ALTER TABLE env.land_cover SET UNLOGGED;'
        Invoke-Psql 'ALTER TABLE env.land_cover SET (autovacuum_enabled = false);'

        Write-Host 'KLAR: NMD stopad, env.land_cover tom, snabbare bulkprofil och indexfritt importlage ar forberett.'
    }

    'start' {
        Write-Host 'Startar optimerad NMD-import...'
        $env:PGOPTIONS = '-c synchronous_commit=off -c work_mem=128MB -c maintenance_work_mem=1GB -c statement_timeout=0'
        Push-Location $repoRoot
        try {
            & python 'scripts/data-pipeline/import_all_datasets.py' 'nmd'
        }
        finally {
            Pop-Location
        }
    }

    'status' {
        Write-Host 'Aktiva NMD-processer:'
        Get-NmdProcesses | Select-Object ProcessId, Name, CommandLine | Format-List

        Write-Host 'Databasstatus:'
        Invoke-Psql @"
SELECT c.relpersistence,
       pg_total_relation_size(c.oid) AS total_bytes,
       pg_relation_size(c.oid) AS heap_bytes,
       pg_indexes_size(c.oid) AS index_bytes
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'env' AND c.relname = 'land_cover';
"@

        Invoke-Psql 'SELECT count(*)::bigint AS rows FROM env.land_cover;'
    }

    'finalize' {
        Write-Host 'Aterstaller normal drift for env.land_cover...'
        Stop-NmdProcesses

        Invoke-Psql 'ALTER TABLE env.land_cover SET LOGGED;'
        Invoke-Psql 'ALTER TABLE env.land_cover RESET (autovacuum_enabled);'
        Invoke-Psql 'CREATE INDEX IF NOT EXISTS land_cover_shape_geom_idx ON env.land_cover USING GIST (shape);'
        Invoke-Psql 'ANALYZE env.land_cover;'

        Invoke-Psql "ALTER SYSTEM SET synchronous_commit = 'on';"
        Invoke-Psql "ALTER SYSTEM SET wal_compression = 'off';"
        Invoke-Psql "ALTER SYSTEM SET checkpoint_timeout = '5min';"
        Invoke-Psql "ALTER SYSTEM SET max_wal_size = '1GB';"
        Invoke-Psql 'SELECT pg_reload_conf();'

        Write-Host 'KLAR: env.land_cover ar tillbaka i normaldrift med spatialt index och ordinarie DB-installback.'
    }
}