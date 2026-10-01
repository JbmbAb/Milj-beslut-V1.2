# DEV-GOV-V0 Foundation Closeout

Status: **PROVEN / PROMOTED**
Date: 2026-09-04
Scope: What actually happened during the DEV-GOV-V0 bootstrap. This document
records facts (exact SHAs, run IDs, outcomes), not architectural rationale
(see the DEV-GOV ADR, once written) and not forward-looking metrics (see
`DEV-GOV-V0-ACCEPTANCE-METRICS.md`).

All SHAs, run IDs, and outcomes below were independently verified against
live GitHub state (`gh api`, `git ls-remote`) during the bootstrap session,
not taken on the producer's word.

## 1. Timeline of candidates

| Candidate SHA           | Parent                  | Purpose                                                                                                                                 | Outcome                                                                                                                                                                                                                                               |
| ----------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `128909dd` … `7e2f151c` | —                       | Earlier DEV-GOV-V0 iterations (pin verifier trust authority, execution record schema, etc.)                                             | Superseded                                                                                                                                                                                                                                            |
| `7f2336a6`              | `7e2f151c`              | v1 execution-identity guard (`anchor npm ci`)                                                                                           | **NOT_PROVEN** — symlink-substitution guard only proved `resolve(X)==resolve(X)`, not that `X` was the non-substituted original path                                                                                                                  |
| `1b9f4def`              | `7f2336a6`              | v2 execution-identity guard (`verify-execution-root.mjs`, dedicated `lstat`-based symlink rejection)                                    | Independently verified PASS (11-attack adversarial battery); promoted to `main`                                                                                                                                                                       |
| `d975e7ef`              | `1b9f4def`              | Diagnostic instrumentation only (`DEVGOV_ISOLATION_START/PASS/FAILED_COMMAND/FAILED_EXIT` markers around the isolation-bootstrap steps) | No functional change; promoted to observe the real failure                                                                                                                                                                                            |
| `eab97f9d`              | `d975e7ef`              | Additional diagnostic: `namei -l` + non-fatal `test -x` traversal probes                                                                | No functional change; promoted; revealed root cause: `/home/runner` (`drwxr-x---`, `runner:runner`) blocks `devgov-candidate` traversal                                                                                                               |
| `c656ec6f`              | `eab97f9d`              | Runtime repair: `sudo chmod o+x /home/runner`, fail-closed, before the traversal probes                                                 | Empirically confirmed fix (full RED→npm-ci→freeze chain passed); promoted                                                                                                                                                                             |
| `236ccdf6`              | `7e2f151c` (stale base) | Historical post-bootstrap manifest probe                                                                                                | **PROVEN as a candidate** (RED FAIL, GREEN PASS, signed, gated, status green) but **not promotion-compatible** — its parent predates `c656ec6f` by several commits; fast-forwarding to it would have discarded later history. Frozen, never promoted. |
| `0b3eb541`              | `c656ec6f`              | Re-ported post-bootstrap manifest probe, base_sha corrected to current main                                                             | **PROVEN and PROMOTED** — full self-referential chain: controller == candidate == promoted main SHA                                                                                                                                                   |

## 2. Defects found and closed

### 2.1 Symlink-substitution gap (v1 → v2)

- **Symptom:** v1's execution-root guard compared `realpath(X)` to itself, which is a tautology, not proof that `X` was un-substituted.
- **Fix:** `scripts/devgov/verify-execution-root.mjs` (introduced at `1b9f4def`) uses `lstatSync` (no symlink follow) on the execution root and both package files, and binds the execution root to the one expected canonical path (`realpath(workspace)/execution`).
- **Verification:** independent adversarial battery — symlink/junction substitution, sibling-path substitution, path traversal, non-directory/non-existent paths, missing `package.json`, cwd independence — all rejected with exit 4. Real Linux file-symlink attack on `package.json`/`package-lock.json` confirmed rejected (owner-run, exit 4, both files).

### 2.2 Silent isolation-bootstrap failure (discovered post-promotion of `1b9f4def`)

