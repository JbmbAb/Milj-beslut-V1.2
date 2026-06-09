# Mimers Brunn: Offline-First Data Architecture

Status: gällande policy från 2026-06-07.

## Syfte

Offentlig miljödata är flyktig. Externa API:er, WMS/WFS-tjänster och PDF-länkar kan ändras, försvinna eller döljas över tid. Miljöbeslut ska därför inte vara beroende av att myndigheternas live-tjänster finns kvar i exakt samma skick.

Mimers Brunn är plattformens offline-first-policy: beslutskritisk geodata, juridiska källor, rapporter och dokument ska ägas, arkiveras och kunna återanvändas lokalt.

## Grundregler

### 1. Download-first

Live-API:er får användas för discovery, statuskontroll och tillfällig visualisering. De får inte vara den permanenta source of truth för beslutskritiska dataset.

Varje permanent dataset ska ha en harvesting-pipeline som laddar ner rådatan fysiskt och skriver manifest med källa, hash, storlek, hämtningstid och eventuell licens-/metadatareferens.

### 2. Master-arkivet är canonical

Nya pipelines ska skriva till:

```text
H:\Delade enheter\Miljöbeslut\GEO_Master_Archive
```

Tillåten målstruktur:

```text
GEO_Master_Archive
  \Rasters\<Provider>\<Dataset>\
  \Vectors\<Provider>\<Dataset>\
  \Documents\Sources\<Provider>\<Dataset>\
  \Data\<Provider>\<Dataset>\
  \_review\Okänd_Provider\<Filename>\
  \_manifests
  \_logs
  \_quarantine
  \_temp
```

Gamla rötter som `D:\GEodata`, `D:\Geo inlärning` och `C:\GEO PDF` är legacy. De får användas endast som migrationskällor i kontrollerade scripts och ska inte användas av nya import- eller download-moduler.

### 3. Arkiv före PostGIS

Data ska säkras i Master-arkivet innan den används som permanent systemunderlag.

- Vektordata (`.shp`, `.gpkg`, `.gml`, `.geojson`) importeras till PostGIS efter arkivering och verifiering.
- Rasterdata (`.tif`, `.tiff`, `.asc`) registreras via stabila Out-of-DB-länkar från Master-arkivet.
- Okända dataset i `_review` får inte importeras till PostGIS förrän provider/dataset har klassats i `mapping.json`.

### 4. Dokument och källhänvisningar

PDF:er, rapporter och domar ska arkiveras under:

```text
GEO_Master_Archive\Documents\Sources\<Provider>\<Dataset>\
```

Frontend och API ska servera beslutskritiska dokument via lokal dokumentroute eller dokument-id. Original-URL får sparas som metadata men ska inte vara den enda klickbara källan i beslutsflöden.

### 5. Cloud/runtime-sökväg

Docker och PostGIS ska se Master-arkivet via en stabil mount, till exempel:

```text
/mnt/geo_master_archive
```

Databasreferenser ska peka på den kanoniska runtime-sökvägen, inte på en användarspecifik Windows-enhetsbokstav. Om lagringen senare flyttas till NAS eller Cloud Storage ska mounten kunna ändras utan att PostGIS-referenser behöver skrivas om.

## Harvesting-kontrakt

Alla nya nedladdningspipelines ska designas som historikbevarande harvesting-jobb, inte som enkla "ladda ner senaste filen"-scripts.

### 1. Myndighetsrättelser och versionering

Myndigheter kan rätta geometrier, metadata och dokument utan stabil changelog. Därför får en ny hämtning aldrig skriva över en tidigare version.

Varje hämtning ska lagras under en versions- eller tidsstämplad katalog, exempel:

```text
GEO_Master_Archive\Data\Naturvardsverket\NVR\2026-06-07T14-30-00Z\
GEO_Master_Archive\Vectors\SGU\jordarter25k_100k\2026-06-07T14-30-00Z\
GEO_Master_Archive\Documents\Sources\VISS\grundvattenutredningar\2026-06-07T14-30-00Z\
```

Manifestet ska markera vilken version som är senaste kända version, men historiska versioner ska behållas. PostGIS-importer ska bära `dataset_version`, `valid_from` eller motsvarande metadata så AI och användare kan veta vilket underlag som gällde vid ett visst datum.

### 2. Polite scraping och rate limiting

Pipelines som anropar myndighetskällor ska vara artiga och återstartbara:

- sätt en tydlig `User-Agent` där det är möjligt;
- använd begränsad concurrency;
- lägg in delay/jitter mellan anrop;
- hantera `429`, `503`, timeouts och nätverksfel med bounded retries och backoff;
- skriv checkpoint/manifest löpande så jobbet kan återupptas utan att hämta om allt;
- bekräfta innan jobb som kan ta mer än 5 minuter eller orsaka mycket trafik.

Massiva oreglerade anrop är förbjudna eftersom de riskerar IP-blockering och skadar relationen till offentliga datakällor.

### 3. Bevis på integritet

Varje nedladdad fil ska verifieras och få en kryptografisk hash, normalt SHA-256.

Minsta manifestfält per fil:

```json
{
  "provider": "Naturvardsverket",
  "dataset": "NVR",
  "sourceUrl": "https://...",
  "originalFileName": "nvr.zip",
  "archivePath": "H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive\\Data\\Naturvardsverket\\NVR\\2026-06-07T14-30-00Z\\nvr.zip",
  "runtimePath": "/mnt/geo_master_archive/Data/Naturvardsverket/NVR/2026-06-07T14-30-00Z/nvr.zip",
  "downloadedAt": "2026-06-07T14:30:00Z",
  "sizeBytes": 123456789,
  "sha256": "...",
  "httpStatus": 200,
  "contentType": "application/zip",
  "etag": "\"...\"",
  "lastModified": "..."
}
```

Om källan erbjuder `ETag`, `Last-Modified`, checksums eller versionsnummer ska de sparas som metadata, men de ersätter inte lokal SHA-256.

## Konsekvenser för scripts/import

Nya scripts under `scripts/import/` ska:

- skriva nya nedladdningar till Master-arkivet;
- skapa manifest eller annan spårbar metadata;
- bevara tidigare versioner och aldrig skriva över historiska filer;
- använda polite scraping med begränsad concurrency, retry/backoff och checkpoints;
- beräkna och lagra SHA-256 samt filstorlek för varje nedladdad fil;
- undvika hårdkodade `D:\`, `C:\GEO PDF` och gamla H:\GEodata-rötter;
- skilja download, archive, import och verify som separata steg;
- aldrig radera rådata permanent utan human-in-the-loop-review.

Legacy-scripts som fortfarande använder gamla sökvägar ska migreras stegvis och markeras som migrationsskuld tills de följer denna policy.
