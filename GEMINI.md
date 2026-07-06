# Projektinstruktioner: miljobeslut-platform-recovery

Den här filen innehåller arkitektoniska beslut och konventioner som är specifika för detta projekt.

## Dokumentation och Gemini Enterprise

| Ämne | Sökväg |
|------|--------|
| Knowledge base (indexera först) | `knowledge-base/README.md` |
| Geodata-gap | `docs/architecture/data-coverage-gaps.md` |
| Framtida optimeringar | `docs/architecture/future-optimizations-backlog.md` |
| Dela kod + PostGIS-kontext | `docs/ops/gemini-enterprise-access.md` |

**Plattformskod** delas via **Git**. **Geodata** delas via **Drive** (`GEO_Master_Archive`). **PostGIS** delas via schema/SQL i repot — inte Docker-volymen på Drive.

## Mimer Bibliotekarie (Specialiserad AI-Roll)
Plattformen använder en specialiserad agentroll, **Mimer Bibliotekarie**, för att hantera geodataflöden. 
- **Mandat:** Granska, planera och optimera dataflöden enligt Mimers Brunn-policyn.
- **Fullständiga instruktioner:** Se `knowledge-base/MIMER_LIBRARIAN.md`.

## Arkitekturpolicy: Mimers Brunn (Offline-First)
... (rest of the content)

### Bakgrund och Syfte
Offentlig miljödata är flyktig. Erfarenhet visar att livsviktig historik (t.ex. grundvattenutredningar från VISS) raderas eller döljs av myndigheter över tid. Ett externt Live-API garanterar inte datans överlevnad.

Därför styrs plattformen av policyn "Mimers Brunn". För att Mimer (AI:n) ska uppnå sann Miljöintelligens, måste all data ägas och lagras lokalt.

### Grundläggande Regler
- **Ladda ner framför API (Download-First):** Live-API:er (WMS/WFS/REST) får endast användas som tillfälliga visuella hjälpmedel i frontenden. Den slutgiltiga lösningen för varje dataset MÅSTE vara ett skript som laddar ner rådatan fysiskt.
- **Direkt till Master-arkivet:** Skriv direkt till den kanoniska strukturen: `H:\Delade enheter\Miljöbeslut\GEO_Master_Archive\Data\<Provider>\<Dataset>\`. Gamla mappar som `D:\GEodata` eller `C:\GEO PDF` är förbjudna.
- **In-DB eller Out-of-DB:** När datan är säkrad i Master-arkivet:
    - Importera direkt i PostGIS-tabeller (Vektordata: shp, gpkg).
    - Registrera i PostGIS via Out-of-DB-länkar (`raster2pgsql -R`) (Rasterdata: tif, asc).
- **Källhänvisningar och Dokument (PDF):** Rapporter och domar ska laddas ner till `H:\Delade enheter\Miljöbeslut\GEO_Master_Archive\Documents\Sources\<Provider>\`. Appens frontend ska servera filen från detta lokala arkiv.

### Tekniska Krav för Harvesting-logik (scripts/import/)
För att säkra datans integritet och tillgänglighet måste alla nya skript hantera:

1.  **Versionering (Myndighetsrättelser):**
    - Skriv aldrig över existerande data. Om ny data hämtas för samma dataset, lagra den i en ny tidsstämplad undermapp (t.ex. `.../YYYY-MM-DD/`).
    - Databasposter ska inkludera ett fält för `download_date` eller `valid_from` så att AI:n kan skilja på historisk och aktuell data.

2.  **"Polite Scraping" (Rate-Limiting & Retries):**
    - Implementera alltid fördröjningar (sleep/delay) mellan anrop för att undvika IP-blockering.
    - Använd robust felhantering med retries (Exponential Backoff rekommenderas) för nätverksfel.

3.  **Bevis på integritet (Checksums):**
    - Beräkna SHA-256 hash för varje nedladdad fil.
    - Lagra hashen i en metadatafil (t.ex. `checksums.txt` eller `metadata.json`) i samma mapp som datan. Detta bevisar att datan är oförvanskad.

### Instruktion för Agenter
Vid utveckling av nya datainhämtningsmoduler (under `scripts/import/`), följ strikt denna policy. Fokusera på att bygga robusta nedladdnings-pipelines ("Harvesting") som säkrar datan på H-disken. Målet är att fylla Mimers Brunn.
