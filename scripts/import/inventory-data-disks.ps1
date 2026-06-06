# Inventerar råfiler för import på C: och D: + PostGIS-trasig data (tomma stora tabeller).
# Skriver JSON under logs/ och storage/import-archive/manifests/
param(
    [switch]$Quick,
    [int]$MaxFilesPerRoot = 5000
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'data-disk-layout.ps1')

$root = $DataDiskLayout.RepoRoot
$manifestDir = Join-Path $DataDiskLayout.ImportArchiveRoot 'manifests'
New-Item -ItemType Directory -Force -Path $manifestDir | Out-Null
$outPath = Join-Path $manifestDir ('inventory-' + (Get-Date -Format 'yyyy-MM-dd-HHmmss') + '.json')

$scanRoots = @(
    @{ role = 'C_repo'; path = $DataDiskLayout.RepoRoot }
    @{ role = 'C_lastkajen'; path = $DataDiskLayout.LastkajenIngest }
    @{ role = 'C_archive'; path = $DataDiskLayout.ImportArchiveRoot }
    @{ role = 'D_geodata'; path = $DataDiskLayout.D_Geodata }
    @{ role = 'D_geo_inlarning'; path = $DataDiskLayout.D_GeoInlarning }
    @{ role = 'D_ingest_arkiv'; path = $DataDiskLayout.D_IngestArkiv }
    @{ role = 'D_dev'; path = $DataDiskLayout.D_Dev }
    @{ role = 'D_desktop_miljo'; path = $DataDiskLayout.D_Desktop_Miljo }
    @{ role = 'D_desktop_outlook'; path = $DataDiskLayout.D_Desktop_Outlook }
    @{ role = 'D_desktop_kommuner'; path = $DataDiskLayout.D_Desktop_Kommuner }
    @{ role = 'H_archive'; path = $DataDiskLayout.H_ArchiveRoot }
    @{ role = 'H_geodata'; path = $DataDiskLayout.H_GeoData }
    @{ role = 'H_geoinlarning'; path = $DataDiskLayout.H_GeoInlarning }
    @{ role = 'G_archive'; path = $DataDiskLayout.G_ArchiveRoot }
)

$geoExt = @('.zip', '.gpkg', '.gdb', '.shp', '.geojson', '.gml', '.tif', '.tiff', '.fgb', '.xml')
$docExt = @('.pdf', '.doc', '.docx', '.eml', '.msg', '.pst', '.mbox')

function Get-DirSummary([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) {
        return @{ exists = $false; bytes = 0; files = 0 }
    }
    $files = Get-ChildItem -LiteralPath $path -Recurse -File -Force -EA SilentlyContinue
    $sum = ($files | Measure-Object -Property Length -Sum).Sum
    return @{
        exists = $true
        bytes  = [int64]$sum
        gb     = [math]::Round($sum / 1GB, 3)
        files  = $files.Count
    }
}

function Get-ExtensionBreakdown([string]$path, [string[]]$exts, [int]$cap) {
    if (-not (Test-Path -LiteralPath $path)) { return @() }
    $groups = Get-ChildItem -LiteralPath $path -Recurse -File -Force -EA SilentlyContinue |
        Where-Object { $exts -contains $_.Extension.ToLowerInvariant() } |
        Group-Object Extension |
        ForEach-Object {
            @{
                ext   = $_.Name
                count = $_.Count
                gb    = [math]::Round(($_.Group | Measure-Object Length -Sum).Sum / 1GB, 3)
            }
        }
    return $groups | Sort-Object { $_.gb } -Descending
}

function Get-LastkajenPackages([string]$base) {
    if (-not (Test-Path -LiteralPath $base)) { return @() }
    Get-ChildItem -LiteralPath $base -Directory -Force | ForEach-Object {
        $id = 0
        [void][int]::TryParse($_.Name, [ref]$id)
        $bytes = (Get-ChildItem $_.FullName -Recurse -File -Force -EA SilentlyContinue | Measure-Object Length -Sum).Sum
        @{
            packageId    = $id
            name         = $_.Name
            gb           = [math]::Round($bytes / 1GB, 3)
            productFocus = ($script:LastkajenProductPackageIds -contains $id)
            archiveOnly  = ($script:LastkajenArchiveOnlyPackageIds -contains $id)
        }
    }
}

