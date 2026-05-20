Param(
  [string]$InputDir = "docs/qa/requirements-model",
  [string]$OutputPath = "docs/qa/requirements-model/requirements-verification-studio.xlsx",
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

$input = [System.IO.Path]::GetFullPath($InputDir)
$rowsCsv = Join-Path $input "requirement_rows.csv"
$casesCsv = Join-Path $input "requirement_cases.csv"

$rows = Read-CsvSemicolon -Path $rowsCsv
$cases = Read-CsvSemicolon -Path $casesCsv

$caseById = @{}
foreach ($c in $cases) {
  $caseById[[string]$c.CaseId] = $c
}

$merged = foreach ($r in $rows) {
  $case = $caseById[[string]$r.CaseId]
  [pscustomobject]@{
    PdfOpen              = "Oppna PDF"
    PdfViewUrl           = Safe-Text([string]$r.PdfViewUrl)
    RequirementId        = Safe-Text([string]$r.RequirementId)
    CaseId               = Safe-Text([string]$r.CaseId)
    DocumentId           = Safe-Text([string]$r.DocumentId)
    Kommun               = if ($case) { Safe-Text([string]$case.Kommun) } else { "" }
    Myndighet            = if ($case) { Safe-Text([string]$case.Myndighet) } else { "" }
    Dokumenttyp          = if ($case) { Safe-Text([string]$case.Dokumenttyp) } else { "" }
    KallaFil             = if ($case) { Safe-Text([string]$case.KallaFil) } else { "" }
    Kravkategori         = Safe-Text([string]$r.Kravkategori)
    Kravsubkategori      = Safe-Text([string]$r.Kravsubkategori)
    Kodningssakerhet     = Safe-Text([string]$r.Kodningssakerhet)
    Verifieringsstatus   = Safe-Text([string]$r.Verifieringsstatus)
    VerifieradJaNej      = Safe-Text([string]$r.VerifieradJaNej)
    VerifieradAv         = Safe-Text([string]$r.VerifieradAv)
    VerifieradDatum      = Safe-Text([string]$r.VerifieradDatum)
    KravtextCitat        = Safe-Text([string]$r.KravtextCitat)
    TolkadKravtext       = Safe-Text([string]$r.TolkadKravtext)
    ValideringsKommentar = Safe-Text([string]$r.ValideringsKommentar)
  }
}

if (-not $merged -or $merged.Count -eq 0) {
  throw "Inga verifieringsrader kunde byggas."
}

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

try {
  $wb = $excel.Workbooks.Add()
  while ($wb.Worksheets.Count -gt 2) { $wb.Worksheets.Item($wb.Worksheets.Count).Delete() }
  if ($wb.Worksheets.Count -lt 2) { [void]$wb.Worksheets.Add() }

  $wsData = $wb.Worksheets.Item(1)
  $wsGuide = $wb.Worksheets.Item(2)
  $wsData.Name = "Verifiering"
  $wsGuide.Name = "PivotGuide"

  $headers = @($merged[0].PSObject.Properties.Name)
  for ($c = 1; $c -le $headers.Count; $c++) {
    $wsData.Cells.Item(1, $c).Value2 = $headers[$c - 1]
  }
  $wsData.Rows.Item(1).Font.Bold = $true

  $rowIndex = 2
  foreach ($m in $merged) {
    for ($col = 1; $col -le $headers.Count; $col++) {
      $header = $headers[$col - 1]
      $wsData.Cells.Item($rowIndex, $col).Value2 = [string]$m.$header
    }

    $url = [string]$m.PdfViewUrl
    if ($url -and $url -match '^https?://') {
      $safeUrl = $url.Replace("""", """""")
      $wsData.Cells.Item($rowIndex, 1).FormulaR1C1 = "=HYPERLINK(""$safeUrl"",""Oppna PDF"")"
    }

    $rowIndex += 1
  }

  $lastRow = $rowIndex - 1
  $lastCol = $headers.Count
  $range = $wsData.Range($wsData.Cells.Item(1, 1), $wsData.Cells.Item($lastRow, $lastCol))
  [void]$range.AutoFilter()
  $wsData.Application.ActiveWindow.SplitRow = 1
  $wsData.Application.ActiveWindow.FreezePanes = $true
  $wsData.Columns.Item(1).ColumnWidth = 12
  $wsData.Columns.Item(2).ColumnWidth = 45
  $wsData.Columns.Item(10).ColumnWidth = 20
  $wsData.Columns.Item(11).ColumnWidth = 20
  $wsData.Columns.Item(17).ColumnWidth = 55
  $wsData.Columns.Item(18).ColumnWidth = 55

  $guideRows = @(
    "Pivot-start:",
    "1) Markera valfri cell i bladet Verifiering.",
    "2) Insert -> PivotTable -> From Table/Range.",
    "3) Rader: Kravkategori, Kravsubkategori.",
    "4) Kolumner: Verifieringsstatus.",
    "5) Varden: Count of RequirementId.",
    "6) Filter/Slicer: Kommun, Myndighet, Dokumenttyp, Kodningssakerhet.",
    "",
    "Risk-pivot:",
    "1) Rader: Kodningssakerhet.",
    "2) Kolumner: VerifieradJaNej.",
    "3) Varden: Count of RequirementId."
  )

  for ($i = 0; $i -lt $guideRows.Count; $i++) {
    $wsGuide.Cells.Item($i + 1, 1).Value2 = $guideRows[$i]
  }
  $wsGuide.Columns.Item(1).ColumnWidth = 90
  $wsGuide.Rows.Item(1).Font.Bold = $true
  $wsGuide.Rows.Item(9).Font.Bold = $true

  $outFull = [System.IO.Path]::GetFullPath($OutputPath)
  $outDir = [System.IO.Path]::GetDirectoryName($outFull)
  if (-not (Test-Path -LiteralPath $outDir)) {
    [void](New-Item -ItemType Directory -Path $outDir -Force)
  }

  $wb.SaveAs($outFull, 51)
  $wb.Close($false)
  Write-Host "Skapad: $outFull"

  if ($OpenAfterCreate) {
    Start-Process $outFull
  }
}
finally {
  $excel.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  [System.GC]::Collect()
  [System.GC]::WaitForPendingFinalizers()
}

