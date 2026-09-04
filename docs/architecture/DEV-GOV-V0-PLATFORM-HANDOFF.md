# DEV-GOV-V0 Platform Handoff

Status: **OPERATIONAL**
Date: 2026-09-05
Scope: How a P1/P2/P3 unit uses the trusted-execution chain that DEV-GOV-V0 already provides. This
document defines a **workflow**, not new trust architecture — every mechanism it references already
exists and is proven (`DEV-GOV-V0-CLOSURE.md`). If following this workflow reveals a real gap, that
is a `REQUIRED_DEFECT_FIX` question for `DEV-GOV-CHANGE-CLASSIFICATION.md`, not a license to design
something new inline.

## 1. What a unit is

A DEV-GOV unit is a self-describing, falsifiable claim about an exact diff: "this exact command must
FAIL at `base_sha` and PASS at `candidate_sha`." It is not a generic "did CI pass" wrapper — see
`governance/devgov/units/README.md` for the full contract, and
`governance/devgov/units/ci-baseline-module-resolution.json` for a worked example.

A unit definition is committed **inside** the candidate it governs, at a path the definition itself
declares under `allowed_paths`, following `governance/devgov/schema/dev-gov-v1-unit-definition.schema.json`.

## 2. The golden path

```text
1. WRITE THE UNIT DEFINITION
   - state ONE falsifiable claim (not "tests pass", a specific property)
   - base_sha = current live main (verify live, not from memory)
   - ancestry_policy = exact_parent (the normal case)
   - allowed_paths = exactly what this unit touches, nothing broader
   - forbidden_paths = at minimum: .github/**, scripts/devgov/**, governance/devgov/schema/**
   - required_red / required_green = the same command, asserted to FAIL at base_sha and
     PASS at candidate_sha

2. LOCAL VERIFICATION (before committing anything)
   - run the RED probe against base_sha's actual state -> confirm it fails for the RIGHT reason
   - run the GREEN probe against the candidate's actual state -> confirm it passes
   - run `npm run devgov:test` -> confirm the existing 88-test regression baseline still passes
     (see DEV-GOV-V0-REGRESSION-BASELINE.md)
   - if the probe can be satisfied by narrowing scope rather than fixing the claim, IT IS WRONG —
     this is the exact failure mode that slipped through in CI-BASELINE-MODULE-RESOLUTION (proven
     only "no TS2307 outside package X", not "total error count did not increase"; the landed commit
     also excluded two files from the program). Write an anti-narrowing assertion into the probe
     itself, or state explicitly in the unit definition why none is needed.

3. COMMIT AND PUSH
   git checkout -b codex/<unit-name> origin/main
   # apply the change + the unit definition (git add -f — see note below)
   git commit
   git push origin codex/<unit-name>

   NOTE: governance/devgov/units/*.json is covered by a repo-wide `*.json` .gitignore entry.
   `git add -f` is required or the manifest silently does not commit and the proof fails
   mysteriously. This has bitten every unit built in this engagement; it is not new.

4. INDEPENDENT VERIFICATION (review surface)
   Open a PR from the candidate branch against main. This is a REVIEW AND AUDIT SURFACE, not the
   landing mechanism (see step 6) — do not squash-merge it. Use it for human review of the diff and
   the unit definition's scope.

5. TRUSTED GITHUB EXECUTION
   gh workflow run devgov-v0-attest.yml --repo <repo> --ref main \
     -f candidate_sha=<candidate> -f unit_definition_path=<path> \
     -f proof_kind=RED -f test_id=<id>

   Wait for RED's Execute AND Sign jobs to fully complete (check status, not just that it was
   dispatched) before dispatching GREEN. Dispatching both together risks the RED-before-GREEN
   ordering violation this engagement hit live during U1 — GREEN's started_at must be strictly
   after RED's finished_at.

   gh workflow run devgov-v0-attest.yml --repo <repo> --ref main \
     -f candidate_sha=<candidate> -f unit_definition_path=<path> \
     -f proof_kind=GREEN -f test_id=<id>

   Both attest runs require approval in the `devgov-attestation` protected environment
   (`prevent_self_review: true` — the dispatcher cannot self-approve).

6. SIGNED EVIDENCE -> REQUIRED CHECK
   gh workflow run devgov-v0-gate.yml --repo <repo> --ref main \
     -f candidate_sha=<candidate> -f unit_definition_path=<path> \
     -f red_run_id=<red> -f green_run_id=<green>

   On success this publishes `DEV-GOV-V0 / trusted-execution: success` on the exact candidate SHA —
   the one context branch protection actually requires.

7. LAND — FAST-FORWARD, NOT SQUASH
   This is the one place a normal PR workflow and a DEV-GOV unit diverge. Squash-merging would mint
   a NEW commit SHA, which is not the SHA that was proven — the exact-SHA invariant (§4.1 of
   DEV-GOV-V0-CLOSURE.md) would be violated by the repository's own default merge convention.

     git fetch origin main   # re-verify live main == the unit's base_sha
     git push origin <candidate-sha>:refs/heads/main

   No branch-protection exception is needed here — the required check is already green on the exact
   SHA, so a normal fast-forward satisfies branch protection honestly. This is the same mechanism
   used to land all four post-bootstrap recovery units (`DEV-GOV-V0-CLOSURE.md` §3), none of which
   used the bootstrap exception.

8. RE-OBSERVE
   Confirm live main == the candidate SHA, branch protection unchanged, and (if the change touches
   CI) that the next authoritative CI run reflects the intended effect. Do not design the next unit
   on a stale base.
```

## 3. What this workflow deliberately does not cover

- **Ordinary, non-DEV-GOV pull requests** (a P1/P2/P3 feature that is not itself proving a DEV-GOV
  claim) merge exactly as `CONTRIBUTING.md` / `docs/GIT_WORKFLOW.md` already describe — PR + squash.
  This document only applies when a change is itself packaged as a DEV-GOV unit.
- **Automatic DEV-GOV triggering on arbitrary PRs.** Not built, and not a gap — see
  `DEV-GOV-V0-CLOSURE.md` §6 for why that question was correctly left open rather than resolved by a
  shortcut.
- **Deciding whether a given piece of platform work should be a DEV-GOV unit at all.** Most P1/P2/P3
  work should not be — DEV-GOV units are for changes that need a machine-verified causal claim
  surviving a protected, signed, OIDC-bound execution chain (governance changes, trust-boundary
  changes, CI-baseline recovery of the kind done in this engagement). A routine feature does not need
  this weight; using it as a general-purpose "high assurance PR" process would itself be scope creep.
