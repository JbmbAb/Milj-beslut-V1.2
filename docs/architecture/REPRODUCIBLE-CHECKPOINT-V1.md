# REPRODUCIBLE-CHECKPOINT-V1

> ```
> Document class:                    AUTHORITY / GATE DEFINITION
> Status:                            FROZEN (this document's contract) —
>                                     the gate it defines is NOT_REACHED
> Supersedes:                        ad hoc "checkpoint" discussion across the
>                                     feat/p2-p3-governed-chain-reproducible session
> Scope:                             defines what REPRODUCIBLE CHECKPOINT V1 means,
>                                     and freezes four decisions the gate depends on
> ```

## Why this document exists

Packaging work on `feat/p2-p3-governed-chain-reproducible` (UNIT 1 + UNIT 3, Phase
A–E) repeatedly deferred a declaration of "checkpoint reproducible" because each
phase surfaced a new open question rather than closing one. That produced two
goals that had silently merged into one:

- **Packaging / worktree hygiene** — get local work committed, pushed, and
  legible.
- **Reproducible checkpoint** — a state where canonical can actually be built,
  tested, and reproduced from a clean checkout.

The first has made real progress (working tree: 191 → 70 entries this session).
The second has not moved, because it was never given a closed definition. This
document closes that gap. It is the single source of truth for what
"reproducible checkpoint" requires; nothing on the branch may be described as a
checkpoint using looser criteria than the ones frozen here.

---

## 1. Source Registry authority — FROZEN

```
SOURCE_REGISTRY_COUNT
CANONICAL                         = 11
SOURCE                             source-registry/national-registry.json
VERIFIED BY                        packages/mps-data-governance/scripts/validateRegistry.ts
                                    (packages/mps-legal-corpus, 11/11, exit 0)
```

**Decision:** 11 is canonical. Any test asserting a registry length of 9 is
**stale proof / test drift**, not evidence of a legitimate alternative
authority state. The registry has already moved past 9 in committed history
(`45a358c`); production code and the validator already operate against 11.
Rolling the registry back to 9 to satisfy old assertions would be authority
reversed by test, which this document explicitly forbids.

**Affected tests** (assert `toHaveLength(9)`, must be updated to 11, not the
registry):

- `tests/unit/P2Auth03D3LegacySourceAcquisitionEnforcement.test.ts`
- `tests/unit/P2Auth03E1LegacyDiscoveryAcquisitionEnforcement.test.ts`
- `tests/unit/P2Auth03E2ANvvLegacyAcquisitionEnforcement.test.ts`
- `tests/unit/P2Auth03E3ASguLegacyCrawlerEnforcement.test.ts`

This is tracked as **RC4** below and is not yet closed by this document —
freezing the authority is not the same act as updating the four assertions.

---

## 2. Compliance triage — 12/12 classified, 0 real regressions

Twelve `compliance`-project failures surfaced when the project was run for the
first time this session (Phase A). All twelve were traced to root cause before
being classified; none required guessing.

**Scope proof:** every failing test's own source path, and every file each
test depends on, was checked against both (a) the full diff of this session's
20+ commits (`64be3db..HEAD`, spanning `scripts/audit/`,
`packages/mps-artifact-store/`, `packages/mps-compliance/`,
`packages/spatial-provider-postgis/`, `packages/mps-runtime/`,
`packages/mps-lu/`) and (b) the remaining uncommitted working tree. Both came
back empty. **None of the twelve are caused by this session's work.**

