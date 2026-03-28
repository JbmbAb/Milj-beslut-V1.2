$ErrorActionPreference = "Stop"

param(
  [string]$BaseUrl = "http://localhost:8787",
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [string]$Token = "",
  [string]$Username = "",
  [string]$Password = "",
  [string]$TemplateId = "ENV_PERMIT_CORE",
  [string]$PermitType = "Anmalan 9 kap"
)

$base = $BaseUrl.TrimEnd("/")

function Resolve-Token {
  param(
    [string]$CurrentToken,
    [string]$ApiBase,
    [string]$User,
    [string]$Pass
  )

  if (-not [string]::IsNullOrWhiteSpace($CurrentToken)) {
    return $CurrentToken.Trim()
  }

  if ([string]::IsNullOrWhiteSpace($User) -or [string]::IsNullOrWhiteSpace($Pass)) {
    throw "Token saknas. Ange -Token eller -Username + -Password."
  }

  $loginBody = @{
    username = $User
    password = $Pass
  } | ConvertTo-Json

  $loginResp = Invoke-RestMethod `
    -Method Post `
    -Uri "$ApiBase/api/admin/auth/login" `
    -ContentType "application/json" `
    -Body $loginBody

  if (-not $loginResp.ok -or [string]::IsNullOrWhiteSpace($loginResp.accessToken)) {
    throw "Kunde inte hamta access token via admin login."
  }

  return [string]$loginResp.accessToken
}

function Invoke-SecureApi {
  param(
    [string]$Method,
    [string]$Path,
    [string]$AccessToken,
    [object]$Body = $null
  )

  $headers = @{
    Authorization = "Bearer $AccessToken"
  }
  $uri = "$base$Path"

  if ($null -ne $Body) {
    $payload = $Body | ConvertTo-Json -Depth 30
    $resp = Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -ContentType "application/json" -Body $payload
  } else {
    $resp = Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
  }

  if (-not $resp.ok) {
    throw "API svarade med ok=false for $Method $Path"
  }

  return $resp
}

function Assert-Condition {
  param(
    [bool]$Condition,
    [string]$Message
  )
  if (-not $Condition) {
    throw "ASSERT FAIL: $Message"
  }
}

Write-Host "== Project plan smoke test =="
Write-Host "BaseUrl: $base"
Write-Host "ProjectId: $ProjectId"

$resolvedToken = Resolve-Token -CurrentToken $Token -ApiBase $base -User $Username -Pass $Password
if ($resolvedToken.Length -lt 20) {
  throw "Ogiltig token (for kort)."
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$newName = "Smoke-$stamp"
$summary = [ordered]@{
  projectId = $ProjectId
  startedAt = (Get-Date).ToString("o")
  initialName = ""
  savedName = ""
  reloadedName = ""
  templateApplied = $TemplateId
  requiredGates = 0
  evaluatedGates = 0
  carbonKgCo2e = 0
  completedAt = ""
}

Write-Host "[1/7] Load plan"
$loadResp = Invoke-SecureApi -Method "Get" -Path "/api/projects/$([uri]::EscapeDataString($ProjectId))/plan" -AccessToken $resolvedToken
$plan = $loadResp.plan
if ($null -eq $plan) {
  throw "Ingen plan returnerades. Kontrollera projectId och behorighet."
}
$summary.initialName = [string]$plan.name

Write-Host "[2/7] Save plan with unique name"
$plan.name = $newName
$saveResp = Invoke-SecureApi `
  -Method "Post" `
  -Path "/api/projects/$([uri]::EscapeDataString($ProjectId))/plan/save" `
  -AccessToken $resolvedToken `
  -Body @{ plan = $plan }
$plan = $saveResp.plan
$summary.savedName = [string]$plan.name
Assert-Condition -Condition ($summary.savedName -eq $newName) -Message "Sparat namn matchar inte $newName"

Write-Host "[3/7] Reload and verify persisted value"
$reloadResp = Invoke-SecureApi -Method "Get" -Path "/api/projects/$([uri]::EscapeDataString($ProjectId))/plan" -AccessToken $resolvedToken
$reloaded = $reloadResp.plan
$summary.reloadedName = [string]$reloaded.name
Assert-Condition -Condition ($summary.reloadedName -eq $newName) -Message "Reload gav inte sparat namn."
$plan = $reloaded

Write-Host "[4/7] Apply template"
$templateResp = Invoke-SecureApi `
  -Method "Post" `
  -Path "/api/projects/$([uri]::EscapeDataString($ProjectId))/template/apply" `
  -AccessToken $resolvedToken `
  -Body @{
    templateId = $TemplateId
    plan = $plan
  }
$plan = $templateResp.plan
Assert-Condition -Condition (-not [string]::IsNullOrWhiteSpace([string]$plan.templateId)) -Message "templateId saknas efter template apply."

Write-Host "[5/7] Evaluate required stage gates"
$requiredGates = @($plan.stageGates | Where-Object { $_.required -eq $true })
$summary.requiredGates = $requiredGates.Count
foreach ($gate in $requiredGates) {
  $gateResp = Invoke-SecureApi `
    -Method "Post" `
    -Path "/api/projects/$([uri]::EscapeDataString($ProjectId))/stage-gates/$([uri]::EscapeDataString([string]$gate.id))/evaluate" `
    -AccessToken $resolvedToken `
    -Body @{
      plan = $plan
      permitType = $PermitType
      permitSubmitted = $true
      mapLayerAvailable = $plan.mapLayerSelection.enabled
      note = "Smoke test gate evaluation"
    }
  $plan = $gateResp.plan
  $summary.evaluatedGates += 1
}

Write-Host "[6/7] Run carbon calculation"
$carbonResp = Invoke-SecureApi `
  -Method "Post" `
  -Path "/api/projects/$([uri]::EscapeDataString($ProjectId))/carbon/calculate" `
  -AccessToken $resolvedToken `
  -Body @{
    plan = $plan
    carbonInput = @{
      tons = 25
      distanceKm = 10
      manualDistanceKm = 0
      transportMode = "TRUCK"
      materialType = "SOIL"
    }
  }
$plan = $carbonResp.plan
$summary.carbonKgCo2e = [double]$carbonResp.result.totalKgCo2e
Assert-Condition -Condition ($summary.carbonKgCo2e -gt 0) -Message "Carbon resultat ar 0 eller ogiltigt."

Write-Host "[7/7] Final save"
$finalSaveResp = Invoke-SecureApi `
  -Method "Post" `
  -Path "/api/projects/$([uri]::EscapeDataString($ProjectId))/plan/save" `
  -AccessToken $resolvedToken `
  -Body @{ plan = $plan }
Assert-Condition -Condition ($null -ne $finalSaveResp.plan) -Message "Final save returnerade ingen plan."

$summary.completedAt = (Get-Date).ToString("o")

Write-Host "`nSmoke test PASS"
$summary | ConvertTo-Json -Depth 12
