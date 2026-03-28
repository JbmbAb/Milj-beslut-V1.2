# Kravmatris Guide

Anvand denna guide med `kravmatris_mellanlagring_template.csv`.

## 0. Kartlaggningsmal

Matrisen ska kunna svara pa:
1. Vilka krav myndigheter staller i anmalningsarenden for mellanlagringsplattor i manga svenska kommuner.
2. Vilka krav pa konstruktion kommunerna staller.
3. Vilka krav pa omhandertagande av lakvatten kommunerna staller.
4. Hur kraven skiljer sig mellan olika avfallsslag.

Det betyder att alla kommunrelaterade krav inom konstruktion och lakvatten ska foras in i matrisen.

## 1. Princip

1. En rad = ett konkret myndighetskrav.
2. Samma arende kan ge flera rader (ett krav per rad).
3. Spara alltid exakt kravcitat i `KravtextCitat`.
4. Skriv din tolkning i `TolkadKravtext`.
5. Om kravet kommer fran kommunen och ror konstruktion/lakvatten ska det alltid registreras.

## 2. Fyll ordning

1. Fyll metadata for arendet:
`CaseId`, `Kommun`, `Myndighetstyp`, `Myndighet`, `Diarienummer`, `Dokumenttyp`, `Dokumentdatum`, `KallaFil`.
2. Fyll kravfalten:
`KravId`, `KravkallaTyp`, `Kravkategori`, `Kravsubkategori`, `KravtextCitat`, `TolkadKravtext`, `Kravniva`.
3. Fyll verksamhetskoppling:
`RattsligHanvisning`, `Tidsfrist`, `Kontrollfrekvens`, `SanktionEllerKonsekvens`, `UtlosandeVillkor`, `Avfallsslag`, `EWC`, `MaxMangdTon`, `MaxLagringstid`.
4. Mappa mot mallen:
`Mallavsnitt`, `KommunBlankettFalt`, `BilagaSomStods`.
5. Markera analys:
`MinimikravJaNej`, `KommunspecifiktJaNej`, `StatusIAnmalan`, `Kommentar`.

## 3. Rekommenderade vardelistor

### `KravkallaTyp`
- Beslutsvillkor
- Kompletteringskrav
- Forsiktighetsmatt
- Informationskrav

### `Kravkategori`
- LokaliseringPlats
- Ytkonstruktion
- DagvattenLakvatten
- DriftEgenkontroll
- Riskhantering
- LagringsvolymTid
- TransportLogistik
- MiljopaverkanForsiktighet
- AvvecklingEfterbehandling
- BilagorDokumentation

### `Kravniva`
- SKA
- BOR
- KAN
- INFO

### `Myndighetstyp`
- Kommun
- Lansstyrelse

### `Dokumenttyp`
- Anmalan
- Beslut
- Komplettering
- Forelaggande

### `StatusIAnmalan`
- Ej behandlad
- Inkluderad
- Delvis inkluderad
- Ej relevant

## 4. Mallkoppling (`Mallavsnitt`)

Anvand mallnummer fran `mall_c_anmalan_mellanlagringsplatta_v2.md`:

1. Grunduppgifter  
2. Verksamhetsbeskrivning  
3. Lokalisering och platsforutsattningar  
4. Avfallsslag, mangder och lagringstid  
5. Konstruktion av mellanlagringsplatta  
6. Dagvatten och lakvattenhantering  
7. Drift, egenkontroll och journalforing  
8. Riskbedomning och skyddsatgarder  
9. Transporter och logistik  
10. Miljopaverkan och forsiktighetsmatt  
11. Avveckling och efterbehandling  
12. Bilagelista  

## 5. Hur matrisen blir underlag till mallen

1. Filtrera pa rader med `Kravniva = SKA`.
2. Gruppera per `Kravkategori` och kommun.
3. Markera `MinimikravJaNej = Ja` for krav som aterkommer i majoriteten av kommuner.
4. Skriv mallens bastext utifran dessa minimikrav.
5. Behall kommunspecifika krav som tillaggsrutor i anmalningsmallen.

## 6. Obligatoriska utsnitt for denna kartlaggning

Ta alltid fram dessa tre tabeller ur matrisen:

1. Kommunvisa konstruktionskrav:
filter `Kravkategori = Ytkonstruktion`.
2. Kommunvisa lakvattenkrav:
filter `Kravkategori = DagvattenLakvatten`.
3. Krav per avfallsslag:
gruppera pa `Kommun + Avfallsslag + EWC + Kravkategori`.

## 7. Kvalitetskontroll fore analys

1. Varje `KravId` ar unikt.
2. `KravtextCitat` innehaller faktisk kallsats.
3. `Mallavsnitt` ar ifyllt pa alla rader.
4. Alla lakvattenkrav ar markerade med `KopplingLakvatten = Ja`.
5. Alla konstruktionskrav ar markerade med `KopplingKonstruktion = Ja`.
6. Alla kommunala beslut/kompletteringar med krav pa konstruktion eller lakvatten finns med som rader.
