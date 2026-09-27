# LU-W2-SEM1-NOT-CHECKED-V1 — PROVEN

**Final state:** PROVEN
**Promotion PR:** #184
**Gated candidate:** `4163745a2c10a7052b93b9d9916acc84a060c199`
**Merge commit:** `cefc95e1a96b5201ae8d5dad99a9c5dbddca5d5a`
**Merge tree:** `6e3686c24f710af60d6312f0eda40aa695c94a1f`
**Candidate tree:** `6e3686c24f710af60d6312f0eda40aa695c94a1f`

This record is introduced by its own DEV-GOV unit, `LU-W2-SEM1-NOT-CHECKED-PROVEN-DOC-V1`. The
unit's final state takes effect when this record is itself merged through that gate. It does not
edit, and does not replace, the candidate record `LU-W2-SEM1-NOT-CHECKED-V1.md`.

## Anchors

- Base before this merge (`main`): `038286ede85f7826995a0be3b3e612547e36914d` (the W1
  PROVEN-record merge, PR #183)
- Gated candidate: `4163745a2c10a7052b93b9d9916acc84a060c199`
- This record's own unit base (`main` at record creation): `cefc95e1a96b5201ae8d5dad99a9c5dbddca5d5a`
  -- the W2 merge commit itself, since no other unit merged to `main` between W2's merge and this
  record's creation.

The candidate record's own lineage (`LU-W2-SEM1-NOT-CHECKED-V1.md`) documents the full
implementation history in detail: candidate `1fbb5112` (unit-JSON + three RED probes only, no
production code, cold-reviewed and approved to start implementation per K-30), `7f77f55d`
(addressed K-30's four must-fix points on the RED probes themselves), `d27d240a` (full
implementation, cold-reviewed as NOT_VERIFIED per K-35 on two points), and `4163745a` (the fixes
for both K-35 points -- corrected the fabricated `permitProbability: 0.5` fallback to `null`, and
removed 3 TypeScript errors the previous candidate's own audit doc had missed by checking too
narrow a `tsc` scope) -- producing the final gated candidate `4163745a`. The delta between
`4163745a` and the pre-merge base `038286ed` is exactly the files declared in
`LU-W2-SEM1-NOT-CHECKED-V1`'s own `allowed_paths`: the governed evidence/rule-engine contract
changes, the provider isolation fix, the usecase/verdict changes, their test files, and that
unit's own two governance files (its unit JSON and its audit doc).

This PROVEN-doc unit is a separate, later unit with its own base and its own two-file
`allowed_paths` (this record and its own unit JSON) -- its own delta is exactly those two files
against its base, `main` at record creation, `cefc95e1a96b5201ae8d5dad99a9c5dbddca5d5a` (the W2
merge commit itself), so none of W2's own files appear in it -- they are already present
identically on both sides of that diff.

## Trusted execution evidence

- Protected Dev-Gov orchestration run: `36323557295`
- Canonical trusted evidence gate: `36324000088`
- Gate result: `proof_status: PROVEN` (job conclusion: `success`), 7 proof ids (3 RED + 4 GREEN)
- Gate trust-policy digest: `2c9ef79592495aba9dd2ddc7913e91f48b6f233b4aa35b9573848dfadec246d5`
- Gate OIDC audience bound to the exact candidate SHA:
  `devgov-v0-gate:2c9ef79592495aba9dd2ddc7913e91f48b6f233b4aa35b9573848dfadec246d5:4163745a2c10a7052b93b9d9916acc84a060c199`
- Repository workflow `devgov-v0-gate.yml@refs/heads/main`; environment `devgov-attestation`;
  GitHub-hosted runner
- Required commit status on the candidate:
  - context: `DEV-GOV-V0 / trusted-execution`
  - state: `success`
  - description: `Trusted RED/GREEN verified for exact candidate SHA; packs=v1:PASS:5be20e1bff4d9fe67471804192c80c1f1072da92f31f5481c34b2c6bb84ea8c3`

### Trusted RED (executed at `038286ed…`, observed `FAIL`, exit 1)

- `w2-not-checked-vocabulary` -- `AssessmentFinding.risk_level` does not admit the `"NOT_CHECKED"`
  string literal at this base; a positive control against a silently-vacuous check.
- `w2-rule-version-2-on-governed-rules` -- none of the five layer-based governed rules
  (LU-WATER-001, LU-EBH-001, LU-PROTECTED-001, LU-NATURA2000-001, LU-WATERPROTECTION-001) are at
  `rule_version "2.0"` at this base.
- `w2-layer-isolation-not-checked` -- a self-contained probe (the test source is embedded in the
  probe script and written to a temporary file at run time, since the real test file does not
  exist at this base) proving `SpatialProviderPostGIS.query()` has no per-layer error isolation: a
  single layer's simulated technical query failure throws for the entire batch, discarding the
  other layers' real evidence.

### Trusted GREEN (executed at the candidate, observed `PASS`, exit 0)

- `w2-not-checked-vocabulary` (the `"NOT_CHECKED"` literal is present)
- `w2-rule-version-2-on-governed-rules` (all five layer rules at `"2.0"`)
- `w2-layer-isolation-not-checked` (the committed test file, 3/3: the isolation claim plus two
  regression-guard tests proving an identity/admission failure still denies the whole batch, and a
  failed layer never appears in evidence as `exists:false`)
- `w2-focused-tests` (`packages/mps-lu/tests/LURuleEngine.test.ts`,
  `packages/spatial-provider-postgis/tests/SpatialProviderPostGISLayerIsolation.test.ts`,
  `tests/unit/spatialAuditServiceExtended.test.ts`,
  `tests/unit/services/localizationReportService.test.ts`,
  `tests/unit/generateLocalizationReportVerdictNotChecked.test.ts`, 69/69 -- with the `npx prisma
  generate` preamble (K-15 precedent) confirmed to regenerate the client after `.prisma` was
  removed before the run)

## Merge topology and tree verification

The candidate was merged with a merge commit only, through PR #184, pinned to the exact candidate
head SHA. Squash and rebase were not used for this merge.

Merge commit parents:

1. `038286ede85f7826995a0be3b3e612547e36914d`
2. `4163745a2c10a7052b93b9d9916acc84a060c199`

Immediately after the merge:

```text
tree(cefc95e1a96b5201ae8d5dad99a9c5dbddca5d5a)
==
tree(4163745a2c10a7052b93b9d9916acc84a060c199)
==
6e3686c24f710af60d6312f0eda40aa695c94a1f
```

Therefore the integration result is identical to the gated candidate tree. A diff between the
merge commit and the candidate is empty.

## Proven claims

LU-W2-SEM1-NOT-CHECKED-V1 proves only the following, as stated in the candidate record:

1. The governed rule chain distinguishes "checked and absent" from "could not be checked": a new
   non-severity finding state, `NOT_CHECKED`, is emitted by `LURuleEngine` for a declared
   unavailable layer with a known governed rule, and never for a layer whose result was
   `exists:false` (checked, confirmed absent -- unchanged v1 semantics, silent).
2. `SpatialProviderPostGIS.query()` isolates a genuine query-execution failure per layer: the
   other layers' evidence is preserved, and the failed layer is reported explicitly via
   `unavailable_layers`, never fabricated as `exists:false` and never by denying the whole batch.
   An identity/admission failure (`SpatialLayerRuntimeBindingError`) is deliberately excluded from
   this isolation and still denies the whole request, exactly as before this unit.
3. All five layer-based governed rules are versioned `rule_version: "2.0"`, reflecting that each
   rule's own contract now admits the `NOT_CHECKED` outcome, independent of any single finding's
   actual severity. `LU-DOC-BESLUT-001` (document-based, not layer-based) is unaffected and stays
   at `"1.0"`.
4. The governed verdict never presents an incomplete assessment as a clean result:
   `unresolvedChecks` lists every `NOT_CHECKED` finding, and `permitProbability` is `null` --
   never a fabricated number -- exactly when `unresolvedChecks` is non-empty and no completed
   check reached HIGH/MEDIUM severity. A site with a `null` `permitProbability` is excluded from
   the report's ranking/comparison population, the same way a non-verdict site is.
5. The legacy producer's (`spatialAuditService.ts`) existing trichotomy -- technical failure /
   checked-and-absent / measured distance -- is proven directly by test, for the first time; no
   production code change was needed for it (OD-03).

## Non-claims

This unit does **not**:

- add a real water-body/strandskydd governed layer, or change what `"water"`/`LU-WATER-001`
  actually measures (SGU wells) -- that naming collision is registered as a map finding (ChatGPT),
  not fixed here.
- change OD-04 (bank/Gemini consumers of the legacy engine's verdict) -- a separate, later unit.
- touch the frozen v1 contracts `SpatialResultSemantics.ts` or `SpatialEngineFingerprint.ts`.
- **claim staging validation.** Per the same delegated-decision basis as W1 (K-11): no staging environment runs `main`
  today, so no staging run was performed or could have been performed for this unit. The evidence
  this PROVEN record rests on is Dev-Gov trusted RED/GREEN execution (above) and the local
  `w2-focused-tests` 69/69 confirmation -- not staging evidence. Real staging validation for the
  Lokaliseringsutredning flow is tracked separately (D-P5/K-6) against a future release SHA that
  includes this unit, once a staging environment exists to run it in.
- **claim `permitProbability`'s consumers outside this unit's `allowed_paths` handle `null`
  safely.** Checked, per K-35's own instruction, before this unit was frozen:
  `server/services/localizationPdfService.ts:45,128` is a **live** route (the legacy PDF path,
  under separate planned retirement per D-P5-5) that assigns the now-nullable value into its own
  `permitProbability?: number` field; it compiles without error only because this repository's
  `strictNullChecks` is off, and its downstream template rendering of a `null` was not traced.
  `components/LocalizationStudyUI.tsx:1154-1160` checks `!== undefined` rather than
  `typeof ... === 'number'`, so a `null` value would render a fabricated "0% Godkänd" -- but this
  component is **unmounted on main** (MAP-5 U-2) and is not reached in the product today.
  `components/app/lu/LuWorkspace.tsx` already guards correctly with a `typeof` check. **Tracked as
  follow-up unit W2b** (null-`permitProbability` consumers: `localizationPdfService.ts` null
  handling or retirement, `LocalizationStudyUI.tsx` correction or removal), queued before W3.
- **claim the two DB-dependent test files with non-deterministic results were cleanly verified.**
  `HM1BRealGovernedDocumentChain.test.ts` and `HM1CGovernedAssessmentPersistence.test.ts` write
  real rows to the live, shared, not-reset-between-runs `miljobeslut-postgres` database and
  produced different specific failures across repeated runs on both the base and candidate trees;
  only the total pass/fail count matched between them. This is pre-existing test-infrastructure
  debt (the same class of issue D-3's separate-temporary-database requirement addresses), not a
  regression this unit introduces, but it is not a clean pass either.

### Non-required PR checks at merge time

Branch protection on `main` requires only `DEV-GOV-V0 / trusted-execution`, which passed. The same
five non-required checks that were red on W1's PR #180/#183 (per delegated decision K-12) were
also red on PR #184 at merge time: `Typecheck` (87 errors, unchanged baseline, confirmed by an
exact root-`tsc` diff during this unit's own cold review), `Lint`, `Format check`, `Security
audit` (pre-existing, unrelated to this unit), and `Require staging proof in PR` (waived by the
same K-11-class basis, see Non-claims above).

## Final disposition

`LU-W2-SEM1-NOT-CHECKED-V1 = PROVEN`

Further LU work may rely on the `NOT_CHECKED` non-severity signal, the per-layer isolation
contract, `rule_version 2.0` on the five layer-based governed rules, and the corrected
null-`permitProbability` verdict consequence as proven, mechanical protections -- not as cover for
the still-open `LU-WATER-001`/wells naming collision, OD-04, or the W2b null-consumer follow-up,
all explicitly deferred to separate units.
