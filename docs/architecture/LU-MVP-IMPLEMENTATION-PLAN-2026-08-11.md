# LU/MVP — IMPLEMENTERINGSPLAN 2026-08-11

> ```
> Document class:                    EXECUTION PLAN  (ej roadmap-authority)
> Program parent:                    P3 (LU end-to-end maturity)
> Program authority:                 P0–P8 → PROGRAM-P0-P8-AUTHORITY-2026-08-11.md
> May define local steps:            YES  (F0A–F5 gäller fortsatt)
> May redefine program dependencies: NO
> May redefine PROVEN semantics:     NO
> May redefine authority boundaries: NO
> ```
>
> Denna plan är **klassificerad, inte nedgraderad** — dess F0A–F5-innehåll är fortsatt styrande
> för LU-spårets utförande. `F3B` är LU-milstolpen *inom* P8, inte en egen proof-definition.
> Utfall: `HM-1 — LU capability HIGH_MATURITY`.

Status: **PLAN — DRAFT, väntar på frysning. Ingen kod skriven.**

Målsättning (ägarbeslut, citerat): *LU är ACTIVE MVP, men inte authority owner. Mimers Brunn /
governance-lagret äger sanning, approval, promotion, CAS-write-regler och kryptografisk
bindning. LU ska vara domän-/produktspåret som konsumerar verifierad data och producerar
replaybara bedömningar.*

Föregående dokument: `LEGACY-CLASSIFICATION-2026-08-11.md` (klassning),
`TOR_INSTRUKTION_JURIDISK_RAG_IMPLEMENTATION.md` (frozen spec + PROVEN v1 för
`mps-legal-corpus`).

---

## 0-A. ⚠️ KRITISKT FYND 2026-08-11 — det finns redan frysta ADR:er som täcker delar av denna plan

Upptäckt när Codex-planens referens till `architecture-authority-map.jsonc` skulle verifieras.
Detta ändrar FAS 0 och FAS 4 materiellt och måste avgöras innan något byggs.

| Befintlig ADR | Status i filen | Överlappar |
|---|---|---|
| `ADR-28-LU-Definition-Scope.md` — "LU v1.0 – Definition & Scope **(Frozen)**" | Fryst | **Hela FAS 0.4.** Definierar redan LU:s MVP-scope och fem artifacts (`LUProjectContextArtifact`, `LUPropertyContextArtifact`, `LocalizationAssessmentArtifact` m.fl.). Min plan föreslog att skriva MVP-scopet som ny kontraktstext — det vore en fjärde parallell modell. |
| `ADR-DOCUMENT-INGESTION-MANIFEST-CONTRACT.md` | "**ACCEPTED / SEQUENCE FROZEN**" | **Hela FAS 4 + din punkt 2 (masterarkivstruktur) + punkt 3 (nedladdningspipeline) + punkt 6 (chunkning).** Definierar redan `DocumentInventoryManifest`-schemat (`document_id`, `source_path`, `content_hash`, `file_size`, `page_count`, `text_extractable`, `ocr_required` + klassificeringsmetadata), pipeline-sekvensen (manifest-gate → klassificering → kanonisk struktur → textextraktion/OCR → layout-aware chunkning → BM25+pgvector → `DocumentEvidenceArtifact`), och tre kunskapsdomäner (`LEGAL`, `ENVIRONMENTAL_DECISIONS`, `TECHNICAL`). |
| `ADR-27-LU-Architecture-Charter.md`, `ADR-30-LU-Runtime-v1-Freeze-...md`, `ADR-CHUNKING-Subsystem.md` | Ej lästa än | Sannolikt relevanta för FAS 2-3. Bör läsas innan FAS 1 skrivs. |

**Konkret konflikt att avgöra:** din föreslagna arkivstruktur (`raw/`, `manifests/`,
`normalized/`, `chunks/`, `attestations/`, `indexes/`, `rejected/`) är **inte** samma som den
redan frysta (`GEO_Master_Archive/Documents/Sources/` med `GIS`/`Documents`-uppdelning och
manifest som katalog-gate snarare än katalogträd). Båda är rimliga. Men att bygga den nya utan
beslut skulle skapa exakt det mönster som hela saneringen finns för att motverka: en parallell
modell bredvid en fryst.

**Tre vägar:**

- **(i) Följ befintlig ADR** — bygg mot `DocumentInventoryManifest` som den är frusen.
- **(ii) Skriv en ADR-supersedering** — din nya struktur ersätter formellt den gamla, med
  explicit "supersedes ADR-DOCUMENT-INGESTION-MANIFEST-CONTRACT"-huvud.
- **(iii) Konvergensspec** — samma mönster som `SourceRegistryArtifact ↔ SourceDefinition ↔
  HarvestPlan`: en kort normativ text som reconcilierar de två modellerna.

Tills detta avgörs bör FAS 4 inte påbörjas. FAS 0.4 (skriva MVP-scope) bör ersättas av
"läs ADR-28 och avgör om den räcker, behöver utökas, eller ska superseders".

---

## 0. Vad som redan är bevisat och INTE ska byggas om

Innan planen: tre saker är redan klara och ska återanvändas, inte återuppfinnas.

| Redan PROVEN / korrekt | Var | Konsekvens för planen |
|---|---|---|
| `CorpusImportGate` — manifest-completeness före första write, batch fail-closed, ordningskänslig `chunk_set_content_hash`, attestation-bunden importauktoritet | `packages/mps-legal-corpus` (PROVEN v1, 18/18) | Punkt 4, 5 och 6 i din åtgärdslista (sortering/determinism, korrekt arkivering, chunkning) är i sina *hash- och gate-delar* redan lösta. Planen ska ÅTERANVÄNDA denna grind för LU:s dokumentspår, inte bygga en parallell. |
| `ArtifactAttestation` / `verifyArtifactAttestation` / `LocalPemSigningKeyProvider` | `packages/mimers-brunn-core/src/signing` | Enda signeringsmekanismen. LU får inte införa en egen. Egen `key_id`/env-block per authority-domän (som `legalCorpusSigningKey.ts` gjorde) är mönstret om LU behöver en egen domän. |
| `ViewerKernel.ts` | `packages/mps-lu/src/viewer` | **Redan arkitektoniskt korrekt** — read-only mot CAS, extern capability-gate, `VERIFIED_OBSERVATION`-taggning. Ska INTE saneras. Endast dess *uppströms* problem (vem utfärdar `ViewerCapabilityArtifact` och sätter `viewer_identity_ref`) berörs. |

