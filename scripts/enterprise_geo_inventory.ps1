<#
.SYNOPSIS
Enterprise Geo Inventory Script (Fas 1) - V2.0

.DESCRIPTION
Skannar D-, H- och C-diskar efter ZIP och PDF-filer. Beräknar SHA256 och storlek,
och genererar manifest-filer samt dubblett-analys.
Gör INGA destruktiva operationer eller flyttar!
#>
# TODO(Mimers Brunn): Migration debt. This inventory still scans legacy roots on D:\GEodata,
# D:\Geo inlärning och C:\GEO PDF. Rewrite it to inventory only migration inputs plus
# H:\Delade enheter\Miljöbeslut\GEO_Master_Archive before next operational use.
[CmdletBinding()]
param ()

$ErrorActionPreference = "Stop"

# --- Konfiguration & Sökvägar ---
$H_DRIVE_ROOT = (Get-Item "H:\Delade enheter\Milj*beslut" -ErrorAction SilentlyContinue).FullName
$D_DRIVE_ROOTS = @("D:\GEodata", (Get-Item "D:\Geo inl*rning" -ErrorAction SilentlyContinue).FullName, "D:\ingest-arkiv-2026-03-29") | Where-Object { $_ -ne $null }
$C_PDF_ROOT = "C:\GEO PDF"

$MASTER_ARCHIVE = Join-Path $H_DRIVE_ROOT "GEO_Master_Archive"
$MANIFEST_DIR = Join-Path $MASTER_ARCHIVE "_manifests"
$LOG_DIR = Join-Path $MASTER_ARCHIVE "_logs"

$H_INDEX_FILE = Join-Path $MANIFEST_DIR "h_drive_index.csv"
$D_INDEX_FILE = Join-Path $MANIFEST_DIR "d_drive_index.csv"
$PDF_INDEX_FILE = Join-Path $MANIFEST_DIR "pdf_source_index.csv"
$MAPPING_TODO_FILE = Join-Path $MANIFEST_DIR "mapping.todo.json"

$TIMESTAMP = Get-Date -Format "yyyyMMdd_HHmmss"
$REPORT_FILE = Join-Path $LOG_DIR "dry_run_report_$TIMESTAMP.md"

# --- Initialisering ---
function Write-Log($Message, $Color="White") {
    $ts = Get-Date -Format "HH:mm:ss"
    Write-Host "[$ts] $Message" -ForegroundColor $Color
}

Write-Log "=== FAS 1: INVENTORY & DRY-RUN ===" "Cyan"
Write-Log "OBS: Detta kan ta lång tid (>5 minuter) eftersom SHA256 beräknas för ALLA gigantiska ZIP- och PDF-filer!" "Red"
Write-Log "Den enda diskpåverkan är skapandet av Manifest och Loggar på H:" "Yellow"

foreach ($dir in @($MANIFEST_DIR, $LOG_DIR)) {
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
}

# Hjälpfunktion för säker hashning
function Get-SafeHash($FilePath) {
    try {
        $hashObj = Get-FileHash -Path $FilePath -Algorithm SHA256 -ErrorAction Stop
        return @{ HashStatus="OK"; SHA256=$hashObj.Hash }
    } catch {
        Write-Log "Kunde inte hasha (Låst?): $FilePath" "Red"
        return @{ HashStatus="ERROR_LOCKED"; SHA256=$null }
    }
}

# Hjälpfunktion för att gissa Provider via heuristik
function Get-ProviderHeuristic($FileName) {
    if ($FileName -match "^(?i)(sgu|jordart|berggrund|grundvatten|brunnar|malm|mineral)") { return "SGU" }
    if ($FileName -match "^(?i)(msb|oversvamning|brandrisk|klimat)") { return "MSB" }
    if ($FileName -match "^(?i)(nv|naturvard|natura2000|riksintresse|biotop)") { return "Naturvardsverket" }
    if ($FileName -match "^(?i)(lm|fastighet|topo|hojd|karta|ortofoto)") { return "Lantmateriet" }
    if ($FileName -match "^(?i)(slu|skog|markfukt|trad)") { return "SLU" }
    if ($FileName -match "^(?i)trafikverket|lastkajen") { return "Trafikverket" }
    return $null
}

