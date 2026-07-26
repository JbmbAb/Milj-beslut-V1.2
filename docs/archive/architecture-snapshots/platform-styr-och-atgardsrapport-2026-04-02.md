# Styr- och atgardsrapport for plattformen

Datum: 2026-04-02

Detta dokument kompletterar:

- `docs/architecture/ombyggnadsstrategi_bygga_nytt_bygga_ratt.md`
- `docs/architecture/modulregister_ombyggnad.md`
- `docs/architecture/development-governance.md`

Syftet ar att ga fran analys till styrning. Dokumentet definierar:

- systemkarta
- riskagare
- canonical regler for var ny kod far byggas
- rekommenderad arbetsordning per kvartal
- policy for ocommittade parallellspar

Detta dokument ar styrande tills det ersatts av en senare version.

---

## 1. Exekutiv riktning

Plattformen ska inte fortsatta utvecklas som tva likvardiga arkitekturer.

Beslut:

1. `src/` ar malarkitektur for ny funktionalitet.
2. `server/` ar fortsatt driftkritiskt, men betraktas som legacy- och adapterlager under migrering.
3. Ingen ny bred affarsfunktion far startas direkt i `server/` utan uttryckligt beslut.
4. Migrering ska ske featurevis och domanvis, inte via total omskrivning.
5. Juridiskt och operativt kritiska funktioner far inte flyttas utan verifierad ersattning.

Detta ar en strangler-strategi med styrd infasning, inte en big-bang-ombyggnad.

---

## 2. Systemkarta

### 2.1 Nulageskarta

| Lager                     | Primara sokvagar                                                                 | Funktion idag                                                           | Mognad                                | Styrbeslut                                                           |
| ------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------- |
| Frontend arbetsytor       | `app/`, `components/`                                                            | UI for arenden, kartor, projekt, admin, legal support                   | Medel                                 | Behall som produktyta men migrera featurevis till tydligare struktur |
| Legacy backend-nav        | `server/secureApi.express.ts`, `server/routes/*`, `server/services/*`            | Driver stor del av verklig produktlogik och integrationer               | Funktionellt stark, strukturellt tung | Stoppa okontrollerad breddning                                       |
| Ny plattformsyta          | `src/api`, `src/application`, `src/domain`, `src/infrastructure`, `src/platform` | Malarkitektur med renare kontrakt och ansvar                            | Strategiskt viktig men inte komplett  | Frys som canonical path for ny kod                                   |
| Datakarna                 | `prisma/`, `server/db`, `server/database`                                        | Gemensam datamodell for projekt, krav, dokument, audit, legal, logistik | Stark men bred                        | Forandras endast med domanmotivering                                 |
| Drift- och schedulerlogik | `server/index.ts`, utvalda `server/services/*`                                   | HTTP, jobs, maintenance, workers i samma process                        | Operativt skort                       | Bryt loss stegvis                                                    |
| Dokumentation och QA      | `docs/analysis`, `docs/architecture`, `docs/qa`, `docs/ops`                      | Haller ihop strategi, verifiering och driftkunskap                      | Stark men ojamt synkad                | Behall och koppla tydligare till faktisk kod                         |

### 2.2 Malbild

Malbilden ar att plattformen styrs av fem canonical karndomaner:

- `Project`
- `PermitCase`
- `Document`
- `Requirement`
- `Audit`

Och fyra kompletterande domangrupper:

- `GeoAssessment`
- `AuthoritySubmission`
- `StorageArea / MassFlow / Transport`
- `Compliance / Legal Intelligence`

### 2.3 Trafikregler mellan lager

Tillaten riktning:

1. UI anropar API eller klientlager.
2. API anropar application/use cases.
3. Application anropar domain och infrastructure interfaces.
4. Infrastructure adaptrar pratar med Prisma och externa system.

Ej tillaten riktning:

- UI direkt till Prisma
- UI direkt till externa API:er for produktkritiska floden
- domain direkt till externa integrationer
- ny affarslogik direkt in i `server/secureApi.express.ts`

