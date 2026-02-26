$ErrorActionPreference = "Stop"

$outDir = "server\data\snapshots"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$sources = @(
  @{ Id = "scb"; Url = "https://api.scb.se/OV0104/v2beta/api/v2/tables" },
  @{ Id = "smhi"; Url = "https://opendata-download-metfcst.smhi.se/api/category/pmp3g/version/2/geotype/point/lon/18.0686/lat/59.3293/data.json" },
  @{ Id = "naturvardsverket"; Url = "https://oppnadata.naturvardsverket.se/" },
  @{ Id = "sgu"; Url = "https://resource.sgu.se/service/wms/130/brunnar?service=WMS&request=GetCapabilities" },
  @{ Id = "msb"; Url = "https://inspire.msb.se/oversvamning/wms?service=WMS&request=GetCapabilities" },
  @{ Id = "lantmateriet_open_fastighetsomrade"; Url = "https://api-ver.lantmateriet.se/fastighetsomrade/atom/v1/" },
  @{ Id = "lantmateriet_open_ftp"; Url = "ftp://download-opendata.lantmateriet.se/" }
)

$summary = @()

foreach ($s in $sources) {
  $tmpBody = Join-Path $env:TEMP "$($s.Id)_body.txt"
  $tmpMeta = Join-Path $env:TEMP "$($s.Id)_meta.txt"
  try {
    & curl.exe -L -sS --max-time 20 -o $tmpBody -w "%{http_code}" $s.Url | Set-Content $tmpMeta
    $status = (Get-Content $tmpMeta -Raw).Trim()
    $content = if (Test-Path $tmpBody) { Get-Content $tmpBody -Raw } else { "" }
    $sample = if ($content.Length -gt 4000) { $content.Substring(0, 4000) } else { $content }

    $record = [pscustomobject]@{
      source = $s.Id
      url = $s.Url
      ok = ($status -ge "200" -and $status -lt "300")
      statusCode = [int]$status
      fetchedAt = (Get-Date).ToString("o")
      sample = $sample
    }
  }
  catch {
    $record = [pscustomobject]@{
      source = $s.Id
      url = $s.Url
      ok = $false
      statusCode = $null
      fetchedAt = (Get-Date).ToString("o")
      error = $_.Exception.Message
    }
  }

  $record | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $outDir "$($s.Id).json")
  $summary += $record
}

$summary | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $outDir "summary.json")
Write-Output "Klar: $outDir"
