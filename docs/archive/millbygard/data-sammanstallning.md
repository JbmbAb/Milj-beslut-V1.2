# Millbygård: Data-Sammanställning

Detta spår är separat från övrig plattform och avser bara Millbygård: återskapande av en verklig gård i Minecraft Java Edition med geodata, foton och manuella kontroller.

Kompletterande styrdokument för kartlager:

- `docs/archive/millbygard/kartlager-inventering.md`

## Fastighetsidentitet och namnvarianter

Detta projekt ska uttryckligen inkludera följande beteckningar och namnvarianter i sökningar, anteckningar och datainsamling:

- `Orsa Stackmora 3:12`
- `Orsa Stackmora 3:12 (1)`
- `Orsa Stackmora 3:12 (2)`
- `Orsa Stackmora 3:12 (3)`

Praktisk regel:

- `Orsa Stackmora 3:12` är huvudbeteckningen
- varianterna med `(1)(2)(3)` behandlas som alias/spårnamn som också ska fångas upp om de förekommer i filer, bilder, exporter eller manuella anteckningar

## Mål

- Bygga gården i praktisk `1 block = 1 meter`
- Använda verklig terräng och byggnadsgeometri
- Använda AI för analys, blockpaletter och QA
- Kunna exportera gården till annan värld eller server
- hålla alla relevanta kartlager i ett enda huvudspår utan sidospår

## Prioriterad datalista

### 1. Ortofoto Nedladdning

Används för:

- byggnaders placering
- gårdsplan, vägar, staketlinjer
- träd, markslag och ytskikt

Praktisk notering:

- Lantmäteriets nuvarande produkt finns via Geotorget
- åtkomst sker via API
- produkten innehåller även historiska ortofoton

Önskat format:

- raster via API

### 2. Markhöjdmodell Nedladdning

Används för:

- höjdskillnader
- slänter
- gårdsplanens nivåer
- heightmap till WorldPainter

Praktisk notering:

- detta är bättre förstaval än rå LAS/LiDAR för Minecraft-flödet
- rå LiDAR behövs bara om vi vill göra mer avancerad egen terrängbearbetning

Önskat format:

- raster/DEM som kan exporteras till `16-bit PNG`

### 3. Byggnad Direkt eller Byggnad Visning

Används för:

- byggnadsfotavtryck
- byggnadstyper
- geometri för huvudbyggnad, ekonomibyggnad och komplementbyggnader

Praktisk notering:

- `Byggnad Direkt` kan svara med `GeoJSON`
- `includeData=geometri` hämtar byggnadens yta
- för ett mindre område är detta det mest praktiska spåret för exakta byggnadsytor

Önskat format:

- `GeoJSON`

### 4. Fastighetsindelning

Används för:

- trakt/fastighetsyta som stöd
- orientering runt rätt fastighet

Praktisk notering:

- ska inte behandlas som exakt juridisk marklinje i själva Minecraft-bygget
- används som stöd, inte som facit för placering av byggnader

Önskat format:

- vektor, helst `GeoJSON` eller `Shapefile`

## Lokala och regionala lager

### Orsa kommun: Bygglovskartan

Relevanta lager:

- detaljplan
- översiktsplan
- LIS-plan
- strandskydd
- kulturmiljö
- fornlämning
- naturreservat
- landskapsbildsskydd
- översvämningsområde
- ras/skredrisk
- förorenad mark
- VA-verksamhetsområden

Praktisk användning:

- kontrollera om gården påverkas av skydd, risk eller kulturvärden
- ge mer kontext för miljön runt gården

### Länsstyrelsen Dalarna

Relevanta vägar in:

- geodatakatalog
- planeringsunderlag i Dalarna
- informationskarta
- WMS-tjänster
- strandskyddskarta

Praktisk användning:

- riksintressen
- skyddad natur
- fornlämningar
- regionala planeringsunderlag

## Rekommenderat arbetsflöde

1. Hämta ortofoto, markhöjd och byggnadsgeometri
2. Lägg allt i QGIS
3. Reprojicera allt till `SWEREF 99 TM (EPSG:3006)`
4. Klipp ut ett arbetsområde runt gården
5. Exportera terrängen till `16-bit PNG`
6. Importera heightmap i WorldPainter
7. Exportera byggnader som `GeoJSON`
8. Konvertera byggnadsytor till Minecraft-volymer via WorldEdit/Amulet
9. Bygg detaljer manuellt
10. Exportera slutresultatet som `.schem` eller via Amulet

## Verktygsstack

- `QGIS`
- `WorldPainter`
- `WorldEdit`
- `Litematica`
- `Amulet`
- bild-AI för palettanalys och QA

## Viktiga begränsningar

- fastighetsgränser på landsbygden kan ha märkbar felmarginal
- AI ska inte gissa mått
- ortofoto visar planläge bra men inte vägg- eller takhöjder
- takvinkel, taksprång, fasaddetaljer och fönstersättning måste verifieras med foton

## Vad som är insamlat nu

- officiella produktspår för ortofoto och markhöjd
- officiellt byggnadsspår för geometri i `GeoJSON`
- officiellt fastighetsindelningsspår
- Orsa kommuns lokala kartlager
- Länsstyrelsen Dalarnas regionala kartlager
- fastighetsnamn och alias för `Orsa Stackmora 3:12`, inklusive `(1)(2)(3)`

## Vad som återstår i nästa fas

1. Låsa exakt arbetsområde för gården
2. Hämta ut de faktiska datamängderna
3. Bygga första QGIS-projektet
4. Exportera första heightmapen
5. Göra första byggnadsfotavtryck-kartan

## Källor

- Lantmäteriet Geodata: https://www.lantmateriet.se/sv/geodata/
- Ortofoto Nedladdning: https://geotorget.lantmateriet.se/dokumentation/GEODOK/44/latest.html
- Byggnad Direkt, teknisk beskrivning: https://geotorget.lantmateriet.se/dokumentation/GEODOK/3/latest/atkomst-och-leverans/teknisk-beskrivning.html
- Byggnad Direkt, åtkomst och leverans: https://geotorget.lantmateriet.se/dokumentation/GEODOK/3/latest/atkomst-och-leverans.html
- Byggnad Visning, kvalitet och byggnadsklasser: https://geotorget.lantmateriet.se/dokumentation/GEODOK/57/1.1_kommande/informationsinnehall/tema-byggnadsverk.html
- Fastighetsindelning: https://geotorget.lantmateriet.se/dokumentation/GEODOK/28/latest/informationsinnehall/fastighetsindelning.html
- Kommande produktförändringar hos Lantmäteriet: https://www.lantmateriet.se/sv/geodata/vara-produkter/Produktnyheter/Geografisk-information/kommande-produktforandringar/
- Orsa Bygglovskartan: https://orsa.se/bygga-bo-och-miljo/bygga-nytt-andra-eller-riva/bygglov-och-andra-tillstand/bygglovskartan.html
- Länsstyrelsen Dalarna, kartor och geodata: https://www.lansstyrelsen.se/dalarna/om-oss/vara-tjanster/kartor-och-geodata.html
- Länsstyrelsen Dalarna, karttjänster och geodata: https://www.lansstyrelsen.se/dalarna/om-oss/vara-tjanster/karttjanster-och-geodata.html
- Länsstyrelsen Dalarna, skyddad natur och strandskydd: https://www.lansstyrelsen.se/dalarna/natur-och-landsbygd/skyddad-natur.html
