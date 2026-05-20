# Millbygård: Hämtad Plattformsdata

Detta dokument sammanfattar vad som faktiskt hämtades via Miljöbeslut-plattformens egna fastighets- och Lantmäteri-spår.

Kartlagren som hämtas via plattformen ska därefter in i samma huvudspår som definieras i:

- `docs/millbygard/kartlager-inventering.md`

## Källa i plattformen

Följande interna spår användes:

- `POST /api/property/lookup/postgis`
- `POST /api/property/lookup`
- `POST /api/admin/lantmateriet/test`

Plattformens backend kör lokalt på:

- `http://127.0.0.1:8787`

Frontend kör lokalt på:

- `http://127.0.0.1:3000`

## Bekräftat i plattformens databas

I `core.property_unit` finns följande relevanta träffar:

- `ORSA STACKMORA 3:12>1`
- `ORSA STACKMORA 3:12>2`
- `ORSA STACKMORA 3:12>3`

Det innebär att Millbygård-projektet redan har faktisk fastighetsgeometri i plattformens PostGIS-spår för delområdena.

## PostGIS-resultat via plattformen

Testat:

- `ORSA STACKMORA 3:12`
- `ORSA STACKMORA 3:12>1`
- `ORSA STACKMORA 3:12>2`
- `ORSA STACKMORA 3:12>3`

Utfall:

- `ORSA STACKMORA 3:12` gav träff via `fuzzy` och matchade mot `ORSA STACKMORA 3:12>3`
- `ORSA STACKMORA 3:12>1` gav `exact`
- `ORSA STACKMORA 3:12>2` gav `exact`
- `ORSA STACKMORA 3:12>3` gav `exact`

Tolkning:

- basbeteckningen utan suffix är inte tillräckligt exakt i plattformens nuvarande fastighetslager
- delområdena `>1`, `>2`, `>3` ska behandlas som de verkliga arbetsobjekten

## Live-Lantmäteri via plattformen

Admin-testet i plattformen visade:

- live-läge aktivt
- autentisering via `OAuth2`
- tokenhämtning fungerar

Plattformens generella provuppslag använde en annan testbeteckning och gav därför inte träff, men det viktiga är att live-kopplingen fungerar.

När vi testade de faktiska Stackmora-varianterna blev utfallet:

- `ORSA STACKMORA 3:12` gav inte träff
- `ORSA STACKMORA 3:12 (1)` gav träff
- `ORSA STACKMORA 3:12 (2)` gav träff
- `ORSA STACKMORA 3:12 (3)` gav träff

Plattformens live-spår normaliserar parentesvarianterna till:

- `ORSA STACKMORA 3:12>1`
- `ORSA STACKMORA 3:12>2`
- `ORSA STACKMORA 3:12>3`

Det är därför rätt att fortsätta använda både:

- `Orsa Stackmora 3:12 (1)(2)(3)` i användarnära sökningar
- `ORSA STACKMORA 3:12>1..3` i tekniska arbetsfiler och interna geometrier

## Utsparade artefakter

Följande filer har skapats:

- `output/millbygard/orsa_stackmora_3_12_split.geojson`
- `output/millbygard/orsa_stackmora_3_12_split_summary.json`
- `output/millbygard/orsa_stackmora_3_12_live_lookup.json`
- `output/millbygard/orsa_stackmora_3_12_workarea.geojson`

## Sammanfattning av fastighetsdelar

Nuvarande geometrier i plattformen visar följande ungefärliga areor:

- `ORSA STACKMORA 3:12>1` = `5962.09 m²`
- `ORSA STACKMORA 3:12>2` = `4324.55 m²`
- `ORSA STACKMORA 3:12>3` = `18812.8 m²`

Centroidpunkter finns också i summary-filen.

## Arbetsregel för Millbygård

Från och med nu bör Millbygård använda följande regel:

1. använd `Orsa Stackmora 3:12 (1)(2)(3)` när vi söker och verifierar live-data
2. använd `ORSA STACKMORA 3:12>1..3` i tekniska geometrier och datalager
3. använd inte basbeteckningen `Orsa Stackmora 3:12` ensam som primär teknisk nyckel

## Sammanfogad arbetsyta

Delområdena `>1`, `>2`, `>3` har slagits ihop till en första arbetsyta:

- benämning: `ORSA STACKMORA 3:12 (1)(2)(3)`
- teknisk beteckning: `ORSA STACKMORA 3:12>1..3`
- area: `29099.44 m²`
- centroid: `POINT(14.665062194437354 61.13531072315907)`

Den sparades som:

- `output/millbygard/orsa_stackmora_3_12_workarea.geojson`

## Nästa steg

Nu när plattformsdata är hämtad är nästa bästa steg:

1. slå samman `>1..3` till ett arbetsområde för QGIS
2. använda den sammanslagna ytan som `workarea`
3. hämta ortofoto och markhöjd över just detta område
4. gå vidare till första riktiga heightmapen
