Param(
  [string]$InputDir = "docs/qa/requirements-model",
  [string]$OutputXlsx = "docs/qa/requirements-model/requirements-verification-priority.xlsx",
  [switch]$OpenAfterCreate
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Read-CsvSemicolon {
  Param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "CSV saknas: $Path"
  }
  $rows = Import-Csv -Path $Path -Delimiter ';'
  if (-not $rows -or $rows.Count -eq 0) {
    throw "CSV ar tom: $Path"
  }
  return $rows
}

function Safe-Text {
  Param([AllowNull()][string]$Value)
  if ($null -eq $Value) { return "" }
  $text = [string]$Value
  $text = [regex]::Replace($text, "[\x00-\x08\x0B\x0C\x0E-\x1F]", " ")
  $text = $text -replace "\r?\n", " "
  if ($text.Length -gt 32767) {
    return $text.Substring(0, 32755) + " [TRUNCATED]"
  }
  return $text
}

function Find-ColumnIndex {
  Param(
    [Parameter(Mandatory = $true)]$Sheet,
    [Parameter(Mandatory = $true)][string]$ColumnName
  )
  $used = $Sheet.UsedRange
  $lastCol = $used.Columns.Count
  for ($c = 1; $c -le $lastCol; $c++) {
    if ([string]$Sheet.Cells.Item(1, $c).Value2 -eq $ColumnName) {
      return $c
    }
  }
  return -1
}

function Add-FilterAndFreeze {
  Param([Parameter(Mandatory = $true)]$Sheet)
  $used = $Sheet.UsedRange
  [void]$used.AutoFilter()
  $Sheet.Activate() | Out-Null
  $Sheet.Application.ActiveWindow.SplitRow = 1
  $Sheet.Application.ActiveWindow.FreezePanes = $true
}

$input = [System.IO.Path]::GetFullPath($InputDir)
$rowsCsv = Join-Path $input "requirement_rows.csv"
$casesCsv = Join-Path $input "requirement_cases.csv"

$rows = Read-CsvSemicolon -Path $rowsCsv
$cases = Read-CsvSemicolon -Path $casesCsv

$caseById = @{}
foreach ($case in $cases) {
  $caseById[[string]$case.CaseId] = $case
}

$docStats = @{}
foreach ($row in $rows) {
  $case = $caseById[[string]$row.CaseId]
  $documentId = [string]$row.DocumentId
  if (-not $docStats.ContainsKey($documentId)) {
    $docStats[$documentId] = [ordered]@{
      DocumentId          = $documentId
      CaseId              = [string]$row.CaseId
      Kommun              = if ($case) { Safe-Text([string]$case.Kommun) } else { "" }
      Myndighet           = if ($case) { Safe-Text([string]$case.Myndighet) } else { "" }
      Dokumenttyp         = if ($case) { Safe-Text([string]$case.Dokumenttyp) } else { "" }
      KallaFil            = if ($case) { Safe-Text([string]$case.KallaFil) } else { "" }
      RequirementCount    = 0
      LowConfidenceRows   = 0
      ShortQuoteRows      = 0
      AutoRows            = 0
      MissingMunicipality = 0
      MissingAuthority    = 0
    }
  }

  $d = $docStats[$documentId]
  $d.RequirementCount += 1
  if ([string]$row.Kodningssakerhet -eq "LOW") { $d.LowConfidenceRows += 1 }
  if (([string]$row.KravtextCitat).Length -lt 80) { $d.ShortQuoteRows += 1 }
  if ([string]$row.Verifieringsstatus -eq "AUTO") { $d.AutoRows += 1 }
  if ([string]::IsNullOrWhiteSpace([string]$d.Kommun)) { $d.MissingMunicipality = 1 }
  if ([string]::IsNullOrWhiteSpace([string]$d.Myndighet)) { $d.MissingAuthority = 1 }
}

foreach ($documentId in $docStats.Keys) {
  $d = $docStats[$documentId]
  $score = 0
  $reasons = New-Object System.Collections.Generic.List[string]
  if ($d.MissingMunicipality -eq 1) { $score += 4; $reasons.Add("saknar_kommun") }
  if ($d.MissingAuthority -eq 1) { $score += 4; $reasons.Add("saknar_myndighet") }
  if ($d.LowConfidenceRows -gt 0) { $score += 3; $reasons.Add("low_confidence:$($d.LowConfidenceRows)") }
  if ($d.ShortQuoteRows -gt 0) { $score += 2; $reasons.Add("korta_citat:$($d.ShortQuoteRows)") }
  if ($d.AutoRows -gt 0) { $score += 1; $reasons.Add("auto_status:$($d.AutoRows)") }

  $band = if ($score -ge 9) { "P1-HOG" } elseif ($score -ge 6) { "P2-MEDEL" } else { "P3-LAG" }
  $d.PriorityScore = $score
  $d.PriorityBand = $band
  $d.PriorityReasons = ($reasons -join ",")
  $d.PdfViewUrl = "http://localhost:8787/api/admin/requirements/documents/$($d.DocumentId)/view"
}

