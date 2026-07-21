# Ombyggnadssegi: Bygga Nytt, Bygga Ratt

Detta dokument beskriver hur plattformen kan byggas om pa ett kontrollerat satt med maximal ateranvandning av det som ar bra i dagens losning, men utan att dra med historisk komplexitet, utvecklingsspår eller teknisk skuld in i nasta generation.

Malet ar inte en total omskrivning utan styrning mot en ny, ren produktkärna med tydliga kontrakt, juridisk hallbarhet och lag risk vid migrering.

---

## 1. Rekommendation i korthet

Rekommendationen ar att bygga en ny produktkarna och migrera in fungerande delar stegvis.

Det som ska ateranvandas:

- domanmodeller och begrepp
- regelmotorer som ar begripliga och verifierbara
- repository- och service-monster som ar tydliga
- API-kontrakt som redan fungerar i praktiken
- tester som beskriver verkligt onskat beteende
- dokumentation om process, juridik, integrationer och affarslogik

Det som inte ska flyttas over okritiskt:

- historiska specialfall
- utvecklingsspecifika artefakter
- temporara integrationer och backupfloden
- UI-texter, testforvantningar och struktur som vuxit fram av tillfalligheter
- moduler som saknar tydligt agarskap eller kontrakt

Strategin ar alltsa:

1. Bygg nytt.
2. Kopiera det bra som mall.
3. Migrera funktion for funktion.
4. Lamna gammal kod orord tills ersattning finns.

---

## 2. Hur komplex ar processen?

Komplexiteten ar medelhog till hog, men fullt genomforbar om den delas upp korrekt.

Tre realistiska nivaer:

- Niva A, ren Core-karna:
  auth, projekt, dokument, kravmotor, audit, grundlaggande integrationer.
  Detta ar en medelhog process.
- Niva B, produktionsbar plattform:
  Core-karna plus GIS, masslogistik, scoring, schedulerjobb, export och driftstod.
  Detta ar hog komplexitet men hanterbart med tydlig fasindelning.
- Niva C, total full omskrivning av allt samtidigt:
  detta ar onodigt riskabelt och bor undvikas.

Min bedomning ar att Niva B ar ratt malbild, men att den maste genomforas via Niva A forst.

---

## 3. Vad den nya plattformen ska bestå av

Den nya losningen bor ha sex tydliga lager.

### 3.1 Domankarna

Detta ar hjartat i systemet och ska vara oberoende av UI, databas och externa API:er.

Karnobjekt:

- Project
- Organization
- User
- PermitCase
- Requirement
- RequirementSource
- Document
- AuditEvent
- StorageArea
- MassFlow
- ComplianceAssessment
- IntegrationStatus

Regler:

- all affarslogik skrivs mot dessa modeller
- inga UI-beroenden i domankarnan
- inga direkta fetch-anrop i domankarnan
- alla viktiga tillstand ska kunna serialiseras och loggas

### 3.2 Applikationstjanster

Detta lagret koordinerar use cases.

Exempel:

- CreateProject
- ImportDocument
- AnalyzeRequirements
- GenerateComplianceAssessment
- RegisterStorageArea
- CalculateMassFlow
- SubmitPermitToAuthority
- GenerateReport

Regler:

- exakt ett ansvar per use case
- input och output styrs av schemas
- human-in-the-loop markeras explicit i varje arbetsflode

### 3.3 Adapterlager

Alla beroenden mot omvarlden ska bo har.

Exempel:

- Prisma repositories
- Outlook / Graph
- Lantmateriet
- SGU
- SLU
- SMHI
- Naturvardsverket
- Transportprovider
- BankID
- DOCX / PDF export

Regler:

- inga adapters far innehalla central affarslogik
- varje adapter ska kunna ersattas eller mockas
- fallback-lagen ska vara tydliga och observerbara

### 3.4 API-lager

Detta ar det enda lagret som webklient eller externa klienter ska prata med.

Krav:

- versionshanterade endpoints
- zod eller motsvarande kontraktsvalidering
- enhetliga felobjekt
- tydlig auth- och behorighetsmodell

### 3.5 Frontend

Frontend ska byggas som en klient till den nya applikationskarnan, inte som platsen dar affarslogiken bor.

Krav:

- tunna vykomponenter
- datahamtning via definierade API-hooks eller klienter
- minimal dold lokal logik
- features grupperade per doman, inte per slumpmassig skarm

### 3.6 Plattform och observability

Detta lagret ska ge driftbarhet.

Krav:

- health endpoints
- scheduler-status
- audit trail
- felspårning
- integrationsstatus
- backup- och retentionregler

---

## 4. Vad som ska ateranvandas som mall

### 4.1 Ateranvands i princip

- bra typer och kontrakt
- repository-interface dar ansvar ar tydligt
- services dar logiken ar ren och avgransad
- auditspar och loggmonster
- exportfloden som faktiskt motsvarar affarsbehov
- testfall som verifierar riktig verksamhetslogik

### 4.2 Ateranvands efter omskrivning

- integrationsmoduler
- Gemini- eller AI-relaterade floden
- schedulerlosningar
- scoring- och compliancekod
- masslogistikmoduler
- GIS-analysfloden

Dessa bor inte kopieras rakt av. De bor brytas isar till:

- kontrakt
- domanlogik
- adapter
- test

### 4.3 Ska inte folja med som aktiv produktkod

- utvecklings- och presentationsspår
- tillfalliga tmp-filer och backupskript
- gammal testkod som bara jagar UI-text
- features som saknar tydligt affarscase
- mode-switches som inte langre har aktiv anvandning

---

## 5. Vad som ska byggas forst

Byggordningen ar viktigare an val av ramverk.