---

## 1. Verifierade fynd som planen bygger på

Varje åtgärd nedan är förankrad i faktiskt läst kod, inte i rapporterade symptom. Där något
ännu inte är verifierat står det uttryckligen.

| # | Fynd | Källa | Verifierat? |
|---|---|---|---|
| F1 | `DocumentEvidenceMaterializer.promote()` gör `this.cas.put(...)` direkt, utan attestation — endast en råhash-koll mot quarantine-payloaden. Filens egen kommentar erkänner att den inte är auktoriteten. | `packages/mps-lu/src/ingestion/QuarantinePromoter.ts:63-67` | ✅ läst |
| F2 | `export class QuarantinePromoter extends DocumentEvidenceMaterializer` — `@deprecated`-alias med exakt samma namn som den riktiga, attesterade klassen i `mimers-brunn-core`. Namnkollision → fel klass kan importeras av misstag. | samma fil, rad 74-77 | ✅ läst |
| F3 | LU E2E-testet gör själv `casRepo.put({...})` direkt för spatial evidence. | `packages/mps-lu/tests/LUEndToEnd.test.ts:51-55` | ✅ läst |
| F4 | `expect(kernelResult.findings).toHaveLength(2)` — väntar `LU-WATER-001` + `LU-DOC-BESLUT-001`. | `LUEndToEnd.test.ts:71-75` | ✅ läst (att den ger 1 är rapporterat, orsaken ej spårad) |
| F5 | `packages/mps-runtime/src/mimers/index.ts` **existerar**. Importen `../../../mps-runtime/src/mimers/index.js` pekar alltså på en fil som finns — problemet är `.js`-suffix mot `.ts`-källa under vitests resolver, inte en saknad fil. E2E-testet importerar samma modul utan suffix (`"../../mps-runtime/src/mimers"`), vilket fungerar. | `ls packages/mps-runtime/src/mimers` + `LuExecutionKernelClient.ts:9` vs `LUEndToEnd.test.ts:7` | ✅ verifierat — **omformulerar din punkt 8: det är inte en "saknad .js-fil" utan inkonsekvent suffixanvändning** |
| F6 | Åtta relativa importer `../../../mps-runtime/src/...` i `LuExecutionKernelClient.ts` + en i `RawSourceIngestor.ts`. Alias `@miljobeslut/mps-runtime` finns redan i `tsconfig.json` och `vitest.config.ts`. | grep | ✅ verifierat |
| F7 | Stray `f;` | `LUMagicMoment.test.ts:156` | ✅ verifierat |
| F8 | `ViewerKernel` kastar korrekt om `viewer_identity_ref` saknas — kontraktet finns. Felet ligger uppströms i vem som konstruerar `ViewerCapabilityArtifact`. | `ViewerKernel.ts:24-26` | ✅ läst (uppströms-källan ej spårad) |
| F9 | Replay ger `undefined` artifact id | rapporterat från testkörning | ⚠️ **ej spårat till källkod** — kräver egen utredning i FAS 0 |
| F10 | `scripts/import/generate-embeddings.ts` gör `prisma.$executeRawUnsafe('UPDATE "DocumentChunk" SET "embedding" = ...')` — authority-bearing write utanför governance-porten | filen, rad 76-80 | ✅ läst |

---

## 2. Faser

Fasordningen är inte godtycklig: **F0 → F1 → F2** måste ske i den ordningen eftersom
kontraktsbrotten (F1) annars cementeras av tester skrivna mot fel beteende, och eftersom
scope-frysning (F0) avgör vad testerna ens ska bevisa.

### 🔒 FRYST FASORDNING (ägarbeslut 2026-08-11)

```
F0A  ADR-28 reconciliation
F0B  Document-ingestion ADR reconciliation
F0C  Trace F4/F8/F9
F0D  Freeze SourceRegistry convergence contract (#19)

        ↓ OWNER FREEZE

F1   Red/negative authority + proof tests
F2   Remove LU authority bypass
F3   Repair LU proof chain
F3B  Establish executable proof/CI lanes
F4   Master archive / harvest pipeline
     — only against frozen ingestion + SourceRegistry contracts
F5   Full DoD verification

        ↓

LU/MVP PROVEN
```

Motivering för F3B före F4: det är märkligt att bygga den största nya pipelinen innan det finns
en reproducerbar definition av hur authority proof faktiskt exekveras.

---

### FAS 0 — Reconciliation + spårning (INGEN kod)

Syfte: eliminera de sista antagandena innan kontrakt fryses. Notera att detta INTE längre
innehåller "skriv ny MVP-scope-spec" — se F0A.

- **F0A — Reconcile MVP-flödet mot ADR-28.** Läs `ADR-28-LU-Definition-Scope.md` som
  **authority** för LU:s scope. Klassificera varje steg i tiostegsflödet nedan som exakt ett av:
  1. `already governed by ADR-28`
  2. `implementation detail under existing ADR`
  3. `missing normative requirement`
  4. `conflicting requirement`

  **Endast verkliga luckor (kategori 3) får bli nytt normativt tillägg. Ingen parallell
  LU-scope-spec skapas.** Detta ersätter det tidigare (felaktiga) 0.4 "skriv MVP-scopet som
  fryst kontraktstext", som hade riskerat att göra planen till modell nummer fyra.

