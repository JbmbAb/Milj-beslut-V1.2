# crawl-and-generate-aria-input.ps1
# Mimers Brunn — Crawl Naturvårdsverket and generate aria2c input file

$ErrorActionPreference = "Stop"

$baseUrl = "https://geodata.naturvardsverket.se/nedladdning/"
$today = Get-Date -Format "yyyy-MM-dd"

# Read MASTER_ARCHIVE_ROOT from env or default
$masterArchiveRoot = $env:MASTER_ARCHIVE_ROOT
if (-not $masterArchiveRoot) {
    # Try parsing .env file
    if (Test-Path ".env") {
        Get-Content ".env" | Foreach-Object {
            if ($_ -match "MASTER_ARCHIVE_ROOT\s*=\s*`"(.*?)`"") {
                $masterArchiveRoot = $Matches[1]
            } elseif ($_ -match "MASTER_ARCHIVE_ROOT\s*=\s*(.*)") {
                $masterArchiveRoot = $Matches[1]
            }
        }
    }
}
if (-not $masterArchiveRoot) {
    $masterArchiveRoot = "H:\Delade enheter\Miljöbeslut\GEO_Master_Archive"
}

$destRoot = Join-Path $masterArchiveRoot "Data\Naturvardsverket"
Write-Host "🌿 Destination root: $destRoot"
Write-Host "🌐 Base URL: $baseUrl"

$visited = @{}
$queue = [System.Collections.Generic.Queue[string]]::new()
$queue.Enqueue($baseUrl)

$ariaInputFile = "aria2c_input.txt"
$writer = [System.IO.StreamWriter]::new($ariaInputFile, $false, [System.Text.Encoding]::UTF8)

Write-Host "📡 Crawling..."
$fileCount = 0

try {
    while ($queue.Count -gt 0) {
        $currentUrl = $queue.Dequeue()
        if ($visited.ContainsKey($currentUrl)) { continue }
        $visited[$currentUrl] = $true

        Write-Host "Crawling: $currentUrl"
        
        # Polite delay
        Start-Sleep -Milliseconds 200

        try {
            $html = Invoke-RestMethod -Uri $currentUrl -UserAgent "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" -TimeoutSec 15
        } catch {
            Write-Warning "Failed to fetch $currentUrl`: $_"
            continue
        }

        # Parse links using regex
        # Pattern matches: <a href="name"> or <a href="name/">
        $matches = [regex]::Matches($html, 'href="([^"\?]+)"')
        foreach ($match in $matches) {
            $link = $match.Groups[1].Value
            
            # Skip parent directory, root, or absolute links not matching base
            if ($link -match "^\s*$" -or $link -match "^\.+$" -or $link -eq "/" -or $link -match "^http") {
                continue
            }

            # Decode URL
            $decodedLink = [System.Web.HttpUtility]::UrlDecode($link)
            $absoluteUrl = [System.Uri]::new([System.Uri]::new($currentUrl), $link).AbsoluteUri

            if ($link.EndsWith("/")) {
                # Directory -> queue for crawl
                if (-not $visited.ContainsKey($absoluteUrl)) {
                    $queue.Enqueue($absoluteUrl)
                }
            } else {
                # File -> parse relative dataset path
                # Example: https://geodata.naturvardsverket.se/nedladdning/marktacke/NMD2023/file.tif
                # Base: https://geodata.naturvardsverket.se/nedladdning/
                # Relative path: marktacke/NMD2023/file.tif
                $relPath = $absoluteUrl.Replace($baseUrl, "")
                $parts = $relPath.Split('/')
                
                if ($parts.Length -ge 2) {
                    # Dataset folder is everything except the filename
                    $datasetRel = $parts[0..($parts.Length - 2)] -join "\"
                    $filename = $parts[-1]
                } else {
                    $datasetRel = ""
                    $filename = $parts[0]
                }

                $localDir = Join-Path $destRoot $datasetRel
                $localDir = Join-Path $localDir $today
                $localDir = Join-Path $localDir "raw"

                # Write to aria2c input file format
                # Each line with the URL, followed by options indented by at least one space
                $writer.WriteLine($absoluteUrl)
                $writer.WriteLine("  dir=$localDir")
                $writer.WriteLine("  out=$filename")
                $writer.WriteLine("  continue=true")
                $fileCount++
            }
        }
    }
} finally {
    $writer.Close()
}

Write-Host "✅ Crawling complete! Found $fileCount files."
Write-Host "📝 Input file generated: $ariaInputFile"
