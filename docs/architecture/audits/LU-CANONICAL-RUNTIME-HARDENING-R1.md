# LU-CANONICAL-RUNTIME-HARDENING-R1 — CANDIDATE

**Status:** CANDIDATE / NOT YET PROVEN  
**Unit:** `LU-CANONICAL-RUNTIME-HARDENING-R1-V1`  
**Unit definition:** `governance/devgov/units/lu-canonical-runtime-hardening-r1-v1.json`  
**Branch:** `governance/lu-canonical-runtime-hardening-r1`

## Identity

| Item | SHA |
|---|---|
| Frozen RED base (`base_sha`) | `b0558c43b160aaa9b9e8e989c8c4c3a7096e3d83` |
| Cold-audited implementation | `c6839f6e2d0cc7b0c367b5abd588a640257a0343` |
| Packaging commit (the candidate) | the commit that introduces this file — see below |

The packaging SHA cannot be written inside the file that the packaging commit itself adds. It is
the commit returned by `git log -1 --format=%H -- docs/architecture/audits/LU-CANONICAL-RUNTIME-HARDENING-R1.md`,
and it is the only SHA that Dev-Gov derives as `candidate_sha`.

### Packaging delta

The delta between the cold-audited implementation `c6839f6e…` and the packaging commit consists of
exactly two added files and nothing else:

- `governance/devgov/units/lu-canonical-runtime-hardening-r1-v1.json`
- `docs/architecture/audits/LU-CANONICAL-RUNTIME-HARDENING-R1.md`

No product code, test code, script, workflow, Dev-Gov controller/verifier/gate, CAS, SecurityRuntime,
or grant/revocation file changed in the packaging commit. Verify with
`git diff --name-status c6839f6e2d0cc7b0c367b5abd588a640257a0343 <packaging SHA>`.

The unit-definition JSON matches the repository's `*.json` ignore rule, exactly as the existing
`governance/devgov/units/*.json` definitions do; it is tracked by explicit add. `.gitignore` is
unchanged.

## Codex cold-audit outcome

`APPROVED_FOR_DEV_GOV_CANDIDATE` for implementation `c6839f6e2d0cc7b0c367b5abd588a640257a0343`,
as communicated by the owner. The audit report itself is not part of this repository.

## The five R1 claims

1. `runCanonicalLuProductAssessment()` can never obtain bootstrap admission from
   `MPS_LU_BOOTSTRAP_ADMIT`, even when set to `1`. The call is rejected with
   `LU_CANONICAL_BOOTSTRAP_ADMIT_FORBIDDEN` before the general engine is entered; the ambient flag is
   never cleared or rewritten. The engine body additionally receives `bootstrap = false` as an
   explicit argument on this path, so no later environment read can grant it.
2. `runCanonicalLuProductAssessment()` enforces the V3 execution subject at runtime. A JavaScript /
   `any` caller that omits or structurally breaks `identity_subject_v3` is rejected with
   `LU_CANONICAL_IDENTITY_SUBJECT_V3_INVALID` before the general engine is entered. Only the fields
   the existing V3 contract already consumes are validated (three artifact references and the
   contract version); no new semantics.
3. `LURuleEngine` is not exported from `packages/mps-lu/src/index.ts`. The package-root runtime
   namespace exposes no rule-engine or general-engine symbol.
4. `scripts/ops/prove-lu-replay-cold-verify-01.ts` and
   `scripts/ops/prove-lu-deterministic-reexecution-01.ts`, which set `MPS_LU_BOOTSTRAP_ADMIT=1`,
   no longer open or mutate the caller's configured `MIMERS_ROOT`. Each creates its own `mkdtemp`
   root under the OS temp directory and passes an explicit cloned environment to
   `MimersIntegration.create({ env, forceMimers: true })`; the proof runs on the real
   filesystem-backed Mimers CAS and the temporary root is removed afterwards.
5. The negative canonical-path scanner fixture exercises the same scan function used against the
   repository's production roots, over a synthetic file tree, instead of re-applying a regex to an
   in-memory string.

## Trusted RED (executed at `base_sha`)

Every RED command is an inline `node` program defined in the unit definition. None depends on a file
introduced after the frozen base, and none runs a git command. Executable material is limited to
modules and scripts that exist on `b0558c43…`.

Exit-code contract shared by all inline programs:

| Exit | Meaning | Dev-Gov classification |
|---|---|---|
| 0 | the property holds | `PASS` |
| 1 | substantive violation of the property (`LU_R1_VIOLATION`) | `FAIL` — the only valid RED outcome |
| 2 | harness or environment problem (`LU_R1_HARNESS_ERROR`), including any unexpected exception | `BLOCKED_ENVIRONMENT` via `blocked_exit_codes: [2]` — never a valid RED |

Each program runs a **control** that must succeed on every tree before the property is judged, so a
broken harness cannot masquerade as a violation. Every program wraps its body so that an unexpected
exception exits 2 rather than 1.

