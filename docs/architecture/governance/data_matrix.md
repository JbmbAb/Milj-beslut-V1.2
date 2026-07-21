# Dataklassning & modulägarskap

**Syfte:** En levande matris för _vem som får ändra vad_ och _vilken känslighetsklass data har_. Underlag för DPIA, åtkomstgranskning och kommande ESLint-gränser.

**Status:** Baslinje 2026-04-26 — uppdatera vid nya moduler, tabeller eller AI-flöden.

**Relaterat:** [ADR-005: Vertex AI Data Minimization](../ADR-005-vertex-ai-data-minimization.md), [source-of-truth-and-decision-layer](../source-of-truth-and-decision-layer.md).

---

## 1. Känslighetsklasser (data tags)

| Klass                       | Kod         | Definition (operativ)                                                                                                                                                             | Riktlinje mot LLM (Vertex)                                                                                                       |
| --------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Öppen geodata**           | `OPEN_GEO`  | Offentlig eller avgiftsfri geodata utan direkt koppling till identifierbara personer i prompten (t.ex. aggregerad marktyp, allmän topografi, Natura-polygon som offentlig källa). | Tillåtet i prompt **endast** efter ADR-005 (ingen onödig precision som möjliggör återidentifiering).                             |
| **Affärssekretess**         | `BUSINESS`  | Kundens ärenden, dokumentinnehåll, interna bedömningar, organisationsdata som inte är offentliga.                                                                                 | **Ej** i fri prompt; endast via **minimerade utdrag** / verktygsspår enligt policy; juridisk granskning vid nya användningsfall. |
| **Personuppgift (PII)**     | `PII`       | Direkta eller indirekta personuppgifter: användaridentitet, namn, kontakt, BankID-koppling, kombinationer som sällan unika platser + ägare, etc.                                  | **Förbjudet** i LLM-prompt enligt ADR-005 (maskera/pseudonymisera först).                                                        |
| **Myndighets-/processdata** | `AUTHORITY` | Diarier, handläggarspår, beslutstexter som kan innehålla tredje parts PII eller sekretess.                                                                                        | Behandlas som minst `BUSINESS`, ofta `PII`-risk; minimering och källcitering.                                                    |

_Juridisk slutbedömning görs alltid utöver denna tabell._

---

## 2. PostGIS: schema → primär ägarmodul

_“Ägare” = ansvarar för läs/skriv-kontrakt, smoke, och att inga andra moduler skriver utan samråd. Andra moduler kan **läsa** via definierade API:er._

| Schema          | Typiskt innehåll                                                                      | Primär ägarmodul (`server/modules/`)                                          | Anmärkning                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **`env`**       | SGU-lager, Natura 2000, skyddad natur, marktäcke-raster (`marktacke`), m.m.           | **`gis`**                                                                     | Versioneras i `prisma/spatial/*`; anrop via services som `geoService`, `markCoverService`, `spatialAuditService`. |
| **`core`**      | Fastighetsenheter (`property_unit`), Lantmäteriet Topo10-lager (`lm_*` enligt import) | **`property`** (geometri/identifierare) + **`gis`** (kartlager, intersection) | Fastighetsbeteckning kan vara **känslig i kombination** med kundkontext — klassa per flöde.                       |
| **`legal`**     | `legal.source_dataset` m.m.                                                           | **`legal`**                                                                   | Spatial landing för rättskällor; metadata ofta även i Prisma (`LegalSourceRecord`).                               |
| **`staging`**   | Tillfälliga ops/importytor                                                            | **Plattform/ops** (ingen produktmodul)                                        | Får inte bli produktionens “tysta” skrivyta utan styrning.                                                        |
| **`culture`\*** | Kulturhistorisk geodata (RAA m.m., omnämns i ingest-flöden)                           | **`gis`** / **`legal`** beroende på källa                                     | Exakt ägarskap per tabell — fyll på när tabeller är aktiva i drift.                                               |

\* _Uppdatera rad när alla `culture._`-tabeller är spårade i repo.\*

---

## 3. Prisma-domän (logisk) → modulägarskap

_Grovmappning: “ägare” = modul vars `adapters`/`commands` primärt muterar dessa entiteter._

