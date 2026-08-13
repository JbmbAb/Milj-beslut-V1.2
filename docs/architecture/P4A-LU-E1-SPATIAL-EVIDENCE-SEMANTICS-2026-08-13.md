# P4A-LU-E1 — Spatial Evidence Identity & Truthfulness (RED BASELINE)

> ```
> Document class:    RED BASELINE + DECISION PROPOSAL
> Program parent:    P4A-LU  (gate contract 🔒 FROZEN 2026-08-11)
>
> P4A-LU-E1 investigation            COMPLETE 2026-08-13
> P4A-LU-E1 red baseline             ESTABLISHED
> Geometry result semantics          🔒 OWNER-FROZEN — EXISTENCE_WITHIN_DISTANCE_V1
> HM1-A authority reconciliation     🔒 OWNER-FROZEN 2026-08-13
> ```

Scope: define what the spatial evidence geometry claims to be, and establish an executable red
baseline for the identity and truthfulness violations. **No provider rewiring, no fixes.**

Normative parent: `P4A-LU-GATE-CONTRACT-2026-08-11.md` (S1–S5, B1).

---

## 1. The decisive observation

`SpatialProviderPostGIS.query()` issues:

```sql
SELECT 1 AS hit
FROM <layer table>
WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint($1,$2), 3006), $3)
LIMIT $4
```

**The query never selects geometry.** `createEvidence()` therefore cannot bind the matched
feature geometry — it has none. It fabricates one instead:

```ts
coordinates: [[
  [easting - 0.001, northing - 0.001],
  [easting + 0.001, northing - 0.001],
  [easting + 0.001, northing + 0.001],
  [easting - 0.001, northing + 0.001],
  [easting - 0.001, northing - 0.001],
]]
```

In SWEREF99 TM these are metres, so this is a **2 mm square centred on the query point**. It is
unrelated to the feature that was found, to the search radius, and to the distance between them.

This is not an oversight in `createEvidence()` that can be patched there. The provider is
structurally an **existence oracle** — it answers "is there a feature within X metres, yes/no" —
while the artifact it emits claims to carry a spatial result geometry. The defect is in the
contract between those two, which is why it needs a semantic decision before any code changes.

### Registered as a distinct blocker

```
P4A-LU-S6 — Spatial evidence geometry truthfulness

Status: KNOWN_BROKEN

Invariant:
  SpatialEvidenceArtifact geometry SHALL represent the actual spatial result, or
  explicitly declared result-geometry semantics.

Observed:
  The layer query selects no geometry (`SELECT 1 AS hit`). createEvidence() fabricates a
  ±0.001 m envelope around the query point and binds it as the evidence geometry.
```

**S6 must be kept separate from S5 (`sv-canonical-1`).** Canonicalizing the wrong geometry only
makes untrue content deterministic. Ordering S5 before S6 would produce stable hashes over
fabricated data — the worst of the available outcomes, because it looks correct.

---

## 2. OWNER DECISION — 🔒 FROZEN 2026-08-13

```
S6 v1 result semantics       EXISTENCE_WITHIN_DISTANCE
Frozen principle             SpatialEvidence identity SHALL bind the declared result semantics
Contract form                packages/mps-lu/src/artifacts/SpatialResultSemantics.ts
Migration into payload       NOT DONE — next work unit
```

Rejected for v1: **B (result-set envelope)** and **D (search buffer)** — both yield an artifact
that looks geometrically rich while only summarising the search. The current implementation is D
with the wrong radius, which is how the defect went unnoticed.

Chosen: **E**, an explicit existential result with no feature geometry. It is what the LU rules
actually ask ("finns skyddat område / vatten / EBH inom X meter?") and the only claim the
executed SQL can truthfully support. **A (matched feature geometry)** stays reserved as
`FEATURE_GEOMETRY`: named so identity can distinguish it, not admitted until a provider can
honestly populate it.

Because `result_semantics` is an identity input, introducing `FEATURE_GEOMETRY` later produces
new evidence rather than reinterpreting old evidence.

The options as assessed before the decision are kept below for the record.

| Option | Geometry binds | Consequence |
|---|---|---|
| **A. Matched feature geometry** | the actual feature(s) found | Truthful and most useful. Requires selecting geometry, and forces a decision on multi-feature results and on redistribution rights for third-party layer data. |
| **B. Result-set envelope** | bounding box of all matches | Cheap, bounded payload. Loses per-feature detail; envelope of scattered matches can be misleading. |
| **C. Distance witness** | nearest point / shortest line | Directly evidences the `ST_DWithin` predicate that was actually evaluated. Narrow but honest. |
| **D. Query buffer geometry** | the search buffer itself | Evidences the *question*, never the *answer*. Only defensible if the artifact also declares it carries no result geometry. |
| **E. No geometry** | `null`, with an explicit existence-only result type | Matches what the provider actually computes today. Requires the artifact contract to admit a geometry-free existence result, and the viewer/QGIS path to handle it. |

Note that the current implementation is **none of these** — it is D with the wrong radius.

