# LU-W2-SEM1-NOT-CHECKED-V1 -- SEM-1 / OD-03 / rule_version 2.0

**Status:** CANDIDATE (not yet frozen, not yet dispatched)
**Unit:** `governance/devgov/units/lu-w2-sem1-not-checked-v1.json`
**Base:** `038286ede85f7826995a0be3b3e612547e36914d` (live main after W1 PROVEN, PR #183)
**Design authority:** K-28 (`W2-DESIGN-DECISION-2026-09-27.md`), K-30 (`W2-UNIT-REVIEW-1fbb5112.md`)

## 1. Scope

ADR-28A section 1 (SEM-1) and MAP-1/MAP-2's OD-03 are owner decisions, already FROZEN on main
since ADR-28A merged (`6b10f5cf`). This unit implements them; it does not re-decide them.

- **SEM-1**: the governed rule chain must distinguish "checked and absent" from "could not be
  checked". A new non-severity finding state, `NOT_CHECKED`, is introduced for exactly that.
- **OD-03**: the legacy producer (`spatialAuditService.ts`) already separates a technical query
  failure from a checked-and-nothing-found result via its existing `distanceToWaterAvailable`
  boolean; this unit proves that trichotomy with tests, since none previously existed, and
  neutralizes prose that assigned a premature meaning to the `{null, available:true}` state.
- **rule_version 2.0**: every governed layer-based rule (LU-WATER-001, LU-EBH-001,
  LU-PROTECTED-001, LU-NATURA2000-001, LU-WATERPROTECTION-001) is bumped to `rule_version: "2.0"`,
  since each one's contract now admits the NOT_CHECKED outcome -- including on findings that are
  still LOW/MEDIUM/HIGH or silent. A rule has one version; it cannot be 1.0 for one outcome and
  2.0 for another. `LU-DOC-BESLUT-001` is NOT bumped: it is predicated on document evidence and
  verified document facts, never on `spatial_evidence`/layer availability, so a spatial layer's
  technical failure has no bearing on its contract.

**A real map finding, registered separately (ChatGPT/map-writer), not fixed here**: the governed
layer named `"water"` (`LU-WATER-001`) is bound in `SpatialLayerRegistry.ts` to `env.sgu_well` --
SGU wells (G1 Brunnar), not a water-body/strandskydd layer. It shares W1's vocabulary by name
only. Ytvatten/strandskydd has no governed layer or rule at all; this unit does not add one.

## 2. What changed

### Governed evidence / rule engine (`packages/mps-lu`)
- `SpatialQueryContract.ts`: added `SpatialLayerUnavailable` (`{dataset, reason}`) and
  `SpatialQueryOutcomeV2` (`{evidence, unavailable_layers}`). `ISpatialProvider.query()`'s return
  type changed from `Promise<SpatialEvidenceArtifact[]>` to `Promise<SpatialQueryOutcomeV2>` --
  a versioned contract change in an allowed path, not a change to the frozen v1
  `SpatialResultSemantics`/`ExistenceWithinDistanceResult` per-evidence-object semantics, which
  are untouched.
- `AssessmentFinding.ts`: `risk_level` widened to `"LOW" | "MEDIUM" | "HIGH" | "NOT_CHECKED"`
  (extracted as an exported `RiskLevel` type). This is `packages/mps-lu`'s own type, unrelated to
  and not merged with the legacy engine's `RiskLevel` (`evaluate-compliance-rules.usecase.ts`,
  `LOW|MEDIUM|HIGH|BLOCK`) -- explicitly left alone per K-28 point 1.
- `LURuleEngine.ts`: `LURuleEvaluationInput` gained an optional `unavailable_layers` field
  (defaults to `[]`, so a caller that never supplies it gets unchanged v1 behavior). A new
  `evaluateUnavailableLayers` step emits one `NOT_CHECKED` finding per declared unavailable layer
  that maps to a known governed rule (`LAYER_RULE_IDS`); an unavailable layer with no known rule
  produces nothing. All five layer-based rule emissions bumped to `rule_version: "2.0"`.
