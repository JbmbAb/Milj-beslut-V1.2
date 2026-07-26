# Millbygård: Hämtplan och Produktionssteg

Detta dokument bygger vidare på `docs/archive/millbygard/data-sammanstallning.md` och översätter datalistan till ett konkret arbetsflöde.

Kartlager ska följa huvudspåret i:

- `docs/archive/millbygard/kartlager-inventering.md`

## Objekt som ska inkluderas

I detta arbetsflöde ska följande beteckningar behandlas som inkluderade i samma projektspår:

- `Orsa Stackmora 3:12`
- `Orsa Stackmora 3:12 (1)`
- `Orsa Stackmora 3:12 (2)`
- `Orsa Stackmora 3:12 (3)`

Praktisk tolkning:

- huvudområdet låses mot `Orsa Stackmora 3:12`
- varianterna `(1)(2)(3)` ska också kontrolleras när vi samlar filer, foton, exportnamn och manuell dokumentation

## Leveransmål för denna fas

Vi vill få fram fyra konkreta arbetsartefakter:

1. ett QGIS-projekt i `EPSG:3006`
2. ett ortofotolager över gården och närmiljön
3. en heightmap i `16-bit PNG`
4. byggnadsgeometri i `GeoJSON`

## Exakt hämtordning

### Steg 1: Ortofoto

Hämta:

- `Ortofoto Nedladdning`

Varför först:

- ger den visuella sanningen för placering av byggnader, vägar, gårdsplan, diken, trädrader och markmönster

Nuvarande produktläge:

- produkten nås via Geotorget
- åtkomst sker genom `STAC-bild`
- leverans sker som `COG` (`Cloud Optimized GeoTIFF`)
- metadata levereras som `GeoJSON`

Min rekommendation:

- hämta ett område som täcker själva gården plus rejäl buffert runt omkring
- ta hellre för stort utsnitt än för litet i första passet

Praktiskt utfall:

- spara under `Millbygard/01_data_raw/ortofoto/`

### Steg 2: Markhöjd

Hämta:

- `Markhöjdmodell Nedladdning`

Varför som nummer två:

- all byggplacering i Minecraft blir fel om terrängen inte är låst tidigt

Min rekommendation:

- använd markhöjdmodell som huvudspår
- använd inte rå LAS/LiDAR som första steg

Praktiskt utfall:

- spara under `Millbygard/01_data_raw/markhojd/`

### Steg 3: Byggnader

Hämta:

- `Byggnad Direkt`

Varför:

- för ett gårdsprojekt är detta smidigaste vägen till verkliga byggnadsytor

Viktiga parametrar:

- `srid=3006`
- `includeData=geometri`

Viktiga format:

- svar kan fås som `GeoJSON`

Praktisk användning:

- använd geometri- eller referensfrågor för ett mindre område runt gården
- byggnadsfotavtryck ska sparas separat från ortofotot

Praktiskt utfall:

- spara under `Millbygard/01_data_raw/byggnader/`

### Steg 4: Fastighetsindelning

Hämta:

- `Fastighetsindelning Nedladdning, vektor`

Varför:

- ger registerbeteckningar, trakt och orientering runt rätt fastighet

Varning:

- använd detta som stödlager
- inte som exakt juridisk eller millimeterkorrekt sanning för blockplacering

Praktiskt utfall:

- spara under `Millbygard/01_data_raw/fastighet/`

### Steg 5: Lokala och regionala lager

Öppna och kontrollera:

- `Orsa Bygglovskartan`
- `Länsstyrelsen Dalarna` planeringsunderlag/geodata

Detta är främst stödlager för:

- kulturmiljö
- strandskydd
- fornlämning
- risk
- skyddad natur
- planeringsunderlag

Praktiskt utfall:

- spara anteckningar och skärmdumpar under `Millbygard/09_notes/`

## QGIS-flöde

### 1. Skapa nytt projekt

Sätt projektets koordinatsystem till:

- `SWEREF 99 TM`
- `EPSG:3006`

### 2. Lägg in lager

Importera:

- ortofoto
- markhöjdmodell
- byggnadsdata
- fastighetsindelning

### 3. Skapa arbetsutbredning

Gör ett polygonlager eller bounding box för:

- själva gården
- gårdsmiljön
- närliggande väg, skogskant, åkerkant och höjdskillnader
- alla relevanta delar som hör till `Orsa Stackmora 3:12` samt eventuella material märkta `(1)`, `(2)` och `(3)`

Min rekommendation:

- börja med en buffert på minst `150-300 meter` runt den centrala gårdsmiljön

### 4. Klipp lagren

Clip/maska:

- ortofoto till arbetsutbredning
- höjdmodell till arbetsutbredning
- byggnader till arbetsutbredning
- fastighetslager till arbetsutbredning

### 5. Granska byggnadsgeometri

Kontrollera i QGIS:

- om alla tydliga byggnader finns med
- om någon ekonomibyggnad saknas
- om byggnader ligger exakt på ortofotot eller verkar schematiska

Om byggnadsdata saknar något:

- komplettera manuellt från ortofotot

### 6. Exportera terrängunderlag

Exportera markhöjdmodellen till:

- `16-bit grayscale PNG`

