# DEV-GOV Change Classification

Status: **ACTIVE POLICY**
Date: 2026-09-05
Scope: Every proposed change touching DEV-GOV (`scripts/devgov/**`, `.github/workflows/devgov-*.yml`,
`governance/devgov/**`) must be classified into exactly one bucket before any code is written. Only
one bucket authorizes blocking platform work; the other two are logged and deferred.

## The three buckets

```text
REQUIRED_DEFECT_FIX
  A proven defect in an existing, frozen invariant (DEV-GOV-V0-CLOSURE.md §4).
  "Proven" means: reproduced, not hypothesized. A failing test, a live adversarial run that
  succeeded when it should have been denied, or a documented incident.
  -> This is the ONLY bucket that may block platform work.
  -> Fix scope must be the minimum that closes the proven gap. Nothing else rides along.

SECURITY_HARDENING
  A real, demonstrated weakness that is not (yet) a proven exploit against a frozen invariant —
  e.g. the required-check app_id gap this engagement found and watched close itself, or a probe
  whose green is reachable by an unintended route that a live attack has not yet exercised.
  -> Does not block platform work.
  -> Gets its own unit, on its own timeline, reviewed with the same rigor as any other unit.

NICE_TO_HAVE
  Everything else: convenience, DX, coverage of a theoretical (not demonstrated) gap, automation
  that would be pleasant but nothing currently depends on it.
  -> Does not block anything. Track it; do not act on it reflexively.
```

## Why this exists

DEV-GOV-V0 is closed (`DEV-GOV-V0-CLOSURE.md`). The role from here is maintainer and adversarial
verifier, not implementer. Every "while I'm in here, I could also..." is exactly how a closed system
stays open. This rubric exists to make that an explicit decision, not a default.

## Worked examples, already classified

These are real proposals from this engagement, classified so the rubric is not abstract:

| Proposal                                                                           | Classification                           | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CI-TEST-EVIDENCE-EXECUTION-UNLOCK` (decouple test jobs from static-gate `needs:`) | `NICE_TO_HAVE` — but see below           | Zero executed test evidence on main for 60+ runs is a real gap, but it is a **CI-baseline** gap (`ci.yml`), not a DEV-GOV trust-chain gap. Its own design pass was independently rejected by adversarial review before anything was built (3 verified probe bypasses) — see the design transcript. Reclassify to `REQUIRED_DEFECT_FIX` only for the narrower, already-isolated DB-0-SAFETY guard name mismatch, which is a one-line fix blocking real test collection. |
| Regression suite gaps for `/home/runner` traversal or signer-key PEM format        | Not applicable — no gap exists           | Verified in `DEV-GOV-V0-REGRESSION-BASELINE.md` §4: these are runtime-only properties, correctly absent from local tests, not a hole.                                                                                                                                                                                                                                                                                                                                  |
| Raising `testTimeout` for three flaky local test files                             | `NICE_TO_HAVE`                           | Windows-local timing artifact, never observed on the Linux runner that actually matters. Does not touch trust semantics.                                                                                                                                                                                                                                                                                                                                               |
| Automatic DEV-GOV triggering on ordinary pull requests                             | Neither bucket — explicitly out of scope | Not a defect (nothing is broken) and not hardening (nothing is weak). It is unbuilt functionality whose design was correctly halted on an unresolved architectural question (what RED/GREEN claim would an arbitrary PR even assert?). Revisiting it requires a fresh owner decision, not a classification.                                                                                                                                                            |

## Process

1. Anyone proposing a DEV-GOV-touching change states the claim and the proven-vs-hypothesized
   evidence for it, in writing, before any implementation.
2. Classify using the rubric above. If evidence for `REQUIRED_DEFECT_FIX` is not a reproduction,
   reclassify down.
3. Only `REQUIRED_DEFECT_FIX` may proceed as blocking work. It still follows the full golden path in
   `DEV-GOV-V0-PLATFORM-HANDOFF.md` — being urgent does not exempt it from RED/GREEN, independent
   verification, or fast-forward landing.
4. `SECURITY_HARDENING` and `NICE_TO_HAVE` are recorded (this file, or a future backlog document) and
   scheduled independently of platform work. They do not get to "just quickly also fix this" their
   way into a `REQUIRED_DEFECT_FIX`'s diff.