- **F0B — Reconcile mot dokumentingest-ADR:n.** Samma fyra kategorier tillämpade på
  `ADR-DOCUMENT-INGESTION-MANIFEST-CONTRACT.md` (`ACCEPTED / SEQUENCE FROZEN`) kontra den
  föreslagna `raw/manifests/normalized/chunks/attestations/indexes/rejected`-strukturen. Välj
  en av de tre vägarna i §0-A (följ ADR:n / supersede:a den / konvergensspec). **FAS 4 får
  inte börja innan detta är avgjort.**

- **F0C — Spåra de tre otraced felen.**
  - F9 (replay `undefined` artifact id): LU-bugg, `mps-runtime`-replay-kontraktsbrott, eller
    testfixture-problem? Åtgärden skiljer sig radikalt mellan dem.
  - F8 uppströms: var konstrueras `ViewerCapabilityArtifact`, och varför saknas
    `viewer_identity_ref` där? Utfärdas den av något attesterat flöde, eller handkonstrueras
    den i test?
  - F4: faller `LU-WATER-001` eller `LU-DOC-BESLUT-001` bort? Sannolikt kopplat till F1 — om
    `promote()` ändras faller dokumentspåret annorlunda ut, vilket är exakt varför detta ska
    spåras FÖRE saneringen.

- **F0D — Frys task #19:s minsta SourceRegistry-kontrakt.** `source-registry-runtime` är
  `RUNTIME_PROJECTION_UNVERIFIED / UNPROVEN` med `blocker_class: PRE_PROOF_SPLIT_BLOCKER`.
  Runtime-registret måste bli en verifierad materialisering av ett governance-approved
  `SourceRegistryArtifact` — aldrig en självständig authority.

**MVP-flöde att reconcilia (oförändrat som förslag, men nu prövat MOT ADR-28, inte fryst
fristående):** ladda ned källor → sortera enligt källa/domän/datum/identifierare → arkivera
råfil i masterarkiv → skapa manifest/provenance → chunkning enligt fryst policy → skapa
evidens/artifacts → köra LU-bedömning → CAS-lagra via governed write → replaya beslut →
exportera enkel viewer/QGIS-vy.

**Leverans FAS 0:** reconciliation-tabeller (F0A, F0B) + tre spårningssvar (F0C) + fryst
minimikontrakt (F0D). **Kräver din OWNER FREEZE innan FAS 1.**

---

### FAS 1 — Negativa/kontraktsdrivna tester FÖRST (tester, ingen produktionskod)

Skrivs mot det frysta kontraktet, och ska **vara röda** när de skrivs — det är beviset att de
mäter något verkligt. Din testlista mappad till konkreta assertions:

#### A1 kräver TVÅ nivåer, inte ett mock-test (ägarskärpning 2026-08-11)

Mock-testet ensamt är otillräckligt — **just detta fel uppstod när en verklig Mimers-repository
injicerades i E2E** (`LUEndToEnd.test.ts:18-19,29`). Ett grönt mock-test skulle alltså kunna
samexistera med en produktions-/E2E-route som fortfarande injicerar samma riktiga repository.

```
Contract test:
LU local materializer cannot invoke governed CAS port.

Integration proof:
Real MimersIntegration.artifactRepository cannot be reached
from LU promotion/materialization without canonical promotion authority.
```

Båda krävs. Den första bevisar att modulen inte anropar porten; den andra bevisar att porten
inte ens är **nåbar** från LU:s väg utan kanonisk promotion authority — vilket är den invariant
som faktiskt bröts.

| Test | Bevisar | Mätpunkt |
|---|---|---|
| `LU cannot write CAS directly` (contract) | F1/F2 kapade | Spy/mock på CAS-porten: `expect(cas.put).not.toHaveBeenCalled()` när LU-vägen körs utan giltig attestation. Direkt på mocken, inte via returvärde. |
| `Real Mimers repository unreachable from LU without canonical authority` (integration) | A1 på riktigt | Injicera den ÄKTA `MimersIntegration.create().artifactRepository` i LU:s materialiseringsväg och bevisa att ingen permanent write kan ske utan kanonisk promotion authority. Detta är testet som hade fångat den nuvarande buggen. |
| `raw archive write happens before parse` | punkt 5 | Ordningsassertion: råfilens write-anrop registreras före parser-anropet i en gemensam call-log. |
| `missing manifest blocks batch commit` | punkt 5 | Återanvänder `checkManifestCompleteness`-mönstret; noll writes. |
| `partial batch writes nothing` | punkt 5 | `expect(writer.writes).toHaveLength(0)` även för det annars giltiga dokumentet i batchen. |
| `changed chunk order changes/rejects hash` | punkt 4/6 | Redan bevisat i `mps-legal-corpus` — här som integrationsassertion att LU:s chunkspår använder SAMMA funktion, inte en egen. |
| `LU replay requires valid artifact ids` | F9 | Replay med `undefined`/okänt id ska kasta explicit, inte tyst returnera. |
| `viewer export requires viewer_identity_ref` | F8 | Finns delvis redan i `ViewerKernel` — testet ska bevisa att det *uppströms* flödet faktiskt sätter fältet. |
| `source cannot be AI-filtered away` | punkt 3 | Negativt test: en källa markerad "irrelevant" av en klassificerare måste ändå finnas i manifest med `FILTERED_OUT` + `filtered_reason`, aldrig försvinna spårlöst. |
| `quarantine records failed source with reason` | punkt 3/5 | Fel-väg skriver quarantine-post med orsak, HTTP-status, URL, hash. |

**Leverans FAS 1:** testfiler + exakt `it()`-räkning dokumenterad (samma disciplin som gav
18/18-matchningen). Ingen produktionskod ändrad ännu.

### A1 RED PROOF — skriven 2026-08-11, väntar på exekverat rött bevis

