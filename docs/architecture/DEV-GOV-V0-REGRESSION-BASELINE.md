# DEV-GOV-V0 Regression Baseline

Status: **VERIFIED**
Date: 2026-09-05
Scope: Confirms the permanent regression suite that already exists in this repository covers every
historical attack and defect this engagement found or exercised. This document **verifies existing
coverage** — it does not add new tests. Writing new DEV-GOV test surface without a proven gap would
itself be scope creep against the maintainer mandate.

## 1. What exists

```text
scripts/audit/devgovCliContract.test.ts             8 tests
scripts/audit/devgovDerivedTargetIdentity.test.ts    3 tests
scripts/audit/devgovExactShaVerification.test.ts    11 tests
scripts/audit/devgovExecutionRootIdentity.test.ts    4 tests
scripts/audit/devgovPathBranchLock.test.ts           7 tests
scripts/audit/devgovRedGreenGate.test.ts            16 tests
scripts/audit/devgovTrustRootProvenance.test.ts      6 tests
scripts/audit/devgovTrustedAttestation.test.ts      12 tests
scripts/audit/devgovTrustedWorkflow.test.ts         10 tests
                                              TOTAL  88 tests / 9 files
```

Run with `npm run devgov:test` (`vitest --config scripts/devgov/vitest.config.mjs`).

**Excluded from this baseline, deliberately:** `scripts/audit/final-freeze-audit.test.ts` and
`scripts/audit/master-boundary-audit.test.ts`. Despite living in the same directory, both test an
unrelated subsystem (CAS authority boundaries / Frozen Core), not DEV-GOV. They are out of scope for
this document and were not touched.

## 2. Live verification (2026-09-05, against `main` = `2855f6c6`)

```text
npm run devgov:test         -> 88/88 pass (after excluding a local timeout artifact, see §5)
```

## 3. Historical attack / defect → existing coverage

Every attack adversarially proven during this engagement, and every real defect found, maps to an
existing test. Nothing below required a new test to be written.

