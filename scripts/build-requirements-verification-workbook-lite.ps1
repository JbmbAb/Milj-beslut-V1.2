Param(
  [string]$InputDir = "docs/qa/requirements-model",
  [string]$OutputPath = "docs/qa/requirements-model/requirements-verification-studio.xlsx",
  [switch]$OpenAfterCreate
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$XlDatabase = 1
$XlRowField = 1
$XlColumnField = 2
$XlPageField = 3
$XlCount = -4112

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

function Write-Header {
  Param(
    [Parameter(Mandatory = $true)]$Sheet,
    [Parameter(Mandatory = $true)][string[]]$Headers
  )
  for ($c = 1; $c -le $Headers.Count; $c++) {
    $Sheet.Cells.Item(1, $c).Value2 = $Headers[$c - 1]
  }
  $Sheet.Rows.Item(1).Font.Bold = $true
}

function Create-Pivot {
  Param(
    [Parameter(Mandatory = $true)]$Workbook,
    [Parameter(Mandatory = $true)]$PivotSheet,
    [Parameter(Mandatory = $true)]$SourceSheet,
    [Parameter(Mandatory = $true)][string]$PivotName,
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][string[]]$RowFields,
    [string[]]$ColumnFields = @(),
    [string[]]$PageFields = @(),
    [Parameter(Mandatory = $true)][string]$DataFieldName
  )

  $PivotSheet.Cells.Item(1, 1).Value2 = $Title
  $PivotSheet.Cells.Item(1, 1).Font.Bold = $true

  $used = $SourceSheet.UsedRange
  $sourceAddress = $used.Address($true, $true, 1, $true)
  $cache = $Workbook.PivotCaches().Create($XlDatabase, $sourceAddress)
  $pivot = $cache.CreatePivotTable($PivotSheet.Range("A3"), $PivotName)

  $pos = 1
  foreach ($field in $RowFields) {
    $pf = $pivot.PivotFields($field)
    $pf.Orientation = $XlRowField
    $pf.Position = $pos
    $pos += 1
  }

  $pos = 1
  foreach ($field in $ColumnFields) {
    $pf = $pivot.PivotFields($field)
    $pf.Orientation = $XlColumnField
    $pf.Position = $pos
    $pos += 1
  }

  $pos = 1
  foreach ($field in $PageFields) {
    $pf = $pivot.PivotFields($field)
    $pf.Orientation = $XlPageField
    $pf.Position = $pos
    $pos += 1
  }

  [void]$pivot.AddDataField($pivot.PivotFields($DataFieldName), "Antal krav", $XlCount)
  $PivotSheet.Columns.AutoFit() | Out-Null
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
    PdfOpen             = "Oppna PDF"
    PdfViewUrl          = Safe-Text([string]$r.PdfViewUrl)
    RequirementId       = Safe-Text([string]$r.RequirementId)
    CaseId              = Safe-Text([string]$r.CaseId)
    DocumentId          = Safe-Text([string]$r.DocumentId)
    Kommun              = if ($case) { Safe-Text([string]$case.Kommun) } else { "" }
    Myndighet           = if ($case) { Safe-Text([string]$case.Myndighet) } else { "" }
    Dokumenttyp         = if ($case) { Safe-Text([string]$case.Dokumenttyp) } else { "" }
    KallaFil            = if ($case) { Safe-Text([string]$case.KallaFil) } else { "" }
    Kravkategori        = Safe-Text([string]$r.Kravkategori)
    Kravsubkategori     = Safe-Text([string]$r.Kravsubkategori)
    Kodningssakerhet    = Safe-Text([string]$r.Kodningssakerhet)
    Verifieringsstatus  = Safe-Text([string]$r.Verifieringsstatus)
    VerifieradJaNej     = Safe-Text([string]$r.VerifieradJaNej)
    VerifieradAv        = Safe-Text([string]$r.VerifieradAv)
    VerifieradDatum     = Safe-Text([string]$r.VerifieradDatum)
    KravtextCitat       = Safe-Text([string]$r.KravtextCitat)
    TolkadKravtext      = Safe-Text([string]$r.TolkadKravtext)
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
  while ($wb.Worksheets.Count -lt 4) { [void]$wb.Worksheets.Add() }
  while ($wb.Worksheets.Count -gt 4) { $wb.Worksheets.Item($wb.Worksheets.Count).Delete() }

  $wsData = $wb.Worksheets.Item(1)
  $wsStatus = $wb.Worksheets.Item(2)
  $wsRisk = $wb.Worksheets.Item(3)
  $wsFocus = $wb.Worksheets.Item(4)

  $wsData.Name = "Verifiering"
  $wsStatus.Name = "Pivot_Status"
  $wsRisk.Name = "Pivot_Risk"
  $wsFocus.Name = "Pivot_Fokus"

  $headers = @($merged[0].PSObject.Properties.Name)
  Write-Header -Sheet $wsData -Headers $headers

  $rowIndex = 2
  foreach ($m in $merged) {
    for ($col = 1; $col -le $headers.Count; $col++) {
      $header = $headers[$col - 1]
      $wsData.Cells.Item($rowIndex, $col).Value2 = [string]$m.$header
    }

    $url = [string]$m.PdfViewUrl
    if ($url -and $url -match '^https?://') {
      $cell = $wsData.Cells.Item($rowIndex, 1)
      $safeUrl = $url.Replace("""", """""")
      try {
        $cell.FormulaR1C1 = "=HYPERLINK(""$safeUrl"",""Oppna PDF"")"
      }
      catch {
        $cell.Value2 = $url
      }
    }

    $rowIndex += 1
  }

  $lastRow = $rowIndex - 1
  $lastCol = $headers.Count
  $range = $wsData.Range($wsData.Cells.Item(1, 1), $wsData.Cells.Item($lastRow, $lastCol))
  $range.AutoFilter() | Out-Null
  $wsData.Application.ActiveWindow.SplitRow = 1
  $wsData.Application.ActiveWindow.FreezePanes = $true
  $wsData.Columns.AutoFit() | Out-Null

  try {
    Create-Pivot -Workbook $wb -PivotSheet $wsStatus -SourceSheet $wsData -PivotName "ptStatus" `
      -Title "Verifieringsstatus per kategori" `
      -RowFields @("Kravkategori", "Kravsubkategori") `
      -ColumnFields @("Verifieringsstatus") `
      -PageFields @("Kommun", "Myndighet", "Dokumenttyp", "Kodningssakerhet") `
      -DataFieldName "RequirementId"
  }
  catch {
    $wsStatus.Cells.Item(1, 1).Value2 = "Pivot kunde inte skapas automatiskt. Skapa pivot manuellt fran bladet Verifiering."
  }

  try {
    Create-Pivot -Workbook $wb -PivotSheet $wsRisk -SourceSheet $wsData -PivotName "ptRisk" `
      -Title "Riskoversikt (Kodningssakerhet x VerifieradJaNej)" `
      -RowFields @("Kodningssakerhet") `
      -ColumnFields @("VerifieradJaNej") `
      -DataFieldName "RequirementId"
  }
  catch {
    $wsRisk.Cells.Item(1, 1).Value2 = "Pivot kunde inte skapas automatiskt. Skapa pivot manuellt fran bladet Verifiering."
  }

  try {
    Create-Pivot -Workbook $wb -PivotSheet $wsFocus -SourceSheet $wsData -PivotName "ptFokus" `
      -Title "Fokuskommuner (filtrera Kravkategori till Ytkonstruktion/DagvattenLakvatten)" `
      -RowFields @("Kommun") `
      -PageFields @("Kravkategori") `
      -DataFieldName "RequirementId"
  }
  catch {
    $wsFocus.Cells.Item(1, 1).Value2 = "Pivot kunde inte skapas automatiskt. Skapa pivot manuellt fran bladet Verifiering."
  }

  $outFull = [System.IO.Path]::GetFullPath($OutputPath)
  $outDir = [System.IO.Path]::GetDirectoryName($outFull)
  if (-not (Test-Path -LiteralPath $outDir)) {
    [void](New-Item -ItemType Directory -Path $outDir -Force)
  }

  # 51 = xlsx
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
