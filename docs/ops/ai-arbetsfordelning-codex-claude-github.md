# AI-arbetsfordelning: Codex, Claude och GitHub

Detta dokument delar upp arbetet mellan tre olika AI-ytor, sa att ratt verktyg används till ratt typ av uppgift i det har projektet.

Antagande i detta dokument:

- `Har` = Codex i denna terminal/session
- `Claude` = Anthropic/Claude for analys, review och specifikationer
- `GitHub` = GitHub Copilot lokalt i editorn eller GitHubs coding agent/PR-flode

Målet ar inte att alla tre ska gora allt, utan att minska overlap, felandringar och onodig handoff-friktion.

## Snabbregel

Anvand `Codex har` nar uppgiften beror pa databas, backend, integrationer, testkoring, incidentfelsokning eller andra systemgrejer som krav er helhetskontext.

Anvand `Claude` nar uppgiften framst ar analys, resonemang, kravtolkning, juridisk riskgenomgang, informationsstruktur eller beslut mellan flera losningar.

Anvand `GitHub` nar uppgiften ar lokal kodning i sma till medelstora steg: UI-polish, boilerplate, komponentarbete, enkla refaktorer, teststommar och PR-baserade andringar.

## Beslutstrad

1. Paverkar uppgiften live-DB, migreringar, backfill, externa API-nycklar, drift eller datasakerhet?
   Anvand `Codex har`.
2. Ar uppgiften att jamfora alternativ, skriva spec, gora juridisk eller metodisk kvalitetsgranskning, eller hitta blinda flackar?
   Anvand `Claude`.
3. Ar uppgiften mest lokal kodproduktion i en eller nagra filer, sarskilt frontend?
   Anvand `GitHub`.
4. Om uppgiften ar bade analys + implementation:
   Lat `Claude` ta fram beslutunderlag eller kravlista forst.
   Lat sedan `Codex` eller `GitHub` bygga beroende pa om det ar systemnara eller lokala andringar.

## 1. Codex har

### Bast lampad for (Codex)

- Databasanalys, Prisma, SQL, migreringar och repository-logik
- Backfill, indexering, OCR/textpipelines och andra batchjobb
- Serverrutter, auth, adminfloden och integrering mellan flera delar av systemet
- Externa API-integrationer med riktig verifiering
- Testkoring, lint, health-checks och reproducerbar felsokning
- Situationer dar nagon maste lasa hela repot och faktiskt utfora jobbet end-to-end

### Anvand Codex for detta repo nar du vill

- laga Lantmateriet, SLU, SMHI, VISS eller andra backendintegrationer
- analysera eller reparera DB-floden
- bygga admin- eller compliancefunktioner som spanner over frontend + backend + data
- verifiera vad som faktiskt fungerar lokalt, i loggar, i DB eller i tester
- gora saker som krav er human-in-the-loop och forsiktighet

### Ge inte Codex detta i forsta hand

- pixelpolish i en redan oppen React-komponent
- "gora snyggare knapp", spacing, hover eller ren layoutfinjustering
- langa brainstormingpass dar ingen kod ska skrivas

### Bra promptmall till Codex

```text
Analysera forst berorda filer och genomfor sedan andringen.
Fokus: [backend/db/integration/test/drift].
Viktigt i detta repo:
- kor aldrig full omindexering utan uttryckligt godkannande
- tolka fragor som fragor, inte kororder
- bekrafta innan jobb som kan ta mer an 5 minuter
- human in the loop ska finnas kvar
Leverera:
1. andring
2. verifiering
3. kort status/risk
```

## 2. Claude

### Bast lampad for (Claude)

- Kravtolkning och omvandling av losa ideer till tydlig specifikation
- Juridisk, regulatorisk och metodisk resonemangsgranskning
- Arkitekturjämforelser och tradeoff-analyser
- Genomlysning av blinda flackar, risker, antaganden och konsekvenser
- Forberedande arbete innan kodning borjar

### Anvand Claude for detta repo nar du vill

- jamfora olika produktionsvagar, till exempel Azure vs enklare drift
- skriva eller kvalitetssakra legal/compliance-underlag
- fa hjalp att dela upp stora problem i beslut, risk och arbetspaket
- gora granskning av produktreadiness, utvecklingslogik eller verksamhetsnytta
- skapa bra prompts/specar innan Codex eller GitHub ska bygga