| Historical finding                                                                       | Covered by                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1 symlink-substitution gap (`resolve(X)==resolve(X)` tautology)                         | `devgovExecutionRootIdentity.test.ts`: "denies a symlinked execution root"                                                                                                                      |
| Sibling-directory substitution                                                           | `devgovExecutionRootIdentity.test.ts`: "denies substitution with another directory under the workspace"                                                                                         |
| cwd-dependence                                                                           | `devgovExecutionRootIdentity.test.ts`: "does not derive execution identity from the current working directory"                                                                                  |
| RED/GREEN ordering violation (caught live in this engagement, U1)                        | `devgovRedGreenGate.test.ts`: "denies GREEN evidence that ran before RED"                                                                                                                       |
| Stale/cross-base RED reuse                                                               | `devgovRedGreenGate.test.ts`: "denies stale RED evidence from another base"                                                                                                                     |
| Evidence from wrong candidate SHA                                                        | `devgovRedGreenGate.test.ts`: "denies GREEN evidence collected on another candidate SHA"                                                                                                        |
| Forged/non-tool-produced evidence                                                        | `devgovRedGreenGate.test.ts`: "denies forged legacy-looking RED/GREEN evidence that was not tool-produced"                                                                                      |
| Copied evidence from another unit                                                        | `devgovRedGreenGate.test.ts`: "denies copied valid RED evidence from another unit"                                                                                                              |
| `236ccdf6` stale-lineage promotion hazard                                                | `devgovExactShaVerification.test.ts`: "supports explicit exact_parent ancestry and denies wrong parent"; "denies merge commits under exact_parent even when first parent is the base"           |
| Dirty-tree promotion                                                                     | `devgovExactShaVerification.test.ts`: "denies dirty trees during exact SHA verification"                                                                                                        |
| Remote SHA divergence / lookup failure                                                   | `devgovExactShaVerification.test.ts`: "denies remote SHA divergence"; "fails closed on remote lookup failure instead of treating it as absent success"                                          |
| Signer/executor privilege separation                                                     | `devgovTrustedWorkflow.test.ts`: "keeps execution and signing authority on separate runner jobs"; "runs candidate code under a separate OS identity that cannot rewrite the raw record"         |
| Wrong-controller-SHA attestation                                                         | `devgovTrustedAttestation.test.ts`: "denies attestations produced by a different controller SHA"                                                                                                |
| Producer self-signing under untrusted key                                                | `devgovTrustedAttestation.test.ts`: "denies a producer self-signed attestation under an untrusted key"                                                                                          |
| Post-execution payload tampering                                                         | `devgovTrustedAttestation.test.ts`: "denies a signed payload changed after protected execution"                                                                                                 |
| OIDC policy redirection to another repo/workflow/ref                                     | `devgovTrustRootProvenance.test.ts`: "denies a policy that redirects authority to an actor-controlled repository"                                                                               |
| Candidate-signed token impersonating trusted issuer                                      | `devgovTrustRootProvenance.test.ts`: "denies a candidate-signed token even when all claims look valid"                                                                                          |
| JWKS unavailability silently accepted                                                    | `devgovTrustRootProvenance.test.ts`: "surfaces GitHub JWKS unavailability instead of accepting unverified provenance"                                                                           |
| `forbidden_paths` precedence                                                             | `devgovPathBranchLock.test.ts`: "gives forbidden_paths precedence over broad allowed paths"                                                                                                     |
| Files outside declared scope                                                             | `devgovPathBranchLock.test.ts`: "denies files outside allowed paths"                                                                                                                            |
| Isolation-bootstrap silent failure (this engagement's d975e7ef/eab97f9d diagnostic work) | `devgovTrustedWorkflow.test.ts`: "identifies the exact isolation-bootstrap command without tracing command data"; "reports parent-directory traversal without changing the fail-closed command" |
| `BLOCKED_ENVIRONMENT` vs `FAIL` collapse                                                 | `devgovRedGreenGate.test.ts`: "records command classification without collapsing blocked environment into FAIL"; "classifies command timeout as BLOCKED_ENVIRONMENT"                            |
| Caller-supplied evidence/policy path injection                                           | `devgovCliContract.test.ts`: "denies caller-supplied evidence and trust policy paths"                                                                                                           |
| External/generated unit-definition substitution                                          | `devgovCliContract.test.ts`: "denies an external or generated replacement unit definition"                                                                                                      |
| Candidate SHA not matching HEAD                                                          | `devgovCliContract.test.ts`: "denies candidate SHA input that does not match HEAD before command execution"                                                                                     |

## 4. Not covered by a local test, and why that is correct

Two real defects this engagement found and fixed **cannot** be expressed as a local unit test,
because they are properties of the live GitHub-hosted execution environment, not of `devgov.mjs`'s
logic:

- **`/home/runner` traversal fix (`c656ec6f`).** The defect was a directory permission
  (`drwxr-x---`, `runner:runner`) on the actual GitHub-hosted runner filesystem. No local test can
  assert this; it was proven the only way it could be — a live RED/GREEN run on `ubuntu-latest`
  before and after the fix, both independently verified in this engagement.
- **Signer private-key PEM format.** The defect was in how a GitHub Environment secret was stored
  (`\n` escape sequences instead of real newlines). Not expressible as a repository-local test at
  all; proven by a live signed-attestation run.

These are correctly absent from the regression suite. Do not try to backfill them — a mocked test
would prove nothing that the live GitHub run did not already prove more strongly, and would itself
be new DEV-GOV surface for no verification gain.

## 5. Local test timeout flakiness

Locally observed on Windows by the author; not independently reproduced in this verification. Linux
CI evidence observed clean (`devgov-v0.yml` run `33745951583`, against `1b9f4def`) — this has never
been observed to fail on `ubuntu-latest`, the environment that actually matters for trust.

**Classification remains `NICE_TO_HAVE` / non-blocking.** If it recurs, raise `testTimeout` for the
affected subprocess-spawning specs in `scripts/devgov/vitest.config.mjs`. This is a test-harness
timing property, not a trust-semantics defect, and does not block platform work.

## 6. What "verify" means going forward

Before any future DEV-GOV-adjacent change: run `npm run devgov:test`, confirm the current DEV-GOV
test count passes (accounting for the known flakiness class above), and check this table for whether
the change touches an already-
covered invariant. If it does, the existing test is the regression check — do not write a duplicate.
If it touches something genuinely new, that itself is the signal to classify the change per
`DEV-GOV-CHANGE-CLASSIFICATION.md` before writing anything.