- **Symptom:** run `33764939366` (first live dispatch of the promoted v2 controller against the historical probe) failed at "Prepare isolated proof OS identity" with exit code 1 and **zero captured stdout/stderr** — confirmed via raw job-log API, not just CLI display.
- **Diagnosis path:** `d975e7ef` added labeled start/pass/fail markers around each isolation command → pinpointed failure to `read-package-json` (`sudo -u devgov-candidate test -r "$execution_root/package.json"`, exit 1). `eab97f9d` added `namei -l` and non-fatal traversal probes → pinpointed root cause: `/home/runner` has mode `750`, owner/group `runner:runner`; `devgov-candidate` (a distinct system user) cannot traverse into it, so it can never reach `execution/package.json` regardless of that file's own ownership.
- **Fix:** `c656ec6f` adds `sudo chmod o+x /home/runner` (fail-closed, run before the traversal probes). Scope of the change: 1 line in `.github/workflows/devgov-v0-attest.yml`, plus a locking test assertion.
- **Verification (run `33808393416`):** full isolation sequence passed end to end — `verify-execution-root` → `useradd` → `chown-execution-root` → `open-runner-home-traverse` → `inspect-package-path` → all three traversal probes → `read-package-json` → `read-package-lock-json` → `npm-ci` → freeze steps → `execution-record.json` created and uploaded. No error anywhere in the log.
- **Noted, not blocking:** `chmod o+x /home/runner` grants traversal to all users on the runner, not only `devgov-candidate`. Accepted because GitHub-hosted runners are single-job, ephemeral, single-tenant VMs — no other untrusted actor shares the machine. Recorded here for future hardening (e.g. targeted ACL or group membership) if the execution model ever changes.

### 2.3 Signer key decode failure (provisioning defect, not architecture)

- **Symptom:** run `33808393416`'s `attest-execution` step failed with `result: BLOCKED_ENVIRONMENT`, `reason_code: COMMAND_BLOCKED`, `message: "error:1E08010C:DECODER routines::unsupported"`, at `createPrivateKey(privateKeyPem)` in `scripts/devgov/trusted-attestation.mjs`.
- **Diagnosis:** confirmed via code read (`devgov.mjs:1054`, `trusted-attestation.mjs:145`) that `DEVGOV_ATTESTATION_PRIVATE_KEY_PEM` is passed to Node's `crypto.createPrivateKey()` with **zero normalization** — no `\n`-escape handling, no trim. Consistent with the secret having been stored with literal `\n` sequences instead of real line breaks (common when a multi-line PEM is pasted into a single-line secret field).
- **Fix:** owner re-stored the GitHub secret with real newlines. Code was not changed (in scope: signer/OIDC changes were explicitly not authorized for this repair lane).
- **Verification (run `33847098588`):** `Sign on isolated protected runner` completed successfully; signed attestation artifact `devgov-attestation-RED-committed-probe-definition-236ccdf6...` produced (1148 bytes).

### 2.4 Promotion-identity mismatch (`236ccdf6` frozen, not promoted)

- **Symptom:** `236ccdf6`'s manifest correctly proved RED/GREEN/attest/gate, but its parent (`7e2f151c`) was several commits behind live `main` (`c656ec6f` at the time). A fast-forward would have discarded `1b9f4def`, `d975e7ef`, `c656ec6f`.
- **Resolution:** `236ccdf6` frozen as a **historically PROVEN candidate that is not promotion-compatible**. A new candidate, `0b3eb541`, was created with the identical semantic diff, base_sha corrected to `c656ec6f`, and run through the full RED/GREEN/attest/gate chain independently — no reuse of `236ccdf6`'s proof, no cherry-pick, no rebase.
- **Significance:** this is the system catching a real promotion-identity/historical-context defect before it reached `main`, exactly as intended — not a DEV-GOV failure.

## 3. Promotion mechanics (all three promotions used the same procedure)

