Add-Type -AssemblyName System.Drawing
$fixtures = Join-Path $PSScriptRoot "fixtures"
New-Item -ItemType Directory -Force -Path $fixtures | Out-Null

function Save-TextPng([string]$path, [string]$text) {
  $bitmap = New-Object System.Drawing.Bitmap 1800, 420
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.Clear([System.Drawing.Color]::White)
  $font = [System.Drawing.Font]::new("Arial", [single]72, [System.Drawing.FontStyle]::Bold)
  $graphics.DrawString($text, $font, [System.Drawing.Brushes]::Black, 40, 150)
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $font.Dispose()
  $bitmap.Dispose()
}

Save-TextPng (Join-Path $fixtures "eng-hello.png") "HELLO OCR LOCAL"
$swedish = "f" + [char]0x00F6 + "rsiktighetsm" + [char]0x00E5 + "tt"
Save-TextPng (Join-Path $fixtures "swe-forsiktighet.png") $swedish
Write-Output "fixtures-written"