$worklistRows = foreach ($row in $rows) {
  $case = $caseById[[string]$row.CaseId]
  $d = $docStats[[string]$row.DocumentId]
  [pscustomobject]@{
    PdfOpen              = "Oppna PDF"
    PdfViewUrl           = "http://localhost:8787/api/admin/requirements/documents/$([string]$row.DocumentId)/view"
    PriorityBand         = [string]$d.PriorityBand
    PriorityScore        = [string]$d.PriorityScore
    PriorityReasons      = [string]$d.PriorityReasons
    RequirementId        = Safe-Text([string]$row.RequirementId)
    CaseId               = Safe-Text([string]$row.CaseId)
    DocumentId           = Safe-Text([string]$row.DocumentId)
    Kommun               = if ($case) { Safe-Text([string]$case.Kommun) } else { "" }
    Myndighet            = if ($case) { Safe-Text([string]$case.Myndighet) } else { "" }
    Dokumenttyp          = if ($case) { Safe-Text([string]$case.Dokumenttyp) } else { "" }
    KallaFil             = if ($case) { Safe-Text([string]$case.KallaFil) } else { "" }
    Kravkategori         = Safe-Text([string]$row.Kravkategori)
    Kravsubkategori      = Safe-Text([string]$row.Kravsubkategori)
    Kodningssakerhet     = Safe-Text([string]$row.Kodningssakerhet)
    Verifieringsstatus   = Safe-Text([string]$row.Verifieringsstatus)
    VerifieradJaNej      = Safe-Text([string]$row.VerifieradJaNej)
    VerifieradAv         = Safe-Text([string]$row.VerifieradAv)
    VerifieradDatum      = Safe-Text([string]$row.VerifieradDatum)
    KravtextCitat        = Safe-Text([string]$row.KravtextCitat)
    TolkadKravtext       = Safe-Text([string]$row.TolkadKravtext)
    ValideringsKommentar = Safe-Text([string]$row.ValideringsKommentar)
  }
}

$worklistRows = $worklistRows | Sort-Object -Property @{ Expression = "PriorityScore"; Descending = $true }, @{ Expression = "Kodningssakerhet"; Descending = $true }, "Kommun"

$docPriorityRows = foreach ($d in $docStats.Values) {
  [pscustomobject]@{
    PdfOpen            = "Oppna PDF"
    PdfViewUrl         = [string]$d.PdfViewUrl
    PriorityBand       = [string]$d.PriorityBand
    PriorityScore      = [string]$d.PriorityScore
    PriorityReasons    = [string]$d.PriorityReasons
    DocumentId         = [string]$d.DocumentId
    CaseId             = [string]$d.CaseId
    Kommun             = [string]$d.Kommun
    Myndighet          = [string]$d.Myndighet
    Dokumenttyp        = [string]$d.Dokumenttyp
    KallaFil           = [string]$d.KallaFil
    RequirementCount   = [string]$d.RequirementCount
    LowConfidenceRows  = [string]$d.LowConfidenceRows
    ShortQuoteRows     = [string]$d.ShortQuoteRows
    MissingMunicipality = [string]$d.MissingMunicipality
    MissingAuthority   = [string]$d.MissingAuthority
  }
}

$docPriorityRows = $docPriorityRows | Sort-Object -Property @{ Expression = "PriorityScore"; Descending = $true }, @{ Expression = "RequirementCount"; Descending = $true }, "Kommun"

$worklistCsvPath = Join-Path $input "requirements-verification-priority.csv"
$docPriorityCsvPath = Join-Path $input "requirements-document-priority.csv"
$worklistRows | Export-Csv -Path $worklistCsvPath -Delimiter ';' -NoTypeInformation -Encoding UTF8
$docPriorityRows | Export-Csv -Path $docPriorityCsvPath -Delimiter ';' -NoTypeInformation -Encoding UTF8

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

