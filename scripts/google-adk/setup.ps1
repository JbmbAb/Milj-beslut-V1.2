#Requires -Version 5.1
<#
.SYNOPSIS
  Isolated Google ADK + A2UI SDK venv (avoids global pip / Store Python pollution).

.DESCRIPTION
  Creates .venv-adk at repo root and installs google-adk + a2ui-agent-sdk via uv.
  Ensures ~/.local/bin (uv tool shims) is on PATH for the current session.
#>
param(
    [switch]$PersistPath
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\google-ai\_path.ps1')

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$VenvDir = Join-Path $RepoRoot '.venv-adk'
$VenvPython = Join-Path $VenvDir 'Scripts\python.exe'
$Requirements = Join-Path $PSScriptRoot 'requirements.txt'

function Write-Step {
    param([string]$Message)
    Write-Host "==> $Message" -ForegroundColor Cyan
}

Write-Host '──────────────────────────────────────────────────────────' -ForegroundColor Yellow
Write-Host ' Miljöbeslut ──► Google ADK setup (.venv-adk)' -ForegroundColor Yellow
Write-Host '──────────────────────────────────────────────────────────' -ForegroundColor Yellow

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw "uv required: https://docs.astral.sh/uv/getting-started/installation/"
}

if (-not (Test-Path $VenvPython)) {
    Write-Step 'Creating .venv-adk'
    Push-Location $RepoRoot
    try {
        uv venv .venv-adk
        uv pip install --python $VenvPython -r $Requirements
    }
    finally {
        Pop-Location
    }
}
else {
    Write-Step 'Syncing ADK packages in existing .venv-adk'
    uv pip install --python $VenvPython -r $Requirements
}

Ensure-UvToolsOnPath -PersistForUser:$PersistPath

Write-Step 'Verifying ADK import'
& $VenvPython -c "import google.adk; print('google-adk OK')"
& $VenvPython -c "import a2ui; print('a2ui-agent-sdk OK')" 2>$null
if ($LASTEXITCODE -ne 0) {
    & $VenvPython -c "import a2ui_agent_sdk; print('a2ui-agent-sdk OK')"
}

$AdkExe = Join-Path $VenvDir 'Scripts\adk.exe'
if (Test-Path $AdkExe) {
    Write-Host "  adk CLI: $AdkExe" -ForegroundColor White
}
else {
    Write-Host '  adk CLI: activate venv and run: adk --help' -ForegroundColor DarkYellow
}

Write-Host '──────────────────────────────────────────────────────────' -ForegroundColor Green
Write-Host '[SUCCESS] Google ADK venv ready.' -ForegroundColor Green
Write-Host "  Activate:  .\.venv-adk\Scripts\Activate.ps1" -ForegroundColor White
Write-Host '  Do NOT use global: pip install google-adk (use this venv instead)' -ForegroundColor DarkYellow
