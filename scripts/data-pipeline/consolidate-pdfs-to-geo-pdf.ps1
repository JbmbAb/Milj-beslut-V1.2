# consolidate-pdfs-to-geo-pdf.ps1
# Samlar alla PDF-filer från D: till C:\GEO PDF med katalogisering.
# Kopierar (flyttar inte) – D:-kopior behålls som backup.

$ErrorActionPreference = 'Continue'
$dest = "C:\GEO PDF"

$stats = @{ copied = 0; skipped = 0; errors = 0; bytes = 0 }

function Copy-PdfTree {
    param(
        [string]$Source,
        [string]$DestSubfolder,
        [string[]]$Extensions = @('.pdf'),
        [switch]$IncludeAll  # kopiera alla filer, inte bara PDF
    )
    $target = Join-Path $dest $DestSubfolder
    if (-not (Test-Path $Source)) {
        Write-Host "  [SKIP] Källa saknas: $Source" -ForegroundColor Yellow
        return
    }

    if ($IncludeAll) {
        $files = Get-ChildItem $Source -Recurse -File -ErrorAction SilentlyContinue
    } else {
        $files = Get-ChildItem $Source -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $Extensions -contains $_.Extension.ToLower() }
    }

    foreach ($f in $files) {
        $rel = $f.FullName.Substring($Source.Length).TrimStart('\','/')
        $destFile = Join-Path $target $rel
        $destDir = Split-Path $destFile -Parent

        if (Test-Path $destFile) {
            $stats.skipped++
            continue
        }

        if (-not (Test-Path $destDir)) {
            New-Item -ItemType Directory -Path $destDir -Force | Out-Null
        }

        try {
            Copy-Item $f.FullName $destFile -Force
            $stats.copied++
            $stats.bytes += $f.Length
        } catch {
            Write-Host "  [ERR] $($f.FullName): $_" -ForegroundColor Red
            $stats.errors++
        }
    }
    Write-Host "  [OK] $DestSubfolder <- $Source ($($files.Count) filer)" -ForegroundColor Green
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host " Konsolidering av PDF till C:\GEO PDF" -ForegroundColor Cyan
Write-Host "========================================`n"

# --- 1. OutlookExport (kommun-beslut) ---
Write-Host "[1/8] Kommun-beslut (OutlookExport)..." -ForegroundColor White
Copy-PdfTree -Source "D:\Users\jimmy\Desktop\OutlookExport" `
             -DestSubfolder "kommun-beslut" `
             -IncludeAll

# --- 2. Naturvårdsverket (ingest-arkiv) ---
Write-Host "[2/8] Naturvardsverket..." -ForegroundColor White
Copy-PdfTree -Source "D:\ingest-arkiv-2026-03-29\naturvardsverket" `
             -DestSubfolder "naturvardsverket-arkiv"

# --- 3. Boverket (ingest-arkiv) ---
Write-Host "[3/8] Boverket..." -ForegroundColor White
Copy-PdfTree -Source "D:\ingest-arkiv-2026-03-29\boverket" `
             -DestSubfolder "boverket-arkiv" `
             -IncludeAll

# --- 4. Domstol & Rättspraxis (ingest-arkiv) ---
Write-Host "[4/8] Domstol & rattspraxis..." -ForegroundColor White
Copy-PdfTree -Source "D:\ingest-arkiv-2026-03-29\domstol-rss-miljo" `
             -DestSubfolder "domstol" `
             -IncludeAll
Copy-PdfTree -Source "D:\ingest-arkiv-2026-03-29\rattspraxis" `
             -DestSubfolder "rattspraxis" `
             -IncludeAll
Copy-PdfTree -Source "D:\ingest-arkiv-2026-03-29\rattspraxis-mark-miljo-split" `
             -DestSubfolder "rattspraxis\mark-miljo-split" `
             -IncludeAll
Copy-PdfTree -Source "D:\ingest-arkiv-2026-03-29\rattspraxis-miljo" `
             -DestSubfolder "rattspraxis\miljo" `
             -IncludeAll

# --- 5. Lagtexter & legal (ingest-arkiv) ---
Write-Host "[5/8] Lagtexter & legal..." -ForegroundColor White
Copy-PdfTree -Source "D:\ingest-arkiv-2026-03-29\legal" `
             -DestSubfolder "lagtexter" `
             -IncludeAll

# --- 6. Länsstyrelser (ingest-arkiv) ---
Write-Host "[6/8] Lansstyrelser..." -ForegroundColor White
Copy-PdfTree -Source "D:\ingest-arkiv-2026-03-29\lansstyrelserna" `
             -DestSubfolder "lansstyrelser-arkiv" `
             -IncludeAll

# --- 7. SGU & Bergsstaten (ingest-arkiv) ---
Write-Host "[7/8] SGU & Bergsstaten..." -ForegroundColor White
Copy-PdfTree -Source "D:\ingest-arkiv-2026-03-29\bergsstaten" `
             -DestSubfolder "bergsstaten-arkiv" `
             -IncludeAll
Copy-PdfTree -Source "D:\ingest-arkiv-2026-03-29\sgu-anvandarstod" `
             -DestSubfolder "sgu-anvandarstod-arkiv" `
             -IncludeAll
Copy-PdfTree -Source "D:\ingest-arkiv-2026-03-29\sgu-portal" `
             -DestSubfolder "sgu-portal-arkiv" `
             -IncludeAll

# --- 8. Geo inlärning PDF:er (redan delvis importerade) ---
Write-Host "[8/8] D:\Geo inlarning PDF:er..." -ForegroundColor White
Copy-PdfTree -Source "D:\Geo inlärning" `
             -DestSubfolder "sgu-guider" `
             -Extensions @('.pdf')

# --- 9. MBN Rapportpaket (Mariestad/Töreboda) ---
Write-Host "[BONUS] MBN Rapportpaket..." -ForegroundColor White
Copy-PdfTree -Source "D:\Users\jimmy\Desktop\Tecomatic\Mariestad\Rapportpaket_2026-03-30" `
             -DestSubfolder "kommun-beslut\mbn-rapportpaket" `
             -IncludeAll

# --- Övriga ingest-mappar ---
$extraDirs = @('atgardsportalen','havochvatten','sgi','svenskt_vatten')
foreach ($d in $extraDirs) {
    $src = "D:\ingest-arkiv-2026-03-29\$d"
    if (Test-Path $src) {
        Copy-PdfTree -Source $src -DestSubfolder "ovrigt\$d" -IncludeAll
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host " RESULTAT" -ForegroundColor Cyan
Write-Host "========================================"
Write-Host "Kopierade: $($stats.copied) filer ($([math]::Round($stats.bytes/1MB,0)) MB)"
Write-Host "Skippade (redan fanns): $($stats.skipped)"
Write-Host "Fel: $($stats.errors)"
Write-Host "`nKlar! Alla PDF:er samlat under C:\GEO PDF"