---

## 3. Riskagare

Riskagare anges som roller, inte personnamn. Roller kan mappas till faktiska personer separat.

| Riskomrade               | Riskbeskrivning                                       | Primar riskagare             | Medagare                    | Trigger for eskalering                             |
| ------------------------ | ----------------------------------------------------- | ---------------------------- | --------------------------- | -------------------------------------------------- |
| Arkitekturell dubblering | Samma feature byggs i `server/` och `src/` samtidigt  | Tekniskt ansvarig / arkitekt | Produktagare                | Ny feature saknar canonical hemvist                |
| Legacy-navet             | `server/secureApi.express.ts` fortsatter samla ansvar | Backendansvarig              | Arkitekt                    | PR lagger till ny stor affarslogik i legacy        |
| Drift i en process       | HTTP, workers och maintenance sitter ihop             | Driftansvarig                | Backendansvarig             | Ny scheduler eller ny worker laggs i huvudprocess  |
| Datamodellens bredd      | Ad hoc-falt och tabeller okar kopplingsgraden         | Data-/domanansvarig          | Arkitekt                    | Prisma-forandring saknar domanmotivering           |
| Juridisk hallbarhet      | AI eller automation glider over i beslutande funktion | Produktagare                 | Compliance / juridik        | Flode saknar human-in-the-loop                     |
| Testflakighet            | Gron pipeline men timingkansliga tester               | QA-ansvarig                  | Frontendansvarig            | Flakey test i CI eller intermittent lokalt fel     |
| Parallella arbetspar     | Ocommittade refaktorer och featurearbete blandas      | Repoansvarig                 | Alla delagare               | Arbetsytan ar blandad over flera domaner samtidigt |
| Dokumentationsglapp      | README, arkitektur och faktisk plattform driver isar  | Produktagare                 | Teknisk skribent / arkitekt | Nya delsystem saknar styrande dokumentation        |

---

## 4. Regler for vad som far byggas i `server/` respektive `src/`

### 4.1 `src/` ar default for ny kod

Ny kod ska byggas i `src/` om den uppfyller minst ett av dessa:

- introducerar ny affarskapabilitet
- etablerar ny domanmodell eller use case
- definierar nya API-kontrakt
- ersatter legacyfunktion stegvis
- bygger ny infrastructure-adapter med tydligt interface

Tillatet i `src/`:

- `domain`-modeller och regler
- `application`-use cases
- `api`-controllers och schemas
- `infrastructure`-repositories och adapters
- `platform`-services for health, observability och plattformsfunktioner

Ej tillatet i `src/`:

- snabbfixad demo-logik utan agarskap
- okontrollerad koppling direkt till UI-specialfall
- ny logik som bara speglar legacy utan forenklad modell

### 4.2 `server/` ar restriktivt tillatet under migrering

Tillatet i `server/`:

- bugfixar i befintliga floden
- sakerhetsfixar
- adapterkod som maste hallas igang for drift
- observability, loggning och incidentskydd for existerande funktion
- tunna compat-routes som pekar vidare mot ny implementation

Ej tillatet i `server/` utan uttryckligt beslut:

- nya stora affarsfloden
- nya produktmoduler
- ny central affarslogik i `secureApi.express.ts`
- nya schedulerjobb i huvudprocessen om de kan byggas separat
- ny dataorkestrering som saknar migrationsplan till `src/`

### 4.3 Praktisk granskningsregel

Varje PR som ror `server/` ska svara pa tre fragor:

1. Varfor kan detta inte ligga i `src/`?
2. Ar detta bugfix/compat eller ny funktion?
3. Vad ar den senare migrationsvagen?

Om PR:n inte kan svara pa det, ska den stoppas eller brytas upp.

---

## 5. Canonical featureindelning

Foljdande featuregrupper ar canonical for vidare arbete:

| Featuregrupp                    | Canonical hemvist                                                               | Kommentar                            |
| ------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------ |
| Projekt och projektplan         | `src/domain/project`, `src/application/project`, `src/api/project*`             | Hoger prioritet                      |
| Tillstand / PermitCase          | `src/domain/permit`, `src/application/permit`, `src/api/permit*`                | Hoger prioritet                      |
| Dokument och upload             | `src/domain/document`, `src/application/document`, `src/api/document*`          | Hoger prioritet                      |
| Krav / requirement model        | `src/domain/requirement`, `src/application/requirement`, `src/api/requirement*` | Hoger prioritet                      |
| Audit, GDPR, access             | `src/domain/audit`, `src/application/audit`, `src/platform/*`                   | Skyddad karndoman                    |
| Geo / kartbedomning             | `src/domain/geo`, `src/application/geo`, adapters i `src/infrastructure/*`      | Byggs efter karnfloden               |
| Logistik / massor               | `src/domain/logistics`, `src/application/logistics`                             | Byggs efter projekt- och permitkarna |
| Legal intelligence / compliance | `src/domain/compliance`, `src/application/compliance`                           | Ska styras av verifierbara regler    |

---

## 6. Kvartalsvis arbetsordning

Denna ordning ar avsedd att minska samtidiga generationsskiften.

### Kvartal 1: Styrning och canonical boundaries

Mal:

- sluta expandera utan arkitekturregler
- definiera vilka moduler som ar canonical
- minska risken for ny skuld

Leverabler:

- denna rapport fastslagen
- README och huvuddokumentation uppdaterad till faktisk produktbild
- explicit PR-regel for `server/` kontra `src/`
- lista over domankritiska legacy-floden som inte far brytas

Exit-kriterier:

- minst en godkand regel for "ny kod i `src/`"
- inga nya stora feature-PRs som landar direkt i legacy-navet

### Kvartal 2: Karndomaner och API-kontrakt

Mal:

- gora `src/` till verklig ryggrad, inte bara ambition

Leverabler:

- canonical kontrakt for `Project`, `PermitCase`, `Document`, `Requirement`, `Audit`
- repositories och use cases for minst tva av dessa domaner
- compat-vag mellan legacy routes och ny implementation dar det ar mojligt

Exit-kriterier:

- minst en aktiv produktfeature drivs delvis via `src/`
- ingen ny databasforandring utan domanmotivering

### Kvartal 3: Driftseparering och featuremigrering

Mal:

- minska operativ risk och bryta ut processansvar

Leverabler:

- separat hantering for workers och maintenance-jobb
- tydlig ownership for scheduler och background jobs
- migrering av en featuregrupp till ny struktur, forslagsvis `Document` eller `Requirement`

Exit-kriterier:

- huvudprocessen bar mindre ansvar an vid start
- minst ett legacy-flode har strangler-ersatts

### Kvartal 4: Produktforenkling och borttagning

Mal:

- ta bort dubbla implementationer och rensa ytor som inte langre ar canonical

Leverabler:

- arkivering eller borttagning av ersatta legacy-delar
- testsvit och observability knutna till ny struktur
- reviderat modulregister baserat pa faktisk migration

Exit-kriterier:

- minst en domangrupp ar helt canonical i ny struktur
- legacy-navet har minskat i ansvar, inte bara i ambition

---

## 7. Policy for ocommittade parallellspar

Nulaget med flera samtidiga lokala spar ar en faktisk processrisk. Foljande policy galler:

### 7.1 En branch eller ett spar per sammanhallen forandring

Tillatet:

- en refaktorbranch for en featuregrupp
- en bugfixbranch for ett avgransat problem
- en docs-branch for styrning och analys

Ej tillatet:

- att samma arbetsyta samtidigt innehaller halvfardig adminrefaktor, ny domankod och orelaterade UI-fixar utan tydlig grans

### 7.2 Ocommittad kod far inte vara permanent backlog

Regel:

- ocommittade andringar ska inom kort bli ett av tre: commit, arkivera, kassera

Om ett arbetspar inte kan beskrivas med en mening, ar det for brett.

### 7.3 Maximal bredd i ett aktivt spar

En aktiv andringsyta far normalt inte samtidigt spanna over fler an:

- 1 featuregrupp
- 1 primar kodniva, eller
- 1 tydlig migration

Exempel pa godkand bredd:

- `Document`-migrering i `src/` + tunna compat-andringar i `server/`

Exempel pa for bred bredd:

- admin-UI, legal ingest, styling och schedulerfix i samma ocommittade spar

### 7.4 Krav vid analys- eller styrdokument

Nar nya analys- eller styrdokument skapas ska de:

- ligga i `docs/analysis` eller `docs/architecture`
- ha datum i filnamn om de ar snapshots
- peka pa vilka dokument de kompletterar

### 7.5 Arbetsyta som stoppvillkor

Arbetsytan ska stoppas for fortsatt featurearbete om:

- flera stora ocommittade spar korsar varandra
- det inte gar att se vilken struktur som ar canonical
- en analys inte kan skilja mellan "lokal experimentkod" och "riktig produktkod"

I det laget ska fokus byta till stadrunda och uppdelning.

---

## 8. Beslutsregler for databas och externa integrationer

### 8.1 Databasforandringar

Databasforandringar maste alltid motiveras av doman, inte av tillfallig UI-form.

Krav:

- vilken doman tillhor forandringen
- vilket use case kravs
- om forandringen ar transitional eller canonical

Ej godtagbart:

- nya falt eller tabeller "for att UI:t behovde det snabbt"

### 8.2 Externa integrationer

Alla nya integrationer ska byggas som adapters med:

- tydligt ansvar
- fallback
- timeoutstrategi
- loggning
- mojlighet till mockning i test

Ingen ny integration far introducera dold affarslogik direkt i adapterlagret.

---

## 9. Kvalitets- och stoppregler

Ut over befintliga kvalitetsgrindar ska foljande stoppregler galla:

Stoppa merge om:

- ny feature laggs i `server/` utan motiv
- samma use case byggs parallellt i `server/` och `src/`
- README eller huvudarkitektur driver isar fran faktisk implementation
- ny scheduler eller worker laggs i huvudprocess utan beslut
- domankritisk funktion flyttas utan test- och fallbackplan

Tillat merge om:

- PR:n minskar dubblering
- PR:n flyttar ansvar fran legacy till ny canonical yta
- PR:n dokumenterar migration eller compat-vag
- PR:n isolerar driftansvar eller gor kodens hemvist tydligare

---

## 10. Rekommenderad nasta arbetssekvens

Denna rapport ska inte foljas av ytterligare bred analys som forsta steg. Den ska foljas av styrd exekvering.

Rekommenderad ordning:

1. Fastsla denna rapport som styrdokument.
2. Uppdatera `README.md` sa att den beskriver verklig plattform.
3. Definiera ett kort PR-template-tillagg med regler for `server/` respektive `src/`.
4. Valj en forsta canonical migreringskandidat:
   - `Document`
   - `Requirement`
   - eller `PermitCase`
5. Dokumentera en konkret strangler-plan for den kandidaten.
6. Forst darefter: fortsatt featureutveckling.

---

## 11. Slutligt styrbeslut

Plattformen far fortsatt utvecklas, men inte langre som flera jamstallda riktningar samtidigt.

Detta dokument faststaller darfor:

- `src/` ar malarkitektur
- `server/` ar legacy/adapter under migrering
- featuremigrering sker domanvis
- driftansvar ska separeras over tid
- ocommittade parallellspar ska minskas aktivt

Om dessa regler inte foljs kommer plattformen sannolikt fortsatta fungera kortsiktigt men bli svarare att drifta, granska och forandra.

Om reglerna foljs finns en realistisk vag till en renare, mer styrbar och mer juridiskt hallbar produktkarna.