try {
  $wb = $excel.Workbooks.Open($worklistCsvPath)
  $wsMain = $wb.Worksheets.Item(1)
  $wsMain.Name = "Verifiering"

  $wsMain.Rows.Item(1).Font.Bold = $true
  Add-FilterAndFreeze -Sheet $wsMain

  $used = $wsMain.UsedRange
  $lastRow = $used.Rows.Count
  $pdfOpenCol = Find-ColumnIndex -Sheet $wsMain -ColumnName "PdfOpen"
  $pdfUrlCol = Find-ColumnIndex -Sheet $wsMain -ColumnName "PdfViewUrl"
  if ($pdfOpenCol -gt 0 -and $pdfUrlCol -gt 0 -and $lastRow -ge 2) {
    $delta = $pdfUrlCol - $pdfOpenCol
    $formulaRange = $wsMain.Range($wsMain.Cells.Item(2, $pdfOpenCol), $wsMain.Cells.Item($lastRow, $pdfOpenCol))
    try {
      $formulaRange.FormulaR1C1 = "=HYPERLINK(RC[$delta],""Oppna PDF"")"
    }
    catch {
      $formulaRange.FormulaR1C1 = "=RC[$delta]"
    }
  }

  $wsMain.Columns.Item(1).ColumnWidth = 11
  $wsMain.Columns.Item(2).ColumnWidth = 55
  $wsMain.Columns.Item(3).ColumnWidth = 12
  $wsMain.Columns.Item(4).ColumnWidth = 11
  $wsMain.Columns.Item(5).ColumnWidth = 34
  $wsMain.Columns.Item(9).ColumnWidth = 16
  $wsMain.Columns.Item(10).ColumnWidth = 22
  $wsMain.Columns.Item(11).ColumnWidth = 14
  $wsMain.Columns.Item(12).ColumnWidth = 42
  $wsMain.Columns.Item(22).ColumnWidth = 52
  $wsMain.Columns.Item(23).ColumnWidth = 52

  $wsDoc = $wb.Worksheets.Add()
  $wsDoc.Name = "Prioritet_Dokument"
  $docHeaders = @($docPriorityRows[0].PSObject.Properties.Name)
  for ($c = 1; $c -le $docHeaders.Count; $c++) {
    $wsDoc.Cells.Item(1, $c).Value2 = $docHeaders[$c - 1]
  }
  $wsDoc.Rows.Item(1).Font.Bold = $true

  $r = 2
  foreach ($item in $docPriorityRows) {
    for ($c = 1; $c -le $docHeaders.Count; $c++) {
      $h = $docHeaders[$c - 1]
      $wsDoc.Cells.Item($r, $c).Value2 = [string]$item.$h
    }
    $r += 1
  }

  Add-FilterAndFreeze -Sheet $wsDoc
  $docUsed = $wsDoc.UsedRange
  $docLastRow = $docUsed.Rows.Count
  $docPdfOpenCol = Find-ColumnIndex -Sheet $wsDoc -ColumnName "PdfOpen"
  $docPdfUrlCol = Find-ColumnIndex -Sheet $wsDoc -ColumnName "PdfViewUrl"
  if ($docPdfOpenCol -gt 0 -and $docPdfUrlCol -gt 0 -and $docLastRow -ge 2) {
    $docDelta = $docPdfUrlCol - $docPdfOpenCol
    $docFormulaRange = $wsDoc.Range($wsDoc.Cells.Item(2, $docPdfOpenCol), $wsDoc.Cells.Item($docLastRow, $docPdfOpenCol))
    try {
      $docFormulaRange.FormulaR1C1 = "=HYPERLINK(RC[$docDelta],""Oppna PDF"")"
    }
    catch {
      $docFormulaRange.FormulaR1C1 = "=RC[$docDelta]"
    }
  }
  $wsDoc.Columns.AutoFit() | Out-Null

  $wsGuide = $wb.Worksheets.Add()
  $wsGuide.Name = "Guide"
  $guideLines = @(
    "Startordning for verifiering",
    "1) Gå till bladet Prioritet_Dokument.",
    "2) Filtrera PriorityBand = P1-HOG och börja uppifrån.",
    "3) Klicka Oppna PDF i respektive rad.",
    "4) Verifiera kravrader i bladet Verifiering (VerifieradJaNej, VerifieradAv, VerifieradDatum).",
    "5) Sätt Verifieringsstatus till VERIFIED först efter manuell kontroll mot PDF.",
    "",
    "Snabbfilter i Verifiering",
    "- VerifieradJaNej = Nej",
    "- PriorityBand = P1-HOG",
    "- Kravkategori = Ytkonstruktion eller DagvattenLakvatten",
    "- Kodningssakerhet = LOW"
  )
  for ($i = 0; $i -lt $guideLines.Count; $i++) {
    $wsGuide.Cells.Item($i + 1, 1).Value2 = $guideLines[$i]
  }
  $wsGuide.Rows.Item(1).Font.Bold = $true
  $wsGuide.Rows.Item(8).Font.Bold = $true
  $wsGuide.Columns.Item(1).ColumnWidth = 100

  $outputPath = [System.IO.Path]::GetFullPath($OutputXlsx)
  $outputDir = [System.IO.Path]::GetDirectoryName($outputPath)
  if (-not (Test-Path -LiteralPath $outputDir)) {
    [void](New-Item -ItemType Directory -Path $outputDir -Force)
  }

  $wb.SaveAs($outputPath, 51)
  $wb.Close($false)

  if ($OpenAfterCreate) {
    Start-Process $outputPath
  }

  $summary = [ordered]@{
    output = $outputPath
    documents = $docStats.Count
    requirements = $rows.Count
    p1HighDocs = ($docStats.Values | Where-Object { $_.PriorityBand -eq "P1-HOG" }).Count
    missingMunicipalityDocs = ($docStats.Values | Where-Object { $_.MissingMunicipality -eq 1 }).Count
    missingAuthorityDocs = ($docStats.Values | Where-Object { $_.MissingAuthority -eq 1 }).Count
    lowConfidenceDocs = ($docStats.Values | Where-Object { $_.LowConfidenceRows -gt 0 }).Count
  }
  $summary | ConvertTo-Json -Compress
}
finally {
  $excel.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  [System.GC]::Collect()
  [System.GC]::WaitForPendingFinalizers()
}

