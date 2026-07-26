# Target Platform Traceability Architecture

## Goal

Platformens malbild ar:

- ett dokument eller en ansokan skapas fran strukturerad data
- det skickas till ratt kommun eller myndighet via ratt kanal
- beslut, forelagganden och kompletteringskrav kommer tillbaka till samma arende
- juridiska, miljomassiga och ekonomiska konsekvenser blir forklarbara i efterhand
- varje kritiskt steg har human-in-the-loop innan rattsverkan uppstar

Detta dokument oversatter den malbilden till en konkret arkitektur for nuvarande repo.

## Existing Building Blocks

Foljande finns redan i kodbasen och bor vara ryggraden i fortsatt implementation:

- `DocumentRecord`, `RequirementCase`, `RequirementRecord`, `RequirementMatrixRow`, `JudgmentRecord` och `LegalSourceRecord` i [schema.prisma](/Users/jimmy/Desktop/utvecklings arbete/Kod/Ny mapp/remix\_-copy-of-Miljobeslut.se-portal/prisma/schema.prisma)
- dokumentuppladdning och dokumentatkomst i [document.routes.ts](/Users/jimmy/Desktop/utvecklings arbete/Kod/Ny mapp/remix\_-copy-of-Miljobeslut.se-portal/server/routes/document.routes.ts)
- utkastgenerator for ansokningar i [documentGenerator.ts](/Users/jimmy/Desktop/utvecklings arbete/Kod/Ny mapp/remix\_-copy-of-Miljobeslut.se-portal/server/services/documentGenerator.ts)
- myndighetsinlamning och audit for tillstandsarenden i [permitAuthorityService.ts](/Users/jimmy/Desktop/utvecklings arbete/Kod/Ny mapp/remix\_-copy-of-Miljobeslut.se-portal/server/services/permitAuthorityService.ts)
- kommuninlamning i [municipalitySubmissionService.ts](/Users/jimmy/Desktop/utvecklings arbete/Kod/Ny mapp/remix\_-copy-of-Miljobeslut.se-portal/server/services/municipalitySubmissionService.ts)
- hash-chain och revisionsspar i [auditTrailService.ts](/Users/jimmy/Desktop/utvecklings arbete/Kod/Ny mapp/remix\_-copy-of-Miljobeslut.se-portal/server/services/auditTrailService.ts)
- legal ingest och matrisprojektion i [legalSourceIngestService.ts](/Users/jimmy/Desktop/utvecklings arbete/Kod/Ny mapp/remix\_-copy-of-Miljobeslut.se-portal/server/services/legalSourceIngestService.ts)
- PostGIS-spatial routing i [002_legal_source_spatial.sql](/Users/jimmy/Desktop/utvecklings arbete/Kod/Ny mapp/remix\_-copy-of-Miljobeslut.se-portal/prisma/spatial/002_legal_source_spatial.sql)

## Target Flow

```text
Kallor in
  -> legal ingest + dokumentingest
  -> arende och kravmodell
  -> dokumentmotor
  -> submissionsgateway
  -> myndighets/kommunsvar tillbaka
  -> matris + status + spårbarhet
  -> beslutsstöd och export
```

## Layer 1: Source Intake

Det forsta lagret samlar in underlag fran:

- dataportal
- domar och praxis
- kommunala diarier
- uppladdade dokument
- e-post och Outlook-floden
- direkta myndighets- eller kommuncallbacks

Regel:

- allting kommer in som sparbara artefakter
- inget far "bara lasas" och forsvinna
- varje inkommande artefakt maste fa `sourceSystem`, `externalId`, tidstampel, filreferens och normaliserad text

Malobjekt:

- `LegalSourceRecord` for externa rattskallor
- `DocumentRecord` for filer, beslut, forelagganden, bilagor och ansokningsutkast
- PostGIS-tabeller for geometriska dataset som ska ga att anvanda i analys

## Layer 2: Unified Case Spine

Plattformens verkliga nav ska vara ett sammanhallet arende, inte en samling filer.

Arenderyggraden bor besta av:

- `Project` som toppniva
- `RequirementCase` som juridiskt och processuellt arende
- `RequirementRecord` for konkreta krav, villkor, kompletteringar och atgarder
- `DocumentRecord` for allt som skickas eller tas emot
- `LegalSourceRecord` och `JudgmentRecord` som rattskallelagret
- `RequirementMatrixRow` som forklaringslager mellan rattskalla och praktiskt krav

Arkitekturregel:

- allt som skickas ut eller kommer tillbaka ska kunna bindas till exakt ett `Project` och minst ett `RequirementCase`
- om en inkommen handling inte kan kopplas automatiskt ska den till review queue, inte hamna los

## Layer 3: Document Engine

Dokumentmotorn ska ga fran "utkast" till "verifierad myndighetshandling".

Den bor arbeta i fyra steg:

1. `Draft`
   - maskinellt genererat underlag
   - tydligt markerat som utkast
   - ingen rattsverkan

2. `Review`
   - manuell kontroll av fakta, rattsgrund, bilagor, mottagare och versionslage
   - juridisk och verksamhetsmassig sign-off

3. `Submission package`
   - dokument + metadata + bilagor + avsandare + mottagare + referensnummer
   - fast payload som kan aterspelats i efterhand

4. `Registered outbound artifact`
   - exakt det som skickades lagras som ett sparbart objekt
   - hash, filstorlek, kanal, kvittens och utskicks-id sparas

Nuvarande [documentGenerator.ts](/Users/jimmy/Desktop/utvecklings arbete/Kod/Ny mapp/remix\_-copy-of-Miljobeslut.se-portal/server/services/documentGenerator.ts) ar en bra start for `Draft`, men malet ar att lagga till tydliga steg mellan utkast och officiellt utskick.

## Layer 4: Submission Gateway

For att dokument ska ga direkt till ratt kommun eller myndighet behovs ett enhetligt integrationslager.

Gatewayn bor ha denna modell:

- en gemensam `SubmissionEnvelope`
- adapter per kanal
- gemensamma statuskoder internt
- kanalberoende implementation externt

Kanaler:

- `REST`
- `EMAIL`
- `Webhook`
- `Portal/manual handoff`
- senare `e-tjanst` eller annan myndighetsstandard

Nuvarande [permitAuthorityService.ts](/Users/jimmy/Desktop/utvecklings arbete/Kod/Ny mapp/remix*-copy-of-Miljobeslut.se-portal/server/services/permitAuthorityService.ts) och [municipalitySubmissionService.ts](/Users/jimmy/Desktop/utvecklings arbete/Kod/Ny mapp/remix*-copy-of-Miljobeslut.se-portal/server/services/municipalitySubmissionService.ts) visar redan ratt riktning, men de bor samlas bakom en gemensam gateway med:

- gemensamt referensnummer
- gemensamt statusmaskineri
- samma auditmodell oavsett kanal

## Layer 5: Feedback Ingestion

Detta ar den viktigaste delen for att plattformen ska bli sjalvgenererande i praktiken.

Nar myndigheten eller kommunen svarar tillbaka ska plattformen kunna registrera:

- mottagningskvittens
- diarienummer
- beslut
- forelaggande
- kompletteringsbegaran
- villkor
- tidsfrist
- avslag eller bifall

Det ska alltid landa som:

- en ny `DocumentRecord` eller uppdatering av befintligt dokumentobjekt
- en statusforandring pa arendet
- en eller flera `RequirementRecord`
- vid behov nya `RequirementMatrixRow` om beslutet skapar nytt handlingskrav

Kallor for aterkoppling:

- webhook/API
- polling mot statusendpoint
- e-postingest
- manuell registrering med strukturerad skarm for fallback

Human-in-the-loop-regel:

- automatisk klassning far foresla "detta ar ett forelaggande" eller "detta ar ett beslut"
- en manniska maste godkanna innan klassningen far processuell verkan

## Layer 6: Traceability Model

For att plattformen ska vara juridiskt, miljomassigt och ekonomiskt sparbar maste varje slutsats kunna forklaras bakat.

Varje viktigt objekt ska kunna svara pa:

- vilken data anvandes
- vilken rattskalla eller praxis stodjer detta
- vilken geodata eller miljodata stodjer detta
- vilken version av dokumentet skickades
- vem godkande
- nar skickades det
- vilken myndighet tog emot det
- vilket svar kom tillbaka
- hur paverkades kostnad, risk och miljo

Detta krav pekar pa tre separata bevislager:

1. Juridiskt bevislager
   - `LegalSourceRecord`
   - `JudgmentRecord`
   - `RequirementMatrixRow`
   - dokumentcitaten och rattsgrunden

2. Miljobevislager
   - PostGIS-data
   - spatial audit
   - analyser som anvands i arendet

3. Ekonomiskt bevislager
   - kalkyler, kostnadsantaganden, transport- och provdata
   - tidsstamplade snapshots av ekonomisk bedomning