$rootsReport = foreach ($r in $scanRoots) {
    $sum = Get-DirSummary $r.path
    $entry = @{
        role = $r.role
        path = $r.path
    } + $sum
    if ($sum.exists -and -not $Quick) {
        $entry.geoExtensions = Get-ExtensionBreakdown $r.path $geoExt $MaxFilesPerRoot
        $entry.docExtensions = Get-ExtensionBreakdown $r.path $docExt $MaxFilesPerRoot
    }
    $entry
}

$postgis = $null
$dbUrl = $env:DATABASE_URL
if (-not $dbUrl) { $dbUrl = 'postgresql://miljobeslut:miljobeslut@127.0.0.1:5432/miljobeslut' }
try {
    $sql = @"
SELECT schemaname, relname, n_live_tup,
       pg_total_relation_size(relid) AS bytes
FROM pg_stat_user_tables
WHERE schemaname IN ('transport','env','lm','stage','core')
  AND pg_total_relation_size(relid) > 10485760
ORDER BY bytes DESC;
"@
    $jsonRows = docker exec miljobeslut-postgres psql -U miljobeslut -d miljobeslut -t -A -F "`t" -c $sql 2>$null
    if ($LASTEXITCODE -eq 0 -and $jsonRows) {
        $broken = @()
        $schemas = @{}
        foreach ($line in ($jsonRows -split "`n" | Where-Object { $_.Trim() })) {
            $p = $line -split "`t"
            if ($p.Count -lt 4) { continue }
            $n = [int64]$p[2]
            $b = [int64]$p[3]
            $full = "$($p[0]).$($p[1])"
            if ($n -eq 0) { $broken += @{ table = $full; bytes = $b; gb = [math]::Round($b / 1GB, 3) } }
            if (-not $schemas.ContainsKey($p[0])) { $schemas[$p[0]] = @{ bytes = 0; tables = 0 } }
            $schemas[$p[0]].bytes += $b
            $schemas[$p[0]].tables++
        }
        $postgis = @{
            schemaBytes = $schemas.GetEnumerator() | ForEach-Object {
                @{ schema = $_.Key; gb = [math]::Round($_.Value.bytes / 1GB, 2); tables = $_.Value.tables }
            }
            emptyLargeTables = $broken | Sort-Object { $_.bytes } -Descending
            emptyLargeCount  = $broken.Count
            emptyLargeGb     = [math]::Round(($broken | ForEach-Object { $_.bytes } | Measure-Object -Sum).Sum / 1GB, 2)
        }
    }
} catch {
    $postgis = @{ error = $_.Exception.Message }
}

$report = @{
    at                  = (Get-Date).ToString('o')
    diskPolicy          = 'C: arbete | D: tillfällig bulk | G: backup'
    lastkajenProductIds = $LastkajenProductPackageIds
    roots               = $rootsReport
    lastkajenPackages   = Get-LastkajenPackages $DataDiskLayout.LastkajenIngest
    postgis             = $postgis
    nextSteps           = @(
        'Kör sanitize-postgis-failed-imports.ps1 -WhatIf sedan utan WhatIf'
        'Kör archive-product-raw.ps1 för Lastkajen-produkt + G: backup'
        'Synka Google Drive om G: är tom'
        'Efter import:focus: flytta D:\GEodata m.m. till storage/import-archive på C:'
    )
}

$report | ConvertTo-Json -Depth 8 | Set-Content -Path $outPath -Encoding utf8
Write-Host "Manifest: $outPath"
Write-Host "PostGIS tomma stora tabeller: $($postgis.emptyLargeCount) (~$($postgis.emptyLargeGb) GB)" -ForegroundColor $(if ($postgis.emptyLargeGb -gt 5) { 'Yellow' } else { 'Green' })