# --- Skannar H-disken ---
Write-Log "1/3 Skannar H-disken efter existerande ZIP-filer..." "Yellow"
$hZipFiles = Get-ChildItem -Path $H_DRIVE_ROOT -Filter "*.zip" -Recurse -File -ErrorAction SilentlyContinue | Where-Object { 
    $_.FullName -notmatch "\\GEO_Master_Archive\\" -and 
    $_.FullName -notmatch "\\Geo backup\\" -and 
    $_.FullName -notmatch "\\_quarantine\\" 
}
$hIndexData = @()

if ($hZipFiles -and $hZipFiles.Count -gt 0) {
    $i = 1
    foreach ($file in $hZipFiles) {
        Write-Progress -Activity "Hashar H-disken" -Status "Fil $i av $($hZipFiles.Count): $($file.Name)" -PercentComplete (($i / $hZipFiles.Count) * 100)
        $hashResult = Get-SafeHash $file.FullName
        $hIndexData += [PSCustomObject]@{
            FileName   = $file.Name
            Path       = $file.FullName
            SizeBytes  = $file.Length
            HashStatus = $hashResult.HashStatus
            SHA256     = $hashResult.SHA256
        }
        $i++
    }
    $hIndexData | Export-Csv -Path $H_INDEX_FILE -NoTypeInformation -Encoding UTF8
}

# --- Skannar D-disken ---
Write-Log "2/3 Skannar D-disken efter ZIP-filer (och genererar mapping.todo)..." "Yellow"
$dZipFiles = @()
foreach ($dRoot in $D_DRIVE_ROOTS) {
    if (Test-Path $dRoot) {
        $dZipFiles += Get-ChildItem -Path $dRoot -Filter "*.zip" -Recurse -File -ErrorAction SilentlyContinue
    }
}
$dIndexData = @()
$mappingTodo = @{}

if ($dZipFiles -and $dZipFiles.Count -gt 0) {
    $i = 1
    foreach ($file in $dZipFiles) {
        Write-Progress -Activity "Hashar D-disken" -Status "Fil $i av $($dZipFiles.Count): $($file.Name)" -PercentComplete (($i / $dZipFiles.Count) * 100)
        
        $hashResult = Get-SafeHash $file.FullName
        $dIndexData += [PSCustomObject]@{
            FileName   = $file.Name
            Path       = $file.FullName
            SizeBytes  = $file.Length
            HashStatus = $hashResult.HashStatus
            SHA256     = $hashResult.SHA256
        }

        # Identifiera via heuristik
        $guessedProvider = Get-ProviderHeuristic $file.Name
        if (-not $guessedProvider) {
            # Använd fullständig sökväg som stabil key för att förhindra namnkollisioner
            $mappingTodo[$file.FullName] = @{
                fileName = $file.Name
                provider = $null
                dataset = $null
                suggestedReason = "Heuristics failed to detect provider based on filename"
            }
        }
        $i++
    }
    $dIndexData | Export-Csv -Path $D_INDEX_FILE -NoTypeInformation -Encoding UTF8
}

if ($mappingTodo.Keys.Count -gt 0) {
    $mappingTodo | ConvertTo-Json -Depth 3 | Set-Content -Path $MAPPING_TODO_FILE -Encoding UTF8
    Write-Log "Hittade $($mappingTodo.Keys.Count) zippar med okänd provider." "Magenta"
}

# --- Skannar C-disken (PDF) ---
Write-Log "3/3 Skannar C:\GEO PDF efter källdokument..." "Yellow"
$cPdfFiles = @()
if (Test-Path $C_PDF_ROOT) {
    $cPdfFiles = Get-ChildItem -Path $C_PDF_ROOT -Filter "*.pdf" -Recurse -File -ErrorAction SilentlyContinue
}
$pdfIndexData = @()

if ($cPdfFiles -and $cPdfFiles.Count -gt 0) {
    $i = 1
    foreach ($file in $cPdfFiles) {
        Write-Progress -Activity "Hashar C-disken (PDF)" -Status "Fil $i av $($cPdfFiles.Count): $($file.Name)" -PercentComplete (($i / $cPdfFiles.Count) * 100)
        $hashResult = Get-SafeHash $file.FullName
        $pdfIndexData += [PSCustomObject]@{
            FileName   = $file.Name
            Path       = $file.FullName
            SizeBytes  = $file.Length
            HashStatus = $hashResult.HashStatus
            SHA256     = $hashResult.SHA256
        }
        $i++
    }
    $pdfIndexData | Export-Csv -Path $PDF_INDEX_FILE -NoTypeInformation -Encoding UTF8
}

