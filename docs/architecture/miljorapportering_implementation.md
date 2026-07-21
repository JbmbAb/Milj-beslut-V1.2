# Implementeringsunderlag: Miljorapportering

## Syfte

Detta dokument beskriver hur plattformen bor byggas ut for att underlatta arbete med miljörapportering enligt miljobalken och Naturvardsverkets foreskrifter, utan att blanda ihop arbetsstod, officiell inlamning och juridiskt bindande beslut.

Malet ar att plattformen ska kunna:

- samla rapportunderlag lopande under verksamhetsaret
- strukturera och kvalitetssakra uppgifter per anlaggning och rapportar
- generera tydliga utkast och exportfiler
- stodja manuell slutgranskning och attest
- forbereda inlamning till ratt kanal

## Regulatorisk utgangspunkt

Naturvardsverkets vagledning om miljörapportering visar att plattformen maste skilja pa:

1. ordinarie miljörapportering
2. kanalberoende inlamning via SMP eller annan myndighetsprocess
3. kompletterande rapportering som inte kan lamnas via SMP

Sarskilt viktigt ar att vissa uppgifter for verksamhetsaret 2025 enligt NFS 2016:8 ska rapporteras i en separat Excel-mall till tillsynsmyndigheten, med kopia till Naturvardsverket, och inte via SMP.

Arkitekturregel:

- plattformen far vara ett starkt arbetsstod
- men ska inte anta att all officiell miljörapportering kan skickas digitalt via en enda kanal

## Nulage i kodbasen

Foljande delar ar redan relevanta och bor ateranvandas i en framtida implementation:

- `server/services/documentGenerator.ts`
  - genererar DOCX-utkast med tydlig markering om att dokumentet ar maskinellt framtaget och maste verifieras manuellt
- `server/services/municipalitySubmissionService.ts`
  - visar etablerat monster for submissions, artefakter, statushistorik och fallback mellan olika kanaler
- `server/routes/ai.routes.ts`
  - ger sok- och sammanfattningskapacitet som kan anvandas for att hitta tidigare beslut, villkor och rapportunderlag
- `server/routes/compliance.routes.ts`
  - visar etablerat satt att skydda myndighetsnara floden bakom behorighet, rate limiting och audit
- `server/services/completionService.ts`
  - visar att plattformen redan arbetar med modulstatus och kan exponera beredskap for ny rapportmodul
- `server/datasources/catalog.ts`
  - markerar SMP som `PERMIT_REQUIRED`, vilket ar viktigt eftersom plattformen inte bor bygga sin forsta version pa antagandet om full SMP-integration

Detta innebar att grunden for dokument, export, audit och submission redan finns, men att det saknas en avgransad domanmodell for miljörapportering.

## Rekommenderad avgransning

Forsta versionen bor inte forsoka losa hela miljörapportkedjan pa en gang.

### Fas 1: Arbetsstod och export

Bygg en modul som:

- samlar rapportdata per verksamhet och rapportar
- visar checklistor och valideringsfel
- genererar rapportutkast
- exporterar Excel och PDF/DOCX-underlag
- skapar ett granskningsflode med attest

### Fas 2: Kanalanpassad inlamning

Bygg adapterlager for:

- SMP-delnar dar avtals- och behorighetslage tillater det
- separat Excel-inlamning via manuell handoff
- e-post- eller portalbaserad fallback till tillsynsmyndighet

### Fas 3: Aterkoppling och arshistorik

Bygg stod for:

- kvittenser
- kompletteringsbegaran
- diarienummer
- versioner per ar
- jamforelse mellan rapportar

## Malarkitektur

```text
Driftsdata / dokument / analysresultat
  -> miljörapportdomän
  -> validering mot rapportschema och regelkrav
  -> review + attest
  -> exportmotor
  -> kanaladapter
  -> kvittens / status / historik
```

## Ny domanmodul

En ny modul bor byggas under `server/modules/environmental-reporting/`.