| # | Test | Class | Finding |
|---|---|---|---|
| 1 | `scripts/audit/final-freeze-audit.test.ts` | **E — stale/heuristic proof (verified false positive)** | The audit scans `packages/**/*.ts` for files containing both the substrings `fs.writeFileSync` and `artifact_type`, with no AST awareness. Commit `f7b65e4` (this session) added the word `artifact_type` to a **code comment** in `FileCheckpointStore.ts:114`, tripping the heuristic. Verified: the file's only `fs.writeFileSync` calls write `HarvestExecutionCheckpoint` and quarantine records — no object literal containing `artifact_type` is ever written to disk. No CAS bypass exists. Final class is **E**, not A: the audit's proof no longer reflects a real invariant violation, the same failure mode as a stale test assertion. It is counted under E, not carved out as a special case, so the tally below stays mechanically checkable. |
| 2 | `scripts/audit/master-boundary-audit.test.ts` | **B — pre-existing** | Flags 7 already-committed test files (`SpatialProviderPostGIS.test.ts`, `LUMagicMomentPostGIS.test.ts`, `LUEnforcement.test.ts`, `VerticalProof.test.ts`, `P4ALUViewerS6Reconciliation.test.ts`, `F9ReplayContract.test.ts`, `F8ViewerCapabilityAdmission.test.ts`) as unauthorized CAS bypass paths. None touched this session. |
| 3–5 | `packages/mps-artifact-store/tests/ReplicationAdversarial.test.ts` (3 cases) | **E — stale proof** | `ArtifactSyncProtocol.ts:65` throws `WRONG_RELEASE_BINDING` before the stale-state / incomplete-replication / hash-mismatch checks these tests exist to exercise, because the test fixtures never set `manifest.release_hash` to the expected value. Production validation gained a check the fixtures were never updated for. |
| 6–9 | `packages/mps-compliance/package24/EVT.test.ts` (4 cases) | **E — stale proof** | Same family: fixtures no longer satisfy a canonical-reference validator (`non-canonical subject_ref`, `non-canonical causal ref`) that has since been tightened. |
| 10 | `packages/spatial-provider-postgis/tests/LUMagicMomentE2E.chain.test.ts` | **C — environment/DB dependent** | `relation "env.kulturmiljo_omrade" does not exist`, `relation "hydro.water_catchment" does not exist`. Neither `tests/setup/seedGisStubs.ts` nor `scripts/db/provision-spatial-test-db.ts` provisions these tables. Schema gap, not a code defect. |
| 11 | `packages/mps-artifact-store/src/tests/golden/GoldenRepositoryReplay.test.ts` | **B — pre-existing** | `repo.lineage.ancestors is not a function`. The `lineage` property exists (`DefaultArtifactRepository.ts:21`); the `.ancestors()` method the test calls does not exist on `ArtifactLineage`. Test has never matched the implementation. |
| 12 | `packages/mps-runtime/src/verification/generality/GeneralityProof.test.ts` | **E — stale proof** | `SpatialEvidenceArtifact.result_semantics` is a required, non-optional field. The test's fixture constructs evidence without it. |

```
A (real canonical regression)   = 0
B (pre-existing known broken)   = 2   (master-boundary-audit, GoldenRepositoryReplay)
C (environment/DB dependent)    = 1   (LUMagicMomentE2E)
D (flake/order-dependent)       = 0
E (stale proof vs new authority)= 9   (final-freeze-audit, ReplicationAdversarial x3,
                                       EVT x4, GeneralityProof)
UNKNOWN                          = 0
                                 ------
TOTAL                            = 12  (0+2+1+0+9, matches the 12 failing cases,
                                        classes are mutually exclusive — no case
                                        is double-counted or carved out)
```

**Decision:** A = 0 is the material result. B, C and E are documented technical
debt, not checkpoint blockers — none represents canonical regressing under
this session's changes. Finding #1 (final-freeze-audit false positive) should
be fixed by rewording the triggering comment or tightening the audit's matcher
to AST-level checks, at some future point; it is not urgent and not a proof of
a real CAS-bypass.

---

## 3. DB-3 canonical schema — PRINCIPLE FROZEN, IMPLEMENTATION OPEN