### Ge inte Claude detta i forsta hand

- riktiga liveandringar i DB eller filer nar du behover verifierad exekvering
- felsokning som krav er terminal, loggar, tester eller lokala processer
- "gor detta i repot nu" om du faktiskt vill att nagot ska bli implementerat direkt

### Bra promptmall till Claude

```text
Jag vill att du fungerar som analys- och granskningssteg fore implementation.
Projekt: miljo/tillstand/compliance-plattform med PostgreSQL, Prisma, externa myndighets-API:er och human-in-the-loop.

Hjalp mig med:
1. beslut/rekommendation
2. viktigaste riskerna
3. konkret arbetsordning
4. kort spec/prompt som jag sedan kan ge till Codex eller GitHub

Om nagot ar juridiskt eller operativt kansligt, var extra strikt.
```

## 3. GitHub

### Bast lampad for (GitHub)

- Lokal editor-nara kodning med snabb iteration
- UI-komponenter, Tailwind, formularkoppling och mindre refaktorer
- Teststommar, snapshots, enklare mockning och upprepade kodmonster
- PR-baserade uppgifter som gar att paketera i ett issue eller en branch
- Smidiga "finish pass" efter att backendkontrakt redan ar satta

### Anvand GitHub for detta repo nar du vill

- bygga eller snygga till React-komponenter
- koppla ett befintligt API till ett formular eller en dashboard
- skriva standardiserad boilerplate i TypeScript
- stada en isolerad feature i nagra fa filer
- lata en coding agent jobba asynkront med en tydlig issue och oppna PR

### Ge inte GitHub detta i forsta hand

- komplexa DB-fixar med stor riskbild
- backfill-beslut, datakorrigering eller live-reparationer
- bred systemfelsokning dar flera subsystems maste tolkas ihop

### Bra promptmall till GitHub Copilot eller coding agent

```text
Implementera endast denna avgransade uppgift:
[beskrivning]

Ramar:
- andra inte databasflode eller batchjobb
- ror inte secrets eller driftkonfiguration
- hall dig till dessa filer: [lista]
- om backendkontrakt saknas, skapa inte nya utan markera blockering

Klart nar:
- komponenten fungerar
- riktade tester/lint passerar
- diffen ar liten och fokuserad
```

## Rekommenderad arbetsdelning i just detta projekt

### Lat Codex aga

- DB, Prisma, migrationsfrågor
- admin- och backfillfloden
- search/indexering
- myndighetsintegrationer
- driftfelsokning
- verifiering av nycklar, health och loggar

### Lat Claude aga

- produktionsstrategi
- compliance- och juridikresonemang
- roadmap, prioritering och riskmatriser
- granskningsunderlag for human review
- specar for stora ombyggnader

### Lat GitHub aga

- komponenter, vyer och layout
- enklare hookar och formularkoppling
- visuell polish
- sma refaktorer
- PR-bundna deluppgifter som gar att ge till en agent utan full systemkontext

## Codex-del for detta repo

Denna sektion gor `min del` konkret. Den ar till for att du snabbt ska kunna se vad Codex redan bor ha tagit, vad som bor tas har nast och vad som inte gar att avsluta utan manniska, avtal eller driftbeslut.

### Redan lampat till Codex och hanterat

- DB- och backfillanalys
- search/indexering och statusreparation
- adminyta for external health
- adminyta for case review
- SMHI backendintegration
- Lantmateriet OAuth-aktivering och live-verifiering
- Lantmateriet-fix for splitbeteckningar som `3:12>1`
- backendroute for dokumentuppladdning (`POST /api/documents/upload`)
- dokumentoppning, nedladdning och borttagning i arkivet
- staging-kompatibel Playwright-konfiguration med lokal/staging-smoke
- generisk staging-workflow med deploykommando, health-check och smoke-steg
- permit-adapter med tydlig overgang mellan `MOCK_QUEUED` och extern endpoint
- hardning av adminsession och bearer-token-fel
- kontroll av externa API-nycklar och healthsignaler

### Kvarvarande Codex-arbete som ar rimligt att gora har

