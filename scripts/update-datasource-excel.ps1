$ErrorActionPreference = "Stop"

function Normalize-Text {
  param([string]$Text)
  if ([string]::IsNullOrWhiteSpace($Text)) { return "" }
  $formD = $Text.Normalize([Text.NormalizationForm]::FormD)
  $chars = foreach ($c in $formD.ToCharArray()) {
    $cat = [Globalization.CharUnicodeInfo]::GetUnicodeCategory($c)
    if ($cat -ne [Globalization.UnicodeCategory]::NonSpacingMark) { $c }
  }
  return (-join $chars).ToLowerInvariant()
}

$excelDir = "c:\Users\jimmy\Desktop\Examens arbete\Excel"
$source = Get-ChildItem -Path $excelDir -Filter "*.xlsx" |
  Where-Object { $_.Name -like "Datak*Milj*beslut*.xlsx" } |
  Select-Object -First 1

if (-not $source) {
  throw "Kunde inte hitta källfilen i $excelDir"
}

$targetPath = Join-Path $excelDir "Datakallor_for_Miljobeslut_klassad.xlsx"

$rules = @(
  @{ Match = "lantmateriet"; Status = "Kräver tillstånd"; Reason = "Licensavtal/behörighetsprocess" },
  @{ Match = "naturvardsverket"; Status = "Aktivera omgående"; Reason = "Öppna data" },
  @{ Match = "sgu"; Status = "Aktivera omgående"; Reason = "Öppna geodata" },
  @{ Match = "lansstyrelsen"; Status = "Aktivera omgående"; Reason = "Öppna tjänster, kontrollera lager" },
  @{ Match = "riksantikvarieambetet"; Status = "Aktivera omgående"; Reason = "Öppna API/data" },
  @{ Match = "msb"; Status = "Aktivera omgående"; Reason = "Öppen WMS" },
  @{ Match = "artdatabanken"; Status = "Kräver tillstånd"; Reason = "Utvecklarportal/prenumeration" },
  @{ Match = "bankid"; Status = "Kräver tillstånd"; Reason = "Avtal och certifikat" },
  @{ Match = "bolagsverket"; Status = "Kräver tillstånd"; Reason = "Tjänsteavtal/åtkomstvillkor" },
  @{ Match = "kontaktuppgifter kommuner.csv"; Status = "Aktivera omgående"; Reason = "Intern datakälla" },
  @{ Match = "kommunernas diarier"; Status = "Aktivera omgående"; Reason = "Tekniskt möjligt, process per kommun" },
  @{ Match = "scb"; Status = "Aktivera omgående"; Reason = "Öppet API" },
  @{ Match = "boverket"; Status = "Delvis omgående"; Reason = "Klimatdata öppet, energideklarationer kräver avtal" },
  @{ Match = "smhi"; Status = "Aktivera omgående"; Reason = "Öppet API" },
  @{ Match = "havs- och vattenmyndigheten"; Status = "Aktivera omgående"; Reason = "Öppna geodata" },
  @{ Match = "trafikverket"; Status = "Kräver tillstånd"; Reason = "Registrering/licens/API-nyckel" }
)

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

try {
  $wb = $excel.Workbooks.Open($source.FullName)
  $ws = $wb.Worksheets.Item(1)
  $used = $ws.UsedRange
  $rows = $used.Rows.Count
  $cols = $used.Columns.Count

  $statusCol = $cols + 1
  $reasonCol = $cols + 2
  $ws.Cells.Item(1, $statusCol).Value2 = "Aktivering"
  $ws.Cells.Item(1, $reasonCol).Value2 = "Tillståndsskäl"

  for ($r = 2; $r -le $rows; $r++) {
    $rawName = [string]$ws.Cells.Item($r, 1).Text
    if ([string]::IsNullOrWhiteSpace($rawName)) { continue }

    $name = Normalize-Text $rawName
    $match = $rules | Where-Object { $name -like "*$($_.Match)*" } | Select-Object -First 1

    if ($match) {
      $ws.Cells.Item($r, $statusCol).Value2 = $match.Status
      $ws.Cells.Item($r, $reasonCol).Value2 = $match.Reason
    } else {
      $ws.Cells.Item($r, $statusCol).Value2 = "Manuell bedömning"
      $ws.Cells.Item($r, $reasonCol).Value2 = "Källa ej matchad automatiskt"
    }
  }

  $wb.SaveAs($targetPath)
  $wb.Close($true)
}
finally {
  if ($wb) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($wb) }
  $excel.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
}

Write-Output "Klar: $targetPath"
