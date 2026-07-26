# Millbygård: QGIS-Startplan

Detta dokument är ett separat arbetsblad för Millbygård och bygger vidare på:

- `docs/archive/millbygard/data-sammanstallning.md`
- `docs/archive/millbygard/hamtplan-och-produktionssteg.md`
- `docs/archive/millbygard/kartlager-inventering.md`

## Objekt och alias

Följande beteckningar ska behandlas som samma projektspår vid import, filnamn och anteckningar:

- `Orsa Stackmora 3:12`
- `Orsa Stackmora 3:12 (1)`
- `Orsa Stackmora 3:12 (2)`
- `Orsa Stackmora 3:12 (3)`

## Mål med QGIS-fasen

QGIS-fasen ska leverera:

1. ett arbetsprojekt i `EPSG:3006`
2. ett klippt ortofoto
3. en klippt markhöjdmodell
4. ett klippt byggnadslager
5. ett stödlager för fastighetsindelning
6. en `16-bit PNG` heightmap till WorldPainter
7. ett `GeoJSON`-lager för byggnadsfotavtryck

Alla kartlager som tas in här ska stanna kvar i projektet. QGIS är det permanenta navet för kartlagren.

## Rekommenderad mappstruktur

```text
Millbygard/
  01_data_raw/
    ortofoto/
    markhojd/
    byggnader/
    fastighet/
  02_qgis/
    project/
    working/
    exports/
  03_heightmap/
  04_references/
  05_buildings/
  06_schematics/
  07_exports/
  08_prompts/
  09_notes/
```

## Rekommenderade filnamn

Använd korta, stabila filnamn med huvudbeteckningen först.

Exempel:

- `orsa_stackmora_3_12_ortofoto.tif`
- `orsa_stackmora_3_12_markhojd.tif`
- `orsa_stackmora_3_12_byggnader.geojson`
- `orsa_stackmora_3_12_fastighet.gpkg`
- `orsa_stackmora_3_12_heightmap_16bit.png`
- `orsa_stackmora_3_12_workarea.gpkg`

Om `(1)(2)(3)` förekommer i källmaterial:

- spara dem som separata referensnamn i `09_notes/`
- men behåll huvudnamnet `orsa_stackmora_3_12_*` i arbetsfilerna

## Projektinställning

### 1. Skapa nytt QGIS-projekt

Projekt:

- nytt tomt projekt

Koordinatsystem:

- `SWEREF 99 TM`
- `EPSG:3006`

Spara som:

- `Millbygard/02_qgis/project/millbygard.qgz`

### 2. Skapa arbetsgrupper i Layers-panelen

Skapa grupper i denna ordning:

1. `00_reference`
2. `01_ortofoto`
3. `02_markhojd`
4. `03_byggnader`
5. `04_fastighet`
6. `05_lokala_lager`
7. `06_working`
8. `07_exports`

## Lager att lägga in först

### A. Ortofoto

Lägg ortofoto i grupp:

- `01_ortofoto`

Kontrollera:

- att det ritas korrekt i `EPSG:3006`
- att byggnadernas tak och gårdsplan syns tydligt

### B. Markhöjdmodell

Lägg höjddata i grupp:

- `02_markhojd`

Kontrollera:

- att rastervärden finns
- att höjdspannet ser rimligt ut

Skapa gärna direkt:

- hillshade
- enkel färgskuggning

så du ser terrängformerna tydligare

### C. Byggnader

Lägg byggnadsdata i grupp:

- `03_byggnader`

Styla:

- tunn mörk kontur
- halvtransparent fyllning

Kontrollera mot ortofoto:

- att byggnadspolygonerna faktiskt ligger rätt
- att alla större byggnader finns med

### D. Fastighetsindelning

Lägg fastighetsdata i grupp:

- `04_fastighet`

Styla:

- endast kontur
- diskret färg

Användning:

- stöd för orientering
- inte facit för blockplacering

## Första arbetsyta

### 1. Skapa lager för arbetsområde

Skapa nytt polygonlager:

- `workarea`

Spara som:

- `Millbygard/02_qgis/working/orsa_stackmora_3_12_workarea.gpkg`

Fält:

- `name`
- `notes`

### 2. Rita arbetsytan

Arbetsytan ska innehålla:

- huvudgården
- ekonomibyggnader
- gårdsplan
- infart
- närliggande väg
- skogskant/åkerkant
- synliga nivåskillnader

Rekommendation:

- börja hellre med för stor yta än för liten
- sikta på ungefär `150-300 meter` buffert runt gårdsmiljön i första passet

