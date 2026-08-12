# PROGRAM: HIGH-MATURITY / HIGH-COVERAGE CONVERGENCE (P0–P8)

| Field | Value |
|---|---|
| **Type** | PROGRAM_AUTHORITY |
| **Status** | **ACTIVE — enda programnivån** |
| **Frozen** | Programmodell **JA**. Dependency graph **JA** (fullständig sedan 2026-08-11 — `P4A-LU → P3` fryst efter genomförd P4A-reconciliation). |
| **Version Date** | 2026-08-11 |

Detta dokument är **den enda roadmap-auktoriteten**. Inget annat dokument får definiera
programnivåberoenden, PROVEN-semantik eller authority-gränser.

---

## 1. Programnoder

```
P0  Proof semantics & baseline
P1  Authority & governance convergence
P2  Governed source → corpus ingestion
P3  LU end-to-end maturity
P4A Spatial runtime convergence
P4B National spatial coverage
P5  Legal/document knowledge plane
P6  Canonical identity & replay convergence
P7  Runtime & operational maturity
P8  Cross-cutting proof fabric
```

## 2. Två separata utfall — får inte blandas ihop

```
HIGH_MATURITY  !=  HIGH_COVERAGE
```

| Mognad | | Täckning | |
|---|---|---|---|
| `HM-1` | LU capability HIGH_MATURITY | `HC-S1` | National spatial baseline HIGH_COVERAGE |
| `HM-2` | Governed ingestion HIGH_MATURITY | `HC-L1` | Legal/document baseline HIGH_COVERAGE |
| `HM-3` | Legal knowledge plane HIGH_MATURITY | | |
| `HM-P` | Shared platform services HIGH_MATURITY | | |

Ett moget spår med liten täckning är inte samma sak som ett brett spår utan mognad. Blandning
av dessa två axlar har historiskt varit källan till överdrivna färdig-påståenden.

## 3. Beroenden — FULLSTÄNDIGT FRYSTA 2026-08-11

```
P0 ─→ P1 ─┬─→ P2 ──────────────────┐
          │                         ├─→ P3 ─→ HM-1
          └─→ P4A-LU ──────────────┘
                 required_before_PROVEN

P4A-LU ⊂ P4A          P4A broad cleanup  ≠ blocker for P3
P4A ─→ P4B            P4B / HC-S1        ≠ blocker for P3

P1 ─→ P5 ─→ HM-3
P1 + P3 + P5 ─→ P6 ─→ P7
P8 löper genom varje nod
```

**Samtliga kanter frysta.** Den tidigare `P4A → P3 ⚠️ PENDING_RECONCILIATION` är ersatt av
`P4A-LU → P3` efter genomförd reconciliation (`P4A-SPATIAL-RUNTIME-RECONCILIATION` +
`P4A-LU-SPATIAL-CONTRACT-READING`). Bred P4A-sanering och P4B-täckning håller **inte** HM-1
gisslan.

### Tre separata statusar — får aldrig blandas ihop

Ett fryst kontrakt talar om vad implementationen måste uppfylla. Frysning får därför **inte**
göras beroende av att implementationen redan är färdig:

| Nivå | Status |
|---|---|
| `P4A-LU` contract / gate definition | 🔒 **FROZEN** — sex gates, se `P4A-LU-GATE-CONTRACT-2026-08-11.md` |
| `P4A-LU` implementation | **KNOWN_BROKEN** — S1–S5 öppna, B1 ounverifierad |
| `P4A-LU` proof / satisfaction | **NOT_PROVEN** |

Samma tredelning gäller `P1`: F0D-kontraktet är fryst och A1:s enforcement-bevis är nu
exekverat grönt, men P1 overall markeras först efter separat statusavstämning av båda
grindarna (se §6).

## 4. P8 är en program-wide invariant, inte ett steg

```
P8 Proof Fabric
├── P1 proof lane
├── P2 proof lane
├── P3 proof lane  ← LU-milstolpen F3B ligger HÄR
├── P4 proof lane
├── P5 proof lane
└── ...
```

F3B behåller sitt konkreta innehåll som LU-milstolpe, men definierar **inte** när
proof-disciplinen börjar. Den börjar i P0.

## 5. Dokumenthierarki

Roadmaps subsumeras. Execution-/spec-/proof-underlag klassificeras under en P-nod — de
nedgraderas inte.

