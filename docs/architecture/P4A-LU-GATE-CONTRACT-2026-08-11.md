# P4A-LU — Spatial convergence gate (FRYST KONTRAKT)

> ```
> Document class:    GATE CONTRACT
> Program parent:    P4A  (P4A-LU ⊂ P4A)
> Program authority: P0–P8 → PROGRAM-P0-P8-AUTHORITY-2026-08-11.md
>
> P4A-LU contract / gate definition   🔒 FROZEN 2026-08-11
> HM1-A authority reconciliation      🔒 OWNER-FROZEN 2026-08-13
> P4A-LU → P3 dependency              🔒 FROZEN 2026-08-11
> P4A-LU-02 admitted v1 semantics     PROVEN_FOR_ADMITTED_EXISTENCE_WITHIN_DISTANCE_V1
> FEATURE_GEOMETRY                    NOT_ADMITTED_FOR_HM1_V1
> ```

**Läs statusblocket ovan noga.** Ett fryst kontrakt talar om vad implementationen *måste*
uppfylla. Att implementationen är trasig är därför inget skäl att hålla kontraktet i DRAFT —
det är tvärtom skälet till att kontraktet behövs. S1–S4 och B1 nedan var röda mål mot detta
frysta kontrakt. S5 är efter HM1-A dormant tills `FEATURE_GEOMETRY` admitteras.

Normativt underlag: `TV-S1-Spatial-Verification-Layer.md` (FRYST), `TV-4.3-Spatial-Processing-
Compatibility.md` (FRYST), `ADR-29-TV4-Spatial-Foundation.md` (Frozen), `ADR-28` §2,
`ADR-SPATIAL-PRESENTATION-EVIDENCE-CONTRACT.md` (ACCEPTED/SEQUENCE FROZEN).
Härledning: `P4A-SPATIAL-RUNTIME-RECONCILIATION-2026-08-11.md`,
`P4A-LU-SPATIAL-CONTRACT-READING-2026-08-11.md`.

---

## 1. De sex frysta gatesen

```
P4A-LU-01 — Capability-resolved runtime provider
  The active LU runtime path SHALL resolve spatial queries through exactly one
  production ISpatialProvider, obtained via the engine-neutral capability registry
  (spatial.*), never by direct vendor construction.
  [TV-S1 §9; TV-4.3 §8 / SPC-R08]

P4A-LU-02 — Canonical query/evidence semantics
  Evidence identity SHALL bind every semantic input capable of changing the spatial
  result, including:
    - the EFFECTIVE (post-budget) parameters actually executed, not the requested ones
    - the complete engine fingerprint (PostGIS, GEOS, PROJ, GDAL) as exact versions,
      no wildcards
    - input layers by version_hash, never by label alone
  [SV-I03; TV-S1 §4, §5.1; TV-4.3 §5, §9]

P4A-LU-03 — No alternate LU spatial path
  No LU production path may bypass the canonical provider by querying PostGIS/Prisma
  directly for evidence-bearing spatial facts. SHALL be enforced by a static
  architecture test, not merely by removing a barrel export.

P4A-LU-04 — Replay isolation
  LU replay SHALL resolve captured canonical evidence and SHALL NOT re-query PostGIS.
  [TV-S1 §8; ADR-24-23]

P4A-LU-05 — Executed runtime proof
  The above SHALL be demonstrated from the real application/runtime entrypoint, not
  only package-scoped tests.
  [= ADR-29 Gate B: "Proven mapping of query → spatial result → evidence"]

P4A-LU-06 — Canonical geometry form before FEATURE_GEOMETRY admission
  FEATURE_GEOMETRY is NOT_ADMITTED_FOR_HM1_V1. Before FEATURE_GEOMETRY can be
  admitted, sv-canonical-1 SHALL be implemented in code before its constant is used
  as a geometry hash prefix: fixed CRS, fixed axis order, fixed decimal grid with
  rounding BEFORE serialization, normalized ring orientation, normalized
  vertex/component order, explicit empty/null encoding, rounded measurements.
  [SV-I07; TV-S1 §12 DoD marks this ❌ implementation phase]
```

