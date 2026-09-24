# LU-API-BOUNDARY-STEP4 — PROVEN

**Final state:** PROVEN
**Promotion PR:** #172
**Gated candidate:** `6999cb7dbd181184f685b7bd56c898b1e9e73a7e`
**Merge commit:** `5a172745c8d1db7ebd774e8a1485081e837318d0`
**Merge tree:** `75383ca102dd05db101ce64dbb64b17db4a4065c`
**Candidate tree:** `75383ca102dd05db101ce64dbb64b17db4a4065c`

This record is introduced by its own DEV-GOV unit, `LU-API-BOUNDARY-STEP4-PROVEN-DOC-V1`. The
unit's final state takes effect when this record is itself merged through that gate. It does not
edit, and does not replace, the candidate record `LU-API-BOUNDARY-STEP4.md`.

## Anchors

- Base before this merge (`main`): `70dbb4c66ca7ba4d662a54aa3e384b69349a2bd9` (the merged
  DEVGOV-HELPERS-STEP3 PROVEN record)
- Gated candidate: `6999cb7dbd181184f685b7bd56c898b1e9e73a7e` (packaging commit; implementation
  commit `321842c532c64e1f2edbcfec54582582b0f7df76`)

The packaging delta between the implementation commit and the gated candidate is exactly two
added files: `governance/devgov/units/lu-api-boundary-step4-v1.json` and
`docs/architecture/audits/LU-API-BOUNDARY-STEP4.md`.

## Trusted execution evidence

- Protected Dev-Gov orchestration run: `35875066537`
- Canonical trusted evidence gate: `35905402228`
- Gate verdict: `PASS`, `proof_status: PROVEN`, 5 proof ids (1 RED + 4 GREEN)
- Gate trust-policy digest: `2c9ef79592495aba9dd2ddc7913e91f48b6f233b4aa35b9573848dfadec246d5`
- Gate OIDC audience bound to the exact candidate SHA:
  `devgov-v0-gate:2c9ef79592495aba9dd2ddc7913e91f48b6f233b4aa35b9573848dfadec246d5:6999cb7dbd181184f685b7bd56c898b1e9e73a7e`
- Repository workflow `devgov-v0-gate.yml@refs/heads/main`; environment `devgov-attestation`;
  GitHub-hosted runner
- Required commit status on the candidate:
  - context: `DEV-GOV-V0 / trusted-execution`
  - state: `success`
  - description: `Trusted RED/GREEN verified for exact candidate SHA`

### Trusted RED (executed at `70dbb4c6…`, observed `FAIL`, exit 1)

- `lu-api-boundary-artifacts-present` — the three new boundary artifacts are absent on this tree;
  the existing LU package root and `runCanonicalLuProductAssessment` are checked first as a
  positive control before absence is treated as the falsified property.

### Trusted GREEN (executed at the candidate, observed `PASS`, exit 0)

- `lu-api-boundary-artifacts-present` (all three artifacts now present)
- `lu-api-boundary-contract` (the standalone evaluator, run against the frozen snapshot)
- `lu-api-boundary-focused-tests` (`tests/unit/luApiBoundaryStep4.test.ts`, 6 tests)
- `lu-api-boundary-targeted-format` (Prettier over the three implementation files only)

## Merge topology and tree verification

The candidate was merged with a merge commit only, through PR #172, pinned to the exact candidate
head SHA (`--match-head-commit`). Squash and rebase were not used.

Merge commit parents:

1. `70dbb4c66ca7ba4d662a54aa3e384b69349a2bd9`
2. `6999cb7dbd181184f685b7bd56c898b1e9e73a7e`

Immediately after the merge:

```text
tree(5a172745c8d1db7ebd774e8a1485081e837318d0)
==
tree(6999cb7dbd181184f685b7bd56c898b1e9e73a7e)
==
75383ca102dd05db101ce64dbb64b17db4a4065c
```

Therefore the integration result is identical to the gated candidate tree. A diff between the
merge commit and the candidate is empty. The delta introduced against the pre-merge base is
exactly the five files declared in the unit's `allowed_paths`.

## Proven claims

LU-API-BOUNDARY-STEP4 proves only the following, as stated in the candidate record:

1. The TypeScript-visible package-root export surface of `@miljobeslut/mps-lu` is snapshotted
   (268 public symbols at the frozen base), following existing `export *` chains so a transitive
   new export is detected even without touching `packages/mps-lu/src/index.ts` directly.
2. Production code cannot add a new deep import into `packages/mps-lu/src/**` or
   `@miljobeslut/mps-lu/**` below the root without the evaluator flagging drift; the eight
   pre-existing production deep imports are grandfathered by exact file + specifier pair, and
   removing one of them is drift too.
3. `LURuleEngine`, `createLuRuleEngineInvokeHandler`, and `runLuAssessmentViaKernel` remain
   forbidden package-root exports.

## Non-claims

This unit does **not**:

- bless or remove the eight grandfathered deep imports;
- change LU runtime, evidence, rules, authority, CAS or persistence semantics;
- add a `package.json` `exports` map or claim Node loader enforcement;
- govern any other package's API;
- forbid internal imports inside `packages/mps-lu`, or forbid tests/ops/proof scripts from
  deliberate internal access;
- make a future snapshot amendment automatically legitimate — a changed snapshot is still drift
  the evaluator will flag, to be judged on its own merits;
- change `scripts/devgov/**`, `.github/workflows/**`, `governance/devgov/schema/**`, the signer,
  or the trust policy;
- make `scripts/dev-helpers/lib/luApiBoundary.mjs` authoritative. It emits `authoritative: false`
  and is advisory only, the same standing as the rest of `scripts/dev-helpers/`; the protected
  controller and the canonical gate remain the sole authority.

### Non-required PR checks at merge time

Branch protection on `main` requires only `DEV-GOV-V0 / trusted-execution`, which passed. The same
five non-required checks failed on PR #172 as on every precedent PR in this lineage (#161, #167,
#170): `Typecheck` (87 errors, unchanged baseline), `Lint`, `Format check` (127 flagged files,
unchanged baseline), `Security audit`, and `Read-only DEV-GOV-V0 validation`. Each log was searched
for this unit's file paths (`api-boundary`, `luApiBoundary`); none appear.

## Final disposition

`LU-API-BOUNDARY-STEP4 = PROVEN`

Further LU work may rely on the frozen export-surface and deep-import snapshot as a proven,
advisory drift signal — not an authority — for reviewing future changes to
`@miljobeslut/mps-lu`'s boundary.