Fil: `packages/mps-lu/tests/A1AuthorityBypass.red.test.ts` (1 `it()`-block).

**Invariant testet är låst mot:**

> A1 — LU SHALL NOT persist/promote a canonical artifact to the production Mimers
> repository without passing the canonical governed promotion path and its required
> approval/attestation checks.

**Hur den verkliga vägen träffas.** Repositoryn hämtas från `MimersIntegration.create()` —
plattformens enda artefaktstack-fasad, vars egen dokumentation säger *"Kernel / replay / LU
clients obtain storage only through this facade"*. `server/index.ts` når samma fasad via
`createKernelArtifactRepository()` (dokumenterad tunn alias). Composition-roten, porttypen
(`ArtifactRepositoryPort`) och skrivmetoden (`put`) är alltså de riktiga. Testet **spionerar**
på `put` utan att blockera den — poängen är att bevisa att skrivningen faktiskt landar, inte
bara att en metod anropades. Artefakten hämtas därefter tillbaka med `resolve()` som
sekundärbevis på att bypassen inte är en no-op.

**Varför felet inte kan bero på miljöbrist.** Under `VITEST` väljer fasaden en
minnesbaserad byte-storage-backend. Det är avsiktligt: ingen DB-auth (`riskguard`), inga
signeringsnycklar, inget filsystem-CAS kan förorena resultatet. Kvar finns endast
authority-gränsen.

**Ordning i testet.** All bevisinsamling sker före invariantassertionen, så att
felmeddelandet bär beviset (`canonical_writes`, `artifact_is_resolvable_from_canonical_repository`,
`attestation_supplied: false`, `canonical_promotion_path_used: false`) i stället för bara ett
booleskt utfall.

**Status: ✅ `ESTABLISHED_RED_PROOF` — exekverat 2026-08-11.**

```
proof_id:       A1_AUTHORITY_BYPASS_RED_PROOF
proof_status:   ESTABLISHED_RED_PROOF        (≠ PROVEN)
executed:       true

invariant_status:   VIOLATED
capability_status:  KNOWN_BROKEN

command:  npx vitest run packages/mps-lu/tests/A1AuthorityBypass.red.test.ts
result:   tests 1 | passed 0 | failed 1 | expected_failure true
failure:  A1 VIOLATED

evidence:
  canonical_writes:                 [ doc_ev_doc-a1-red-proof ]
  canonical_repository_resolution:  true
  attestation_supplied:             false
  canonical_promotion_path_used:    false

program_effect:
  P1_enforcement:        KNOWN_BROKEN
  P1_enforcement_proof:  COMPLETE_RED
  P1_overall:            OPEN
```

**Avstämning mot skriven kod:** filen innehåller exakt **1** `it()`-block; rapporten säger 1
test. Matchar — samma korsvalidering som gav 18/18 för `mps-legal-corpus`.

**Varför `canonical_repository_resolution: true` är den avgörande raden.** Den skiljer fyndet
från ett ytligt *"LU anropade `put()`"*-problem. Artefakten blev faktiskt åtkomlig via den
kanoniska repository-fasaden — skrivningen landade. Det var ingen no-op, inget avlyssnat anrop,
ingen mock-assertion.

**`ESTABLISHED_RED_PROOF` ≠ `PROVEN`.** Det som är bevisat är att kontraktsbrottet **existerar**.
Beviset säger ingenting om att en fix fungerar, att P1 är stängd, att LU är PROVEN, eller att
den bredare compliance-sviten är frisk.

**Detta ökar `compliance`-lanens röda antal från 17 till 18.** Avsiktligt, och får inte
förväxlas med de 16 pre-existing legacy-felen.

### A1 HISTORISERAD 2026-08-11 — och varför "samma test rött → grönt" övergavs

Den ursprungliga planen var att samma test skulle gå från rött till grönt. **Den planen
övergavs av ett dokumenterat skäl:** rödtestet kodar in det trasiga tillståndet i en
*precondition* — *"the LU-written artifact must actually be present in the canonical
repository"*. Den satsen är sann endast så länge bypassen finns. Efter fixen blir den falsk
by design. Att skriva om den hade reparerat testet i stället för arkitekturen.

Rödtestet är därför **historiserat genom rename, innehållet oredigerat** (6636 bytes, byte-
identiskt):

```
packages/mps-lu/tests/A1AuthorityBypass.red.test.ts
→ packages/mps-lu/tests/A1AuthorityBypass.red.test.ts.historical
```

Filen faller därmed utanför varje vitest include-glob. **Ingen `vitest.config.ts`-ändring
gjordes.** Posten får aldrig skrivas om till *"test passed after fix"* — det gjorde den aldrig
och ska aldrig göra.

```
FÖRE FIX
  A1AuthorityBypass.red.test.ts        → 1/1 FAILED, A1 VIOLATED, ESTABLISHED_RED_PROOF

EFTER FIX
  ...red.test.ts.historical            → arkivbevis, ej körbart i aktiva lanes
  A1AuthorityEnforcement.test.ts       → aktivt bevis för den reparerade arkitekturen
```

### P1 ENFORCEMENT FIX 2026-08-11 — implementerad och bevisad

**Produktionsfix** (`packages/mps-lu/src/ingestion/QuarantinePromoter.ts`):

```
före:  DocumentEvidenceMaterializer → äger ArtifactRepositoryPort → put-capability
                                    → promote() → kanonisk persistens

efter: DocumentEvidenceMaterializer → ingen ArtifactRepositoryPort → ingen put-capability
                                    → materialize() → returnerar evidens, persisterar inte
```

**Capability removal by construction** — starkare än att behålla write-capabilityn bakom en
runtime-kontroll och hoppas att varje anropsställe validerar rätt. Namnbytet
`promote() → materialize()` beskriver den auktoritet komponenten faktiskt har efter saneringen.

