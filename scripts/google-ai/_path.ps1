# Shared PATH helpers for Google AI Python tooling (uv tools + venv scripts).

function Get-UvToolsBin {
    $candidate = Join-Path $env:USERPROFILE '.local\bin'
    if (Test-Path $candidate) {
        return $candidate
    }
    return $null
}

function Ensure-UvToolsOnPath {
    param(
        [switch]$PersistForUser
    )

    $bin = Get-UvToolsBin
    if (-not $bin) {
        Write-Warning 'uv tools bin not found (~/.local/bin). Run: uv tool install <package>'
        return
    }

    $normalized = $bin.TrimEnd('\')
    if ($env:Path -notlike "*$normalized*") {
        $env:Path = "$normalized;$env:Path"
    }

    if ($PersistForUser) {
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        if ($userPath -notlike "*$normalized*") {
            [Environment]::SetEnvironmentVariable('Path', "$normalized;$userPath", 'User')
            Write-Host "Added $normalized to user PATH (restart terminal to pick up everywhere)." -ForegroundColor Green
        }
    }
}

function Test-GcloudAdc {
    try {
        $null = gcloud auth application-default print-access-token 2>$null
        return $LASTEXITCODE -eq 0
    }
    catch {
        return $false
    }
}
