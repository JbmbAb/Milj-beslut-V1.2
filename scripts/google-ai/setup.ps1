#Requires -Version 5.1
<#
.SYNOPSIS
  One-shot Google AI tooling setup for Miljöbeslut (AlphaEvolve + ADK).

.PARAMETER PersistPath
  Add ~/.local/bin (uv tool shims: ae, etc.) to the user PATH permanently.

.EXAMPLE
  .\scripts\google-ai\setup.ps1 -PersistPath
  .\scripts\google-ai\setup.ps1 -GeAppId gemini-enterprise-agent-ap_1783287062429
#>
param(
    [string]$ProjectId = 'miljointelligens',
    [string]$GeAppId = '',
    [switch]$PersistPath,
    [switch]$SkipAdk,
    [switch]$SkipAlphaEvolve
)

$ErrorActionPreference = 'Stop'
$ScriptsRoot = $PSScriptRoot

Write-Host ''
Write-Host '╔══════════════════════════════════════════════════════════╗' -ForegroundColor Yellow
Write-Host '║  Miljöbeslut — Google AI dev stack (optimal layout)      ║' -ForegroundColor Yellow
Write-Host '╚══════════════════════════════════════════════════════════╝' -ForegroundColor Yellow
Write-Host ''
Write-Host ' Layout:' -ForegroundColor White
Write-Host '   alphaevolve-on-googlecloud/.venv  → AlphaEvolve experiments (ae CLI)' -ForegroundColor DarkGray
Write-Host '   .venv-adk/                        → Google ADK + A2UI (adk CLI)' -ForegroundColor DarkGray
Write-Host '   ~/.local/bin                      → uv tool shims (ae)' -ForegroundColor DarkGray
Write-Host '   Avoid global pip install          → keeps Node + Python isolated' -ForegroundColor DarkGray
Write-Host ''

if (-not $SkipAlphaEvolve) {
    $aeArgs = @{
        ProjectId   = $ProjectId
        PersistPath = $PersistPath
    }
    if ($GeAppId) { $aeArgs['GeAppId'] = $GeAppId }
    & (Join-Path $ScriptsRoot '..\alphaevolve\setup.ps1') @aeArgs
    Write-Host ''
}

if (-not $SkipAdk) {
    & (Join-Path $ScriptsRoot '..\google-adk\setup.ps1') -PersistPath:$PersistPath
    Write-Host ''
}

Write-Host '╔══════════════════════════════════════════════════════════╗' -ForegroundColor Green
Write-Host '║  All done — quick reference                              ║' -ForegroundColor Green
Write-Host '╚══════════════════════════════════════════════════════════╝' -ForegroundColor Green
Write-Host ''
Write-Host '  AlphaEvolve:  ae version' -ForegroundColor White
Write-Host '                cd alphaevolve-on-googlecloud; .\.venv\Scripts\Activate.ps1' -ForegroundColor DarkGray
Write-Host '  Google ADK:   .\.venv-adk\Scripts\Activate.ps1; adk --help' -ForegroundColor White
Write-Host '  Docs:         docs\google-ai\SETUP.md' -ForegroundColor White
Write-Host ''