| RED proof ID | Base property falsified | Observed on a clean checkout of `b0558c43…` |
|---|---|---|
| `canonical-rejects-bootstrap-admission` | The canonical wrapper has no runtime guard against bootstrap admission. Control: the general engine still admits under the flag. | Canonical call resolves `admitted: true` under `MPS_LU_BOOTSTRAP_ADMIT=1` → exit 1 |
| `canonical-enforces-v3-at-runtime` | The V3 requirement is type-only. Control: a complete V3 subject is accepted. | Omitted, `null`, `{}`, missing geometry ref, empty `artifact_id`, and missing contract version all pass through to the general engine → exit 1 |
| `package-root-does-not-export-rule-engine` | The package root exports `LURuleEngine`. Control: the canonical entrypoint is exported. Checked on the runtime namespace, not by text search. | Namespace exposes `LURuleEngine` → exit 1 |
| `proof-script-cold-verify-isolated-root` | The cold-verify script uses the caller/ambient `MIMERS_ROOT`. Runs the real script against a populated sentinel root. | Script added or changed 33 entries in the sentinel root → exit 1 |
| `proof-script-deterministic-reexecution-isolated-root` | Same, for the deterministic re-execution script. | Script added or changed 37 entries in the sentinel root → exit 1 |

A RED is invalid, and the unit must not be advanced, if its failure cause is a missing file, a
module that does not exist on base, or any harness fault (exit 2).

## Trusted GREEN (executed at the candidate SHA)

The five inline programs above are executed again, unchanged, at the candidate and must exit 0. The
isolation programs additionally require that the script attests a distinct temporary root under the
OS temp directory, backed by the real Mimers CAS, and removed after the run.

| GREEN proof ID | Evidence |
|---|---|
| `lu-canonical-runtime-hardening-tests` | `packages/mps-lu/src/unit/LuCanonicalRuntimeHardening.test.ts` |
| `lu-bootstrap-proof-scripts-isolation-tests` | `tests/unit/luBootstrapProofScriptsIsolation.test.ts` |
| `lu-canonical-path-repo-guard` | `src/application/unit/LuCanonicalPath01.test.ts` |
| `lu-single-path-and-no-alternate-verdict` | `LuCutoverSinglePath.test.ts`, `NoAlternateLuDecisionPath.test.ts` |
| `lu-release-binding-regression` | `packages/mps-lu/tests/LocalizationAssessmentReleaseBindingProof.test.ts` |
| `lu-runnable-source-authority-admission-replay-regression` | `LuSourceAuthorityTemporal04E`, `LuSourceAuthorityWiring04D`, `LuExecutionKernelClient`, `LuDeterministicReExecution`, `LuReplayColdVerify`, `P4ALU03NoAlternateSpatialPath` |

### Regression coverage that is deliberately NOT in GREEN

These `packages/mps-lu` tests fail identically on the frozen base and on the implementation
candidate in the author's environment (missing authority/lifecycle configuration and an unreachable
Prisma database). A pre-existing environment failure is not a PASS, so they are neither listed as
GREEN nor claimed:

- `LuAdmissionPreVerification.test.ts` (4 tests)
- `LuSourceAuthorityWiring04DF04.test.ts` (2)
- `LuAdmission02DComposition.test.ts` (1)
- `HM1BRealGovernedDocumentChain.test.ts` (3)
- `HM1CGovernedAssessmentPersistence.test.ts` (1)
- `P4ALU05RealRuntimeEntrypoint.test.ts` (1)

Across all 371 `packages/mps-lu` tests, the implementation changed the status of exactly one
pre-existing test, `LocalizationAssessmentReleaseBindingProof`'s canonical-entrypoint case. It called
the canonical entrypoint under `MPS_LU_BOOTSTRAP_ADMIT=1` — the behaviour this unit closes — and was
changed to clear the flag for that call. It is in GREEN. Whether the excluded suites pass in the
trusted runner is unknown to this record; they must be treated as unproven until a run shows it.

## allowed_paths

The unit definition's `allowed_paths` covers the whole diff from `base_sha` to the candidate: the
nine implementation paths reviewed in the cold audit plus the two packaging files. `forbidden_paths`
additionally lists `.github/**`, `governance/devgov/schema/**`, `scripts/devgov/**`, the Mimers CAS
and repository code, `packages/mps-runtime/src/security/**`, `packages/mimers-brunn-core/**`, and
`prisma/**`, so the non-claims below are machine-checked.

## Non-claims

This unit does **not**:

- remove `runLuAssessmentViaKernel`, or remove bootstrap capability from the general/test engine;
- redesign SecurityRuntime admission;
- solve grant lifecycle or revocation;
- classify all `scripts/ops`, or introduce a general OPS_TOOLING authority model;
- prove the absence of every alternate LU verdict path;
- clean unrelated legacy product code;
- fix the pre-existing stale outcome-id assertion in `prove-lu-replay-cold-verify-01.ts`
  (it asserts `outcome-attempt-…-1` but the outcome id is `outcome-v2-attempt-…-1`, so that script
  reports `ALL GREEN: false` on base and candidate alike). No R1 proof depends on that verdict.

Known and out of scope: `MimersIntegration.create()` falls back to `.data/mimers` when `MIMERS_ROOT`
is unset (CAS layer).

## Local pre-dispatch evidence (not attestation)

Before packaging, the RED programs were run on a clean detached checkout of `b0558c43…` and the GREEN
commands on the implementation candidate, with controller classification semantics and a
clean-tree check before and after each command. That is author-side provenance only. It is not an
externally signed execution attestation and establishes nothing by itself.

## Finalization rule

This document is `CANDIDATE`, not `PROVEN`. The unit becomes PROVEN only when the exact packaged
candidate SHA has, through the protected trusted-execution workflow, passed every RED and GREEN
proof above, has passed the canonical Dev-Gov gate, has been merged with a merge commit, and the
merge tree has been verified equal to the gated candidate tree. A separate protected PROVEN record
is then added; this file is not edited into one.
