# Source of truth och Decision Fact Layer

**Status:** Gällande arkitektur **från antagande av detta dokument** (P3+).  
**Syfte:** Ett tydligt lager där *produktdata* får *en* sanning, medan *ETL* och *bakgrundsmodeller* får tydlig roll.

---

## 1. Source of truth (produktion)

| Domän | Sanning ligger i | Anmärkning |
|--------|------------------|------------|
| Applikationsentiteter, auditbarhet | **Prisma-modeller** i **PostgreSQL** | Migrationer under `prisma/migrations/`. |
| Kärnobjekt ni nämnde | `KnowledgeNode`, `KnowledgeEdge` (kärn *kunskapsgraf*), `ExtractedRequirement` (e-post/ingest-kedja), `DocumentRecord` + innehålls-/chunk-lager, `PipelineRun` → `ingest_runs` | RAG/semantik bygger på dokument + noder, inte parallell “andra grafen”. |
| Kund- och ärendehantering i plattformen | `Project`, `RequirementCase`, `RequirementRecord`, `Submission`, `CaseSnapshot` m.m. | `RequirementCase` = **plattformens** ärendefall kopplat till *ett* huvuddokument; se avsnitt 3. |
| Rå GIS (PostGIS) | Tabeller i `env` / `core` under **spatial bootstrap** | Versioneras med rå SQL (`prisma/spatial/`), anropas från services med `$queryRaw`. **Inte** “andra grafer” för beslutsfakta. |

## 2. Ops / ETL (tillåtet, men inte source of truth för produktgraf)

- Rå **SQL** (engångs-/massuppdateringar) när det är motiverat.
- **Python-pipelines** (t.ex. nedladdning, transform, ladda underlag).
- **raster2pgsql** och liknande för **NMD/GeoTIFF** → PostGIS.
- **Legacy `graph_runs` / `graph_nodes` / `graph_edges`** (skapas i `Miljobeslut_Ops_Pipeline/scripts/graph/build-knowledge-graph.ts`):

  **Dessa tabeller får *inte* konkurrera med `KnowledgeNode` / `KnowledgeEdge` i fråga om “vad är produktens graf”.**

  De ska betraktas som **ETL- eller mellanlager** tills innehåll är **migrerat** till Prisma-modellerna (eller ersätts helt). Produkt-API, RAG och admin ska läsa **endast** `knowledge_nodes` / `knowledge_edges` (Prisma) för samma semantik.

## 3. Ej tillåtet

- **Två parallella “ägare”** av samma faktatyp (t.ex. samma kant/nyckel i både råa `graph_*` och `KnowledgeNode` med divergerande innehåll) utan migrationsplan och tydlig deprioritering av det ena.

**Åtgärd:** Migrera in i Prisma, eller håll `graph_*` strikt i **ETL** och hoppa aldrig produktflöde dit.

---

## 4. Befintligt vs nytt: “ärende”

| Befintligt | Innebörd |
|------------|----------|
| `RequirementCase` + `RequirementRecord` | Operativt **krav- och C-anmälningsstöd** i produkten, kopplat till plattformens projekt/dokument. |
| `DocumentRecord` (t.ex. större korpus) | Råa handlingar med metadata, beslutstyp, kommun, m.m. |

| Nytt (Decision Fact Layer) | Innebörd |
|----------------------------|----------|
| `decision_cases` (`DecisionCase`) | **Normaliserat historiskt/myndighetsärende** för statistik: kommun, tidslinje, ufall, EWC, volym, flaggor för komplettering/föreläggande/godkännande. Kan länka *valfritt* till `DocumentRecord` / `RequirementCase` när källan speglar samma reella ärende. |
| `decision_requirements` | Kravrader *kopplade till beslutsärende* (kan komplettera `ExtractedRequirement` där fokus är ingest, och `RequirementRecord` där fokus är kundens fall). |
| `municipality_decision_profile` | Aggregerad **kommunprofil** (t.ex. kompletteringsgrad, snitttider) — *materialiserad* eller räknad när data finns. |
| `decision_risk_features` | **Feature-vektor** per ärende till scoring/“kompletteringsradar” (C-anmälan), inte ersättning för rå PostGIS. |

Målet med lagret: svara på frågetypen: *“I kommun X, för EWC … och volym Y, leder ofta Z → komplettering; vanligaste orsakerna A, B.”* Det är det **KPI- och försäljningsbärande** locket ovanför rå sökning och RAG.

## 5. Största gap (produkt)

Ni har: dokument, RAG, krav, GIS, audit, **scoring-stubbar**.

Ni saknar fortfarande i **låst form**: ett **decision / analytics-faktalager** som låter er:

- spika **en ärenderad** per reellt ärende (även när källan är flera PDF:er);
- räkna **kompletteringsgrad** per segment (kommun, EWC, volymklass);
- mata en **risk-endpoint** och en **enkel rapport** utan att först bygga mer raster.

**Prioritering (förslag):**

1. Frys SoT för **kunskapsgraf** (Punkt 1–2 ovan; legacy `graph_*` = ETL / på väg bort).  
2. Fyll / backa `decision_cases` från befintlig dokumentkorpus (där metadata tillåter).  
3. Koppla där det går: ansökan → händelser (komplettering, föreläggande) → slutligt ufall.  
4. Mät kompletteringsgrad per kommun / EWC / volymbucket.  
5. `POST` (eller motsv.) **risk** för C-anmälan + enkel **rapportvy**.  
6. *Inte* expandera GIS **före** punkt 2–5 har första svar i staging.

## 6. Produkt: “kompletteringsradar” (C-anmälan)

**Löfte till kund (exempel):** *“Vi sänker risken för komplettering innan C-anmälan skickas in.”*

**Indata (koncept):** kommun, verksamhet, EWC, mängd, bifogade underlag, plats.  
**Utdata:** uppskattad kompletteringsrisk, vanligaste skäl, jämförelseärenden, förebyggande åtgärder.

Tekniskt: bygg på `DecisionCase` + `DecisionRiskFeature` + `MunicipalityDecisionProfile` så siffror är **förklaringsbara** (inte bara LLM-svans).

## 7. Nästa tekniska steg i repot

- Prisma: modeller mappade till `decision_cases`, `decision_requirements`, `municipality_decision_profile`, `decision_risk_features` (se `schema.prisma`).  
- ETL: separata skript som **skriver in** rader, inte nya “sanningar” i `graph_nodes`.  
- (Valfritt) vyer: `CREATE VIEW` senare när mönster i query är stabila; börja med tabeller + batch-jobb.