## 2. Programberoende (fryst)

```
P4A-LU ──required_before_PROVEN──> P3 / HM-1

P4A-LU ⊂ P4A
P4A broad cleanup   ≠ blocker for P3
P4B / HC-S1         ≠ blocker for P3
```

Detta hindrar **inte** att LU-implementation påbörjas parallellt. Det innebär att **P3 inte får
status PROVEN / HM-1** förrän P4A-LU är satisfied *och* exekverat bevis finns.

## 3. Röda mål mot det frysta kontraktet

| ID | Avvikelse | Bryter mot | Status |
|---|---|---|---|
| **S1** | `engine_fingerprint: { postgis: "3.x" }` — bokstavligen den wildcard SV-I03 förbjuder | `P4A-LU-02` | **PROVEN_FIXED** |
| **S2** | `engine_fingerprint` ligger **utanför** identitetsdomänen — `buildSpatialEvidenceIdentityPayload()` binder bara `algorithm` + `engine` | `P4A-LU-02` | **PROVEN_FIXED** |
| **S3** | Ofullständig stack: GEOS/PROJ/GDAL saknas i fingerprintet | `P4A-LU-02` | **PROVEN_FIXED** |
| **S4** | Lager binds via etiketten `layer_version: "v1"` i stället för `version_hash` | `P4A-LU-02` | **PROVEN_FIXED** |
| **S5** | `sv-canonical-1` geometry rules are not implemented | `P4A-LU-06` | **DORMANT / NOT_APPLICABLE_TO_ADMITTED_HM1_V1_RESULT_SEMANTICS** |
| **B1** | Effective- vs requested-parameterbindning vid budgetklippning | `P4A-LU-02` | **PROVEN_FOR_ADMITTED_EXISTENCE_SEMANTICS** |

B1 behöver inte avgöras för att invariantens ordalydelse ska kunna frysas. Den måste avgöras
innan P4A-LU kan passera.

### S2 är den arkitektoniskt allvarligaste

```
artifact carries engine_fingerprint
        men
identity does not bind engine_fingerprint
```

Konsekvens: två artefakter producerade på olika exekveringsstack kan få samma identitet om
övriga inputs sammanfaller. Det strider direkt mot TV-S1 §5.2 — *"substituting an engine
produces a new evidence identity, not an equal one"*. S1 är mer uppenbar; S2 är värre.

## 4. Implementationsordning (normativ)

```
1. identity schema
2. canonicalization  (sv-canonical-1; conditional on FEATURE_GEOMETRY admission)
3. exact stack fingerprint
4. version_hash layer binding
5. provider runtime wiring
```

**Inte** att koppla in providern först och "fixa hashen efteråt". Varje evidens producerad före
steg 1–4 blir en framtida migreringspost.

### S5 får inte småpatchas när den aktiveras

`sv-canonical-1` ska vara en faktisk, definierad canonicalizer. Ett `toFixed(6)` insprängt
någonstans uppfyller inte kontraktet. Identitetskedjan SKA vara:

```
semantic spatial inputs
        ↓
sv-canonical-1          (verklig canonicalizer)
        ↓
canonical bytes
        ↓
content / evidence identity
```

och inte:

```
JSON-ish object → hash prefix säger "sv-canonical-1"
```

Det senare är exakt den falska canonicalization-markör S5 identifierar.

### HM1-A — authority reconciliation (owner-frozen 2026-08-13)

```text
EXISTENCE_WITHIN_DISTANCE_V1   ADMITTED_FOR_HM1_V1
FEATURE_GEOMETRY               NOT_ADMITTED_FOR_HM1_V1
S5 / R5 / R6                   DORMANT_UNTIL_FEATURE_GEOMETRY_ADMISSION

P4A-LU-02                      PROVEN_FOR_ADMITTED_EXISTENCE_WITHIN_DISTANCE_V1
```

