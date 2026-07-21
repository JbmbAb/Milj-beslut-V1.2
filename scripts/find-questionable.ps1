$RELEVANT_TERMS = @('jordart', 'berggrund', 'grundvatten', 'geofysik', 'malmer', 'brunnar', 'strandforskjutning', 'klimat', 'miljogift', 'natura', 'vardetrakt', 'biogeokemi', 'fastmark', 'jordskred', 'stranderosion', 'svaghetszoner', 'avrinningsomrade', 'mineral', 'kallor', 'vatten', 'skydd', 'miljo', 'vatmark', 'riksintresse', 'naturolyckor', 'nitrat', 'betesmark', 'byggnad', 'fastighet', 'avvattning', 'gron_infrastruktur', 'olyckor', 'hotrisk', 'ang', 'naturtyper', 'seveso', 'kust', 'hav')
$TRAFFIC_TERMS = @('vagnummer', 'hastighetsgrans', 'slitlager', 'vagbredd', 'vaghallare', 'vagtrafik', 'rastplats', 'tillganglighetsvagnat', 'belaggning', 'jarnvag', 'sverigepaket', 'trafiknat', 'viltolyckskartor', 'vagar', 'blaljus', 'noise', 'waterway', 'transportplanering')

$files = Get-ChildItem -Path "H:\Delade enheter\Milj*beslut\GEodata" -Recurse -Filter "*.zip"
$questionable = @()

foreach ($f in $files) {
    $name = $f.Name.ToLower()
    $isRel = $false
    foreach ($rt in $RELEVANT_TERMS) {
        if ($name -match $rt) {
            $isRel = $true
            break
        }
    }
    
    if (-not $isRel) {
        $isTraffic = $false
        foreach ($tt in $TRAFFIC_TERMS) {
            if ($name -match $tt) {
                $isTraffic = $true
                break
            }
        }
        
        if (-not $isTraffic) {
            $questionable += $f.Name
        }
    }
}

$questionable | Out-File -FilePath "c:\Dev\miljobeslut-platform-recovery\scripts\questionable.txt" -Encoding UTF8
Write-Output "Found $($questionable.Count) questionable files."
