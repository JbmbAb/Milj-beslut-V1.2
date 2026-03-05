Param(
  [string]$InputDir = "docs/qa/requirements-model",
  [string]$OutputPath = "docs/qa/requirements-model/requirements-verification-studio.xlsx",
  [switch]$OpenAfterCreate
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ExcelCellMaxLength = 32767

function Get-ImportedCsv {
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

function To-ExcelCellText {
  Param([AllowNull()][string]$Value)

  if ($null -eq $Value) {
    $text = ""
  }
  else {
    $text = [string]$Value
  }
  if ([string]::IsNullOrEmpty($text)) {
    return ""
  }

  # Excel ogillar vissa kontrolltecken i cellinnehall.
  $text = [regex]::Replace($text, "[\x00-\x08\x0B\x0C\x0E-\x1F]", " ")
  $text = $text -replace "\r?\n", " "

  if ($text.Length -gt $ExcelCellMaxLength) {
    $suffix = " [TRUNCATED]"
    $limit = $ExcelCellMaxLength - $suffix.Length
    if ($limit -lt 0) { $limit = 0 }
    return $text.Substring(0, $limit) + $suffix
  }

  return $text
}

function Write-SheetFromRows {
  Param(
    [Parameter(Mandatory = $true)]$Sheet,
    [Parameter(Mandatory = $true)][object[]]$Rows,
    [Parameter(Mandatory = $true)][string]$TableName,
    [switch]$AddPdfOpenColumn
  )

  $headers = @($Rows[0].PSObject.Properties.Name | Where-Object { $_ -notmatch '^PdfOpenLink' })
  if ($AddPdfOpenColumn -and -not ($headers -contains "PdfOpen")) {
    $headers = @("PdfOpen") + $headers
  }

  for ($col = 1; $col -le $headers.Count; $col++) {
    $Sheet.Cells.Item(1, $col).Value2 = $headers[$col - 1]
  }

  $rowIndex = 2
  foreach ($row in $Rows) {
    for ($col = 1; $col -le $headers.Count; $col++) {
      $header = $headers[$col - 1]
      if ($header -eq "PdfOpen") {
        $Sheet.Cells.Item($rowIndex, $col).Value2 = "Oppna PDF"
      }
      else {
        $value = To-ExcelCellText -Value ([string]($row.$header))
        if ($value.StartsWith("=")) {
          $value = "'" + $value
        }
        $Sheet.Cells.Item($rowIndex, $col).Value2 = $value
      }
    }
    $rowIndex += 1
  }

  if ($AddPdfOpenColumn -and ($headers -contains "PdfViewUrl")) {
    $pdfUrlCol = [Array]::IndexOf($headers, "PdfViewUrl") + 1
    $pdfOpenCol = [Array]::IndexOf($headers, "PdfOpen") + 1
    for ($r = 2; $r -lt $rowIndex; $r++) {
      $url = [string]$Sheet.Cells.Item($r, $pdfUrlCol).Value2
      if ($url -and $url -match '^https?://') {
        $cell = $Sheet.Cells.Item($r, $pdfOpenCol)
        $Sheet.Hyperlinks.Add($cell, $url, $null, "Oppna PDF", "Oppna PDF") | Out-Null
      }
    }
  }

  $lastRow = $rowIndex - 1
  $lastCol = $headers.Count
  $range = $Sheet.Range($Sheet.Cells.Item(1, 1), $Sheet.Cells.Item($lastRow, $lastCol))
  $table = $Sheet.ListObjects.Add(1, $range, $null, 1)
  $table.Name = $TableName
  try {
    $table.TableStyle = "TableStyleMedium2"
  }
  catch {}

  $Sheet.Rows.Item(1).Font.Bold = $true
  $Sheet.Columns.AutoFit() | Out-Null
}

function Set-PivotField {
  Param(
    [Parameter(Mandatory = $true)]$PivotTable,
    [Parameter(Mandatory = $true)][string]$FieldName,
    [Parameter(Mandatory = $true)][int]$Orientation,
    [int]$Position = 1
  )
  $field = $PivotTable.PivotFields($FieldName)
  $field.Orientation = $Orientation
  $field.Position = $Position
  return $field
}

$base = [System.IO.Path]::GetFullPath($InputDir)
$rowsPath = Join-Path $base "requirement_rows.csv"
$citationsPath = Join-Path $base "requirement_citations.csv"
$casesPath = Join-Path $base "requirement_cases.csv"

$requirementRows = Get-ImportedCsv -Path $rowsPath
$citationRows = Get-ImportedCsv -Path $citationsPath
$caseRows = Get-ImportedCsv -Path $casesPath

$caseById = @{}
foreach ($case in $caseRows) {
  $caseById[[string]$case.CaseId] = $case
}

$combinedRows = foreach ($row in $requirementRows) {
  $case = $caseById[[string]$row.CaseId]
  [pscustomobject][ordered]@{
    RequirementId       = [string]$row.RequirementId
    CaseId              = [string]$row.CaseId
    DocumentId          = [string]$row.DocumentId
    PdfViewUrl          = [string]$row.PdfViewUrl
    Kommun              = if ($case) { [string]$case.Kommun } else { "" }
    Myndighet           = if ($case) { [string]$case.Myndighet } else { "" }
    Dokumenttyp         = if ($case) { [string]$case.Dokumenttyp } else { "" }
    KallaFil            = if ($case) { [string]$case.KallaFil } else { "" }
    Kravkategori        = [string]$row.Kravkategori
    Kravsubkategori     = [string]$row.Kravsubkategori
    Kodningssakerhet    = [string]$row.Kodningssakerhet
    Verifieringsstatus  = [string]$row.Verifieringsstatus
    VerifieradJaNej     = [string]$row.VerifieradJaNej
    VerifieradAv        = [string]$row.VerifieradAv
    VerifieradDatum     = [string]$row.VerifieradDatum
    KravtextCitat       = [string]$row.KravtextCitat
    TolkadKravtext      = [string]$row.TolkadKravtext
    ValideringsKommentar = [string]$row.ValideringsKommentar
  }
}

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

try {
  $workbook = $excel.Workbooks.Add()
  $sheetNames = @("Kravrader", "Citat", "Arenden", "KravCase", "Pivot_Status", "Pivot_Risk", "Pivot_Fokus")

  while ($workbook.Worksheets.Count -lt $sheetNames.Count) {
    $null = $workbook.Worksheets.Add()
  }
  while ($workbook.Worksheets.Count -gt $sheetNames.Count) {
    $workbook.Worksheets.Item($workbook.Worksheets.Count).Delete()
  }

  for ($i = 1; $i -le $sheetNames.Count; $i++) {
    $workbook.Worksheets.Item($i).Name = $sheetNames[$i - 1]
  }

  $sheetKrav = $workbook.Worksheets.Item("Kravrader")
  $sheetCitat = $workbook.Worksheets.Item("Citat")
  $sheetArenden = $workbook.Worksheets.Item("Arenden")
  $sheetKravCase = $workbook.Worksheets.Item("KravCase")
  $sheetPivotStatus = $workbook.Worksheets.Item("Pivot_Status")
  $sheetPivotRisk = $workbook.Worksheets.Item("Pivot_Risk")
  $sheetPivotFokus = $workbook.Worksheets.Item("Pivot_Fokus")

  Write-SheetFromRows -Sheet $sheetKrav -Rows $requirementRows -TableName "tblKravrader" -AddPdfOpenColumn
  Write-SheetFromRows -Sheet $sheetCitat -Rows $citationRows -TableName "tblCitat" -AddPdfOpenColumn
  Write-SheetFromRows -Sheet $sheetArenden -Rows $caseRows -TableName "tblArenden" -AddPdfOpenColumn
  Write-SheetFromRows -Sheet $sheetKravCase -Rows $combinedRows -TableName "tblKravCase" -AddPdfOpenColumn

  $sourceRange = $sheetKravCase.ListObjects.Item("tblKravCase").Range
  $cache = $workbook.PivotCaches().Create(1, $sourceRange)

  $sheetPivotStatus.Cells.Item(1, 1).Value2 = "Pivot 1: Verifieringsstatus per kategori"
  $pivotStatus = $cache.CreatePivotTable($sheetPivotStatus.Range("A3"), "ptStatus")
  Set-PivotField -PivotTable $pivotStatus -FieldName "Kravkategori" -Orientation 1 -Position 1 | Out-Null
  Set-PivotField -PivotTable $pivotStatus -FieldName "Kravsubkategori" -Orientation 1 -Position 2 | Out-Null
  Set-PivotField -PivotTable $pivotStatus -FieldName "Verifieringsstatus" -Orientation 2 -Position 1 | Out-Null
  Set-PivotField -PivotTable $pivotStatus -FieldName "Kommun" -Orientation 3 -Position 1 | Out-Null
  Set-PivotField -PivotTable $pivotStatus -FieldName "Myndighet" -Orientation 3 -Position 2 | Out-Null
  Set-PivotField -PivotTable $pivotStatus -FieldName "Dokumenttyp" -Orientation 3 -Position 3 | Out-Null
  Set-PivotField -PivotTable $pivotStatus -FieldName "Kodningssakerhet" -Orientation 3 -Position 4 | Out-Null
  $null = $pivotStatus.AddDataField($pivotStatus.PivotFields("RequirementId"), "Antal krav", -4112)
  $sheetPivotStatus.Columns.AutoFit() | Out-Null

  $sheetPivotRisk.Cells.Item(1, 1).Value2 = "Pivot 2: Riskoversikt (Kodningssakerhet x VerifieradJaNej)"
  $pivotRisk = $cache.CreatePivotTable($sheetPivotRisk.Range("A3"), "ptRisk")
  Set-PivotField -PivotTable $pivotRisk -FieldName "Kodningssakerhet" -Orientation 1 -Position 1 | Out-Null
  Set-PivotField -PivotTable $pivotRisk -FieldName "VerifieradJaNej" -Orientation 2 -Position 1 | Out-Null
  $null = $pivotRisk.AddDataField($pivotRisk.PivotFields("RequirementId"), "Antal krav", -4112)
  $sheetPivotRisk.Columns.AutoFit() | Out-Null

  $sheetPivotFokus.Cells.Item(1, 1).Value2 = "Pivot 3: Fokuskommuner (filtrera Kravkategori till Ytkonstruktion/DagvattenLakvatten)"
  $pivotFokus = $cache.CreatePivotTable($sheetPivotFokus.Range("A3"), "ptFokus")
  Set-PivotField -PivotTable $pivotFokus -FieldName "Kommun" -Orientation 1 -Position 1 | Out-Null
  $fokusFilter = Set-PivotField -PivotTable $pivotFokus -FieldName "Kravkategori" -Orientation 3 -Position 1
  $fokusFilter.EnableMultiplePageItems = $true
  $null = $pivotFokus.AddDataField($pivotFokus.PivotFields("RequirementId"), "Antal krav", -4112)
  $sheetPivotFokus.Columns.AutoFit() | Out-Null

  $resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
  $outDir = [System.IO.Path]::GetDirectoryName($resolvedOutput)
  if (-not (Test-Path -LiteralPath $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
  }

  # 51 = xlOpenXMLWorkbook (.xlsx)
  $workbook.SaveAs($resolvedOutput, 51)
  $workbook.Close($false)

  Write-Host "Skapad: $resolvedOutput"
  if ($OpenAfterCreate) {
    Start-Process $resolvedOutput
  }
}
finally {
  $excel.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  [System.GC]::Collect()
  [System.GC]::WaitForPendingFinalizers()
}