Detta blir underlag till:

- `WorldPainter`

Viktigt:

- undvik att råka exportera 8-bit
- kontrollera att hela höjdspannet bevaras

### 7. Exportera byggnader

Exportera byggnadsytor till:

- `GeoJSON`

Detta blir underlag för:

- husvolymer
- `.schem`
- eller manuell överföring i WorldEdit/Amulet

## Produktionssteg efter QGIS

### Fas A: Terräng

1. importera heightmap i `WorldPainter`
2. ställ in vertikal mappning
3. välj referensnivå för gårdsplan
4. exportera testvärld

Mål:

- rätt sluttningar
- rätt höjdskillnader
- rimlig läsbarhet i Minecraft

### Fas B: Gårdsstruktur

1. lägg ut byggnadsfotavtryck
2. lägg ut infart och vägdragning
3. lägg ut gårdsplan
4. lägg ut murar, staket och tydliga vegetationslinjer

### Fas C: Byggnader

Prioritetsordning:

1. huvudbyggnad
2. lada/ekonomibyggnad
3. uthus/garage/komplementbyggnader

### Fas D: Detaljer

1. takvinkel
2. taksprång
3. fönstersättning
4. panel/timmer/puts
5. trappor, räcken, dörrar
6. gårdsdetaljer

## AI-stöd i rätt ordning

Använd AI först efter att geodata är låst.

Bra AI-uppgifter:

- blockpalett för rödfärg, vita knutar, plåt, natursten, trä
- takvinkelestimat från foton
- detaljlista per byggnad
- QA mellan referensfoto och Minecraft-screenshot

Dåliga AI-uppgifter:

- gissa byggnadsmått
- hitta fastighetsgränser
- ersätta höjdmodell

## Export till annan värld eller server

### Bästa metod med rättigheter

- `WorldEdit`
- spara som `.schem`

Bra för:

- flytt mellan världar
- flytt till server
- versionshantering av byggnader

### Bästa metod utan serverrättigheter

- `Litematica`

Bra för:

- hologram
- återuppbyggnad i survival eller begränsad creative-miljö

### Bästa offline-metod

- `Amulet`

Bra för:

- kopiera område mellan världar
- justera placering offline

### Vanilla-metod

- `Structure Blocks`

Bra för:

- mindre delar

Inte bra för:

- stor gård i ett enda stycke

## Vad som återstår innan faktisk datahämtning

För att gå hela vägen behöver du:

1. tillgång till Geotorget-produkt/behörighet
2. exakt avgränsning för Millbygård
3. beslut om hur stor omgivning som ska med i första världsutkastet

## Regel mot sidospår

All fortsatt kartlagerhämtning ska ske inom samma huvudspår.

Det betyder:

- inga parallella alternativa lagerpaket
- inga tillfälliga geodataflöden som inte förs tillbaka till QGIS-projektet
- alla hämtade kartlager ska sparas och dokumenteras

## Praktisk mappstruktur

```text
Millbygard/
  01_data_raw/
    ortofoto/
    markhojd/
    byggnader/
    fastighet/
  02_qgis/
  03_heightmap/
  04_references/
  05_buildings/
  06_schematics/
  07_exports/
  08_prompts/
  09_notes/
```

## Rekommenderad nästa handling

Nästa bästa steg är att skapa:

- ett QGIS-projekt
- en första arbetspolygon
- och en konkret hämtlista per produkt

När det är gjort kan nästa leverans vara:

- `qgis-startplan.md`
- eller ett skript-/checklistespår för att konvertera höjdmodell till `16-bit PNG`

## Källor

- Ortofoto Nedladdning, åtkomst och leverans: https://geotorget.lantmateriet.se/dokumentation/GEODOK/44/latest/atkomst-och-leverans.html
- Ortofoto Nedladdning, informationsinnehåll: https://geotorget.lantmateriet.se/dokumentation/GEODOK/44/2025.02_gallande/informationsinnehall.html
- Byggnad Direkt, åtkomst och leverans: https://geotorget.lantmateriet.se/dokumentation/GEODOK/3/latest/atkomst-och-leverans.html
- Byggnad Direkt, teknisk beskrivning: https://geotorget.lantmateriet.se/dokumentation/GEODOK/3/latest/atkomst-och-leverans/teknisk-beskrivning.html
- Fastighetsindelning, informationsinnehåll: https://geotorget.lantmateriet.se/dokumentation/GEODOK/28/latest/informationsinnehall/fastighetsindelning.html
- Lantmäteriet, kommande produktförändringar: https://www.lantmateriet.se/sv/geodata/vara-produkter/Produktnyheter/Geografisk-information/kommande-produktforandringar/
- Orsa Bygglovskartan: https://orsa.se/bygga-bo-och-miljo/bygga-nytt-andra-eller-riva/bygglov-och-andra-tillstand/bygglovskartan.html
- Länsstyrelsen Dalarna, kartor och geodata: https://www.lansstyrelsen.se/dalarna/om-oss/vara-tjanster/kartor-och-geodata.html
- Länsstyrelsen Dalarna, karttjänster och geodata: https://www.lansstyrelsen.se/dalarna/om-oss/vara-tjanster/karttjanster-och-geodata.html