Foreslagna delar:

- `domain/`
  - typmodeller for rapport, anlaggning, rapportperiod, datapunkt, attest och exportjobb
- `services/`
  - orkestrering, validering, mapping, export och kanalhantering
- `repositories/`
  - lagring av rapportutkast, versioner, status, attest och exporter
- `public.ts`
  - tydlig publik yta for routes och framtida integrationer

Detta foljer repo-regeln att ny funktionalitet inte ska laggas in i monoliten.

## Foreslagen datamodell

Nedan ar en rimlig minsta modell for framtida implementation.

### EnvironmentalReport

Ett rapportobjekt per verksamhet, anlaggning och rapportar.

Bor innehalla:

- `id`
- `projectId`
- `organisationId`
- `facilityName`
- `facilityIdentifier`
- `reportingYear`
- `reportType`
- `status` (`DRAFT`, `IN_REVIEW`, `APPROVED`, `EXPORTED`, `SUBMITTED`)
- `schemaVersion`
- `sourceChannel` (`SMP`, `EXCEL`, `EMAIL`, `MANUAL`)
- `approvedByUserId`
- `approvedAt`

### EnvironmentalReportSection

Sektioner i rapporten sa att plattformen kan spara delresultat stegvis.

Exempel:

- grunduppgifter
- driftdata
- utslapp
- avvikelser
- egenkontroll
- vattenateranvandning
- bilagor

### EnvironmentalReportDatum

Normaliserade datapunkter for export, diff och validering.

Bor innehalla:

- `sectionKey`
- `fieldKey`
- `valueJson`
- `unit`
- `sourceType`
- `sourceReference`
- `confidence`
- `requiresReview`

### EnvironmentalReportExport

Spårbar logg over genererade exportfiler.

Bor innehalla:

- filtyp
- mallversion
- hash
- genererad av
- genererad tid
- koppling till `DocumentRecord`

## UI-flode

Frontend bor byggas som en egen arbetsyta och inte som ett sidospår i befintliga permit-vyer.

Foreslaget flode:

1. Valj verksamhet och rapportar
2. Se status per sektion
3. Importera eller koppla underlag
4. Granska valideringsfel och avvikelser
5. Skapa utkast
6. Attestera
7. Exportera till vald kanal
8. Registrera inlamning och kvittens

Foreslagna vyer:

- `EnvironmentalReportingWorkspace`
- `EnvironmentalReportChecklist`
- `EnvironmentalReportReviewPanel`
- `EnvironmentalReportExportPanel`
- `EnvironmentalReportHistoryPanel`

## Datakallor och input

Miljörapportering bor inte bygga pa manuell fritext ensam. Modulen bor kunna mata in data fran flera typer av kallor:

- uppladdade dokument
- tidigare beslut och villkor
- interna drift- och kontrolluppgifter
- LIMS-resultat
- manuellt ifyllda vardefalt
- framtida integrationer mot verksamhetssystem

Varje datapunkt bor kunna forklaras i efterhand:

- varifran kom vardet
- nar importerades det
- vem andrade det
- maste det granskas manuellt

## Excel-strategi

Excel-export bor vara ett forstklassigt flode, inte en eftertanke.

Det ar sarskilt viktigt for de delar av miljörapporteringen som enligt myndighetsinstruktion ska skickas i separat mall.

Exportmotorn bor darfor kunna:

- mappa interna datapunkter till mallens celler eller kolumner
- lasa mallversion per rapporttyp
- validera att obligatoriska falt ar ifyllda fore export
- skapa en spårbar exportpost
- spara exakt vilken mallversion som anvandes

Arkitekturregel:

- interna falt ska inte hardkodas direkt mot ett visst Excel-ark i UI-lagret
- mappingen ska ligga i servermodulen och vara versionsstyrd

## SMP-strategi

SMP bor behandlas som en separat kanaladapter och inte som den centrala domanmodellen.

