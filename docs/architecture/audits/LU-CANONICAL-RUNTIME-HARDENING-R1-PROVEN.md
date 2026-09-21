# LU-CANONICAL-RUNTIME-HARDENING-R1 — PROVEN

**Final state:** PROVEN  
**Promotion PR:** #167  
**Gated candidate:** `7186f187e4b34a6ae6b99ace544f34f4270b0b78`  
**Merge commit:** `551c3112cee5b77f615310c6da04ebd56f8879df`  
**Merge tree:** `0718edf396b7cbc8a3b6380b3369f89bd43574d3`  
**Candidate tree:** `0718edf396b7cbc8a3b6380b3369f89bd43574d3`

This record is introduced by its own DEV-GOV unit, `LU-CANONICAL-RUNTIME-HARDENING-R1-PROVEN-DOC-V1`.
The unit's final state takes effect when this record is itself merged through that gate. It does
not edit, and does not replace, the candidate record `LU-CANONICAL-RUNTIME-HARDENING-R1.md`.

## Anchors

- Frozen RED base (`main` before the merge): `b0558c43b160aaa9b9e8e989c8c4c3a7096e3d83`
- Cold-audited implementation: `c6839f6e2d0cc7b0c367b5abd588a640257a0343`
  (Codex cold audit outcome `APPROVED_FOR_DEV_GOV_CANDIDATE`, as communicated by the owner)
- First packaging commit, published and dispatched, **superseded and never PROVEN**:
  `8d82f0aec7a8dcdf84a321cd1421b479a21e2d7f` (orchestration run `35556115424`, cancelled)
- Gated candidate: `7186f187e4b34a6ae6b99ace544f34f4270b0b78` (parent `8d82f0ae…`)
- Unit definition hash bound by the trusted runner:
  `7456e28c3b3559f5770bfb1e8822e28f7466522b7b46b17abb4e2ff7255095b3`

The packaging delta between the cold-audited implementation and the gated candidate is exactly two
added files: `governance/devgov/units/lu-canonical-runtime-hardening-r1-v1.json` and
`docs/architecture/audits/LU-CANONICAL-RUNTIME-HARDENING-R1.md`.

## Trusted execution evidence

- Protected Dev-Gov orchestration run: `35568596702`
- Canonical trusted evidence gate: `35578070021`
- Gate verdict: `PASS`, `proof_status: PROVEN`, 16 proof ids (5 RED + 11 GREEN)
- Gate trust-policy digest: `2c9ef79592495aba9dd2ddc7913e91f48b6f233b4aa35b9573848dfadec246d5`
- Controller SHA: `b0558c43b160aaa9b9e8e989c8c4c3a7096e3d83`
- Gate OIDC audience bound to the exact candidate SHA; repository workflow
  `devgov-v0-gate.yml@refs/heads/main`; environment `devgov-attestation`; GitHub-hosted runner
- Required commit status on the candidate:
  - context: `DEV-GOV-V0 / trusted-execution`
  - state: `success`
  - description: `Trusted RED/GREEN verified for exact candidate SHA`

The gate's `proof_status: PROVEN` means the exact candidate is trusted-proven. It does not by itself
complete the unit; the merge, the tree equivalence below, and this record do.

### Trusted RED (executed at the frozen base, observed `FAIL`, exit 1)

- `canonical-rejects-bootstrap-admission`
- `canonical-enforces-v3-at-runtime`
- `package-root-does-not-export-rule-engine`
- `proof-script-cold-verify-isolated-root`
- `proof-script-deterministic-reexecution-isolated-root`

### Trusted GREEN (executed at the candidate, observed `PASS`, exit 0)

The same five programs, plus `lu-canonical-runtime-hardening-tests`,
`lu-bootstrap-proof-scripts-isolation-tests`, `lu-canonical-path-repo-guard`,
`lu-single-path-and-no-alternate-verdict`, `lu-release-binding-regression`, and
`lu-runnable-source-authority-admission-replay-regression`.

### Environment finding from the first dispatch

The first dispatch (`35556115424`) showed that the trusted attest workflow installs with
`npm ci --ignore-scripts`, so the repository's `prisma generate` postinstall never runs there. Three
proofs that load the `mps-lu` package root ended `BLOCKED_ENVIRONMENT` (exit 2) and were correctly
not counted as RED. The correction was definition-only: the affected commands provision the Prisma
client themselves. All 16 proofs then executed and were signed in run `35568596702`.