**Grönkontrakt** (`packages/mps-lu/tests/A1AuthorityEnforcement.test.ts`, **5** `it()`-block):

| Tillstånd | Bevisar |
|---|---|
| 1 | Noll kanoniska writes; artefakten **ej** upplösbar; plus strukturell kontroll av konstruktorns aritet så att en återinförd write-capability faller direkt |
| 2 | Ogiltig attestation → avvisas, posten kvar som `quarantined`, inget persisterat. Giltig attestation → befordran lyckas, innehållet hämtbart ur kanonisk CAS, status `promoted` |
| 3 | Källkodsscanning av `packages/mps-lu/src/ingestion/QuarantinePromoter.ts` plus prototypkontroller bevisar att document-evidence-materializern och dess deprecated alias inte exponerar repository-write eller gamla `promote()`-bypassen |

**`canonical_repository_resolution` är bevarad som bevisdimension** — bara riktningen ändras:

```
RED:    obehörig write → upplösbar      = brott bevisat
GREEN:  obehörig write → EJ upplösbar   = enforcement bevisat
        behörig write  → upplösbar      = governad persistens bevisad
```

**Scope-ärlighet i tillstånd 2:** det bevisar att den governade vägen *finns och kräver
attestation*. Det påstår **inte** att LU rider den. Under den reparerade arkitekturen äger LU
inte persistens-capabilityn alls, så *"LU använder promotorn"* är ingen egenskap att bevisa.

**Följdändringar som fixen tvingade fram** (inget annat): `RawSourceIngestion.test.ts`,
`LUEndToEnd.test.ts`, `VerticalProof.test.ts` — 1-argumentskonstruktion och `materialize()`.
I `LokeIngestion` vändes dessutom steg 5, som tidigare löd *"verify it now exists in CAS"* —
bokstavligen en assertion på att bypassen fungerade.

**Ej rört:** `vitest.config.ts`, `tsconfig.json`, spatial kod, legal corpus, viewer, CI-lanes,
`@deprecated QuarantinePromoter`-aliasen (FAS 2.2, egen enhet).

**Typkontroll:** enda felet i den ändrade filen är ett pre-existing `TS2322` på
`relevant_document` (saknar `title`, `metadata`) — verifierat närvarande före fixen och min
diff rör inte payload-konstruktionen.

**Status: ✅ `PROVEN` — exekverat lokalt i Windows-workspacen 2026-08-12.**

```
npx vitest run packages/mps-lu/tests/A1AuthorityEnforcement.test.ts
→ Test Files 1 passed (1)
→ Tests      5 passed (5)

npx vitest run packages/mps-lu/tests/A1AuthorityEnforcement.test.ts \
  packages/mps-lu/tests/RawSourceIngestion.test.ts \
  tests/unit/mimers/approval.test.ts \
  tests/unit/mimers/quarantinePromotionAttestation.test.ts \
  tests/unit/mimers/tv-l1-e2e.test.ts \
  tests/unit/governanceRoutes.test.ts
→ Test Files 6 passed (6)
→ Tests      30 passed (30)
```

**Bredare LU-E2E-not:** en explorativ körning som även tog med
`packages/mps-lu/tests/LUEndToEnd.test.ts` och `packages/mps-lu/tests/VerticalProof.test.ts`
är fortsatt röd på separata LU-mognadsfrågor: document findings ignoreras i nuvarande
LU-kernelväg (F4), `ViewerCapabilityArtifact` saknar `viewer_identity_ref` (F8), och replay
får `undefined` artifact id (F9). Det är inte A1-enforcement-fel och ska inte blandas in i
denna proof.

**Efter grönt:**

```
A1 historical violation proof        ESTABLISHED_RED_PROOF
A1 forbidden capability              REMOVED_BY_CONSTRUCTION
A1 enforcement green proof           PROVEN
production reachability of old path  NOT_APPLICABLE / REMOVED
P1 enforcement                       PROVEN
P1 overall                           OPEN — P1 har två grindar; contract closure krävs också
```

---

### FAS 2 — Kapa parallell authority (minsta möjliga kodändring)

Här görs den arkitektoniskt viktigaste ändringen, och bara den.

- **2.1** `DocumentEvidenceMaterializer` (F1): **§4.1 är avgjord** — ta bort den permanenta
  `cas.put(...)`-writen ur LU:s väg. Förgodkänt material till icke-auktoritativ
  quarantine-/arkivlagring; kanonisk CAS endast via Mimers Brunns governade promotion-väg.
  Staging-CAS-omdöpning är förkastad. Förutsätter att FAS 1:s röda test finns först.
- **2.2** Ta bort `@deprecated`-aliasen `QuarantinePromoter` (F2) och döp filen efter sin
  faktiska klass (`DocumentEvidenceMaterializer.ts`). Ren namnkollisionseliminering.
- **2.3** LU E2E-testets egen `casRepo.put` (F3) ersätts med den governade vägen — annars
  bevisar testet den bypass vi just kapade.
- **2.4** `generate-embeddings.ts` (F10): **UTGÅR ur FAS 2.** Klassad
  `KNOWN_AUTHORITY_BYPASS / OUT_OF_LU_SCOPE` — se §4.2. Får **inte** blockera LU/MVP och ska
  inte byggas om inom detta spår.

---

### FAS 3 — Reparera proof-kedjan (mekaniskt, låg risk)

Görs efter FAS 2 eftersom F4 sannolikt påverkas av 2.1.

- **3.1** Byt de nio relativa `../../../mps-runtime/src/...`-importerna mot
  `@miljobeslut/mps-runtime` (F6). Enhetligt suffixbruk löser samtidigt F5.
- **3.2** Ta bort stray `f;` (F7).
- **3.3** Åtgärda F9 och F4 enligt F0C:s spårningsresultat.
- **3.4** Sätt `viewer_identity_ref` i det uppströms flödet enligt F0C (F8).

