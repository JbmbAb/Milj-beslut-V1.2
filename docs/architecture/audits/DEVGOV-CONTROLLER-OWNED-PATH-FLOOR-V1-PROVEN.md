# DEVGOV-CONTROLLER-OWNED-PATH-FLOOR-V1 -- PROVEN

**Final state:** PROVEN
**Promotion PR:** #197
**Gated candidate:** `451e24b87680d49a3acf3c0028c7184a796640b4`
**Merge commit:** `d9d9ccdf8a228586422e2a7173f4f0d4548e9d33`
**Merge tree:** `6addac542d4286e38f2653aba6cdf01a60729482`
**Candidate tree:** `6addac542d4286e38f2653aba6cdf01a60729482`

This record is introduced by its own DEV-GOV unit,
`DEVGOV-CONTROLLER-OWNED-PATH-FLOOR-V1-PROVEN-DOC-V1`.
Its final state takes effect when this record is itself merged through that gate.
It does not edit or replace the candidate record
`DEVGOV-CONTROLLER-OWNED-PATH-FLOOR-V1.md`.

## Anchors

- Base before implementation merge: `b48ed5e262793b0bf8086dad18a0729e399f84b9`
- Gated candidate: `451e24b87680d49a3acf3c0028c7184a796640b4`
- Promotion merge: `d9d9ccdf8a228586422e2a7173f4f0d4548e9d33`
- Promotion PR: #197
- Candidate and merge trees are byte-identical at the Git tree level.

## Trusted execution evidence

- Protected Dev-Gov orchestration run: `36555046332`
- Canonical trusted evidence gate: `36555591498`
- Gate verdict: `PASS`, `proof_status: PROVEN`
- Proof cardinality: 3 executions (1 RED + 2 GREEN)
- Gate trust-policy digest:
  `2c9ef79592495aba9dd2ddc7913e91f48b6f233b4aa35b9573848dfadec246d5`
- Gate OIDC audience:
  `devgov-v0-gate:2c9ef79592495aba9dd2ddc7913e91f48b6f233b4aa35b9573848dfadec246d5:451e24b87680d49a3acf3c0028c7184a796640b4`
- Controller-owned invariant packs: `pack_set_sha256`
  `5be20e1bff4d9fe67471804192c80c1f1072da92f31f5481c34b2c6bb84ea8c3`, result `PASS` (registry v3
  -- this is the version bump this very unit's parent implementation made, removing
  `DG-IP-001-PROTECTED-CONTROLLER-SEPARATION` and adding `DG-IP-009-CONTROLLER-OWNED-PATH-FLOOR`).
- Required commit status:
  - context: `DEV-GOV-V0 / trusted-execution`
  - state: `success`
  - description (as published; trailing digest truncated by GitHub's status-description length
    limit, not by this unit):
    `Trusted RED/GREEN and controller-owned packs verified for exact candidate SHA; packs=v1:PASS:5be20e1bff4d9fe67471804192c80c1f1072da92f31f548`

### RED proof

- `controller-owned-floor-rejects-empty-forbidden-paths-touch`

Ran against the protected base (`b48ed5e2`) and observed the expected violation: a synthetic
unit definition with an _empty_ `forbidden_paths` was incorrectly admitted to modify
`.github/workflows/devgov-v0-attest.yml`, proving no controller-owned floor existed yet.

### GREEN proofs

- `controller-owned-floor-rejects-empty-forbidden-paths-touch`
- `devgov-invariant-regression-tests`

Ran against the exact candidate (`451e24b8`) and passed: the same synthetic unit definition is
correctly denied (`FORBIDDEN_PATH`) despite declaring nothing forbidden itself, proving the floor
carries the protection independent of any unit's own self-declaration; and the full real
`scripts/audit/devgov*.test.ts` + `scripts/dev-helpers/unit/devgovHelpers.test.ts` regression suite
(6 files, 86 tests) passes.

## Merge topology and tree verification

PR #197 was merged with a merge commit pinned to the exact candidate SHA.
Squash and rebase were not used. The merge was authorized directly by the repository owner in
conversation with an explicit "merge-go" message naming the exact SHA, consistent with every
prior unit in this lineage.

Merge parents:

1. `b48ed5e262793b0bf8086dad18a0729e399f84b9`
2. `451e24b87680d49a3acf3c0028c7184a796640b4`

Immediately after merge:

```text
tree(d9d9ccdf8a228586422e2a7173f4f0d4548e9d33)
==
tree(451e24b87680d49a3acf3c0028c7184a796640b4)
==
6addac542d4286e38f2653aba6cdf01a60729482
```

The diff between merge commit and candidate is empty.

## Proven claims

This unit proves the F-10 structural-fix property only:

1. `scripts/devgov/devgov.mjs` declares `CONTROLLER_OWNED_FLOOR_PATHS`, a hardcoded,
   controller-owned constant unioned into `evaluateRepositoryState`'s single `classifyDiffScope`
   call, forbidding `scripts/devgov/**`, `governance/devgov/schema/**`,
   `governance/devgov/invariant-packs/**`, and the four core `devgov-v0-*.yml`/
   `devgov-invariant-packs.yml` workflow files for every Dev-Gov unit, regardless of what that
   unit's own `forbidden_paths` declares.
2. This property was independently proven, not merely asserted: a synthetic unit definition with
   an empty `forbidden_paths` array, whose `allowed_paths` includes
   `.github/workflows/devgov-v0-attest.yml`, is admitted against the base controller and denied
   against the candidate controller.
3. `DG-IP-001-PROTECTED-CONTROLLER-SEPARATION` -- a content check already proven defeatable via
   shell eval/token-splitting obfuscation, and independently reconfirmed still live on `main`
   immediately before this unit -- is removed from the invariant pack registry
   (`pack_version: 3`) rather than left in place as a now-permanently-green, misleading signal.
   `DG-IP-002-SIGNER-ISOLATION` (native YAML keys, never in the defeatable class) is unaffected.
4. A new invariant, `DG-IP-009-CONTROLLER-OWNED-PATH-FLOOR`, verifies the floor's completeness,
   its application at the `classifyDiffScope` call site, and (via YAML block-scalar-scoped
   detection, not naive substring matching) the absence of any `${{ }}` template splice inside a
   `run:` block in `devgov-v0-attest.yml`.
5. A dev-helper lint tool (`scripts/dev-helpers/lib/unitLint.mjs`, outside the floor, advisory
   only) was updated so its `DGL-003` rule no longer produces a permanent false-positive `ERROR`
   for units relying on the floor instead of redundant self-declaration -- downgraded to `INFO`
   when only the floor (not the unit's own `forbidden_paths`) covers a protected sample.

## Non-claims

This unit does **not**:

- claim `DG-IP-005-PACKS-LOAD-BEARING` or `DG-IP-007-PR-PROTECTED-BASE` were restructured, even
  though both also check content of now-floor-protected files via the same
  `noDynamicNodeInvocation` helper `DG-IP-001` used -- the same "now-permanently-green"
  observation likely applies to parts of those checks too; only `DG-IP-001` was named as needing
  action, and broadening scope to restructure them was deliberately not done in the implementation
  this record binds;
- resolve or clean up `governance/devgov/units/dev-gov-v7-derived-target-identity.json` (a
  pre-existing, stale, never-merged unit definition that would become permanently unreachable
  under this floor if anyone ever tried to dispatch against it) -- flagged in the implementation's
  own audit doc, not resolved by either unit;
- claim F-01 through F-14 (Step 5's own earlier falsification battery) have been rerun in full
  after this merge -- only F-10 is in scope;
- change application code, data, secrets, or any Dev-Gov schema file.

At merge time the required trusted-execution status was green. Non-required CI jobs
(`Typecheck`, `Lint`, `Format check`, `Security audit`, `Require staging proof in PR`) were red at
merge time; each is a pre-existing, repo-wide condition, not introduced by this unit, and was not
used as authority for this promotion -- the branch's only required status check is
`DEV-GOV-V0 / trusted-execution`, confirmed directly against the GitHub branch-protection API
before merge, not assumed.

## Final disposition

`DEVGOV-CONTROLLER-OWNED-PATH-FLOOR-V1 = PROVEN`

F-10 is closed on protected `main`. No future Dev-Gov unit can modify `scripts/devgov/**`,
`governance/devgov/schema/**`, `governance/devgov/invariant-packs/**`, or the four core
`devgov-v0-*.yml`/`devgov-invariant-packs.yml` workflow files -- a legitimate future change to any
of them must land via a direct commit to `main` outside the Dev-Gov unit mechanism. The permissions
micro-unit's own PROVEN-record precedent (E3: mechanical vs. semantic) applies here at least as
strongly, given this unit's security-critical nature.
