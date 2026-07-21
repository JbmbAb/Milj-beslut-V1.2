$files = @(
    '2024-422-1.zip', 
    '2023-105-1-1.zip', 
    '2023-241-1.zip', 
    '2024-47-1.zip', 
    '2025-187-1.zip', 
    'snd1122-1-1.0.zip', 
    '1_skane_land.zip', 
    '2025-151-1.zip', 
    '2025-259-2.zip', 
    'Stockholms län.zip'
)

foreach ($f in $files) {
    $path = Get-ChildItem "H:\Delade enheter\Milj*beslut\GEodata" -Recurse -Filter $f | Select-Object -First 1
    if ($path) {
        Write-Output "=== Contents of $($f) ==="
        tar -tf $path.FullName | Select-Object -First 10
        Write-Output ""
    } else {
        Write-Output "=== Could not find $($f) ==="
        Write-Output ""
    }
}