```
P0–P8  (program authority — detta dokument)
│
├── P0 ── PROOF-BASELINE-MATRIX-2026-08-11.md            (proof underlag)
│         proof taxonomy: proven_criteria i authority-mappen
│
├── P1 ── architecture-authority-map.jsonc               (authority register)
│         ARCHITECTURE-CLEANUP-DECISION-PACKETS-2026-08-11.md
│         LEGACY-CLASSIFICATION-2026-08-11.md
│         F0A-ADR28-RECONCILIATION-2026-08-11.md
│         F0B-INGESTION-ARCHIVE-RECONCILIATION-2026-08-11.md
│
├── P2 ── F0D-SOURCE-REGISTRY-MINIMAL-CONTRACT-2026-08-11.md   (kontrakt)
│         GAP-REPORT-harvest-governance-2026-08-10.md          (underlag)
│
├── P3 ── LU-MVP-IMPLEMENTATION-PLAN-2026-08-11.md       (execution plan, F0A–F5)
│
├── P4A ─ P4A-LU-GATE-CONTRACT-2026-08-11.md            (🔒 FRYST gate contract)
│         P4A-SPATIAL-RUNTIME-RECONCILIATION-2026-08-11.md      (underlag)
│         P4A-LU-SPATIAL-CONTRACT-READING-2026-08-11.md         (underlag)
│
└── P5 ── TOR_INSTRUKTION_JURIDISK_RAG_IMPLEMENTATION.md (fryst spec + PROVEN v1)

SUBSUMED (får ej längre agera roadmap-authority):
    HIGH-MATURITY-ARCHITECTURE-IMPLEMENTATION-PLAN.md   (workstreams A–E)
    CODEX-NON-COLLIDING-ARCHITECTURE-PLAN-2026-08-11.md (Phase 1–5)
```

### Authority-markering som subsumerade dokument SKA bära

```
Program status:                  SUBSUMED
Program authority:               P0–P8
Local purpose:                   execution detail only
May define local steps:          YES
May redefine program dependencies: NO
May redefine PROVEN semantics:     NO
May redefine authority boundaries: NO
```

## 6. P1 har TRE gates, inte två (preciserat 2026-08-12)

Tvågrindsmodellen var för smal medan Source Registry ännu inte var implementerad. Den tredje
grinden är en **precisering av vad P1 redan betyder**, inte ny roadmap-omfattning.

```
P1 contract closure
└─ F0D freeze                          ✅ FRYST 2026-08-11

P1 enforcement proof
├─ A1 red proof                        ✅ ESTABLISHED
├─ A1 enforcement green proof          ✅ PROVEN (5/5, 30/30 regression)
└─ forbidden LU capability             ✅ REMOVED_BY_CONSTRUCTION

P1 runtime authority convergence       ✅ PROVEN_FOR_KNOWN_P1_SURFACES — READY_FOR_CLOSURE_REVIEW
├─ SR1 red proof                       ✅ ESTABLISHED_RED_PROOF (1/1 failed as expected)
├─ SR1 green proof                     ✅ PROVEN (4/4; 25/25 nearest regression)
├─ Loke SourceRegistry path            ✅ canonical F0D materialization before adapter/network/write
├─ C2 write-capability audit           ✅ REGISTERED (read-only, no fix)
├─ property lookup fallback            ✅ PROVEN_FIXED (2/2; 54/54 nearest regression)
├─ Domstol RSS red proof               ✅ ESTABLISHED_RED_PROOF (2/2 failed as expected)
├─ Domstol RSS green proof             ✅ PROVEN (4/4; 45/45 nearest regression)
├─ classified non-authority path       ✅ open datasource sync (read-only health check; route-policy fixed)
├─ classified project index path       ✅ search sync-manifest (AUDIT_EXPORT + path override guard)
└─ P1 system-wide green proof           ✅ PROVEN (12 files, 93/93)
```

**Stängningsregel:**

```
P1 CLOSED  iff  contract closure  AND  enforcement proof  AND  system-wide runtime authority convergence
```

System-wide runtime authority convergence means every runtime-reachable
authority-bearing source-resolution/ingestion path either resolves through
canonical SourceRegistry/F0D authority, or is explicitly classified as
non-authoritative/out-of-scope with proof that it cannot establish canonical
knowledge state. SR1-green now proves the Loke path, but it does not close P1 alone.

**P1 runtime-convergence green contract — freeze candidate, not authority-frozen**

This contract becomes freezeable only after `architecture-authority-map.jsonc` and this program
document are tracked/reviewed. Until then it is a worktree contract candidate, not reproducible
program authority.