Recommended sequencing regardless of choice: decide the semantics, then encode it as a declared
field on the artifact (e.g. `result_geometry_kind`) so that a future change of semantics changes
the identity rather than silently reinterpreting existing artifacts.

---

## 3. Red baseline — what is executably proven broken

`packages/spatial-provider-postgis/tests/P4ALUE1SpatialEvidence.red.test.ts`

Follows the existing red-proof convention (`A1AuthorityBypass.red.test.ts.historical`): these
tests are **expected to fail** and are the measurement point for the fix.

| # | Assertion | Gate | Sub-finding |
|---|---|---|---|
| R1 | Two payloads differing only in `engine_fingerprint` must not share an identity | P4A-LU-02 | S2 |
| R2 | The identity payload must contain the engine fingerprint | P4A-LU-02 | S2 |
| R3 | The pinned stack must contain no wildcard and must name PostGIS, GEOS, PROJ, GDAL | P4A-LU-02 | S1, S3 |
| R4 | Every layer in `SPATIAL_LAYER_REGISTRY` must carry a `version_hash` | P4A-LU-02 | S4 |
| R5 | Ring orientation must be normalized before hashing (sv-canonical-1) | P4A-LU-06 | S5 — **DORMANT_UNTIL_FEATURE_GEOMETRY_ADMISSION** |
| R6 | Coordinates below the decimal grid must collapse to one identity (sv-canonical-1) | P4A-LU-06 | S5 — **DORMANT_UNTIL_FEATURE_GEOMETRY_ADMISSION** |
| R7 | The layer query must select geometry | P4A-LU-02 | **S6** |
| R8 | Effective executed parameters must be bound into identity | P4A-LU-02 | B1 |

---

## 4. B1 resolved — effective vs requested parameters

B1 was `UNVERIFIED / REQUIRED_PROOF`. It splits in two:

**Search distance — NOT a defect.** `bufferDistance` is fail-closed, not clipped:

```ts
if (bufferDistance > budget.max_distance_meters) throw new Error("REJECT_SPATIAL_BUDGET: ...")
```

An over-budget request is rejected rather than silently reduced, so the executed distance always
equals the requested one. This is the correct discipline and needs no change.

**Feature limit — IS a defect.** `budget.max_features_per_layer` is applied as `LIMIT $4` in the
executed SQL. It changes the result set, and it is **not bound into identity** —
`query_context.parameters` carries only `property_ref` and `search_distance_meters`. Two runs
under different feature budgets can produce the same evidence identity from different executions.

```
B1  →  B1a search distance      RESOLVED / NOT_A_DEFECT
       B1b feature limit        CONFIRMED VIOLATION of P4A-LU-02
```

### Incidental observation (not a gate finding)

The budget-exceeded check at `SpatialProviderPostGIS.ts:124` is unreachable: the SQL already
applies `LIMIT max_features_per_layer`, so `rowCount` can never exceed it. Recorded so it is not
mistaken for working enforcement later. **No change made.**

---

## 5. Frozen implementation order (proposed)

Amends the gate contract's §4 order to place truthfulness first:

```
1. spatial evidence result semantics        ← 🔒 FROZEN (§2) — EXISTENCE_WITHIN_DISTANCE
2. truthful result geometry                 ← S6  BLOCKING FIRST (S5 is BLOCKED_BY_S6)
3. identity schema                          ← S2, B1b
4. sv-canonical-1 implementation            ← S5, only after FEATURE_GEOMETRY admission
5. exact engine fingerprint                 ← S1, S3
6. layer version_hash binding               ← S4
7. capability registry / provider resolution ← P4A-LU-01
8. static no-bypass enforcement             ← P4A-LU-03
9. real runtime entrypoint proof            ← P4A-LU-05
```

Steps 7–9 stay last. The gate contract already warns that wiring the provider before identity is
correct turns every artifact produced in the meantime into a migration item; with S6 open, those
artifacts would additionally carry untrue geometry.

---

## 6. Status

```
P4A-LU-E1 investigation       COMPLETE
P4A-LU-E1 historical baseline ESTABLISHED
B1                            PROVEN_FOR_ADMITTED_EXISTENCE_SEMANTICS
S6                            CLOSED / PROVEN
Geometry semantics            OWNER-FROZEN — EXISTENCE_WITHIN_DISTANCE_V1
P4A-LU-02                     PROVEN_FOR_ADMITTED_EXISTENCE_WITHIN_DISTANCE_V1
FEATURE_GEOMETRY              NOT_ADMITTED_FOR_HM1_V1
S5 / R5 / R6                  DORMANT_UNTIL_FEATURE_GEOMETRY_ADMISSION
HM-1                          BLOCKED_ON_GOVERNED_END_TO_END_LU_EVIDENCE_AND_RELEASE_PROOF
```

HM1-A gör inget påstående om att `FEATURE_GEOMETRY` eller dess geometry-canonicalization är
implementerad. Ett framtida owner-beslut att admittera `FEATURE_GEOMETRY` aktiverar S5/R5/R6
som blockerande krav och kräver separat implementation och exekverbart proof före användning.