- `LuExecutionKernelClient.ts`: `evaluateLuRuleSet`, `createLuRuleEngineInvokeHandler` and
  `LuKernelRunInput` each gained the same optional `unavailable_layers`/`unavailableLayers`
  plumbing through to `LURuleEngine.evaluate()`.

### Provider (`packages/spatial-provider-postgis`)
- `SpatialProviderPostGIS.ts`: `query()`'s per-layer loop now isolates a genuine query-EXECUTION
  failure (the `SELECT ... WHERE ST_DWithin(...)` call itself throwing) into a
  `SpatialLayerUnavailable` entry, and continues with the remaining layers -- it no longer throws
  for the whole batch on a single layer's technical failure. `SpatialLayerRuntimeBindingError`
  (an identity/admission failure: the connected database does not materialize the dataset a
  layer's `version_hash` claims) is explicitly NOT caught here and still denies the whole request,
  exactly as before this unit -- proven by a dedicated regression test (see below). A failed
  layer's `reason` is `"<Error class>: <message, truncated to 200 chars>"`, never a raw stack
  trace, since it can end up referenced from an assessment artifact.

### Product usecase (`src/application/generate-localization-report.usecase.ts`)
- Consumes the new `{evidence, unavailable_layers}` shape from `provider.query()`, passes
  `unavailable_layers` through to `runCanonicalLuProductAssessment` (`LuKernelRunInput`'s new
  field, inherited by `CanonicalLuKernelRunInput` automatically).
- `evidence: [...mpsEvidence]`: `SpatialQueryOutcomeV2.evidence` is `readonly`;
  `LuKernelRunInput.evidence` predates this unit and still declares a mutable array. Copying at
  this one call site is the minimal, in-scope fix -- widening `LuKernelRunInput.evidence`'s own
  type would touch every existing caller/test of `runLuAssessmentViaKernel`, none of which are in
  this unit's `allowed_paths`.
- **Verdict consequence** (K-28 point 3 / K-30 M3): `GovernedVerdictAnalysis` gained a new
  required field, `unresolvedChecks: readonly {rule_id, finding_id}[]`, added to the local
  intersection type (not to `SiteAnalysis` itself, which lives in the legacy engine's file and is
  out of this unit's scope). `governedVerdictFromFindings` now:
  1. always populates `unresolvedChecks` from any `NOT_CHECKED` findings;
  2. still grades `overallRisk` HIGH/MEDIUM from completed checks exactly as before (NOT_CHECKED
     never raises severity by itself -- it is a non-severity state);
  3. when nothing HIGH/MEDIUM was found but `unresolvedChecks` is non-empty, returns
     `overallRisk: 'LOW'` with `permitProbability: 0.5` (not `0.95`) and a `summary` that states
     the assessment did not complete all checks -- never the same clean-result numbers/text as a
     genuinely complete LOW case.
  `LU_VERDICT_AUTHORITY_V1`'s frozen identity (verdict fields present only when
  `assessment_status === 'ASSESSED'`) is unbroken: `unresolvedChecks` follows the same
  presence/absence rule as `overallRisk`/`permitProbability`, proven by three new cases added to
  `LuVerdictTypeBoundary.type-proof.ts` (T2c, T4/T4b extended, T5e) -- run for real via
  `P3LuVerdictTypeBoundary.test.ts`'s own `tsc -p tsconfig.lu-verdict.json` gate (see Non-claims).
- REQ-8 prose neutralized at the site that previously called the `{null, available:true}` case a
  "genuine 'beyond range' result" (an interpretation OD-03 does not make): now states only that
  the producer returns null with available=true when the bounded query found nothing, and that
  what it means is not decided here. Comment and one test title changed
  (`tests/unit/services/localizationReportService.test.ts`); no assertion logic changed.

## 3. Tests added/changed

- `packages/mps-lu/tests/LURuleEngine.test.ts`: two existing fixtures' `rule_version` pins bumped
  1.0 -> 2.0 (deliberate, documented expectation change, not a silent drift). Six new tests:
  NOT_CHECKED emission for a known layer, the same for all five layer/rule pairs, no finding for
  an unrecognised dataset, the SEM-1 point itself (one unavailable layer does not suppress the
  other layers' real findings), unchanged silent exists:false semantics, and unchanged
  no-argument legacy-caller behavior.
- `packages/spatial-provider-postgis/tests/SpatialProviderPostGISLayerIsolation.test.ts` (new): a
  pure unit test, `pg` fully mocked (both named and default export -- the module graph
  transitively reaches `server/db/prisma.ts` via `@miljobeslut/mps-lu`'s barrel). Three tests: the
  isolation claim itself, and two M4 regression guards (an identity/admission failure still denies
  the whole batch; a failed layer never appears in `evidence` with `exists:false`, whether
  `query()` rejects entirely or resolves with partial evidence).
- `tests/unit/spatialAuditServiceExtended.test.ts`: three new tests proving the OD-03 trichotomy
  directly against the producer (technical failure / checked-and-absent / measured), using the
  file's existing `$queryRaw` mock -- no production code change was needed for these to pass.
- `tests/unit/generateLocalizationReportVerdictNotChecked.test.ts` (new): seven tests against
  `governedVerdictFromFindings` directly (exported for this reason) proving the verdict-consequence
  claim. Not run through the full DB-dependent governed pipeline -- see Non-claims.
- `src/application/types/LuVerdictTypeBoundary.type-proof.ts`: three additions (T2c, T4/T4b
  extended, T5e) proving `unresolvedChecks` participates in the verdict/non-verdict type boundary
  the same way `overallRisk`/`permitProbability` do.
- Nine further test files updated only because their `ISpatialProvider` fakes returned a bare
  array (`query: vi.fn().mockResolvedValue([])`/`async () => []`) or destructured a real
  provider's result as an array (`const [evidence] = await provider.query(...)`), which no longer
  type-checks against `SpatialQueryOutcomeV2`: `LUEnforcement.test.ts`,
  `LUMagicMomentE2E.chain.test.ts`, `LUMagicMomentPostGIS.test.ts`, `SpatialProviderPostGIS.test.ts`
  (destructuring fix, mechanical, no behavior change), `HM1BRealGovernedDocumentChain.test.ts`,
  `HM1CGovernedAssessmentPersistence.test.ts`, `SpatialEvidenceQueryContractV2.test.ts`,
  `P3LuVerdictAuthority.red.test.ts`, `localizationGeometryDrawingProofs.test.ts`,
  `localizationGeometryProductProofs.test.ts`, `luExecutionIdentityScopeV2ProductWiring.test.ts`
  (fake-provider fix, `{evidence: [], unavailable_layers: []}` in place of `[]`).

## 4. Verified evidence

**RED probes** -- each run via its exact JSON-embedded command (not a restated version), against
the true, immutable base_sha in a separate detached worktree, confirmed failing for the intended
semantic reason (not a harness/file-missing error):
- `w2-not-checked-vocabulary`: exit 1, `AssessmentFinding` risk_level vocabulary lacks the
  `"NOT_CHECKED"` literal.
- `w2-rule-version-2-on-governed-rules`: exit 1, all five layer rules still at `"1.0"`.
- `w2-layer-isolation-not-checked`: exit 1 (the isolation assertion fails; the two M4 mirror
  assertions in the same embedded file pass, as designed), temp probe file cleaned up.

**GREEN**, run against the current candidate tree:
- All three RED probes' identical commands pass (candidate has the fix).
- `w2-focused-tests` (real, with the K-15 `prisma generate` preamble): 5 files, 68 tests, exit 0 --
  `LURuleEngine.test.ts`, `SpatialProviderPostGISLayerIsolation.test.ts`,
  `spatialAuditServiceExtended.test.ts`, `localizationReportService.test.ts`,
  `generateLocalizationReportVerdictNotChecked.test.ts`.

**Additional manual verification, not wired into the unit's own GREEN set:**
- `P3LuVerdictTypeBoundary.test.ts` (the real `tsc -p tsconfig.lu-verdict.json` gate): this test
  cannot currently pass in absolute terms -- both its assertions were already failing on the clean
  base, before any change in this unit, due to 6 pre-existing TypeScript errors in
  `luGeometrySupersessionProvisioning.ts`, `CanonicalPropertyArtifacts.ts` and
  `ProductLuContextArtifacts.ts`, none of which this unit touches. Verified by running the gate
  twice against byte-identical states (stash/apply around the implementation), confirming: this
  candidate introduces exactly **zero new errors**, in-surface or out-of-surface, versus that same
  pre-existing baseline. Not claimed as "passes"; claimed only as "introduces no new errors" --
  the honest, verifiable claim.
- The nine test files listed above whose `ISpatialProvider` fakes/destructuring needed fixing for
  type compatibility: of these, `HM1BRealGovernedDocumentChain.test.ts`,
  `HM1CGovernedAssessmentPersistence.test.ts`, `localizationGeometryProductProofs.test.ts` and
  `luExecutionIdentityScopeV2ProductWiring.test.ts` have some cases that need a live Postgres/
  Prisma connection and signing-key environment this session does not have available (Docker was
  paused for disk compaction during this unit's work). Verified, in each case, by running the
  identical test against the untouched base tree and finding the identical failure (same error,
  same assertion, same line) -- confirming the failure is pre-existing and unrelated to this unit,
  not a regression it introduces. The other five files (`LUEnforcement.test.ts`,
  `LUMagicMomentE2E.chain.test.ts`, `LUMagicMomentPostGIS.test.ts`, `SpatialProviderPostGIS.test.ts`,
  `SpatialProviderPostGISV3NumericBoundary.test.ts` needing no change,
  `SpatialEvidenceQueryContractV2.test.ts`) are also DB-dependent integration tests and were not
  executed; the destructuring/mock-shape fixes were verified by direct code reading against each
  call site, and `SpatialEvidenceQueryContractV2.test.ts` specifically (mocks the pg pool
  directly, no live DB needed) was run and passed, 12/12.

**Infrastructure finding, incidental to this unit but affecting its testability**: this worktree's
`node_modules` was set up per K-29 via `robocopy` from `wt-w1-proven` rather than `npm install`.
Robocopy converted the workspace's `node_modules/@miljobeslut/*` symlinks (which point to absolute
paths inside `wt-w1-proven`) into plain directory copies, which broke any cross-package relative
import (e.g. `packages/mps-lu` reaching `packages/mps-governance` via `../../../mps-governance/...`)
-- surfacing as `Failed to resolve import` for several otherwise-unrelated test files. Fixed by
replacing the 29 workspace-package entries under `node_modules/@miljobeslut/` with Windows
junctions pointing at this worktree's own `packages/*` directories (verified: `localizationReport
Service.test.ts` went from a hard import failure to 30/30 passing, matching `wt-w1-proven` exactly).
This is a worktree-local fix; it does not touch git history and is not part of this unit's diff.

## 5. Non-claims

This unit does **not**:
- add a real water-body/strandskydd governed layer, or change what `"water"`/`LU-WATER-001`
  actually measures (SGU wells) -- that naming collision is registered as a map finding, not fixed
  here.
- change OD-04 (bank/Gemini consumers of the legacy engine's verdict) -- a separate, later unit
  per ROLE-MAP.md.
- touch the frozen v1 contracts `SpatialResultSemantics.ts` or `SpatialEngineFingerprint.ts`.
- claim `P3LuVerdictTypeBoundary.test.ts` passes -- it cannot, right now, for reasons entirely
  outside this unit's `allowed_paths`; this unit's own claim is "introduces zero new errors to it",
  verified by an exact before/after diff.
- claim the verdict-consequence tests were run through the full DB-dependent governed pipeline
  (ExecutionKernel, ProjectContextBinding persistence, Prisma) -- they test
  `governedVerdictFromFindings` directly, which is the entire surface the claim is about.
- claim the four DB/Prisma-dependent `ISpatialProvider`-fake test files were verified beyond "the
  same pre-existing failure occurs on the untouched base" -- real runtime verification of those
  four needs a live Postgres and signing-key setup this session did not have available.

## 6. Final disposition

Not yet frozen. Per K-28/K-30's required order: RED probes were cold-reviewed and confirmed before
any production code was written (candidate `1fbb5112`); M1/M2/M4 were addressed (candidate
`7f77f55d`); this candidate is the implementation. Awaiting cold review before freezing the exact
SHA, then the established chain: cold verification -> owner push-go -> PR -> dispatch (owner only)
-> attestation -> merge.
