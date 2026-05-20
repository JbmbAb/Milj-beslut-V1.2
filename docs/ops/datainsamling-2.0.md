# Datainsamling 2.0 - Operativ plan

Datum: 2026-03-06
Syfte: Maximera inflode av kvarvarande kommunmaterial och bygga en ren, aterstartbar databas.

## Malbild

1. Full spårbarhet mellan kommun -> trad -> dokument -> arende -> krav.
2. En masterlogg dar varje kommun har tydlig status och nasta atgard.
3. Dataforst: inga nya stora produktspår innan datagrunden ar stabil.

## Spar A - Aterstallning och indexering

Fokus: allt som redan finns i Outlook och filarkiv.

Checklist:

1. Exportera mejlmetadata och bilagemetadata till masterlogg.
2. Identifiera tradar med saknad migrering.
3. Markera flaggor:

- `avgift_omnand`
- `losenord_omnand`
- `delvis_svar`
- `fullt_svar`

4. Kontrollera diarienummer och dokumentdatum.
5. Satt status `MIGRERAD_TILL_DB` for poster som ar tekniskt inforda.

Human in the loop:

1. Manuell kontroll av feltolkade kommunnamn.
2. Manuell kontroll av status for tradar med otydligt svar.
3. Manuell stickprovskontroll av 20 dokument per batch.

## Spar B - Riktad uppfoljning mot kommuner

Fokus: smart andra utskicksvag.

Segment:

1. Grupp 1: material finns, migrering saknas.
2. Grupp 2: delvis svar.
3. Grupp 3: kraver avgift.
4. Grupp 4: kraver losenord.
5. Grupp 5: inget svar.

Regel:

1. Skicka inte ny forfragan till grupp 1 innan intern aterstallning ar klar.
2. Skicka kort uppfoljning till grupp 2.
3. For grupp 3, begar diarielista eller avgransat urval innan betalbeslut.
4. For grupp 4, begar oppet format eller separat losenordskanal.
5. For grupp 5, skicka ny standardforfragan + tydlig avgransning.

Human in the loop:

1. Juridisk/administrativ bedomning innan eventuella avgifter godkanns.
2. Manuell godkanning av utskicksmallar innan batchutskick.

## Spar C - Databasrenovering

Fokus: arendedatabas, inte filsamling.

Karnentiteter:

1. Kommun
2. Trad/Utskick
3. Dokument
4. Arende
5. Extraherat krav

Kvalitetskrav:

1. Ingen rad utan `kommunnamn`, `status`, `senaste_kontakt`.
2. Ingen dokumentrad utan `filnamn` och `dokumentkategori`.
3. Ingen kravrad utan `kravkategori` och `kravtext_citat`.

Human in the loop:

1. Verifiering av datamappning innan full import.
2. Godkannande av schemaandring innan produktionsskrivning.

## KPI for 14 dagar

1. Tackt kommuner i masterlogg: mal >= 260.
2. Kommuner med status `FULLT_SVAR`: mal +20 procentenheter.
3. Tradar med korrekt diarienummer: mal >= 90 procent.
4. Dokument migrerade med kategori: mal >= 95 procent.
5. Rader med kvalitetsstatus `KVALITETSGRANSKAD`: mal >= 80 procent.

## 14-dagars exekvering

Dag 1-3:

1. Bygg masterlogg fran Outlook.
2. Kor forsta normalisering.

Dag 4-5:

1. Segmentera kommuner i 5 grupper.
2. Definiera batchlista for uppfoljning.

Dag 6-7:

1. Skicka uppfoljning grupp 2, 3, 4, 5.
2. Logga alla utskick i masterlogg.

Dag 8-10:

1. Kor migrering batch 1.
2. Kvalitetsgranska resultat.

Dag 11-14:

1. Kor migrering batch 2.
2. Uppdatera gaplista och plan for nasta cykel.

## Stoppregler

1. Stoppa import om >2 procent parserfel i en batch.
2. Stoppa statusautomatik om kommunmatchning faller under 95 procent.
3. Stoppa utskick om mall eller mottagarlista ej ar manuellt godkand.
