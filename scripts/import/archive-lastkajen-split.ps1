# Delar Lastkajen på C: i produkt (behålls) vs bulk (backup till H:, sedan raderas från C:).
# Produkt: buller, barriär, vilt (paket 10088, 10177, 10499, 10094) + valfritt 10175 (historik, stor).
param(
    [switch]$WhatIf,
    [switch]$KeepOnC_OnlySmallProduct,  # behall bara 10088,10177,10499,10094 pa C (~0,7 GB); 10175 -> H:
    [switch]$SkipDeleteFromC,
    [switch]$DeleteBulkOnly            # radera bulk fran C utan kopiering (nar C: ar full, t.ex. 300 MB kvar)
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'data-disk-layout.ps1')

$srcRoot = $DataDiskLayout.LastkajenIngest
$hRoot = if ($DataDiskLayout.H_ArchiveRoot) { $DataDiskLayout.H_ArchiveRoot } else { 'H:\Min enhet\miljobeslut-archive-2026' }
# H: är ofta Google Drive "Min enhet" — samma layout som användaren redan har för GEodata
if (-not (Test-Path 'H:\Min enhet\GEodata') -and (Test-Path 'H:\Min enhet')) {
    $hRoot = Join-Path 'H:\Min enhet' 'miljobeslut-archive-2026'
}

$destBulk = Join-Path $hRoot 'lastkajen\bulk'
$destProduct = Join-Path $hRoot 'lastkajen\product'

$keepIds = @($LastkajenProductPackageIds)
if (-not $KeepOnC_OnlySmallProduct) {
    $keepIds += $LastkajenArchiveOnlyPackageIds
}

function Invoke-Robo([string]$src, [string]$dest, [string]$label) {
    if (-not (Test-Path -LiteralPath $src)) {
        Write-Host "Saknas: $src" -ForegroundColor Yellow
        return $false
    }
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    if ($WhatIf) {
        Write-Host "[WhatIf] $label : $src -> $dest"
        return $true
    }
    Write-Host "robocopy $label ..." -ForegroundColor Cyan
    Write-Host "  -> $dest" -ForegroundColor DarkGray
    & robocopy.exe $src.TrimEnd('\') $dest /E /Z /R:2 /W:5 /XO /FFT /J /NP /NFL /NDL /NJH /NJS | Out-Null
    $code = $LASTEXITCODE
    if ($code -ge 8) {
        Write-Host "FEL: $label exit $code" -ForegroundColor Red
        return $false
    }
    return $true
}

$log = @{
    at       = (Get-Date).ToString('o')
    srcRoot  = $srcRoot
    hRoot    = $hRoot
    keepOnC  = $keepIds
    bulk     = @()
    product  = @()
    deleted  = @()
    errors   = @()
}

Get-ChildItem -LiteralPath $srcRoot -Directory -Force | ForEach-Object {
    $id = [int]$_.Name
    $isKeep = $keepIds -contains $id
    $dest = if ($isKeep) { Join-Path $destProduct $_.Name } else { Join-Path $destBulk $_.Name }
    $label = if ($isKeep) { "H-product-$id" } else { "H-bulk-$id" }
    $ok = $true
    if (-not $isKeep -and $DeleteBulkOnly) {
        if ($WhatIf) {
            Write-Host "[WhatIf] radera bulk fran C: $($_.FullName)"
        }
    } elseif (-not $isKeep -or -not $DeleteBulkOnly) {
        if (-not $isKeep) {
            $ok = Invoke-Robo $_.FullName $dest $label
        } else {
            $ok = Invoke-Robo $_.FullName $dest $label
        }
    }
    $entry = @{ id = $id; dest = $dest; ok = $ok; keepOnC = $isKeep; deleteOnly = [bool]$DeleteBulkOnly }
    if ($isKeep) { $log.product += $entry } else { $log.bulk += $entry }
    if (-not $ok) { $log.errors += "robocopy failed: $id" }

    if ((-not $isKeep) -and (-not $WhatIf) -and (-not $SkipDeleteFromC) -and ($ok -or $DeleteBulkOnly)) {
        try {
            Remove-Item -LiteralPath $_.FullName -Recurse -Force
            $log.deleted += $_.FullName
            Write-Host "Raderat från C: $($_.FullName)" -ForegroundColor Green
        } catch {
            $log.errors += "delete failed: $($_.FullName) - $($_.Exception.Message)"
            Write-Host "Kunde inte radera $($_.FullName): $($_.Exception.Message)" -ForegroundColor Red
        }
    }
}

$manifestDir = Join-Path $DataDiskLayout.ImportArchiveRoot 'manifests'
New-Item -ItemType Directory -Force -Path $manifestDir | Out-Null
$manifestPath = Join-Path $manifestDir ('lastkajen-split-' + (Get-Date -Format 'yyyy-MM-dd-HHmmss') + '.json')
$log | ConvertTo-Json -Depth 6 | Set-Content -Path $manifestPath -Encoding utf8

Write-Host "`nManifest: $manifestPath"
Write-Host "Produkt kvar på C: under $srcRoot (paket: $($keepIds -join ', '))"
Write-Host "Bulk backup pa H: under $destBulk"
if ($WhatIf) { Write-Host 'Kör utan -WhatIf för att verkställa.' -ForegroundColor Cyan }
if ($log.errors.Count -gt 0) { exit 1 }