```
EBH             canonical (normalized read model) = id
                raw / source-faithful             = fid

protected_area  canonical (normalized read model) = nvr_id
                raw / source-faithful             = nvrid

PRINCIPLE       raw source feeds a materializer;
                the materializer writes the canonical (normalized) model;
                runtime and tests consume the canonical model only —
                they do not invent or re-derive schema.
```

This follows the already-frozen spatial-schema-ownership decision (option C:
raw source + normalized read model), applied specifically to the two
divergences discovered during this session's checkpoint proofs (EBH
`fid`/`id` in `provision-spatial-test-db.ts` vs `seedGisStubs.ts`;
`protected_area` `nvrid`/`nvr_id` across `publicUiService.ts` and test
provisioning).

**The principle is frozen. No further recon is required on which column wins.**
What remains is explicitly **not yet done**:

- versioned DDL for both tables under the normalized names,
- a materializer that writes canonical from raw,
- a migration that carries existing data,
- runtime and test consumers updated to read canonical only.

None of this exists yet. This document freezes the *decision*; it does not
claim the *implementation*. Tracked as **RC6** below.

---

## 4. UNIT 4 (Cesium/geo presentation layer) — ownership FROZEN

```
OWNS            Cesium rendering, GeoJSON/map adapters, presentation-layer code
DOES NOT OWN    spatial schema authority (§3 above)
                governance authority (UNIT 3)
                evidence authority (LU / governance contracts)
CONSUMES        canonical spatial/evidence contracts published by their
                respective authorities — it may not define them
```

This narrows UNIT 4's blast radius: presentation code may read canonical
contracts, never author them. The unresolved question from earlier recon
(who owns the ~13 modified Cesium/geo files, `OWNER NOT ESTABLISHED`) is
scoped by this freeze but not resolved by it — UNIT 4 still needs an owner
decision before it can be packaged; this document only constrains what that
owner is and is not allowed to claim.

---

## REPRODUCIBLE_CHECKPOINT_V1 — gate definition

```
STATUS = NOT_REACHED

SATISFIED
  RC1   canonical branch synchronized           ahead/behind 0/0 at 8bc79eb
  RC3   registry authority = 11                 frozen in §1 above
  RC5   compliance triage complete, UNKNOWN = 0  §2 above, 12/12 classified
  RC7   UNIT 4 ownership frozen                  §4 above

OPEN
  RC2   working-tree parking record              70 entries: mostly classified
                                                  by unit, not yet recorded as a
                                                  committed parking document
  RC4   stale registry-count proofs, 9 -> 11      4 assertions listed in §1
  RC6   DB-3 versioned canonical schema +
        materializer + migration                 principle frozen (§3), nothing
                                                  built yet
  RC8   clean-checkout checkpoint proof           NOT ATTEMPTED

INVARIANT
  RC8 may only become PROVEN by executing the required checkpoint test lanes
  against a fresh clone/checkout of the canonical branch. It MUST NOT be
  inferred solely from RC4 and RC6 reporting complete — closing RC4 and RC6
  makes RC8 attemptable, not true. RC8 is a result of execution, not a
  deduction from planning.
```

## Required checkpoint test lanes (for RC8, once attempted)

At minimum: `unit`, `component`, and the `compliance` subset covering
`packages/mps-data-governance`, `packages/mps-legal-corpus`,
`packages/spatial-provider-postgis`. A fresh checkout must provision its own
test database (`scripts/db/provision-spatial-test-db.ts`) and opt in to
DB-0-SAFETY (`GIS_TEST_DB_DISPOSABLE=1` / `GIS_TEST_DB_NAME` in a local,
untracked `.env.test`) before those lanes can run at all — this document does
not change that requirement.

## Next order

```
RC2 -> RC4 -> UNIT 2 / DB-3 (RC6) -> clean-checkout proof (RC8)
```

RC2 and RC4 are small and close before UNIT 2 begins, so UNIT 2's closure/
recon pass starts from a documented, definitionally clean state rather than
an implicitly-clean one.