---

### FAS 3B — Exekverbara proof-/CI-lanes (NY, före FAS 4)

Flyttad hit på ägarbeslut: det är märkligt att bygga den största nya pipelinen innan det finns
en reproducerbar definition av hur authority proof faktiskt exekveras.

- Lös §4.3 (vad "normal full suite" betyder) — DB-auth eller formell lane-split.
- Säkerställ att varje `required_proof` i `architecture-authority-map.jsonc` uppfyller de fyra
  `proven_criteria`: invariant definierad, testet **exekveras** av namngiven lane, testet
  träffar **produktionsvägen** (inte bara fixture/stub), testet grönt i den lanen.
- Konkret känd lucka: `ADR23Compliance.test.ts` matchar ingen lane
  (`TEST_EXISTS_BUT_IS_NOT_EXECUTED`). Poster med `PARTIAL_LOCAL_ONLY` /
  `UNPROVEN_FOR_AUTHORITY` måste antingen få riktig produktionsvägstäckning eller behålla
  `UNPROVEN`.

Codex äger denna fas (proof-lanes är Codex lane). Denna plan konsumerar resultatet.

---

### FAS 4 — Masterarkiv + nedladdningspipeline

**Får inte börja innan F0B är avgjord.** Den är störst, och ska byggas ovanpå en bevisad
authority-baseline och ett fryst ingestion-kontrakt — inte parallellt med saneringen.

Arkivstrukturen (`raw/` orörda originalbytes, `manifests/`, `normalized/`, `chunks/`,
`attestations/`, `indexes/`, `quarantine/`) är ett **förslag som konkurrerar med den redan
frysta ADR-strukturen** — se §0-A. Den får byggas först när F0B valt väg. Invarianten **inga
bearbetade filer får ersätta råkällan** gäller oavsett vilken struktur som väljs.

Pipeline-krav: hämta från source registry/harvest plan → spara originalbytes FÖRST → hasha
originalet direkt → registrera URL/hämtningstid/HTTP-status/MIME/storlek/hash → deterministisk
retry → aldrig filtrera bort källa på AI-relevans → fel till quarantine med orsak.

