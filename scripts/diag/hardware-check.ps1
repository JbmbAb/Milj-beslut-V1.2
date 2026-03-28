Write-Host "------------------------------------------------"
Write-Host "HÅRDVARUINFORMATION (PowerShell)"
Write-Host "------------------------------------------------"

$os = Get-CimInstance Win32_OperatingSystem
Write-Host "OS: $($os.Caption) $($os.Version)"

$cpu = Get-CimInstance Win32_Processor
Write-Host "CPU Modell: $($cpu.Name)"
Write-Host "Antal kärnor: $($cpu.NumberOfCores)"

$mem = Get-CimInstance Win32_PhysicalMemory | Measure-Object -Property Capacity -Sum
$totalRam = [math]::round($mem.Sum / 1GB, 2)
$freeMem = [math]::round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024 / 1024, 2)

Write-Host "Totalt RAM: $totalRam GB"
Write-Host "Ledigt RAM: $freeMem GB"
Write-Host "------------------------------------------------"