# --- Dubblettanalys (D vs H) ---
Write-Log "Genomför dubblettanalys baserat på SHA256 + Filstorlek..." "Yellow"
$duplicatesFound = 0
$duplicateSizeFreed = 0

if ($dIndexData -and $hIndexData) {
    # Skapa en hashset för snabb sökning av H-diskens filer
    $hHashSet = @{}
    foreach ($hFile in $hIndexData) {
        if ($hFile.HashStatus -eq "OK" -and $hFile.SHA256) {
            $key = "$($hFile.SHA256)_$($hFile.SizeBytes)"
            $hHashSet[$key] = $true
        }
    }

    foreach ($dFile in $dIndexData) {
        if ($dFile.HashStatus -eq "OK" -and $dFile.SHA256) {
            $key = "$($dFile.SHA256)_$($dFile.SizeBytes)"
            if ($hHashSet.ContainsKey($key)) {
                $duplicatesFound++
                $duplicateSizeFreed += $dFile.SizeBytes
            }
        }
    }
}

# --- Generera Dry Run Rapport ---
Write-Log "Skapar Dry Run Markdown-rapport..." "Gray"

$totalHSize = if ($hIndexData) { [math]::Round(($hIndexData | Measure-Object -Property SizeBytes -Sum).Sum / 1GB, 2) } else { 0 }
$totalDSize = if ($dIndexData) { [math]::Round(($dIndexData | Measure-Object -Property SizeBytes -Sum).Sum / 1GB, 2) } else { 0 }
$totalPdfSize = if ($pdfIndexData) { [math]::Round(($pdfIndexData | Measure-Object -Property SizeBytes -Sum).Sum / 1MB, 2) } else { 0 }
$freedSpaceGB = [math]::Round($duplicateSizeFreed / 1GB, 2)

$hCount = if ($hZipFiles) { $hZipFiles.Count } else { 0 }
$dCount = if ($dZipFiles) { $dZipFiles.Count } else { 0 }
$pdfCount = if ($cPdfFiles) { $cPdfFiles.Count } else { 0 }

$reportContent = @"
# Geo Archive Inventory Report (Fas 1)
**Datum:** $(Get-Date -Format 'yyyy-MM-dd HH:mm')

## Sammanfattning
Denna inventering utfördes i Read-Only-läge. Endast `_manifests` och `_logs` mappar skapades. Inga övriga filer har flyttats, modifierats eller raderats.

### H-disken (Existerande Arkiv & Källor)
- **Hittade ZIP-filer:** $hCount
- **Total storlek:** $totalHSize GB
- **Manifest:** `h_drive_index.csv`
*(Exkluderade Master Archive, Backup och Karantän från sökningen)*

### D-disken (Nedladdade Zippar för Migration)
- **Hittade ZIP-filer:** $dCount
- **Total storlek:** $totalDSize GB
- **Okända Providers (mapping.todo):** $($mappingTodo.Keys.Count) st
- **Manifest:** `d_drive_index.csv`

### C:\GEO PDF (Källdokument)
- **Hittade PDF-filer:** $pdfCount
- **Total storlek:** $totalPdfSize MB
- **Manifest:** `pdf_source_index.csv`

## Dubblettanalys (D vs H)
- **Exakta kopior (Hash+Size) på H-disken:** $duplicatesFound filer
- **Teoretiskt Utrymme att frigöra direkt:** $freedSpaceGB GB

## Nästa Steg
1. Granska `mapping.todo.json` och fyll i `provider`/`dataset` för kända filer. (Flytta ifyllda rader till en framtida `mapping.json`).
2. Granska Dubblettanalysen – $freedSpaceGB GB kan raderas i Fas 2 utan kvalitetsförlust!
3. Utför migreringen genom att initiera Fas 2.
"@

Set-Content -Path $REPORT_FILE -Value $reportContent -Encoding UTF8

Write-Log "=== INVENTERING KLAR ===" "Green"
Write-Log "Se rapporten i: $REPORT_FILE" "Green"
