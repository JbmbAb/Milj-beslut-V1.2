# DEVGOV-HELPERS-STEP3 — PROVEN

**Final state:** PROVEN
**Promotion PR:** #170
**Gated candidate:** `2d2489c65db15a9adc056e62016638e775f78019`
**Merge commit:** `8a9b7464756d005e9b466fba74e183d21e9f117e`
**Merge tree:** `a5dbffc318152fe0e9b032a7bdf017f767ea0229`
**Candidate tree:** `a5dbffc318152fe0e9b032a7bdf017f767ea0229`

This record is introduced by its own DEV-GOV unit, `DEVGOV-HELPERS-STEP3-PROVEN-DOC-V1`. The
unit's final state takes effect when this record is itself merged through that gate. It does not
edit, and does not replace, the candidate record `DEVGOV-HELPERS-STEP3.md`.

## Anchors

- Base before this merge (`main`): `864a62f7d1f6f480c41a9c9395e6ce7b920fed99` (the merged
  LU-CANONICAL-RUNTIME-HARDENING-R1 PROVEN record)
- Gated candidate: `2d2489c65db15a9adc056e62016638e775f78019` (parent
  `00a3294a560b6213d88a315d913557d9dc53bfb0`, the tooling implementation commit)
- Unit definition hash bound by the trusted runner:
  `2c9ef79592495aba9dd2ddc7913e91f48b6f233b4aa35b9573848dfadec246d5` is the trust-policy digest
  common to every unit under this policy; the packaging commit binds its own
  `unit_definition_hash` independently in each execution record (see the trusted execution
  evidence below).

The packaging delta between the tooling implementation and the gated candidate is exactly two
added files: `governance/devgov/units/devgov-helpers-step3-v1.json` and
`docs/architecture/audits/DEVGOV-HELPERS-STEP3.md`.

## Trusted execution evidence

- Protected Dev-Gov orchestration run: `35748983305`
- Canonical trusted evidence gate: `35827987410`
- Gate verdict: `PASS`, `proof_status: PROVEN`, 5 proof ids (2 RED + 3 GREEN)
- Gate trust-policy digest: `2c9ef79592495aba9dd2ddc7913e91f48b6f233b4aa35b9573848dfadec246d5`
- Gate OIDC audience bound to the exact candidate SHA:
  `devgov-v0-gate:2c9ef79592495aba9dd2ddc7913e91f48b6f233b4aa35b9573848dfadec246d5:2d2489c65db15a9adc056e62016638e775f78019`
- Repository workflow `devgov-v0-gate.yml@refs/heads/main`; environment `devgov-attestation`;
  GitHub-hosted runner
- Required commit status on the candidate:
  - context: `DEV-GOV-V0 / trusted-execution`
  - state: `success`
  - description: `Trusted RED/GREEN verified for exact candidate SHA`

### Trusted RED (executed at `864a62f7…`, observed `FAIL`, exit 1)

- `isolation-test-prettier-violation`
- `dev-helpers-cli-absent`

### Trusted GREEN (executed at the candidate, observed `PASS`, exit 0)

The same two programs, plus `dev-helpers-unit-tests`
(`scripts/dev-helpers/unit/devgovHelpers.test.ts`, 27 tests).

### Approvals

This run waited on the protected `devgov-attestation` environment three times (RED signing,
GREEN signing, the gate run itself). The GREEN signing wait was unusually long — roughly 14 hours
between the RED approval and the GREEN approval — with no change in that interval other than the
wait itself; the eventual approval produced the same trusted-execution result described here.

## Merge topology and tree verification

The candidate was merged with a merge commit only, through PR #170, pinned to the exact candidate
head SHA (`--match-head-commit`). Squash and rebase were not used.

Merge commit parents:

1. `864a62f7d1f6f480c41a9c9395e6ce7b920fed99`
2. `2d2489c65db15a9adc056e62016638e775f78019`

Immediately after the merge:

```text
tree(8a9b7464756d005e9b466fba74e183d21e9f117e)
==
tree(2d2489c65db15a9adc056e62016638e775f78019)
==
a5dbffc318152fe0e9b032a7bdf017f767ea0229
```

Therefore the integration result is identical to the gated candidate tree. A diff between the
merge commit and the candidate is empty. The delta introduced against the pre-merge base is
exactly the nine files declared in the unit's `allowed_paths`; the R1 PROVEN record and unit
definition are untouched.

## Proven claims

DEVGOV-HELPERS-STEP3 proves only the following:

1. `scripts/dev-helpers/devgov-helper.mjs` (`lint`, `preflight`) exists, is runnable, and is
   read-only advice: every command it runs re-uses the protected controller's own exported
   functions or reads the checkout it is given; it changes no controller, workflow, or schema
   file.
2. Its rules `DGL-xxx` catch, on retroactive inspection of R1's own history, the class of defect
   that blocked R1's first trusted dispatch (`server/db/prisma.ts` reached without provisioning
   under `npm ci --ignore-scripts`), and its 27-test suite (mutation-tested against synthetic
   defects in throwaway git repositories) passes.
3. `tests/unit/luBootstrapProofScriptsIsolation.test.ts` is Prettier-formatted; before this unit
   it was the one file responsible for R1's format-check regression (127 → 128 flagged files).

## Non-claims

This unit does **not**:

- claim an independent cold audit occurred for it (none did; verification was self-testing only —
  see `DEVGOV-HELPERS-STEP3.md`);
- claim the linter or preflight tool is complete or exhaustive; it is explicitly heuristic and can
  both over- and under-approximate;
- change, weaken, or bypass `scripts/devgov/devgov.mjs`, any `.github/workflows/**` file, or
  `governance/devgov/schema/**`;
- fix the stale outcome-id in `scripts/ops/prove-lu-replay-cold-verify-01.ts` (left in the gap
  ledger, per owner decision, until a natural tooling/proof-script delta);
- introduce any new trust root. A clean `lint` or `preflight` result proves nothing on its own;
  the protected controller and the canonical gate remain the sole authority.

### Non-required PR checks at merge time

Branch protection on `main` requires only `DEV-GOV-V0 / trusted-execution`, which passed. Five
non-required checks failed on PR #170, the same five that failed on the R1 precedent PRs (#161,
#167): `Typecheck` (87 errors, unchanged baseline count), `Lint` (53 errors), `Format check`
(back down to 127 flagged files — the R1-era 128th file is this unit's own fix), `Security audit`
(dependency advisories; this unit changed no dependency), and `Read-only DEV-GOV-V0 validation`
(a stale assertion about the orchestrator workflow text, unrelated to this unit). Each of those
logs was searched for any of this unit's file paths; none appear. Unlike the R1 precedent PRs,
`Require staging proof in PR` **passed** here, because the PR body used the repository's own PR
template with an explicit N/A justification and a non-empty "Validated scope", instead of a
free-form body.

## Final disposition

`DEVGOV-HELPERS-STEP3 = PROVEN`

Further work may rely on `scripts/dev-helpers/devgov-helper.mjs` as a proven-tooling-grade
convenience — not an authority — for linting and preflighting future DEV-GOV unit definitions,
subject to the non-claims above. Step 4 of the frozen roadmap (export snapshot + import rule) has
not started.
