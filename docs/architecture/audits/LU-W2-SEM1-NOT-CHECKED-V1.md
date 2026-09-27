# LU-W2-SEM1-NOT-CHECKED-V1 -- SEM-1 / OD-03 / rule_version 2.0

**Status:** CANDIDATE (not yet frozen, not yet dispatched)
**Unit:** `governance/devgov/units/lu-w2-sem1-not-checked-v1.json`
**Base:** `038286ede85f7826995a0be3b3e612547e36914d` (live main after W1 PROVEN, PR #183)
**Design authority:** K-28 (`W2-DESIGN-DECISION-2026-09-27.md`), K-30 (`W2-UNIT-REVIEW-1fbb5112.md`),
K-35 (`W2-COLD-REVIEW-d27d240a.md`) -- candidate `d27d240a` was NOT_VERIFIED; M5/M6 below are the
corrections made in response, on top of `d27d240a`.

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
- **Verdict consequence** (K-28 point 3 / K-30 M3, corrected per K-35 M5): `GovernedVerdictAnalysis`
  gained a new required field, `unresolvedChecks: readonly {rule_id, finding_id}[]`, and its
  `permitProbability` was widened from `SiteAnalysis`'s plain `number` to `number | null` --
  `Omit<SiteAnalysis, 'permitProbability'> & { permitProbability: number | null, ... }`, since a
  plain intersection with the legacy `SiteAnalysis`'s `number` would have collapsed back to
  `number`. Both changes are to the local intersection type, not to `SiteAnalysis` itself (the
  legacy engine's own file, out of this unit's scope). `governedVerdictFromFindings` now:
  1. always populates `unresolvedChecks` from any `NOT_CHECKED` findings;
  2. still grades `overallRisk`/`permitProbability` HIGH (0.2) or MEDIUM (0.5) from completed
     checks exactly as before (NOT_CHECKED never raises severity by itself -- it is a
     non-severity state);
  3. when nothing HIGH/MEDIUM was found but `unresolvedChecks` is non-empty: `overallRisk: 'LOW'`
     (nothing severe was found among the checks that DID complete) but **`permitProbability:
     null`** -- not a number. The first candidate (`d27d240a`) used `0.5` here; cold review (K-35
     M5) correctly identified this as a second fabrication of exactly the kind ADR-28A/OD-03
     retired from the legacy engine ("no permit/risk number may be derived solely from a
     null/unmeasured [signal]"; J-2 forbids presenting an uncalibrated number as a probability at
     all). `summary` states the assessment did not complete all checks.
  `null` occurs **only** together with a non-empty `unresolvedChecks` -- this is a runtime
  invariant of `governedVerdictFromFindings`, proven directly across seven representative
  finding-combinations in `generateLocalizationReportVerdictNotChecked.test.ts`, not a structural
  constraint expressible on two independent object fields at the type level (this repository's
  `tsconfig.json` has `strictNullChecks` off, so `null` is unconditionally assignable to `number`
  regardless of narrowing -- confirmed directly: an attempted `@ts-expect-error` on an unguarded
  `number | null -> number` read produced TS2578 "Unused '@ts-expect-error' directive", i.e. the
  read compiles fine either way. See `LuVerdictTypeBoundary.type-proof.ts`'s T6 comment for the
  full reasoning).
  `LU_VERDICT_AUTHORITY_V1`'s frozen identity (verdict fields present only when
  `assessment_status === 'ASSESSED'`) is unbroken: `unresolvedChecks` follows the same
  presence/absence rule as `overallRisk`/`permitProbability`, proven by four new cases added to
  `LuVerdictTypeBoundary.type-proof.ts` (T2c, T4/T4b extended, T5e, T6) -- run for real via
  `P3LuVerdictTypeBoundary.test.ts`'s own `tsc -p tsconfig.lu-verdict.json` gate (see Non-claims).
  `isAssessed`/`rankedProbability` (the report's ranking-population filter) were extended to
  exclude a site with `permitProbability: null` from ranking/comparison, the same way a
  non-verdict site is excluded, even though its `assessment_status` is technically `'ASSESSED'` --
  ranking such a site (even at a floor value) would still be inventing a comparison ADR-28A/OD-03
  forbid.
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
- `tests/unit/generateLocalizationReportVerdictNotChecked.test.ts` (new, extended per K-35 M5):
  eight tests against `governedVerdictFromFindings` directly (exported for this reason) proving
  the verdict-consequence claim, including the `permitProbability: null` correction and a
  dedicated runtime-invariant test across seven finding-combinations proving `null` occurs only
  together with a non-empty `unresolvedChecks`. Not run through the full DB-dependent governed
  pipeline -- see Non-claims.
- `src/application/types/LuVerdictTypeBoundary.type-proof.ts`: four additions (T2c, T4/T4b
  extended, T5e, T6) proving `unresolvedChecks` participates in the verdict/non-verdict type
  boundary the same way `overallRisk`/`permitProbability` do, and that `permitProbability` itself
  now admits `null`.
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
- `LUEnforcement.test.ts` and `LUMagicMomentPostGIS.test.ts` needed a *second*, distinct fix
  (K-35 M6): the mechanical destructuring fix above left `evidence` typed as `readonly
  SpatialEvidenceArtifact[]`, and each file then passed it straight into
  `runLuAssessmentViaKernel({..., evidence})`, whose `LuKernelRunInput.evidence` still declares a
  mutable array (`TS4104`). Fixed the same way as the one production call site: `evidence:
  [...spatialEvidence]`.

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
- `w2-focused-tests` (real, with the K-15 `prisma generate` preamble): 5 files, 69 tests, exit 0 --
  `LURuleEngine.test.ts`, `SpatialProviderPostGISLayerIsolation.test.ts`,
  `spatialAuditServiceExtended.test.ts`, `localizationReportService.test.ts`,
  `generateLocalizationReportVerdictNotChecked.test.ts`.

**Root `tsc -p tsconfig.json --noEmit` (K-35 M6)** -- the check the cold review actually used, not
the narrower `tsconfig.lu-verdict.json`. Run against base `038286ed` and this candidate with the
*same* node_modules setup (this worktree's junction-repaired tree, both times):
- Base: **87** `error TS` lines. Candidate (before M6): **90** -- exactly 3 new, all `TS4104`
  (`readonly SpatialEvidenceArtifact[]` assigned to a mutable `SpatialEvidenceArtifact[]`) at
  `LUEnforcement.test.ts(113,7)`, `LUEnforcement.test.ts(166,7)`,
  `LUMagicMomentPostGIS.test.ts(196,7)` -- matching K-35's finding exactly (the review's own
  absolute count, 97/100, differed because it used a real `npm ci`, but the *differential* was
  identical: +3, same three lines). Fixed with `[...spatialEvidence]` at each of the three call
  sites (the same pattern already used for the production call site in
  `generate-localization-report.usecase.ts`).
- Candidate (after M6): **87** -- equal to base. Diffed the full error lists with line numbers
  stripped (so a line shifted by an added comment doesn't register as a difference): **zero**
  textual difference. This is the corrected version of the claim `d27d240a`'s audit doc made too
  narrowly (against `tsconfig.lu-verdict.json` only, which does not even cover the two files the
  3 new errors were in).
- `P3LuVerdictTypeBoundary.test.ts` itself (the narrower `tsconfig.lu-verdict.json` gate) still
  cannot pass in absolute terms: both its assertions were already failing on the clean base, before
  any change in this unit, on 6 pre-existing errors in `luGeometrySupersessionProvisioning.ts`,
  `CanonicalPropertyArtifacts.ts` and `ProductLuContextArtifacts.ts`, none of which this unit
  touches. Re-verified after M5/M6: still exactly those same 6, zero new. Not claimed as "passes";
  claimed only as "introduces no new errors."

**The four DB-dependent `ISpatialProvider`-fake test files, run for real (K-35: Docker is up)**:
against the real `miljobeslut-postgres` container (`localhost:5432`, credentials read from the
container's own env, not the repo's `.env.example` template, which is stale), both on the
untouched base and on this candidate:
- `localizationGeometryProductProofs.test.ts` and `luExecutionIdentityScopeV2ProductWiring.test.ts`:
  identical failure on both trees -- the same `executionMotor.admitted` assertion fails, same
  assertions, same lines. Not a regression.
- `HM1BRealGovernedDocumentChain.test.ts` and `HM1CGovernedAssessmentPersistence.test.ts`: **not a
  clean comparison.** These tests write real rows (organisations, project bindings, artifacts) to
  `miljobeslut-postgres`, which is a live, shared, NOT reset-between-runs database -- re-running
  the same file twice in a row (once with a wrong password, once correct, while diagnosing
  credentials) produced *different* failing sub-tests and different error messages each time, on
  **both** the base tree and this candidate. Total pass/fail count matched on both (3 passed / 4
  failed across the two files, each run), but the specific failure signature is not deterministic
  against this database, so "identical to base" cannot be claimed with the same confidence as for
  the other two files. I did not continue re-running against the live shared database to chase a
  clean signal, to avoid compounding state changes to it further. This is a pre-existing
  characteristic of these two tests against this specific database, not something this candidate
  introduces -- but it is a genuine testing gap, not a clean pass.
- The other five `ISpatialProvider`-touching files (`LUEnforcement.test.ts`,
  `LUMagicMomentE2E.chain.test.ts`, `LUMagicMomentPostGIS.test.ts`, `SpatialProviderPostGIS.test.ts`,
  `SpatialProviderPostGISV3NumericBoundary.test.ts` needing no change) are also DB-dependent
  integration tests and were not executed against the live database; verified by direct code
  reading against each call site instead. `SpatialEvidenceQueryContractV2.test.ts` (mocks the pg
  pool directly, no live DB needed) was run and passed, 12/12.

**A real, unresolved risk found while checking `permitProbability` consumers (K-35 M5's own
instruction), outside this unit's `allowed_paths`, not fixed here**:
`components/LocalizationStudyUI.tsx:1154-1160` checks `permitProbability !== undefined` (not
`typeof permitProbability === 'number'`) before rendering it. A `null` value passes that check,
`null >= 0.8` evaluates `false`, and `Math.round(null * 100)` evaluates to `0` -- the UI would
render **"0% Godkänd"** for a site whose assessment is actually incomplete, which is exactly the
silent-fabrication failure mode this whole unit exists to eliminate, just moved one layer up the
stack. `server/services/localizationPdfService.ts:45,128` assigns the same now-nullable value into
its own `permitProbability?: number` field; this compiles without error (confirmed by the M6 tsc
diff: zero new errors) only because this repository's `strictNullChecks` is off, and I did not
trace how its own PDF template renders `undefined`/`null` there. `components/app/lu/LuWorkspace.tsx`
and the test-only `components/TechnicalSluExpert.tsx` both guard with `typeof ... === 'number'`,
which correctly excludes `null`. **This needs a follow-up unit before any of these three UI/PDF
surfaces reaches a user with a real NOT_CHECKED-only site**; flagging it here rather than silently
leaving it for someone to discover in production.

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
- claim the four DB/Prisma-dependent `ISpatialProvider`-fake test files were cleanly re-verified.
  Two (`localizationGeometryProductProofs.test.ts`, `luExecutionIdentityScopeV2ProductWiring.test.ts`)
  showed the identical failure on base and candidate against the real database. The other two
  (`HM1BRealGovernedDocumentChain.test.ts`, `HM1CGovernedAssessmentPersistence.test.ts`) write real
  rows to a live, shared, not-reset database and produced non-deterministic specific failures
  across runs on *both* trees; only the total pass/fail count matched. Not claimed as verified
  beyond that.
- claim `permitProbability`'s consumers outside this unit's `allowed_paths` handle `null` safely.
  `components/LocalizationStudyUI.tsx` does not (see the finding in section 4) and needs a
  follow-up unit before a NOT_CHECKED-only site can safely reach that UI surface.

## 6. Final disposition

Not yet frozen. Per K-28/K-30's required order: RED probes were cold-reviewed and confirmed before
any production code was written (candidate `1fbb5112`); M1/M2/M4 were addressed (candidate
`7f77f55d`); this candidate is the implementation. Awaiting cold review before freezing the exact
SHA, then the established chain: cold verification -> owner push-go -> PR -> dispatch (owner only)
-> attestation -> merge.
