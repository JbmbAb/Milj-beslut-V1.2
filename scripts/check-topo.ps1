Write-Output '--- C: Drive Space ---'
Get-Volume -DriveLetter C | Select-Object @{Name='Free_GB';Expression={[math]::Round($_.SizeRemaining / 1GB, 2)}}, @{Name='Total_GB';Expression={[math]::Round($_.Size / 1GB, 2)}} | Format-Table -AutoSize

Write-Output '--- Topo File Sizes ---'
Get-ChildItem -Path "H:\Delade enheter\Milj*beslut\GEodata" -Recurse -Filter "*Topo*.zip" | Select-Object Name, @{Name='Size_MB';Expression={[math]::Round($_.Length / 1MB, 2)}} | Format-Table -AutoSize

Write-Output '--- Topo10 Contents ---'
$topo10 = Get-ChildItem -Path "H:\Delade enheter\Milj*beslut\GEodata" -Recurse -Filter "Topo10.zip" | Select-Object -First 1
if ($topo10) {
    tar -tf $topo10.FullName | Select-Object -First 15
}