Detta försvagar inte P4A-LU-02 och öppnar inte om dess exekverade bevis. Den admitterade
v1-semantiken är ett existensresultat med `geometry: null`; ingen geometri produceras eller
påstås vara canonicaliserad. Ingen claim görs att `FEATURE_GEOMETRY` eller
`sv-canonical-1`-reglerna är implementerade eller bevisade.

Aktiveringsvillkoret är normativt och får inte kringgås:

```text
owner decision admits FEATURE_GEOMETRY
        ↓
S5 / R5 / R6 become ACTIVE and BLOCKING
        ↓
sv-canonical-1 implementation + separate executable proof
        ↓
FEATURE_GEOMETRY may be used
```

Att kalla S5 `DORMANT` är inte en waiver. Kravet förblir bindande för den framtida
resultatsemantik som faktiskt bär geometri.

## 5. Öppet ägarbeslut: `SPATIAL_STACK_V1`

Det frysta kravet (SPC-R09 + SV-I03) är:

```
no wildcards
exact versions
full required fingerprint
pin before evidence production
```

Vilka exakta versioner som blir `SPATIAL_STACK_V1` är ett **ägarbeslut som inte fattas här**:

```
SPATIAL_STACK_V1
  PostGIS = exact
  GEOS    = exact
  PROJ    = exact
  GDAL    = exact
```

TV-4.3 §9 registrerar en redan verifierad baseline (PostGIS 3.4.3, GEOS 3.9.0, PROJ 7.2.1,
GDAL 3.2.2). Att välja den är enkelt. Ska miljön uppgraderas är det uppgraderingen som ska ske
**först**, och de verkliga versionerna frysas därefter.

### Blockeringsyta — precis så bred som kontraktet kräver, inte bredare

```
Stack-pinning MUST be resolved before the first production/canonical
SpatialEvidenceArtifact is admitted.
```

**Inte** "all P2 implementation waits for stack pinning". P2:s governed ingestion kan arbeta med
en icke-spatial första källa:

```
P1 → P2 first governed non-spatial source ingestion     ← ej blockerad
P3 spatial runtime → first canonical SpatialEvidenceArtifact  ← blockerad tills pinnad
```

## 5b. Konsoliderad programstatus (ägarformulering 2026-08-11)

```
P4A reconciliation                       COMPLETE
P4A-LU normative scope                   COMPLETE

P4A-LU contract                          FROZEN   (ägarbedömning: READY_TO_FREEZE → fryst)
P4A-LU → P3 dependency                   FROZEN   (ägarbedömning: READY_TO_FREEZE → fryst)

P4A-LU admitted v1 implementation         TECHNICALLY_CLOSED
  S1 exact fingerprint                    PROVEN
  S2 fingerprint bound into identity      PROVEN
  S3 complete stack fingerprint           PROVEN
  S4 authoritative layer version_hash     PROVEN
  S5 geometry canonicalization            DORMANT_UNTIL_FEATURE_GEOMETRY_ADMISSION
  B1 effective parameters                 PROVEN_FOR_ADMITTED_EXISTENCE_SEMANTICS

P4A-LU-02 proof scope                     PROVEN_FOR_ADMITTED_EXISTENCE_WITHIN_DISTANCE_V1
FEATURE_GEOMETRY proof                    NOT_CLAIMED / NOT_ADMITTED_FOR_HM1_V1

P4A broad                                remains separate
P4B / HC-S1                              remains later coverage work
GIS presentation bypass                  KNOWN_BROKEN / HM-P, not P3
```

## 6. Utanför P4A-LU

- Bred P4A-sanering (presentationsgränsen i `gis.routes.ts` — registrerad separat i
  `architecture-authority-map.jsonc` som `SPATIAL_PRESENTATION_EVIDENCE_BYPASS`, blockerar HM-P,
  inte P3).
- P4B / HC-S1: nationell täckning, `layer_id`-populationer, ADMIT-V1-efterlevnad, SPC-R07
  read-only-roll.
- QGIS-integration, raster, 3D (ADR-29 TV-4.2–4.7).

**Spatial reconciliation är härmed avslutad.** Nästa spatiala arbete är implementation och
bevis, inte ytterligare kontraktsanalys.
