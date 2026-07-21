# Millbygård: Kartlagerinventering

Detta dokument är den samlade sanningskällan för kartlager i Millbygård.

## Princip

För Millbygård gäller:

- alla relevanta kartlager ska med i huvudspåret
- alla hämtade kartlager ska finnas kvar efteråt
- inga separata sidospår ska drivas parallellt om de inte leder tillbaka till samma huvudflöde
- QGIS-projektet ska vara den samlande platsen för alla lager

Det betyder i praktiken:

- vi samlar inte "alternativa geodataflöden" vid sidan av huvudspåret
- vi använder ett enda lagerpaket för terräng, bild, byggnader, fastighet och lokala/regionala stöddata
- varje lager ska få en tydlig plats i projektstrukturen

## Huvudspår

Det enda huvudspåret för kartlager är:

1. `workarea` från plattformens fastighetsgeometri
2. ortofoto
3. markhöjdmodell
4. byggnader
5. fastighetsindelning
6. lokala kommunlager
7. regionala länslager
8. eventuella extra mark-/miljölager som stöd

## Kartlager som ska ingå

### A. Arbetsyta

Status:

- redan framtagen

Fil:

- `output/millbygard/orsa_stackmora_3_12_workarea.geojson`

Användning:

- klippning
- avgränsning
- gemensam spatial nyckel för resten av lagren

### B. Fastighetsdelar

Status:

- redan framtagna

Filer:

- `output/millbygard/orsa_stackmora_3_12_split.geojson`
- `output/millbygard/orsa_stackmora_3_12_split_summary.json`

Användning:

- spårbarhet mellan `(1)(2)(3)` och `>1..3`
- möjlighet att särskilja delområden i senare analys

### C. Ortofoto

Status:

- ska ingå
- ännu inte hämtat i Millbygård-spåret

Användning:

- byggnaders tak och läge
- gårdsplan
- vägdragning
- träd och vegetation
- staketlinjer
- markmönster

Behåll efteråt:

- ja

### D. Markhöjdmodell

Status:

- ska ingå
- ännu inte hämtad i Millbygård-spåret

Användning:

- terräng
- nivåskillnader
- slänter
- underlag till `16-bit PNG` heightmap

Behåll efteråt:

- ja

### E. Byggnadslager

Status:

- ska ingå
- ännu inte hämtat som separat arbetslager i Millbygård-spåret

Användning:

- byggnadsfotavtryck
- huvudhus, lada, uthus
- stöd för volymbygge i Minecraft

Behåll efteråt:

- ja

### F. Fastighetsindelning

Status:

- ska ingå
- ännu inte exporterad till arbetsmapp i Millbygård-spåret

Användning:

- stödjande registerlager
- orientering
- trakt/fastighetsyta

Behåll efteråt:

- ja

### G. Orsa kommun - lokala lager

Status:

- ska ingå som stödlager

Exempel:

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

Användning:

- kontext
- kultur- och miljötolkning
- bättre förståelse av gårdsmiljön

Behåll efteråt:

- ja

### H. Länsstyrelsen Dalarna - regionala lager

Status:

- ska ingå som stödlager

Exempel:

- skyddad natur
- strandskydd
- riksintressen
- kulturmiljö och planeringsunderlag
- övriga relevanta WMS-lager

Användning:

- regional kontext
- miljö- och landskapsförståelse

Behåll efteråt:

- ja

### I. Eventuella extralager

Kan ingå om de hjälper huvudspåret:

- marktäcke
- hydrologi/vatten
- väglager
- terrängskuggning/hillshade
- manuellt kompletteringslager för byggnader

Regel:

- de får bara tas in om de stärker huvudspåret
- de ska sedan stanna kvar som dokumenterade lager

## Lager som inte ska bli sidospår

Följande får användas endast om de leder tillbaka till samma huvudprojekt:

- OSM som snabb jämförelse
- manuella skisser
- tillfälliga testlager
- alternativa exportformat

Regel:

- inget av detta får bli ett eget parallellt arbetsflöde
- om de används ska resultatet föras tillbaka till QGIS-huvudspåret

## Bevaranderegel

Alla kartlager som hämtas in i Millbygård ska bevaras i projektet enligt mappstruktur:

```text
Millbygard/
  01_data_raw/
  02_qgis/
  03_heightmap/
  09_notes/
```

Miniminivå för bevarande:

- råfil eller råkälla
- arbetskopia/clip
- dokumenterad användning

## Lagerordning i QGIS

Rekommenderad permanent lagerordning:

1. arbetsanteckningar
2. byggnader
3. fastighetsdelar
4. fastighetsindelning
5. kommunala lokallager
6. regionala lager
7. ortofoto
8. hillshade
9. markhöjdmodell
10. workarea

## Vad som fortfarande saknas i kartlager

Det som ännu inte är hämtat eller sparat i arbetsmappen är främst:

- ortofoto
- markhöjdmodell
- separat byggnadslager
- fastighetsindelning som arbetslager
- kommunala/regionala stödlager som exporterade eller dokumenterade arbetslager

## Nästa ordning utan sidospår

1. använd `orsa_stackmora_3_12_workarea.geojson` som klippyta
2. hämta ortofoto
3. hämta markhöjdmodell
4. hämta byggnadslager
5. hämta/exportera fastighetsindelning
6. koppla in Orsa- och Dalarnalagren
7. bygg QGIS-projektet med allt detta kvar

Detta är huvudspåret. Inga alternativa kartlagerflöden behövs utanför detta.
