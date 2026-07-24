#Requires -Version 5.1
<#
.SYNOPSIS
  Idempotent setup for AlphaEvolve (Google Cloud) in the Miljöbeslut workspace.

.DESCRIPTION
  - Verifies git and uv prerequisites
  - Clones alphaevolve-on-googlecloud if missing
  - Creates uv venv and installs package with examples/dev extras
  - Ensures ae CLI via uv tool
  - Installs Cursor skills to %USERPROFILE%\.cursor\skills
  - Copies example.env to .env with PROJECT_ID=miljointelligens if .env is missing
#>
param(
    [string]$ProjectId = 'miljointelligens',
    [string]$RepoUrl = 'https://github.com/Google-Cloud-AI/alphaevolve-on-googlecloud.git'
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$AlphaEvolveRoot = Join-Path $RepoRoot 'alphaevolve-on-googlecloud'
$SkillsSource = Join-Path $AlphaEvolveRoot 'skills'
$SkillsDest = Join-Path $env:USERPROFILE '.cursor\skills'
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
    if (Get-Command ae -ErrorAction SilentlyContinue) {
        return 'ae'
    }

    Write-Step 'Installing ae CLI via uv tool'
    uv tool install ae --force | Out-Null

    if (-not (Get-Command ae -ErrorAction SilentlyContinue)) {
        throw 'ae CLI is still unavailable after uv tool install.'
    }

    return 'ae'
}

Write-Host '──────────────────────────────────────────────────────────' -ForegroundColor Yellow
Write-Host ' Miljöbeslut ──► AlphaEvolve setup' -ForegroundColor Yellow
Write-Host '──────────────────────────────────────────────────────────' -ForegroundColor Yellow
Write-Host " Repo root:       $RepoRoot" -ForegroundColor White
Write-Host " AlphaEvolve:     $AlphaEvolveRoot" -ForegroundColor White
Write-Host " GCP project:     $ProjectId" -ForegroundColor White
Write-Host '──────────────────────────────────────────────────────────' -ForegroundColor Yellow

Write-Step 'Checking prerequisites (git, uv)'
Assert-Command -Name 'git' -InstallHint 'Install Git: https://git-scm.com/downloads'
Assert-Command -Name 'uv' -InstallHint 'Install uv: https://docs.astral.sh/uv/getting-started/installation/'

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

if (-not (Test-Path $VenvPython)) {
    Write-Step 'Creating uv venv and installing alphaevolve-on-googlecloud[examples,dev]'
    Push-Location $AlphaEvolveRoot
    try {
        uv venv .venv
        uv pip install -e ".[examples,dev]"
    }
    finally {
        Pop-Location
    }
}
else {
    Write-Step 'Virtual environment already present'
}

$aeCmd = Ensure-AeCli

Write-Step "Installing Cursor skills from $SkillsSource"
& $aeCmd skills install --source $SkillsSource --dest $SkillsDest --force

if (-not (Test-Path $DotEnv)) {
    if (-not (Test-Path $ExampleEnv)) {
        throw "Missing example.env at $ExampleEnv"
    }

    Write-Step "Creating .env from example.env (PROJECT_ID=$ProjectId)"
    $envContent = Get-Content -Path $ExampleEnv -Raw
    if ($envContent -match '(?m)^PROJECT_ID=') {
        $envContent = $envContent -replace '(?m)^PROJECT_ID=.*$', "PROJECT_ID=$ProjectId"
    }
    else {
        $envContent = $envContent.TrimEnd() + "`nPROJECT_ID=$ProjectId`n"
    }
    Set-Content -Path $DotEnv -Value $envContent -Encoding utf8 -NoNewline
}
else {
    Write-Step '.env already present; leaving unchanged'
}

Write-Host '──────────────────────────────────────────────────────────' -ForegroundColor Green
Write-Host '[SUCCESS] AlphaEvolve setup complete.' -ForegroundColor Green
Write-Host '──────────────────────────────────────────────────────────' -ForegroundColor Green
Write-Host ''
Write-Host "  Repo:    $AlphaEvolveRoot"
Write-Host "  Venv:    $AlphaEvolveRoot\.venv"
Write-Host "  Skills:  $SkillsDest"
Write-Host "  .env:    $DotEnv"
Write-Host ''
Write-Host 'Next: set GE_APP_ID in alphaevolve-on-googlecloud\.env (see docs\alphaevolve\SETUP.md).'