- bygga eller harda systemnara backenddelar som fortfarande saknas
- koppla riktig staging-deploy nar plattform och secrets ar beslutade
- skriva eller skarpa tekniska tester for karnfloden
- laga backendfloden for verkliga integrationer dar endpoint och credentials finns
- slutverifiera systemhelheten efter att manuell granskning eller UI-arbete ar gjort

### Kvarvarande Codex-arbete som ar identifierat just nu

- staging-deploy hela vagen, inte bara workflow-skelett
- koppla staging-workflowet till faktisk plattform via `STAGING_DEPLOY_COMMAND`, `STAGING_URL` och riktiga secrets
- slutlig CI-korning mot verklig stagingmiljo efter att plattformen ar vald
- riktig permit-submit mot extern myndighetsendpoint nar kontrakt, authmodell och avtal finns
- eventuella kvarvarande compile-, drift- eller testluckor i helheten

### Inte Codex ensam

- manuell verifiering av minst 25 case
- juridiskt slutgodkannande av granskningsregler och compliancepastaenden
- val och uppkoppling av produktionsplattform, DNS, secrets och driftkonto
- avtalssparrade integrationer som BankID eller andra myndighetsnara tjanster

### Handoff fran Codex till manniska

- nar ett flode ar tekniskt klart men kraver manuell kontroll
- nar ett steg kraver riktig credential, avtal eller policybeslut
- nar juridisk hallbarhet maste bekraftas av manniska
- nar UI-polish ar viktigare an mer systemkod

### Handoff fran Codex till GitHub

- polish i React-komponenter efter att backendkontrakt ar satta
- mindre formularkopplingar och visuell forbattring
- lokala refaktorer i isolerade filer

### Handoff fran Codex till Claude

- nar du behover ett beslutunderlag innan implementation
- nar risk, juridik eller metod maste kvalitetssakras
- nar du vill jamfora flera strategier innan nagon bygger vidare

### Statusrad for Codex-delen just nu

Per senaste verifierade lokala lage ar Codex-delen `tekniskt langt kommen men inte slutstangd`.

Det som fortfarande hindrar full slutleverans av Codex-delen ar framst:

- manuell case-verifiering ar inte klar
- staging ar inte verkligt driftsatt
- full repo-typecheck ar fortfarande inte gron
- vissa slutfloden ar fortfarande beroende av externa endpoint- eller avtalsbeslut

Praktisk tumregel:

- om uppgiften krav er terminal, DB, server, loggar eller liveverifiering ar den fortfarande min
- om uppgiften krav er omdome, godkannande eller avtal ar den inte langre bara min

## Konkreta exempel

### Exempel A: Ny extern myndighetsintegration

- `Claude`: hjalp till att valja datakalla, risker, rate-limit-strategi och juridiska begransningar
- `Codex`: bygg service, route, test och health-check
- `GitHub`: bygg panelen som visar datat i UI

### Exempel B: Kravmodell och case review

- `Claude`: kvalitetssakra granskningsregler och manuell process
- `Codex`: bygg DB-logik, admin-endpoints, review-status och verifiering
- `GitHub`: bygg bekvam case-review-upplevelse i granssnittet

### Exempel C: Produktionsklar staging

- `Claude`: ta fram acceptanskriterier och readiness-checklista
- `Codex`: fixa secrets, health-checks, deploylogik och tekniska blockerare
- `GitHub`: mindre UI-fixar och eventuella CI/PR-justeringar

## Vad som inte ska blandas

- Lat inte tva AI-verktyg redigera samma osparade fil samtidigt.
- Lat inte GitHub ta DB-beslut som inte forst ar analyserade.
- Lat inte Claude vara enda kallan for om nagot faktiskt fungerar i kod eller drift.
- Lat inte Codex lagga tid pa pixelpolish som editorn loser snabbare.

## Praktisk rutin

1. Anvand `Claude` for att reda ut vad som borde goras.
2. Anvand `Codex` for det som maste implementeras eller verifieras pa riktigt.
3. Anvand `GitHub` for sista milen i kod och PR-polish.
4. Kom tillbaka till `Codex` for slutlig kontroll av helheten om andringen blev systemnara.

## Enkel minnesregel

- `Claude tankar`
- `Codex bygger och verifierar`
- `GitHub finslipar och paketerar`