### 3. Lägg till en mindre kärnyta

Skapa gärna en andra polygon:

- `build_core`

Den ska bara täcka:

- gården och dess närmaste byggda miljö

Detta gör det lättare att exportera:

- en stor terrängyta
- men ett mindre byggfokus

## Klippning och arbetskopior

### 1. Ortofoto

Kör clip/mask med `workarea`.

Spara som:

- `Millbygard/02_qgis/exports/orsa_stackmora_3_12_ortofoto_clip.tif`

### 2. Markhöjdmodell

Kör clip/mask med `workarea`.

Spara som:

- `Millbygard/02_qgis/exports/orsa_stackmora_3_12_markhojd_clip.tif`

### 3. Byggnader

Kör clip med `workarea`.

Spara som:

- `Millbygard/02_qgis/exports/orsa_stackmora_3_12_byggnader_clip.geojson`

### 4. Fastighetslager

Kör clip med `workarea`.

Spara som:

- `Millbygard/02_qgis/exports/orsa_stackmora_3_12_fastighet_clip.gpkg`

## Kvalitetskontroller i QGIS

### Kontroll 1: Byggnader mot ortofoto

Frågor att besvara:

- saknas någon lada eller komplementbyggnad?
- är alla polygoner rimligt rätt placerade?
- ser vissa byggnader generaliserade eller förenklade ut?

Om något saknas:

- skapa ett manuellt kompletteringslager

Filnamn:

- `Millbygard/02_qgis/working/orsa_stackmora_3_12_manual_buildings.gpkg`

### Kontroll 2: Höjdmodell

Frågor att besvara:

- syns gårdsplanens nivåskillnad tydligt?
- fångas dike/slänt/infart?
- är rasterupplösningen tillräcklig för gårdsmiljön?

### Kontroll 3: Fastighet och lokala lager

Frågor att besvara:

- finns skydd, kulturmiljö eller risklager som påverkar tolkningen?
- finns lokal väg, infart eller gårdsstruktur som blir tydligare av kommun-/länslager?

## Heightmap-export

### Mål

Vi vill skapa en höjdfil för WorldPainter i:

- `16-bit grayscale PNG`

### Rekommenderat arbetssteg

1. arbeta på det klippta höjdrastret
2. kontrollera min/max-värden
3. normalisera höjdområdet försiktigt till en gråskala
4. exportera utan att råka nedgradera till 8-bit

Spara som:

- `Millbygard/03_heightmap/orsa_stackmora_3_12_heightmap_16bit.png`

Anteckna alltid:

- källraster
- min/max-höjd
- vilken y-nivå i Minecraft du tänker mappa gårdsplanen till

## Byggnadsexport

Målet är ett rent underlag för:

- manuell modellering
- halvautomatisk volymgenerering
- `.schem`

Exportera byggnader till:

- `GeoJSON`

Spara som:

- `Millbygard/05_buildings/orsa_stackmora_3_12_buildings.geojson`

Om du kompletterar manuellt:

- slå ihop officiellt lager och manuellt lager till ett arbetslager

Spara sammanslaget lager som:

- `Millbygard/05_buildings/orsa_stackmora_3_12_buildings_merged.geojson`

## Lagerordning i QGIS

Rekommenderad ritordning uppifrån och ned:

1. manuella anteckningar
2. byggnader
3. fastighetsgränser
4. lokala/regionala stödlager
5. ortofoto
6. hillshade
7. markhöjdmodell

## Första leverans från QGIS

När QGIS-fasen är godkänd ska följande finnas:

1. `millbygard.qgz`
2. `orsa_stackmora_3_12_workarea.gpkg`
3. `orsa_stackmora_3_12_ortofoto_clip.tif`
4. `orsa_stackmora_3_12_markhojd_clip.tif`
5. `orsa_stackmora_3_12_heightmap_16bit.png`
6. `orsa_stackmora_3_12_buildings_merged.geojson`

## Nästa steg efter QGIS

1. importera heightmap i `WorldPainter`
2. skapa första terrängvärlden
3. lägga ut byggnadsfotavtryck
4. skapa huvudvolymer
5. börja referensstyrd detaljering

## Vad du inte ska göra i QGIS-fasen

- inte blanda flera CRS utan kontroll
- inte börja bygga hus innan terrängen är låst
- inte anta att fastighetsgräns = exakt byggplacering
- inte exportera höjddata som 8-bit om målet är WorldPainter
- inte slå ihop allt i ett enda lager för tidigt
