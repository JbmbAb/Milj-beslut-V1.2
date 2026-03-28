$ErrorActionPreference = "Stop"

if (!(Test-Path ".env")) {
  throw ".env saknas i projektroten."
}

Get-Content .env | ForEach-Object {
  if ($_ -match "^\s*#" -or $_ -match "^\s*$") { return }
  $parts = $_ -split "=", 2
  if ($parts.Count -eq 2) {
    [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1], "Process")
  }
}

$base = [System.Environment]::GetEnvironmentVariable("SLU_API_BASE_URL", "Process").TrimEnd("/")

$targets = @(
  @{ Product = "species_observations"; Method = "POST"; KeyEnv = "SLU_SPECIES_OBS_API_KEY"; PathEnv = "SLU_SPECIES_OBS_BASE_PATH"; Body = "{}" },
  @{ Product = "taxonomy"; Method = "GET"; KeyEnv = "SLU_TAXONOMY_API_KEY"; PathEnv = "SLU_TAXONOMY_BASE_PATH"; Body = "" },
  @{ Product = "artfakta"; Method = "GET"; KeyEnv = "SLU_ARTFAKTA_API_KEY"; PathEnv = "SLU_ARTFAKTA_BASE_PATH"; Body = "" },
  @{ Product = "metodkatalog"; Method = "GET"; KeyEnv = "SLU_METODKATALOG_API_KEY"; PathEnv = "SLU_METODKATALOG_BASE_PATH"; Body = "" }
)

$results = @()

foreach ($t in $targets) {
  $key = [System.Environment]::GetEnvironmentVariable($t.KeyEnv, "Process")
  $path = [System.Environment]::GetEnvironmentVariable($t.PathEnv, "Process")

  if ([string]::IsNullOrWhiteSpace($key) -or [string]::IsNullOrWhiteSpace($path)) {
    $results += [pscustomobject]@{
      product = $t.Product
      statusReal = $null
      statusFake = $null
      authSensitive = $false
      note = "Missing key/path env"
    }
    continue
  }

  $url = "$base$path"
  $outReal = Join-Path $env:TEMP "slu_$($t.Product)_real.txt"
  $outFake = Join-Path $env:TEMP "slu_$($t.Product)_fake.txt"

  $realCmd = @("-L", "-sS", "--max-time", "25", "-o", $outReal, "-w", "%{http_code}", "-X", $t.Method, "-H", "Ocp-Apim-Subscription-Key: $key")
  $fakeCmd = @("-L", "-sS", "--max-time", "25", "-o", $outFake, "-w", "%{http_code}", "-X", $t.Method, "-H", "Ocp-Apim-Subscription-Key: definitely-invalid-key")
  if ($t.Method -eq "POST") {
    $realCmd += @("-H", "Content-Type: application/json", "--data", $t.Body)
    $fakeCmd += @("-H", "Content-Type: application/json", "--data", $t.Body)
  }
  $realCmd += $url
  $fakeCmd += $url

  $statusReal = (& curl.exe @realCmd).Trim()
  $statusFake = (& curl.exe @fakeCmd).Trim()
  $sampleReal = if (Test-Path $outReal) { (Get-Content $outReal -Raw) } else { "" }

  $results += [pscustomobject]@{
    product = $t.Product
    url = $url
    statusReal = [int]$statusReal
    statusFake = [int]$statusFake
    authSensitive = ([int]$statusReal -ne [int]$statusFake)
    sample = $sampleReal.Substring(0, [Math]::Min(180, $sampleReal.Length))
    note = if ([int]$statusReal -eq 404 -and [int]$statusFake -eq 404) { "Likely wrong path" } else { "" }
  }
}

$results | ConvertTo-Json -Depth 6