Auditkedjan i [auditTrailService.ts](/Users/jimmy/Desktop/utvecklings arbete/Kod/Ny mapp/remix\_-copy-of-Miljobeslut.se-portal/server/services/auditTrailService.ts) ar ratt princip for detta, men den bor konsekvent kopplas till alla outbound och inbound handelser.

## What "Self-Generating" Should Mean

Plattformen ska inte vara autonom i juridisk mening. Den ska vara sjalvgenererande i den begransade betydelsen att den kan:

- foresla underlag
- bygga utkast
- fylla paket med ratt bilagor
- foresla mottagare och kanal
- tolka inkommande svar till strukturerade forslag
- uppdatera matris, status och arbetslista

Men:

- den far inte ensam fatta myndighetsbeslut
- den far inte ensam skapa rattsverkan
- den far inte ensam faststalla tolkningar i tvistiga steg

Det ar darfor human-in-the-loop ska ligga i:

- fore officiell inlamning
- fore klassning av beslut/forelaggande med rattsverkan
- fore automatisk uppdatering av bindande krav

## Proposed Internal Domain Events

For att gora flodet robust bor plattformen behandla allt som handelser.

Karnhandelser:

- `DOCUMENT_UPLOADED`
- `LEGAL_SOURCE_INGESTED`
- `CASE_CREATED`
- `DRAFT_GENERATED`
- `REVIEW_APPROVED`
- `SUBMISSION_PREPARED`
- `SUBMISSION_DISPATCHED`
- `DELIVERY_CONFIRMED`
- `STATUS_CALLBACK_RECEIVED`
- `DECISION_DOCUMENT_RECEIVED`
- `FORELAGGANDE_RECEIVED`
- `MATRIX_UPDATED`
- `POSTGIS_DATA_BOUND`
- `ECONOMIC_SNAPSHOT_RECORDED`

Det gor att UI, notifieringar, audit och bakgrundsjobb kan lasa samma sanningskalla.

## Recommended Next Implementation Slices

### Slice 1: Persisted submission spine

Nuvarande myndighetsinlamning har delar som lever i minnet. Nasta steg bor vara att lagga till persistenta modeller for:

- `Submission`
- `SubmissionArtifact`
- `SubmissionStatusEvent`
- `AuthorityInboxEvent`

Mal:

- inget utskick eller myndighetssvar far endast finnas i processminnet

### Slice 2: Inbound decision pipeline

Bygg en gemensam pipeline for beslut och forelagganden som:

- tar emot dokument via upload, e-post eller webhook
- OCR:ar och klassificerar
- foreslar arendekoppling
- skapar reviewkort
- uppdaterar `RequirementCase` efter manuell godkannande

### Slice 3: Matrix from decision feedback

Nar beslut och forelagganden kommer tillbaka ska de kunna:

- skapa eller uppdatera `RequirementRecord`
- skapa ny arbetslista
- mappa tillbaka till `RequirementMatrixRow`
- visa vilka krav som ar rattsligt bindande, foreslagna eller upphavda

### Slice 4: Economic trace snapshots

Lag till en strukturerad modell for ekonomiska snapshots per arende:

- beraknad kostnad
- antaganden
- datakallor
- datum/version
- vem som godkande

Detta ar nodvandigt for att "ekonomiskt sparbar" ska vara sant i efterhand.

### Slice 5: Authority/municipality adapter registry

Samla dagens olika submission services bakom ett gemensamt register:

- kanaltyp
- autentisering
- callback/polling-stod
- bilagekrav
- regler per myndighet eller kommun

## Practical Definition of Done

Plattformen nar malbilden nar foljande kan demonstreras i samma arende:

1. systemet bygger ett utkast fran strukturerad data
2. en manniska granskar och godkanner
3. handlingen skickas till ratt mottagare
4. kvittens sparas
5. beslut eller forelaggande kommer tillbaka in i plattformen
6. beslutet kopplas till arendet
7. kravmatrisen uppdateras
8. anvandaren kan i efterhand se juridisk, miljomassig och ekonomisk beviskedja

## Bottom Line

Malet ar inte bara "skicka PDF till kommunen".

Malet ar ett sammanhallet processystem dar:

- varje handling har en livscykel
- varje beslut har ett ursprung
- varje krav kan forklaras
- varje geodataunderlag kan sparas tillbaka till arendet
- varje kostnadsbedomning kan revisionstestas

Det ar sa plattformen blir effektiv utan att tappa rattssakerhet.