## Merge topology and tree verification

The candidate was merged with a merge commit only, through PR #167. Squash and rebase were not used.
The PR was merged pinned to the exact candidate head SHA.

Merge commit parents:

1. `b0558c43b160aaa9b9e8e989c8c4c3a7096e3d83`
2. `7186f187e4b34a6ae6b99ace544f34f4270b0b78`

Immediately after the merge:

```text
tree(551c3112cee5b77f615310c6da04ebd56f8879df)
==
tree(7186f187e4b34a6ae6b99ace544f34f4270b0b78)
==
0718edf396b7cbc8a3b6380b3369f89bd43574d3
```

Therefore the integration result is identical to the gated candidate tree. A diff between the merge
commit and the candidate is empty.

## Proven claims

LU-CANONICAL-RUNTIME-HARDENING-R1 proves only the following:

1. `runCanonicalLuProductAssessment()` can never obtain bootstrap admission from
   `MPS_LU_BOOTSTRAP_ADMIT`, even when it is set to `1`. The call is rejected before the general
   engine is entered, and the ambient flag is never cleared or rewritten.
2. `runCanonicalLuProductAssessment()` enforces the V3 execution subject at runtime. A JavaScript or
   `any` caller that omits or structurally breaks `identity_subject_v3` is rejected before the
   general engine is entered.
3. `LURuleEngine` is not exported from `packages/mps-lu/src/index.ts`.
4. `scripts/ops/prove-lu-replay-cold-verify-01.ts` and
   `scripts/ops/prove-lu-deterministic-reexecution-01.ts` no longer open or mutate the caller's
   configured `MIMERS_ROOT`; each runs on an isolated temporary root backed by the real
   filesystem Mimers CAS and removes it afterwards.
5. The negative canonical-path scanner fixture exercises the same scan function used against the
   repository's production roots.

## Non-claims

This unit does **not**:

- remove `runLuAssessmentViaKernel`, or remove bootstrap capability from the general/test engine;
- redesign SecurityRuntime admission;
- solve grant lifecycle or revocation;
- classify all `scripts/ops`, or introduce a general OPS_TOOLING authority model;
- prove the absence of every alternate LU verdict path;
- clean unrelated legacy product code.

## Known limits, recorded as found

- Six `packages/mps-lu` suites fail identically on the frozen base and on the candidate in the
  author's environment, and are therefore not part of the GREEN set and are not claimed:
  `LuAdmissionPreVerification`, `LuSourceAuthorityWiring04DF04`, `LuAdmission02DComposition`,
  `HM1BRealGovernedDocumentChain`, `HM1CGovernedAssessmentPersistence`,
  `P4ALU05RealRuntimeEntrypoint`. Whether they pass in the trusted runner was not established.
- `prove-lu-replay-cold-verify-01.ts` asserts a stale outcome id (`outcome-attempt-…-1` versus the
  real `outcome-v2-attempt-…-1`) and reports `ALL GREEN: false` on the base and the candidate alike.
  No R1 proof depends on that verdict. It is not fixed here.
- `MimersIntegration.create()` falls back to `.data/mimers` when `MIMERS_ROOT` is unset. This is CAS
  layer behaviour and out of scope.

### Non-required PR checks at merge time

Branch protection on `main` requires only `DEV-GOV-V0 / trusted-execution`, which passed. Six
non-required checks failed on PR #167. The same six failed on the precedent PR #161. Attribution:

- `Typecheck`: the same four errors in `LuExecutionKernelClient.ts` that exist on the base; no new
  error.
- `Lint`: one pre-existing warning (unused `eslint-disable`) in a file R1 modified; no lint error
  from R1.
- `Format check`: **R1 adds exactly one violation** — 127 files flagged on #161, 128 on #167; the
  additional file is `tests/unit/luBootstrapProofScriptsIsolation.test.ts`. It was not corrected,
  because the trusted-proven candidate was frozen.
- `Read-only DEV-GOV-V0 validation`: a stale assertion about the orchestrator workflow text; not
  R1-related.
- `Security audit`: dependency advisories (`npm audit --audit-level=high`); R1 changed no dependency.
- `Require staging proof in PR`: the PR body did not use the repository PR template; not
  R1-related.

## Final disposition

`LU-CANONICAL-RUNTIME-HARDENING-R1 = PROVEN`

Further LU work may rely on the canonical product entrypoint's runtime guards and on the closed
package-root surface as a proven mainline property, subject to later changes being governed
normally.
