param(
    [string]$InputCsv = "$env:USERPROFILE\Desktop\OutlookExport\outlook_email_triage_report.csv",
    [string]$OutDir = "$env:USERPROFILE\Desktop\OutlookExport",
    [string]$TargetFolderName = "Triage_Samlad",
    [switch]$ApplyMove
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Ensure-Dir {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -Path $Path -ItemType Directory -Force | Out-Null
    }
}

function Get-ActionableRows {
    param([array]$Rows)

    # Striktare tidskansligt: fildelningstjanster + explicit deadline
    $serviceRegex = '(?i)(sprend|sharepoint|onedrive|1drv|dropbox|wetransfer|mailanyone|transfer)'

    $Rows | Where-Object {
        ($_.FirstExternalLink -match $serviceRegex) -or
        ($_.ExternalLinkDomain -match $serviceRegex) -or
        (-not [string]::IsNullOrWhiteSpace($_.DeadlineDate))
    }
}

function Get-OrCreate-OutlookFolder {
    param(
        $Session,
        [string]$FolderName
    )

    $root = $Session.DefaultStore.GetRootFolder()
    $target = $null
    try {
        $target = $root.Folders.Item($FolderName)
    } catch {
        $target = $null
    }

    if (-not $target) {
        $target = $root.Folders.Add($FolderName)
    }

    return $target
}

if (-not (Test-Path -LiteralPath $InputCsv)) {
    throw "Input CSV hittades inte: $InputCsv"
}

Ensure-Dir -Path $OutDir

$runId = Get-Date -Format "yyyy-MM-ddTHH-mm-ss"
$actionableCsv = Join-Path $OutDir "outlook_email_triage_actionable_$runId.csv"
$entryCsv = Join-Path $OutDir "outlook_email_triage_actionable_entryids_$runId.csv"
$summaryJson = Join-Path $OutDir "outlook_email_triage_actionable_summary_$runId.json"

$rows = Import-Csv -Path $InputCsv -Delimiter ';'
$actionable = Get-ActionableRows -Rows $rows

# Unik per EntryID
$actionableUnique = $actionable | Group-Object EntryID | ForEach-Object { $_.Group | Select-Object -First 1 }

$actionableUnique |
    Sort-Object ReceivedTime -Descending |
    Export-Csv -Path $actionableCsv -NoTypeInformation -Delimiter ';' -Encoding UTF8

$actionableUnique |
    Select-Object EntryID, ReceivedTime, SenderEmail, Subject, FirstExternalLink, DeadlineDate, PriorityBucket |
    Export-Csv -Path $entryCsv -NoTypeInformation -Delimiter ';' -Encoding UTF8

$moveResult = [ordered]@{
    attempted = 0
    moved = 0
    missing = 0
    skipped = 0
    targetFolder = $TargetFolderName
}

if ($ApplyMove) {
    $outlook = New-Object -ComObject Outlook.Application
    $session = $outlook.Session
    $target = Get-OrCreate-OutlookFolder -Session $session -FolderName $TargetFolderName

    foreach ($r in $actionableUnique) {
        $entryId = $r.EntryID
        if ([string]::IsNullOrWhiteSpace($entryId)) {
            $moveResult.skipped++
            continue
        }

        $moveResult.attempted++
        try {
            $item = $session.GetItemFromID($entryId)
            if ($null -eq $item) {
                $moveResult.missing++
                continue
            }

            if ($item.Class -ne 43) { # olMail
                $moveResult.skipped++
                continue
            }

            $null = $item.Move($target)
            $moveResult.moved++
        } catch {
            $moveResult.missing++
        }
    }
}

$summary = [ordered]@{
    runId = $runId
    inputCsv = $InputCsv
    totalRows = @($rows).Count
    actionableRows = @($actionable).Count
    actionableUniqueEntryIds = @($actionableUnique).Count
    actionableCsv = $actionableCsv
    actionableEntryCsv = $entryCsv
    move = $moveResult
}

$summary | ConvertTo-Json -Depth 6 | Set-Content -Path $summaryJson -Encoding UTF8

Write-Host "Triage action klar."
Write-Host "RunId: $runId"
Write-Host "Input rows: $(@($rows).Count)"
Write-Host "Actionable rows: $(@($actionable).Count)"
Write-Host "Actionable unique EntryID: $(@($actionableUnique).Count)"
Write-Host "Actionable CSV: $actionableCsv"
Write-Host "EntryID CSV: $entryCsv"
Write-Host "Summary: $summaryJson"

if ($ApplyMove) {
    Write-Host "Move attempted: $($moveResult.attempted)"
    Write-Host "Move moved: $($moveResult.moved)"
    Write-Host "Move missing: $($moveResult.missing)"
    Write-Host "Move skipped: $($moveResult.skipped)"
    Write-Host "Target folder: $($moveResult.targetFolder)"
} else {
    Write-Host "Ingen flytt gjord (dry mode). Kör med -ApplyMove för att flytta till Outlook-mapp."
}

