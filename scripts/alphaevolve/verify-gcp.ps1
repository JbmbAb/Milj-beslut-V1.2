#Requires -Version 5.1
<#
.SYNOPSIS
  Verify AlphaEvolve GCP prerequisites and optionally sync GE_APP_ID to .env.

.PARAMETER GeAppId
  Expected engine ID. If omitted, reads alphaevolve-on-googlecloud/.env.

.PARAMETER UpdateEnv
  Write detected engine ID into .env when placeholder is set.
#>
param(
    [string]$ProjectId = 'miljointelligens',
    [string]$GeAppId = '',
    [switch]$UpdateEnv
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$AlphaRoot = Join-Path $RepoRoot 'alphaevolve-on-googlecloud'
$DotEnv = Join-Path $AlphaRoot '.env'

function Write-Check {
    param([string]$Label, [bool]$Ok, [string]$Detail = '')
    $mark = if ($Ok) { '[OK]' } else { '[FAIL]' }
    $color = if ($Ok) { 'Green' } else { 'Red' }
    Write-Host "$mark $Label" -ForegroundColor $color
    if ($Detail) { Write-Host "     $Detail" -ForegroundColor DarkGray }
}

Write-Host 'AlphaEvolve GCP verification' -ForegroundColor Cyan
Write-Host "Project: $ProjectId"

$adcOk = $false
try {
    $null = gcloud auth application-default print-access-token 2>$null
    $adcOk = $true
} catch { }
Write-Check -Label 'Application Default Credentials' -Ok $adcOk -Detail 'gcloud auth application-default login'

$apiEnabled = $false
try {
    $enabled = gcloud services list --enabled --filter="name:discoveryengine.googleapis.com" --format="value(name)" --project=$ProjectId 2>$null
    $apiEnabled = [bool]$enabled
} catch { }
Write-Check -Label 'Discovery Engine API enabled' -Ok $apiEnabled

$token = gcloud auth application-default print-access-token 2>$null
$enginesUrl = "https://discoveryengine.googleapis.com/v1alpha/projects/$ProjectId/locations/global/collections/default_collection/engines"
$engineList = @()
if ($token) {
    try {
        $raw = curl.exe -sS -H "Authorization: Bearer $token" -H "x-goog-user-project: $ProjectId" $enginesUrl
        if ($raw -match '"engines"') {
            $parsed = $raw | ConvertFrom-Json
            if ($parsed.engines) {
                $engineList = @($parsed.engines)
            }
        }
    } catch { }
}
Write-Check -Label "Engines in default_collection ($($engineList.Count))" -Ok ($engineList.Count -gt 0)
foreach ($engine in $engineList) {
    $name = $engine.name
    $id = if ($name -match '/engines/([^/]+)$') { $Matches[1] } else { $name }
    Write-Host "     - $id" -ForegroundColor DarkGray
}

if (-not $GeAppId -and (Test-Path $DotEnv)) {
    $line = Get-Content $DotEnv | Where-Object { $_ -match '^GE_APP_ID=' } | Select-Object -First 1
    if ($line) { $GeAppId = ($line -replace '^GE_APP_ID=', '').Trim() }
}

$placeholderPatterns = @('your-engine-id', 'gemini-enterprise-agent-ap_')
$isPlaceholder = $false
foreach ($pattern in $placeholderPatterns) {
    if ($GeAppId -like "*$pattern*") { $isPlaceholder = $true; break }
}
Write-Check -Label "GE_APP_ID configured ($GeAppId)" -Ok ((-not $isPlaceholder) -and [bool]$GeAppId)

$engineExists = $false
if ($GeAppId -and $token -and -not $isPlaceholder) {
    $engineUrl = "$enginesUrl/$GeAppId"
    $code = curl.exe -sS -o NUL -w "%{http_code}" -H "Authorization: Bearer $token" -H "x-goog-user-project: $ProjectId" $engineUrl
    $engineExists = ($code -eq '200')
}
Write-Check -Label "Engine reachable ($GeAppId)" -Ok $engineExists -Detail "HTTP check against Discovery Engine API"

if ($UpdateEnv -and $engineList.Count -gt 0 -and ($isPlaceholder -or -not $GeAppId)) {
    $firstId = if ($engineList[0].name -match '/engines/([^/]+)$') { $Matches[1] } else { $null }
    if ($firstId -and (Test-Path $DotEnv)) {
        $content = Get-Content $DotEnv -Raw
        $content = $content -replace '(?m)^GE_APP_ID=.*$', "GE_APP_ID=$firstId"
        Set-Content -Path $DotEnv -Value ($content.TrimEnd() + "`n") -Encoding utf8
        Write-Host "Updated .env GE_APP_ID=$firstId" -ForegroundColor Yellow
        $GeAppId = $firstId
    }
}

if (-not $engineExists) {
    Write-Host ''
    Write-Host 'Next step (Cloud Shell, requires Gemini Enterprise license):' -ForegroundColor Yellow
    Write-Host '  export PROJECT_ID=miljointelligens SYSTEM_USER_EMAIL=you@domain.com'
    Write-Host '  bash scripts/alphaevolve/provision-gcp.sh'
    exit 1
}

Write-Host ''
Write-Host 'GCP ready for AlphaEvolve smoke runs.' -ForegroundColor Green
exit 0