No canonical promotion procedure existed in repo documentation; the repo's
default (PR + squash-merge, see `CONTRIBUTING.md` / `docs/GIT_WORKFLOW.md`)
cannot preserve an exact proven SHA as a reachable, unmodified commit. The
following narrow, repeatable ceremony was used for all three promotions
(`1b9f4def`→`d975e7ef`, `d975e7ef`→`eab97f9d`, `eab97f9d`→`c656ec6f`,
`c656ec6f`→`0b3eb541`):

1. **Pre-flight (read-only):** verify `origin/main` equals the expected base SHA, verify candidate's parent equals that SHA, capture the complete branch-protection object.
2. **Owner authorization (explicit, narrow, single-promotion-scoped):** temporarily remove **only** the `DEV-GOV-V0 / trusted-execution` required-status-check context; no other protection field.
3. **Mutation:** pure fast-forward push (`git push origin <candidate>:refs/heads/main`) — no force, merge commit, rebase, squash, or cherry-pick.
4. **Restore:** immediately re-apply the captured branch-protection state.
5. **Post-check (read-only, independent):** re-fetch `origin/main`, confirm exact SHA and clean fast-forward history; diff live branch protection against the captured before-state.

### Observed non-restorable field: `required_status_checks.checks[0].app_id`

Before every promotion in this bootstrap, `app_id` was `null` (no GitHub App had ever posted a status against the `DEV-GOV-V0 / trusted-execution` context). After the first real RED/GREEN/gate cycle posted a status via the `github-actions` App (id `15368`), GitHub auto-binds the required-check context to that App and **rejects** attempts to reset `app_id` back to `null` via both `PATCH .../required_status_checks` and `PUT .../protection` (tested explicitly, both return `app_id: 15368` regardless of an explicit `"app_id": null` in the request body).

**Classification: accepted, security-strengthening, non-degrading.** `app_id: null` was itself a previously-identified gap (any actor able to post a commit status with the matching context string could satisfy the gate). Binding to the actual issuing App closes that gap. This delta is recorded here as an accepted, permanent characteristic of the restored state — not an unresolved defect requiring remediation.

## 4. Final proven state (as of this closeout)

```text
main:                    0b3eb5411d8312a641372d6e12540bdf3bd61b2e
controller == candidate: 0b3eb5411d8312a641372d6e12540bdf3bd61b2e  (self-referential post-promotion proof)
required check:          DEV-GOV-V0 / trusted-execution, strict=true, app_id=15368
status on main SHA:      success ("Trusted RED/GREEN verified for exact candidate SHA")
```

Post-promotion self-proof chain (controller, candidate, and `main` all equal `0b3eb541`):

| Stage         | Run           | Result                                                                                     |
| ------------- | ------------- | ------------------------------------------------------------------------------------------ |
| RED           | `33860984340` | `execution_sha == base_sha (c656ec6f)`, exit_code 1, classification FAIL — expected        |
| GREEN         | `33860992231` | `execution_sha == candidate_sha (0b3eb541)`, exit_code 0, classification PASS — expected   |
| Sign (both)   | (same runs)   | success, reviewer-approved (`devgov-attestation` environment, `prevent_self_review: true`) |
| Evidence gate | `33861882579` | success, `headSha = 0b3eb541`                                                              |
| Status        | —             | `state: success` on `0b3eb5411d8312a641372d6e12540bdf3bd61b2e`                             |

## 5. What this closeout does not claim

- Does not claim adversarial coverage against forged/substituted evidence, stale RED/GREEN, wrong-issuer signatures, or tampered manifests — see `DEV-GOV-V0-ACCEPTANCE-METRICS.md`, "Adversarial Coverage" row (status: INCOMPLETE).
- Does not claim the `app_id`-bypass class of risk is fully closed for every required-check context in the repo — only for `DEV-GOV-V0 / trusted-execution`, and only after real status history existed to force GitHub's auto-binding.
- Does not define architectural invariants (`PROVEN ≠ AUTHORIZED ≠ PROMOTED`, replay semantics, revocation semantics) — those belong in a dedicated ADR, not yet written.