**Beroende:** detta överlappar den ÄNNU EJ FRYSTA `SourceRegistryArtifactV2`/`HarvestPlan`-specen
i `GAP-REPORT-harvest-governance-2026-08-10.md` (task #19). FAS 4 kan inte slutföras
meningsfullt innan den fryses — annars byggs pipelinen mot en registry-modell som kan ändras.

---

## 3. Definition of Done (din lista, oförändrad)

LU/MVP får inte kallas PROVEN förrän samtliga är uppfyllda:

1. Isolerade LU/MVP-tester gröna (med `it()`-räkning verifierad mot rapporterat antal).
2. `mps-legal-corpus` fortsatt 18/18 (regressionskontroll).
3. Governance route/attestation-tester fortsatt gröna.
4. Relevant compliance-svit grön ELLER legacy-failures formellt quarantinade.
5. Normalt CI-kommando/env dokumenterat.
6. Inga aktiva authority-bearing writes utanför governed path.

Punkt 4 och 5 är i praktiken samma öppna fråga som klassningsdokumentets §"Rekommenderad
effekt på full-svitkravet" — se §4.3.

---

## 4. Beslutspunkter — status 2026-08-11

Av de fyra ursprungliga öppna besluten är **två avgjorda** (4.1, 4.2) och **fasordningen
fryst** (4.4). Kvar innan kod: 4.3 samt de fyra F0-punkterna.

| Beslut | Status |
|---|---|
| 4.1 LU CAS-write | 🔒 AVGJORT — staging förkastat, writen bort ur authority-vägen |
| 4.2 `generate-embeddings.ts` | 🔒 AVGJORT — `KNOWN_AUTHORITY_BYPASS / OUT_OF_LU_SCOPE`, blockerar inte LU |
| 4.3 "normal full suite" | ⬜ ÖPPET — måste lösas före PROVEN (nu FAS 3B) |
| 4.4 Fasordning | 🔒 AVGJORT — F0A→F0D→freeze→F1→F2→F3→F3B→F4→F5 |
| F0A ADR-28 reconciliation | ⬜ ÖPPET — nästa konkreta steg |
| F0B ingestion-ADR reconciliation | ⬜ ÖPPET — blockerar FAS 4 |
| F0D task #19 SourceRegistry-kontrakt | ⬜ ÖPPET — pre-proof-split blocker |



### 4.1 `DocumentEvidenceMaterializer` — 🔒 AVGJORT 2026-08-11 (ej längre öppen)

**Ägarbeslut:** alternativ (a) "LU-lokal staging-CAS" är **uttryckligen förkastat.**

> *"Vi ska inte försöka göra LU:s felaktiga CAS-write legitim genom att döpa om den. Den ska
> bort ur authority-vägen."*

Normativt:

- LU är ett aktivt MVP-domän/produktspår och äger **ingen** promotion- eller CAS-auktoritet.
- `QuarantinePromoter.ts` klassades före fixen `LEGACY_AUTHORITY_BYPASS` / `KNOWN_BROKEN` —
  den skulle **inte** legitimeras som staging-CAS. Nuvarande A1-status efter grön proof är
  `LU_LOCAL_MATERIALIZER_NOT_AUTHORITY` / `PROVEN` för authority-boundaryn; den deprecated
  aliasen kvarstår som separat FAS 2.2-namnfråga.
- Material före godkännande hör hemma i **icke-auktoritativ quarantine-/arkivlagring**.
- Kanonisk CAS-persistens får ske **endast** via Mimers Brunns governade promotion-väg, med
  giltig auktoritet och attestation-bindning.
- Ett explicit **negativt/rött test krävdes innan produktionskod ändrades** (FAS 1 före FAS 2)
  och är uppfyllt via `ESTABLISHED_RED_PROOF`.

Konsekvens för FAS 2.1: uppgiften var inte längre "välj mellan (a) och (b)" utan "ta bort den
permanenta CAS-writen ur LU:s väg, och låt icke-auktoritativ lagring bära förgodkänt material".
Den delen är nu genomförd och bevisad av `A1AuthorityEnforcement.test.ts`.

### 4.2 `generate-embeddings.ts` — 🔒 AVGJORT 2026-08-11: scopebeslut, inte ombyggnad

Klassning: **`KNOWN_AUTHORITY_BYPASS / OUT_OF_LU_SCOPE`.**

Scriptet ligger utanför LU, och embeddings är uttryckligen utanför denna plans scope (§5). Det
ska därför **inte blockera LU/MVP** och **inte byggas om av bara farten** inom detta spår —
annars riskerar LU-saneringen att dra in hela dataplattformen.

Bypassen är dokumenterad (`prisma.$executeRawUnsafe('UPDATE "DocumentChunk" SET "embedding" =
...')`, rad 76-80) och kvarstår som känd, klassad avvikelse tills den får **egen
remediation i ett eget spår**. Skillnaden mot tidigare läge är att den inte längre är en
odokumenterad bypass — den är en namngiven, avgränsad sådan.

*Konsekvens för Definition of Done punkt 6 ("inga aktiva authority-bearing writes utanför
governed path"): DoD-punkten avser LU/MVP:s egen väg. Detta script är explicit undantaget och
ska inte tolkas som att DoD är uppfylld för hela plattformen.*

### 4.3 Vad betyder "normal full suite"?

Antingen (i) fixa DB-auth (`riskguard`) så den verkliga sviten kan köras, eller (ii) formellt
definiera `--project compliance` som kollateral-sviten och dela dess `test.include` i en
proof-bärande och en quarantined del. Detta är din prioritet #1 i CI-kontraktet och blockerar
DoD-punkt 4-5.

### 4.4 Fasordning — 🔒 AVGJORT 2026-08-11

Fryst enligt diagrammet överst i §2: `F0A → F0B → F0C → F0D → OWNER FREEZE → F1 → F2 → F3 →
F3B → F4 → F5`. Proof-/CI-lanes (F3B) ligger **före** masterarkivet (F4).

---

## 4-B. Koordinering med Codex-planen (`Codex Non-Colliding Architecture Plan — 2026-08-11`)

Lane-uppdelningen accepteras: Codex äger proof-lanes, authority map-tester, route exposure
matrix, klassningskonsistens, CI/env-dokumentation och kollateral verifiering. Denna plan
(Opus/Claude) äger LU/MVP-implementationen. Tre saker behöver dock avstämmas:

| # | Observation | Åtgärd |
|---|---|---|
| K1 | Codex Fas 3 säger *"Extend `architecture-authority-map.jsonc` only with frozen classifications"* — men **filen existerar inte** (verifierat: noll träffar i hela repot). | Codex skapar den som ny artefakt, eller så syftar formuleringen på något annat namn. Bör klargöras innan Codex bygger vidare på antagandet. |
| K2 | Codex Fas 3 vill lägga en statisk guardrail: *"LU must not import or export a live `QuarantinePromoter` authority"*. Denna plans FAS 2.2 **tar bort** just den aliasen. | **Uppdaterat beslut:** ingen guardrail skrivs innan ADR-reconciliation och §4.1 är frysta. Codex får endast dokumentera A1 som `KNOWN_BROKEN`/red-test target. När designen är fryst kan guardrailen födas röd och därefter gör FAS 2.2 den grön. |
| K3 | Codex Fas 2 rör `vitest.config.ts` (proof-lanes). Denna session har redan ändrat samma fil (`mps-legal-corpus`-alias + include). | Codex bör basera sina lane-ändringar på nuvarande HEAD-tillstånd, inte på pre-PROVEN-versionen. DoD-punkt 2 (`mps-legal-corpus` fortsatt 18/18) är den naturliga regressionskontrollen. |

Handoff-regeln i Codex-planen (Codex rapporterar LU-defekter som blockers med fil- och
testbevis i stället för att patcha dem) accepteras utan ändring.

**K1 är löst:** `docs/architecture/architecture-authority-map.jsonc` finns (untracked draft,
behandlas ej som fryst auktoritet). Samtliga fem `file`-referenser och samtliga tio
`required_proof`-testfiler i den är verifierade att existera — kartan är förankrad, inte
påhittad.

### Tre defekter i authority-mappen — rapporterade och nu dokumentärt åtgärdade i Codex lane

Enligt handoff-regeln rapporterades dessa först med fil- och testbevis. Codex har därefter
uppdaterat authority-map-draften dokumentärt, utan produktionskod och utan guardrails.

**A1 — `lu-local-quarantine-promoter`s invariant är redan bruten av sin egen kod, och inget
test fångar det.** Invarianten lyder: *"Must not be imported by live server governance routes
or used for permanent governance promotion without canonical attestation binding."*
Men `packages/mps-lu/src/ingestion/QuarantinePromoter.ts:63-67` gör `this.cas.put(...)` utan någon
attestation, och `packages/mps-lu/tests/LUEndToEnd.test.ts:18-19,29` injicerar **den riktiga**
Mimers-repositoryn (`MimersIntegration.create().artifactRepository`) som just den `cas`-porten.
Det är alltså en permanent CAS-write utan attestation-bindning, via den kanoniska repositoryn.
Antingen är invarianten bruten och behöver ett test som bevisar det, eller så måste kartan
uttryckligen definiera att LU:s `cas`-port är en icke-auktoritativ staging-yta — vilket är
exakt öppen fråga §4.1 i denna plan. Invarianten kan inte förbli sann-på-pappret medan koden
säger annat.

**A2 — `mps-governance-actor-trust` har ett `required_proof` som aldrig körs.** Kartan pekar på
`packages/mps-governance/tests/ADR23Compliance.test.ts`. Filen existerar, men matchar ingen
`include`-glob i någon vitest-`project` (`unit`: `**/unit/**/*.test.ts` — ingen `unit`-katalog
i sökvägen; `compliance`: `packages/mps-governance/**` saknas i listan; `component`/
`integration`: nej). Testet exekveras alltså aldrig. En authority map vars "required proof"
aldrig körs ger falsk trygghet. Antingen läggs paketet till i en lane, eller så nedgraderas
posten till "unproven".

#### Ägarbeslut 2026-08-11 på A1–A3 (registrerat och dokumentärt infört — ej fryst)

- **A1: blockerande vid fyndtillfället, nu reparerad.** Posten fick inte beskriva LU-promotorn
  som "inte permanent promotion utan attestation" när koden gjorde `cas.put(...)` mot riktig
  Mimers-repository. Den vägen blev först en uttrycklig red-test target och är nu grönbevisad
  som borttagen capability.
- **A2: falskt proof.** `required_proof` får inte peka på en testfil som existerar men aldrig
  körs. Antingen in i en definierad lane, eller markeras `UNEXECUTED_PROOF` /
  `candidate_unproven`.
- **A3: separera statusfälten** i tre oberoende dimensioner:
  `paketklass` / `modulroll` / `proofstatus`. Då slipper LU som produktspår se legacy ut,
  samtidigt som `DocumentEvidenceMaterializer`-bypassen inte får frisedel.

Codex authority-map-draft använder nu `package_class`, `module_role` och `proof_status` som
separata fält. Den har även `required_proof_execution` per proof-fil, med aktuell
Vitest-project/include-glob eller `NO_MATCHING_VITEST_PROJECT_INCLUDE`.

**Förslag på hur det tredelade schemat faller ut för kartans samtliga fem poster** (utkast åt
Codex, inte ett beslut):

| Post | paketklass | modulroll | proofstatus |
|---|---|---|---|
| `quarantine-promotion-live` | `ACTIVE` | `CANONICAL_AUTHORITY` | `PROVEN` (Level 2, Windows-grön) |
| `mps-data-governance-import-gate` | `ACTIVE` | `ISOLATED_GATE` (ej live route) | `PROVEN` (PR 2) |
| `lu-local-quarantine-promoter` | `ACTIVE_MVP_NOT_AUTHORITY_OWNER` | `LU_LOCAL_MATERIALIZER_NOT_AUTHORITY` | `PROVEN` (A1 enforcement green proof) |
| `mps-governance-actor-trust` | `RETIRED_CANDIDATE` | — | `UNEXECUTED_PROOF` (A2) |
| `source-registry-runtime` | `ACTIVE` | `RUNTIME_PROJECTION_UNVERIFIED` | `UNPROVEN` |

Sista raden är värd särskild uppmärksamhet: dess invariant ("*Must become a verified
materialization of a governance-approved source registry artifact before it is treated as
canonical authority*") är exakt vad `SCHEMA-CONVERGENCE-SPEC 2026-08-11` i
`GAP-REPORT-harvest-governance-2026-08-10.md` skulle lösa — och den specen är **fortfarande
ofryst** (task #19). Authority-mappen och den ofrysta specen beskriver alltså samma öppna
lucka från två håll.

**A3 — vokabulärkollision.** Åtgärdad i authority-map-draften genom att dela upp posten i:
`package_class: ACTIVE_MVP_NOT_AUTHORITY_OWNER`, `module_role: LU_LOCAL_MATERIALIZER_NOT_AUTHORITY`
och `proof_status: PROVEN` för den reparerade A1-boundaryn. Det gör att LU som MVP-produktspår
inte kallas legacy, samtidigt som det historiska red proofet ligger kvar som separat bevis.

### Required proof execution inventory 2026-08-11

Varje `required_proof` i `architecture-authority-map.jsonc` har verifierats mot aktuell
`vitest.config.ts`:

| Proof-fil | Exekveras av | Status |
|---|---|---|
| `tests/unit/mimers/quarantinePromotionAttestation.test.ts` | `unit` via `**/unit/**/*.test.ts` | `PROVEN` |
| `tests/unit/mimers/approval.test.ts` | `unit` via `**/unit/**/*.test.ts` | `PROVEN` |
| `tests/unit/mimers/tv-l1-e2e.test.ts` | `unit` via `**/unit/**/*.test.ts` | `PROVEN` |
| `tests/unit/governanceRoutes.test.ts` | `unit` via `**/unit/**/*.test.ts` | `PROVEN` |
| `packages/mps-data-governance/tests/ImportGate.test.ts` | `compliance` via `packages/mps-data-governance/**/*.test.ts` | `PROVEN` |
| `packages/mps-data-governance/tests/FileCheckpointStoreLoadApproval.test.ts` | `compliance` via `packages/mps-data-governance/**/*.test.ts` | `PROVEN` |
| `packages/mps-lu/tests/RawSourceIngestion.test.ts` | `compliance` via `packages/mps-lu/**/*.test.ts` | `PARTIAL_LOCAL_ONLY` |
| `tests/unit/architectureAuthorityMap.test.ts` | `unit` via `**/unit/**/*.test.ts` | `INVENTORY_ONLY` |
| `packages/mps-governance/tests/ADR23Compliance.test.ts` | ingen matchande Vitest-project/include | `UNPROVEN` / `UNEXECUTED_PROOF` |
| `tests/unit/import/sourceRegistry.test.ts` | `unit` via `**/unit/**/*.test.ts` | `UNPROVEN_FOR_AUTHORITY` |

## 5. Utanför scope (uttryckligen)

Embeddings, kvalitetstuning, fler adapters, full omindexering, UI-arbete. Per din styrning:
*"Rör inte embeddings/tuning/adapters mer än nödvändigt. Kör inte full omindexering."*