P1 runtime authority convergence is GREEN iff all of the following are true:

1. `lokeScheduler`/`lokeRuntime` source resolution uses canonical F0D SourceRegistry authority;
   the legacy hard-coded registry cannot act as authority.
2. `propertyUnitService` no longer materializes permanent geodata/document state from request-path
   fallback without proven source/provenance admission, or it is removed/quarantined from the
   authority-bearing path.
3. Domstol RSS ingest either resolves source authority through canonical F0D/provenance admission
   before writing `JudgmentRecord`/`LegalSourceRecord`/`RequirementMatrixRow`, or is explicitly
   classified as non-authoritative and prevented from establishing canonical knowledge state.
4. `sync-manifest` is classified and enforced as one of: canonical governed ingestion,
   materialization after governed admission, explicitly non-authoritative project operational
   state, or authority bypass to be fixed.
5. `open datasource sync` is either explicitly scoped as non-authoritative read-only health
   checking, or routed through canonical authority if it later persists knowledge state.
6. Executed proofs cover both the canonical allowed path and negative guardrails against the
   legacy/alternative authority paths.

### Varför P1 nu kräver closure review

Noden heter **Authority & Governance Convergence** — inte "en Loke-path är reparerad". C-P1-04
har nu tagit bort den sista kända P1-blockern (`property lookup fallback`) och den sammansatta
P1-sviten är grön. Det gör P1 redo för owner closure review, men implementationen märker inte
programnoden `CLOSED` utan den formella reviewn.

F0D-frysningen betyder:

```
WHAT SourceRegistry must be        ✅ frozen
THAT Loke runtime uses it          ✅ proven by SR1 green
THAT known P1 source/write paths do ✅ proven or explicitly scoped
```

### Vad tredje grinden kräver

1. Kanonisk SourceRegistry V2/F0D-modell existerar i runtime.
2. Harvest/runtime löser källauktoritet genom den modellen.
3. Det hårdkodade parallella registret är inte längre en självständig auktoritet. Det får finnas
   kvar endast som migrationsinput/projektion, och då explicit klassat.
4. Registergodkännande/identitet följer det frysta authority-kontraktet.
5. Ett runtime-nåbart bevis demonstrerar vägen.
6. En negativ guardrail bevisar att den gamla parallella auktoriteten inte kan användas som
   alternativ auktoritativ väg.

**Aktuell status:**

```
P1 contract closure        ✅ CLOSED
P1 enforcement boundary    ✅ PROVEN
P1 authority convergence   ✅ PROVEN_FOR_KNOWN_P1_SURFACES (12 files, 93/93)
P1 release authority       ⚠️ STAGED_PENDING_COMMIT_AND_OWNER — Tor preflight clean; staged set still needs commit and owner closure
P1 overall                  READY_FOR_CLOSURE_REVIEW — owner closure pending
```

## 7. Fryst ordning härifrån

```
A. Etablera P0–P8 som enda program-authority        ✅ 2026-08-11
B. Reclassify befintliga planer under P0–P8          ✅
C. Korrigera och avblockera Codex-planens reconciliation-del   ✅
D. Frys F0D som P2-kontrakt                          ✅
E. Kör P4A read-only reconciliation                  ✅
F. Frys dependency graphen (P4A-LU → P3)             ✅
```

**Roadmap-fasen är härmed avslutad.** Allt återstående arbete är kod och bevis:

```
freeze P4A-LU            ✅ klart
        ↓
A1 red proof            ✅ ESTABLISHED
        ↓
P1 authority enforcement ✅ GREEN PROOF EXECUTED
        ↓
P2 first governed source   (icke-spatial källa möjlig utan stack-pinning)
        ↓
P4A-LU runtime wiring + proof   (S1→S5 i ordningen identity → canonicalization
                                 → fingerprint → version_hash → wiring)
        ↓
P3 canonical LU chain
        ↓
F3B / P8 executed proof
        ↓
HM-1
```

### Enda kvarstående pre-implementation-beslut

`SPATIAL_STACK_V1` — exakta versioner av PostGIS/GEOS/PROJ/GDAL. Måste avgöras **innan första
canonical `SpatialEvidenceArtifact` admitteras** (SPC-R09). Blockerar **inte** ett icke-spatialt
P2-ingestionsspår. Se `P4A-LU-GATE-CONTRACT-2026-08-11.md` §5.

**Ingen mer roadmap-design efter detta dokument.**