| Domän / modeller (urval)                                                                        | Primär ägarmodul                                                     | Klass (typisk)                                              |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| `User`, `Organisation`, `TokenRevocation`, `RateLimitEntry`                                     | **`auth`**, **`organisation`**                                       | `PII` / `BUSINESS`                                          |
| `Project`, `ProjectMember`, `ProjectPlanState`, `PropertyAccessLog`                             | **`project`**                                                        | `BUSINESS` (+ ev. `PII` i loggar)                           |
| `DocumentRecord`, `DocumentContent`, `DocumentChunk`, sökjobb                                   | **`documents`**, **`search`**                                        | `BUSINESS` (innehåll kan vara `AUTHORITY`)                  |
| `RequirementCase`, `RequirementRecord`, `RequirementCitation`                                   | **`requirements`**                                                   | `BUSINESS` / `AUTHORITY`                                    |
| `CaseSnapshot`, `EvidenceExport`, relaterade queries                                            | **`evidence`**                                                       | `BUSINESS` / `AUTHORITY`                                    |
| `Submission`, `SubmissionArtifact`, `SubmissionStatusEvent`                                     | **`sewage`**, **`platform`** (beroende på route)                     | `BUSINESS` / `AUTHORITY`                                    |
| `AuditTrail`                                                                                    | **`audit`**                                                          | `BUSINESS` (spårbarhet)                                     |
| `LegalSourceRecord`, `JudgmentRecord`, matrisrader kopplade till legal                          | **`legal`**                                                          | Ofta `OPEN_GEO` (metadata) + `AUTHORITY` (fulltext)         |
| `KnowledgeNode`, `KnowledgeEdge`, `ExtractedRequirement`                                        | **`ai`** + ingest (e-post)                                           | `BUSINESS`; mot Vertex se ADR-005                           |
| `DecisionCase`, `DecisionCaseRequirement`, `MunicipalityDecisionProfile`, `DecisionRiskFeature` | **Plattform analytics** (egen modul eller `platform` tills uppdelad) | Aggregerat: ofta `BUSINESS`; rader kan innehålla `PII`-risk |
| `PipelineRun` / ingest                                                                          | **Ingest/ops** + berörda moduler                                     | `BUSINESS`                                                  |

_För full lista: se `prisma/schema.prisma`. **Anmärkning (2026-05):** Databasrevision visar att modeller som `DocumentContent`, `RequirementRecord` och `KnowledgeNode` är definierade men ännu inte materiellt befolkade med data. Denna matris beskriver ägarskapet för modellerna, inte nuvarande datavolym._

---

## 4. AI / “dossier”-lager (prompter, RAG, generatorer)

Det finns ingen separat mapp `dossier` i `server/modules/`. Funktionellt motsvaras **dossier-lik** hantering av:

| Komponent                      | Plats                                              | Ägarskap                       | Dataklass mot Vertex                                                             |
| ------------------------------ | -------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------- |
| RAG / semantisk sök            | `server/modules/ai/public.ts` → `ragSearchService` | **`ai`**                       | Endast minimerade utdrag; se ADR-005                                             |
| Exec summary-kö                | `execSummaryQueueService`                          | **`ai`**                       | `BUSINESS`                                                                       |
| Tillstånds-/generator-API      | `server/modules/generators`                        | **`generators`**               | Output kan vara `AUTHORITY`; input ska minimeras                                 |
| System-/agentprompter (texter) | bl.a. `services/geminiService.ts`, Vertex-tjänster | **`ai`** + säkerhetsgranskning | Inga **riktiga** fastighetsbeteckningar eller personnamn i prompt enligt ADR-005 |

**Regel:** Promptmallar och loggade prompts ska granskas vid release som hanterar ny känslighetsklass.

---

## 5. Läsa vs skriva (grannmoduler)

- **Tillåtet:** Modul A anropar **`B/public.ts`** eller delad **repository** som explicit exporterats för läsning.
- **Kräver beslut:** Modul A importerar `prisma` och skriver på B:s tabeller — dokumentera i denna fil eller flytta till B:s adapter.
- **Förbjudet (mål):** Route eller frontend importerar `server/services/*` eller `db/prisma` direkt — se CI-plan i `ci-import-boundaries-plan.md`.

---

## 6. Underhåll

- **Vid ny tabell:** Lägg till rad i §2 eller §3, sätt ägare och default-klass.
- **Vid ny Vertex-feature:** Uppdatera ADR-005 + denna matris.
- **Kvartalsvis:** Gå igenom `server/modules/*/adapters` som använder `prisma.$queryRaw` mot `env`/`core` och säkerställ att de står under rätt ägarsektion.