### Fas 0: Beslutsfrysning

Syfte:

- definiera vad som faktiskt ar produkt
- skilja produkt, experiment, arkiv och utvecklingsmaterial
- faststalla juridiska och operativa minimikrav

Leverabler:

- produktkarta
- modulregister
- dataklassificering
- lista over human-in-the-loop-beslut

### Fas 1: Ny domanmodell

Syfte:

- bygga ren modell for karndatan

Leverabler:

- nya TypeScript-typer
- domanregler
- statusmodeller
- auditmodeller

### Fas 2: Ny API-kontraktmodell

Syfte:

- stoppa kontraktsdrift mellan klient, service och databas

Leverabler:

- request- och response-schema
- enhetliga felformat
- API-versionering

### Fas 3: Ny datakarna

Syfte:

- bygga datalagret runt domanmodellen, inte tvartom

Leverabler:

- ny Prisma-modell eller motsvarande
- migreringsplan
- repositories med tydliga interface

### Fas 4: Use cases

Bygg de viktigaste flodena forst:

1. autentisering och organisation
2. projekt
3. dokumentimport
4. kravextraktion
5. lagring av beslut och krav
6. rapportering

### Fas 5: Risk- och integrationsmoduler

Nar karnan ar stabil:

- GIS
- masslogistik
- scoring
- schedulerjobb
- myndighetsinlamning
- bank- och compliancefloden

### Fas 6: Ny frontend ovanpa ny API-yta

Frontend migreras sist eller parallellt i sma delar, aldrig som stor omkoppling pa en gang.

---

## 6. Migreringsstrategi med lag risk

Den nya plattformen bor byggas parallellt med den gamla.

### 6.1 Ingen big-bang

Vi ska inte forsoka "fixa allt i befintlig kod" och vi ska inte heller stanga av gammal produkt innan ny motsvarighet finns.

### 6.2 Strangler-pattern

Den gamla losningen fortsatter leva medan ny funktion tar over stegvis.

Exempel:

- gammal endpoint finns kvar
- ny endpoint byggs bredvid
- trafik flyttas modulvis
- gamla implementationen pensioneras efter verifiering

### 6.3 Adapter for gammal data

Gammal data ska inte migreras blint.

Istallet:

- bygg en lasadapter mot gammalt schema
- normalisera till ny domanmodell
- migrera verifierad data i batcher

### 6.4 Verifiering per steg

Varje migrerad modul maste verifieras med:

- kontraktstest
- domantest
- integrationsprov
- manuell verksamhetsgranskning

---

## 7. Juridisk och operativ designprincip

Ombyggnaden maste designas for juridisk hallbarhet, inte laggas pa i slutet.

Det betyder:

- AI far assistera men inte ensam besluta i juridiska slutsatser
- kaellor och underlag maste vara spårbara
- alla automatiska bedomningar ska kunna granskas i efterhand
- status, risk och rekommendation ska vara forklarbara
- personuppgifter, myndighetsdata och exportfloden maste ha tydliga ansvarspunkter

Human-in-the-loop ska vara explicit i:

- dokumentpublicering
- myndighetsinlamning
- regulatorisk slutsats
- riskklassning med affars- eller juridisk konsekvens

---

## 8. Om jag skulle bygga om det

Jag skulle inte borja i UI:t.

Jag skulle gora sa har:

1. Kartlagga faktisk produktkarna och kasta brus.
2. Bygga ny domanmodell och nya API-kontrakt.
3. Skapa nytt datalager med ren repositorystruktur.
4. Flytta over ett use case i taget.
5. Satta upp audit, schedulerstatus och integrationsstatus tidigt.
6. Lata ny frontend tala bara med ny API-yta.
7. Flytta gammal kod till arkiv eller adapter nar ersattning finns.

Jag skulle ocksa medvetet undvika:

- att flytta over all testkod rakt av
- att ateranvanda UI-struktur bara for att den redan finns
- att blanda produktkod med researchmaterial
- att laga vidare pa varje gammal modul innan malarkitekturen ar bestamd

---

## 9. Praktisk malbild for detta repo

En realistisk malbild ar att införa en ny struktur bredvid dagens kod.

Exempel:

```text
src/
  domain/
  application/
  infrastructure/
  api/
  ui/
  platform/

legacy/
  old-services/
  old-tests/
  archived-adapters/
```

Eller, om repo:t ska fortsatta vara uppdelat mellan klient och server:

```text
server/
  domain/
  application/
  infrastructure/
  api/
  platform/

client/
  features/
  shared/
  app/

legacy/
archive/
```

Det viktiga ar inte exakt mappnamn utan att:

- domanlogik skiljs fran adapters
- API skiljs fran UI
- legacy skiljs fran aktiv produkt

---

## 10. Beslutsrekommendation

Den mest rationella vagen ar:

- fortsatta drifta nuvarande losning kortsiktigt
- bygga ny produktkarna parallellt
- ateranvanda bra kod som mall och kontrakt
- migrera stegvis
- undvika total omskrivning i ett svep

Det ger bast kombination av:

- teknisk kvalitet
- juridisk hallbarhet
- lagre konfliktkostnad
- battre testbarhet
- mindre beroende av historiska kompromisser

---

## 11. Nasta konkreta steg

Om arbetet ska startas direkt bor nasta leverabler vara:

1. ett modulregister: behall, bygg om, arkivera, kassera
2. en ny malarkitektur for server och klient
3. ett minimalt domanschema for Project, PermitCase, Requirement, Document och AuditEvent
4. en migreringsordning modul for modul
5. en teknisk avgransning for version 1 av nya karnan

Det ar dar det verkliga ombyggnadsarbetet bor borja.
