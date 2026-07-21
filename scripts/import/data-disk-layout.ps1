# Gemensam sökvägskonvention (uppdaterad 2026-06-03):
# TODO(Mimers Brunn): Migration debt. This layout still models D:\GEodata and
# D:\Geo inlärning as active roots. Rewrite defaults to GEO_Master_Archive once the
# Antigravity migration is complete.
# - C: = Plattformens installation + kod (PostGIS byggs/körs här tillsammans med appen).
#   Plattformen flyttas till ren sökväg på C: och döps om till t.ex. C:\miljöbeslut (enbart "miljöbeslut").
# - D: = Tillfällig råfils-lagring / bulk för import (GEodata, Geo inlärning, Outlook/C-anmälan-dokument från skrivbordet på D:, etc.).
#   Råfiler **stannar på D:** under import. De används direkt därifrån (via GEODATA_DIR etc.).
# - H: = Primär backup-driv för råfiler (när import är klar och verifierad). D: kan sedan tömmas (åter till annan dator + ny SSD som D:).
#   Både GeoData och Geo inlärning har redan kopierats hit av användaren.
# - G: = Sekundär / moln-backup (Google Drive "Min enhet"). Används för extra redundans eller när H: inte är ansluten.
#
# ImportArchiveRoot på C: (inuti plattforms-repot) är **endast för**:
# - Manifests, loggar, små curated saker (t.ex. de 4 Lastkajen produkt-paketen som whitelistats för produktflöden).
# - INTE för bulk-råfiler. De hör hemma på D: som källa + H: som huvudbackup (G: som extra).

$script:DataDiskLayout = @{
    # NOTE: This will be updated to the clean C:\miljöbeslut (or equivalent) after the platform folder is moved/renamed.
    RepoRoot           = 'C:\Dev\miljobeslut-platform-recovery'
    # Curated / small things only (manifests + whitelisted small source caches). Not for large raw dumps.
    ImportArchiveRoot  = 'C:\Dev\miljobeslut-platform-recovery\storage\import-archive'
    LastkajenIngest    = 'C:\Dev\miljobeslut-platform-recovery\storage\ingest\lastkajen'
    # Raw / bulk sources — live on D: (temporary). Import reads from here. After success + G: backup these can be purged to free D:.
    D_Geodata          = 'D:\GEodata'
    D_GeoInlarning     = 'D:\Geo inlärning'
    D_IngestArkiv      = 'D:\ingest-arkiv-2026-03-29'
    D_Dev              = 'D:\Dev'
    # The "skrivbordet på D:" with kommun/C-anmälan docs, ansökningar, beslut etc. (Outlook import artifacts + produktdata).
    D_Desktop_Miljo    = 'D:\Users\jimmy\Desktop\MiljoBeslut_Produktdata'
    D_Desktop_Outlook  = 'D:\Users\jimmy\Desktop\OutlookExport'
    D_Desktop_Kommuner = 'D:\Users\jimmy\Desktop\Mariestad'

    # H: = primär offline backup för stora rå-träd (GeoData, Geo inlärning, etc.).
    # Användaren har redan kopierat D:\GEodata och D:\Geo inlärning hit.
    H_Root             = 'H:\Min enhet'
    H_GeoData          = 'H:\Min enhet\GEodata'           # användarens kopia från D:\GEodata (~128 GB)
    H_GeoInlarning     = 'H:\Min enhet\Geo inlärning'    # om mappen finns; annars under GEodata
    H_ArchiveRoot      = 'H:\Min enhet\miljobeslut-archive-2026'

    # Google Drive som sekundär/moln-backup (valfritt extra lager).
    G_DriveGeoRoot     = 'G:\Min enhet\GeoData'
    G_ArchiveRoot      = 'G:\Min enhet\GeoData\miljobeslut-archive-2026'
}

# Lastkajen-paket som stödjer produktflöden (lokalisering, C-anmälan, avlopp) — ej TN-väg/vägbeläggning.
$script:LastkajenProductPackageIds = @(
    10088  # tv_noise_layers
    10177  # tv_barriaranalys
    10499  # tv_barriaranalys_2021
    10094  # tv_viltolycka_vag
)

# Paket som endast ska arkiveras som rådata (ej till PostGIS utan explicit -IncludeTransport)
$script:LastkajenArchiveOnlyPackageIds = @(
    10175  # vilt historik (skipImport i manifest)
)