Skal:

- SMP ar markerad som `PERMIT_REQUIRED` i nuvarande katalog
- viss rapportering sker utanför SMP
- behorighet, avtal och tekniska grannssnitt kan variera over tid

Darfor bor forsta versionen leverera:

- SMP-redo datastruktur
- export- och granskningsstod
- manuell handoff dar integration inte ar tillganglig

Inte:

- bero pa full automatiserad SMP-inlamning for att vara anvandbar

## Human-in-the-loop

Miljörapportering ar ett omrade dar plattformen far foresla, sammanstalla och kvalitetssakra, men inte sjalv ta juridiskt slutansvar.

Obligatoriska gransser:

- AI-genererade sammanfattningar maste markeras som utkast
- kritiska falt maste kunna flaggas som `requiresReview`
- attest maste goras av behorig person
- exporterad rapport ska kunna sparas exakt som den lagmnades

Obligatorisk text i AI-genererat underlag:

`Human-in-the-loop: juridisk slutgranskning kravs`

## API-skisser

Foreslagna endpoints:

- `POST /api/environmental-reports`
- `GET /api/environmental-reports/:reportId`
- `PUT /api/environmental-reports/:reportId/sections/:sectionKey`
- `POST /api/environmental-reports/:reportId/validate`
- `POST /api/environmental-reports/:reportId/review-submit`
- `POST /api/environmental-reports/:reportId/approve`
- `POST /api/environmental-reports/:reportId/export/excel`
- `POST /api/environmental-reports/:reportId/export/docx`
- `POST /api/environmental-reports/:reportId/submissions`
- `GET /api/environmental-reports/:reportId/submissions`

Samtliga bor skyddas med samma grundprinciper som ovriga myndighetsnara floden:

- `requireAuth`
- projekt- eller organisationsbaserad behorighetskontroll
- rate limiting
- audit trail

## Foreslagen implementationsordning

1. Etablera domanmodell och repository for miljörapporter
2. Bygg sektionerad lagring och valideringsmotor
3. Koppla `DocumentRecord` och exportlogg
4. Leverera Excel-export med versionsstyrd mapping
5. Bygg review- och attestflode
6. Koppla submission spine for inlamning och kvittens
7. Lagg till kanaladapter per myndighetsflode efter behov

## Viktiga risker

### 1. Kanalrisk

Om implementationen byggs runt SMP for tidigt blir hela modulen beroende av behorigheter och externa grannssnitt.

### 2. Regelrisk

Falt och instruktioner kan andras mellan rapportar och foreskriftsversioner. Darfor maste schema- och mallversion vara explicit sparade.

### 3. Spårbarhetsrisk

Om exporter inte kopplas till en spårbar artefakt blir det svart att i efterhand visa vad som faktiskt lagmnades.

### 4. Produktgransrisk

Miljörapportering kan annars svalla till ett generellt verksamhetssystem. Modulen bor fokusera pa rapportunderlag, review, export och inlamningsspår.

## Rekommenderad forsta leverans

Den forsta verkligt nyttiga leveransen bor vara:

- skapande av rapport per verksamhetsar
- sektionerad datainmatning
- validering och checklista
- export till Excel-mall
- dokumenterat gransknings- och attestflode
- lagring av exportartefakt med audit

Det ger direkt verksamhetsnytta aven utan full SMP-integration.

## Slutsats

Plattformen har redan flera byggblock som gor miljörapportering till en naturlig nasta modul: dokumentutkast, audit trail, submission-spine, behorighetskontroller och sokbar kunskapsyta.

Det som saknas ar inte enstaka hjalpmetoder utan en tydlig doman for miljörapportering med:

- egen datamodell
- versionsstyrd export
- review och attest
- kanaloberoende arkitektur

Rekommendationen ar darfor att bygga miljörapportering som en separat modul med Excel-export som forsta prioritet och SMP som en senare adapter, inte som grunddesign.
