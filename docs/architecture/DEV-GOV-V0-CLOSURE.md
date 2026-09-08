# DEV-GOV-V0 Closure

Status: **CLOSED / OPERATIONAL**
Date: 2026-09-05
Scope: The final, live-verified statement that the DEV-GOV-V0 bootstrap is done. This document
freezes what is PROVEN, names the canonical controller, and closes the bootstrap exception. It does
not narrate how we got here (`DEV-GOV-V0-FOUNDATION-CLOSEOUT.md`, PR #113) and it does not define
metrics going forward (`DEV-GOV-V0-ACCEPTANCE-METRICS.md`, PR #113).

All facts below were re-verified live against GitHub immediately before this document was written,
not carried forward from earlier session state.

## 1. Canonical controller

```text
main:               2855f6c6e890f1631bb4236d64b41171ca1f3dc1
required check:     DEV-GOV-V0 / trusted-execution
check state:        success — "Trusted RED/GREEN verified for exact candidate SHA"
required-check app: github-actions (app_id 15368) — bound automatically by GitHub after real
                     status history existed; not devgov-asserted
strict:              true
enforce_admins:      true
allow_force_pushes:  false
allow_deletions:     false
```

This is the exact SHA a future consumer must treat as "the protected controller." Verify it live
before relying on this document — do not treat this file as a substitute for re-checking.

## 2. Bootstrap closure statement

The bootstrap exception — the narrow, owner-authorized ceremony that temporarily removed the
`DEV-GOV-V0 / trusted-execution` required-status-check context, performed a pure fast-forward, and
immediately restored branch protection — was used **five times**, all before this document, all
independently verified, all with branch protection byte-identical before and after:

| Promoted SHA | Purpose                                                                  |
| ------------ | ------------------------------------------------------------------------ |
| `1b9f4def`   | v2 execution-identity guard (closes the v1 symlink-substitution gap)     |
| `d975e7ef`   | isolation diagnostic instrumentation                                     |
| `eab97f9d`   | traversal diagnostic instrumentation                                     |
| `c656ec6f`   | runtime repair (`/home/runner` traversal fix)                            |
| `0b3eb541`   | **self-referential proof**: controller == candidate == promoted main SHA |

`0b3eb541` is the moment the bootstrap circle actually closed: the controller executed and attested
**itself**, live, from `main` — not a claim about a future controller, a proof of the one already
running.

**The bootstrap exception is CLOSED.** Every promotion after `0b3eb541` (the four-unit CI recovery
train below) used the identical ceremony mechanics but needed no exception, because the required
check could be satisfied honestly before each fast-forward — this is the chain operating normally,
not a special case. Reopening the bootstrap exception requires a new, explicit owner authorization;
it is not implied by any future maintenance work.

## 3. Post-bootstrap operation, proven

Four units landed after `0b3eb541`, each a fresh direct child of the then-current live `main`,
proved by exact-SHA RED, GREEN, signed attestation, and evidence-gate, then landed by pure
fast-forward with **no branch-protection exception**:

| Unit                                 | SHA        | RED         | GREEN       | Gate        |
| ------------------------------------ | ---------- | ----------- | ----------- | ----------- |
| `CI-BASELINE-SYNTAX-RECOVERY`        | `f7600ebb` | 33904978823 | 33905662525 | 33905970612 |
| `CI-BASELINE-LINT-SCOPE`             | `1f18c478` | 33907102878 | 33909648641 | 33909933046 |
| `CI-BASELINE-AUDIT-GATE-VALIDITY-V2` | `5b625396` | 33910649620 | 33913291559 | 33913578128 |
| `CI-BASELINE-MODULE-RESOLUTION`      | `2855f6c6` | 33914362375 | 33915391158 | 33916148816 |

This is the proof that DEV-GOV-V0 is not merely self-referential — it has now certified four
independent, ordinary maintenance changes, each with its own falsifiable RED/GREEN claim, none of
them about DEV-GOV itself.

## 4. Frozen invariants

These are proven, not aspirational, and change to any of them is a `REQUIRED_DEFECT_FIX`-or-nothing
question, never routine maintenance (see `DEV-GOV-CHANGE-CLASSIFICATION.md`):

1. **Exact-SHA binding.** Candidate, base, and controller SHAs are each pinned exactly; no
   substitution, squash, or recreation is accepted. Verified adversarially (v2 symlink battery) and
   operationally (`236ccdf6` correctly frozen rather than force-promoted when its lineage went stale).
2. **RED-before-GREEN causal ordering.** GREEN's `started_at` must be strictly after RED's
   `finished_at` for the same unit/base/candidate; enforced by timestamp comparison in
   `scripts/devgov/devgov.mjs`. Caught live in this engagement (U1's first gate attempt) when RED and
   GREEN were dispatched too close together.
3. **Signer isolation.** The execution job never holds the signing credential; a separate job on the
   protected `devgov-attestation` environment receives only the unsigned record and signs it.
   `prevent_self_review: true` on that environment additionally prevents the dispatcher from being
   the approver.
4. **OIDC-bound verifier trust policy.** The gate's trust policy is sourced only from a protected
   secret, proven via a GitHub-issued OIDC token bound to the exact policy-bytes hash and candidate
   SHA; redirection to another repository, workflow, ref, environment, or runner class is denied.
5. **Path/branch lock.** `forbidden_paths` always wins over `allowed_paths`; a unit cannot touch
   anything outside its declared scope.
6. **Fail-closed on environment failure.** `BLOCKED_ENVIRONMENT` is a distinct classification from
   `FAIL` — an inability to run is never silently counted as a passing or failing proof.
7. **Status is published only on the exact candidate SHA.**
8. **Required-check app binding is GitHub-enforced, not devgov-controlled.** `app_id` on the required
   context started `null` (no app had ever posted a matching status) and GitHub auto-bound it to the
   real issuing app (github-actions, `15368`) after live status history existed. This closes a
   previously-identified gap (any actor could satisfy an unscoped context) as a side effect of normal
   operation, not a devgov change.

## 5. Regression coverage

See `DEV-GOV-V0-REGRESSION-BASELINE.md` for the full mapping. Summary: 88 local tests across 9 files
in `scripts/audit/devgov*.test.ts` cover every invariant in §4 except #8 (a GitHub-side property, not
locally testable) and the two runtime-only defects (`/home/runner` traversal, signer-key PEM format)
that could only be proven by a live GitHub-hosted run, not a local unit test.

## 6. Residual risks — non-blocking hardening only

Per the maintainer mandate, nothing below blocks platform work and nothing here implies further
DEV-GOV architecture changes are needed:

- **Local test timeout flakiness.** Locally observed on Windows by the author; not independently
  reproduced in this verification. Linux CI evidence observed clean (`devgov-v0.yml` run
  `33745951583`, on `1b9f4def`). Classification remains `NICE_TO_HAVE` / non-blocking — raise
  `testTimeout` for the affected subprocess-spawning specs in `scripts/devgov/vitest.config.mjs` if
  it recurs. Does not affect trust semantics.
- **`devgov-v0.yml` (the read-only PR validation gate) has run once in its entire history.** All
  four recovery-train units touched exactly the paths it filters on, yet none went through a pull
  request, so it has never actually exercised the current test suite in CI. Not a defect in
  DEV-GOV — it reflects that ordinary PR automation for DEV-GOV was deliberately not built (see §7).
- **PR automation for ordinary pull requests remains unbuilt**, by design. An earlier design pass
  (`DEV-GOV-PR-TRUSTED-EXECUTION-INTEGRATION`) found that DEV-GOV-V0's RED/GREEN mechanism requires
  each unit to declare its own falsifiable claim — there is no generic, honest "this ordinary PR
  passed DEV-GOV" claim without either requiring every contributor to hand-author a unit definition,
  or synthesizing a claim so generic it would just be CI re-labeled. That question was correctly
  left open rather than resolved by a shortcut, and it is explicitly out of scope for the maintainer
  role (see `DEV-GOV-CHANGE-CLASSIFICATION.md`).

## 7. What this closure does not claim

- Does not claim adversarial coverage of the evidence-gate/attestation pipeline as a whole against a
  live, deliberately-forged submission — the regression suite exercises this at the unit-test level
  (mocked/constructed inputs), not as an end-to-end adversarial GitHub run. See
  `DEV-GOV-V0-ACCEPTANCE-METRICS.md` for the honest status of that gap.
- Does not claim ordinary-PR DEV-GOV automation exists. It does not.
- Does not extend to platform work (P1/P2/P3 units) beyond providing the trusted-execution chain
  those units may use — see `DEV-GOV-V0-PLATFORM-HANDOFF.md`.
