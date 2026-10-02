# Tar bort misslyckad GIS-import: tomma tabeller med stor diskfootprint + hela transport-schemat.
# Behåller env/lm/core med data (t.ex. registerenhetsomradesytor, skyddad natur).
param(
    [switch]$WhatIf,
    [switch]$KeepTransportSchema,
    [long]$MinEmptyTableBytes = 50MB
)
$ErrorActionPreference = 'Stop'
# U30F F1 (PRES-05): every DROP goes through the protected relation gate (PowerShell binding).
. (Join-Path $PSScriptRoot '..\lib\ProtectedRelationGate.ps1')
$gateCaller = 'scripts/import/sanitize-postgis-failed-imports.ps1'
$logDir = Join-Path $PSScriptRoot '..\..\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$manifest = Join-Path $logDir ('sanitize-postgis-' + (Get-Date -Format 'yyyy-MM-dd-HHmmss') + '.json')

$executed = @()
$skipped = @()

function Invoke-DbSql([string]$sql, [string]$reason) {
    if ($WhatIf) {
        Write-Host "[WhatIf] $reason"
        Write-Host "  $sql" -ForegroundColor DarkGray
        $script:skipped += @{ sql = $sql; reason = $reason }
        return
    }
    docker exec miljobeslut-postgres psql -U miljobeslut -d miljobeslut -v ON_ERROR_STOP=1 -c $sql | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "SQL failed: $sql" }
    $script:executed += @{ sql = $sql; reason = $reason; at = (Get-Date).ToString('o') }
    Write-Host "OK: $reason" -ForegroundColor Green
}

# 1) transport — alla tabeller hade 0 rader men ~61 GB (avbruten Lastkajen-import)
if (-not $KeepTransportSchema) {
    Assert-UngovernedWriteAllowed -Caller $gateCaller -Operation 'DROP_SCHEMA' -Relation 'transport'
    Invoke-DbSql 'DROP SCHEMA IF EXISTS transport CASCADE;' 'transport-schema (0 rader, ~61 GB bloat)'
} else {
    Write-Host 'KeepTransportSchema: hoppar över DROP SCHEMA transport' -ForegroundColor Yellow
}

# 2) stage — dataportal-ingest (överlappande ingest_*)
Assert-UngovernedWriteAllowed -Caller $gateCaller -Operation 'DROP_SCHEMA' -Relation 'stage'
Invoke-DbSql 'DROP SCHEMA IF EXISTS stage CASCADE;' 'stage-schema (ingest_* från 631 GPKG, ej produkt)'

# 3) env/lm — tomma tabeller större än tröskel
$listSql = @"
SELECT format('%I.%I', schemaname, relname)
FROM pg_stat_user_tables
WHERE schemaname IN ('env','lm')
  AND COALESCE(n_live_tup, 0) = 0
  AND pg_total_relation_size(relid) >= $($MinEmptyTableBytes);
"@
$tables = docker exec miljobeslut-postgres psql -U miljobeslut -d miljobeslut -t -A -c $listSql
if ($LASTEXITCODE -ne 0) { throw 'Kunde inte lista tomma env/lm-tabeller' }

foreach ($t in ($tables -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
    # Behåll registerenhetsomradesytor även om stat skulle vara fel
    if ($t -match 'registerenhetsomradesytor$') { continue }
    # n_live_tup can be stale (e.g. right after a bulk load): a protected LU relation is never dropped on it.
    try {
        Assert-UngovernedWriteAllowed -Caller $gateCaller -Operation 'DROP' -Relation $t
    } catch {
        Write-Warning $_.Exception.Message
        $script:skipped += @{ sql = "DROP TABLE IF EXISTS $t CASCADE;"; reason = $_.Exception.Message }
        continue
    }
    Invoke-DbSql "DROP TABLE IF EXISTS $t CASCADE;" "tom stor tabell $t"
}

# 4) VACUUM FULL kräver exclusiv lock — kör ANALYZE + vanlig VACUUM
Invoke-DbSql 'VACUUM (ANALYZE);' 'återkräv disk efter DROP'

$summary = @{
    whatIf    = [bool]$WhatIf
    executed  = $executed
    skipped   = $skipped
    minBytes  = $MinEmptyTableBytes
}
$summary | ConvertTo-Json -Depth 5 | Set-Content -Path $manifest -Encoding utf8
Write-Host "`nManifest: $manifest"
if ($WhatIf) {
    Write-Host 'Kör utan -WhatIf för att verkställa.' -ForegroundColor Cyan
}
