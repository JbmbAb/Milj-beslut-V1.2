Param(
  [string]$InputDir = "docs/qa/requirements-model"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Convert-CsvToXlsxWithHyperlinks {
  Param(
    [Parameter(Mandatory = $true)][string]$CsvPath,
    [Parameter(Mandatory = $true)][string]$XlsxPath
  )

  if (-not (Test-Path -LiteralPath $CsvPath)) {
    throw "CSV saknas: $CsvPath"
  }

  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false

  try {
    $resolvedCsv = [System.IO.Path]::GetFullPath($CsvPath)
    $workbook = $excel.Workbooks.Open($resolvedCsv)
    $sheet = $workbook.Worksheets.Item(1)
    $sheet.Columns.AutoFit() | Out-Null

    $resolvedOutput = [System.IO.Path]::GetFullPath($XlsxPath)
    $directory = [System.IO.Path]::GetDirectoryName($resolvedOutput)
    if (-not (Test-Path -LiteralPath $directory)) {
      New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }

    # 51 = xlOpenXMLWorkbook (.xlsx)
    $workbook.SaveAs($resolvedOutput, 51)
    $workbook.Close($false)
  }
  finally {
    $excel.Quit()
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
  }
}

$base = [System.IO.Path]::GetFullPath($InputDir)
$targets = @(
  "requirement_rows",
  "requirement_citations",
  "requirement_cases"
)

foreach ($name in $targets) {
  $csv = Join-Path $base "$name.csv"
  $xlsx = Join-Path $base "$name.xlsx"
  Convert-CsvToXlsxWithHyperlinks -CsvPath $csv -XlsxPath $xlsx
  Write-Host "Skapad: $xlsx"
}
