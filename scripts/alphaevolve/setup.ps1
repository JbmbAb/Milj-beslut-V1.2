#Requires -Version 5.1
<#
.SYNOPSIS
  Idempotent AlphaEvolve (Google Cloud) setup for Miljöbeslut.

.DESCRIPTION
  - Clones alphaevolve-on-googlecloud if missing
  - uv venv + alpha_evolve[examples,dev]
  - ae CLI from local skills/ (uv tool install)
  - Skills → Cursor + Antigravity (Gemini)
  - Seeds .env with PROJECT_ID (never overwrites existing GE_APP_ID)
#>
param(
    [string]$ProjectId = 'miljointelligens',
    [string]$GeAppId = '',
    [string]$RepoUrl = 'https://github.com/Google-Cloud-AI/alphaevolve-on-googlecloud.git',
    [switch]$PersistPath
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\google-ai\_path.ps1')

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$AlphaEvolveRoot = Join-Path $RepoRoot 'alphaevolve-on-googlecloud'
$SkillsSource = Join-Path $AlphaEvolveRoot 'skills'
$SkillsDestinations = @(
    (Join-Path $env:USERPROFILE '.cursor\skills'),
    (Join-Path $env:USERPROFILE '.gemini\config\skills')
)
$VenvPython = Join-Path $AlphaEvolveRoot '.venv\Scripts\python.exe'
$ExampleEnv = Join-Path $AlphaEvolveRoot 'example.env'
$DotEnv = Join-Path $AlphaEvolveRoot '.env'

function Write-Step {
    param([string]$Message)
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Assert-Command {
    param(
        [string]$Name,
        [string]$InstallHint
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' not found. $InstallHint"
    }
}

function Ensure-AeCli {
    param([string]$SkillsDir)

    if (-not (Test-Path $SkillsDir)) {
        throw "Missing skills directory: $SkillsDir"
    }

    Write-Step 'Installing/updating ae CLI from local skills (uv tool)'
    uv tool install $SkillsDir --force | Out-Null
    Ensure-UvToolsOnPath -PersistForUser:$PersistPath

    if (-not (Get-Command ae -ErrorAction SilentlyContinue)) {
        throw 'ae CLI unavailable after uv tool install. Add ~/.local/bin to PATH.'
    }

    return 'ae'
}

Write-Host '──────────────────────────────────────────────────────────' -ForegroundColor Yellow
Write-Host ' Miljöbeslut ──► AlphaEvolve setup' -ForegroundColor Yellow
Write-Host '──────────────────────────────────────────────────────────' -ForegroundColor Yellow
Write-Host " Repo root:   $RepoRoot"
Write-Host " AlphaEvolve: $AlphaEvolveRoot"
Write-Host " GCP project: $ProjectId"
Write-Host '──────────────────────────────────────────────────────────' -ForegroundColor Yellow

Write-Step 'Checking prerequisites (git, uv, gcloud ADC)'
Assert-Command -Name 'git' -InstallHint 'https://git-scm.com/downloads'
Assert-Command -Name 'uv' -InstallHint 'https://docs.astral.sh/uv/getting-started/installation/'
Assert-Command -Name 'gcloud' -InstallHint 'https://cloud.google.com/sdk/docs/install'

if (-not (Test-GcloudAdc)) {
    Write-Warning 'ADC not configured. Run: gcloud auth application-default login'
}

if (-not (Test-Path $AlphaEvolveRoot)) {
    Write-Step "Cloning AlphaEvolve repo to $AlphaEvolveRoot"
    git clone $RepoUrl $AlphaEvolveRoot
}
elseif (-not (Test-Path (Join-Path $AlphaEvolveRoot '.git'))) {
    throw "Path exists but is not a git repo: $AlphaEvolveRoot"
}
else {
    Write-Step 'AlphaEvolve repo already present'
}

Push-Location $AlphaEvolveRoot
try {
    if (-not (Test-Path $VenvPython)) {
        Write-Step 'Creating .venv and installing alpha_evolve[examples,dev]'
        uv venv .venv
        uv pip install -e ".[examples,dev]"
    }
    else {
        Write-Step 'Syncing alpha_evolve in existing .venv'
        uv pip install -e ".[examples,dev]"
    }
}
finally {
    Pop-Location
}

$aeCmd = Ensure-AeCli -SkillsDir $SkillsSource
& $aeCmd version

foreach ($SkillsDest in $SkillsDestinations) {
    Write-Step "Installing AlphaEvolve skills → $SkillsDest"
    New-Item -ItemType Directory -Force -Path $SkillsDest | Out-Null
    & $aeCmd skills install --source $SkillsSource --dest $SkillsDest --force
}

if (-not (Test-Path $DotEnv)) {
    if (-not (Test-Path $ExampleEnv)) {
        throw "Missing example.env at $ExampleEnv"
    }

    Write-Step "Creating .env from example.env (PROJECT_ID=$ProjectId)"
    $envContent = Get-Content -Path $ExampleEnv -Raw
    $envContent = $envContent -replace '(?m)^PROJECT_ID=.*$', "PROJECT_ID=$ProjectId"
    if ($GeAppId) {
        $envContent = $envContent -replace '(?m)^GE_APP_ID=.*$', "GE_APP_ID=$GeAppId"
    }
    Set-Content -Path $DotEnv -Value ($envContent.TrimEnd() + "`n") -Encoding utf8
}
else {
    Write-Step '.env exists — updating PROJECT_ID only if placeholder'
    $envContent = Get-Content -Path $DotEnv -Raw
    if ($envContent -match '(?m)^PROJECT_ID=your-gcp-project-id') {
        $envContent = $envContent -replace '(?m)^PROJECT_ID=.*$', "PROJECT_ID=$ProjectId"
        Set-Content -Path $DotEnv -Value ($envContent.TrimEnd() + "`n") -Encoding utf8
    }
    if ($GeAppId -and $envContent -match '(?m)^GE_APP_ID=your-engine-id') {
        $envContent = Get-Content -Path $DotEnv -Raw
        $envContent = $envContent -replace '(?m)^GE_APP_ID=.*$', "GE_APP_ID=$GeAppId"
        Set-Content -Path $DotEnv -Value ($envContent.TrimEnd() + "`n") -Encoding utf8
    }
}

Write-Host '──────────────────────────────────────────────────────────' -ForegroundColor Green
Write-Host '[SUCCESS] AlphaEvolve setup complete.' -ForegroundColor Green
Write-Host "  Venv:   $AlphaEvolveRoot\.venv"
Write-Host "  ae:     $(Get-Command ae | Select-Object -ExpandProperty Source)"
Write-Host "  Skills: Cursor + Antigravity (Gemini)"
Write-Host "  .env:   $DotEnv"
Write-Host ''
Write-Host 'Activate:  cd alphaevolve-on-googlecloud; .\.venv\Scripts\Activate.ps1' -ForegroundColor White
