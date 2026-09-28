# DEVGOV-INVARIANT-PACKS-POSTPROVEN-HARDENING-V1 — CANDIDATE

**Status:** CANDIDATE / NOT YET PROVEN
**Frozen base:** `825a876bd8067f5307181d9033067217968892f2`
**Historical Step 5 PROVEN record:** `DEVGOV-INVARIANT-PACKS-V1`
**Unit:** `DEVGOV-INVARIANT-PACKS-POSTPROVEN-HARDENING-V1`

## Purpose

A cold falsification pass performed after Step 5 had already been admitted as PROVEN found six
adversarial mutations that the protected invariant-pack evaluator on exact live main
`cf33cc1318b4505ccbf57d6296136b99c41fdee1` classified as `PASS`.

This unit does not rewrite or delete the historical admission record. It records new contradictory
evidence, repairs the mechanism, and requires a new exact-SHA trusted proof before the hardening may
be relied upon.

## Historical anchors

The existing PROVEN record binds:

- gated implementation candidate `65ae1487eb7327bc85f80655bacbded84bd09df7`;
- promotion merge `7ec4b1b262e30fe3ff18ecba6d11133c98cb7384`;
- candidate/merge tree `30f2f10686df370d06b56cb6da3b7a8e6ef74152`;
- trusted orchestration `36230319826`;
- canonical gate `36230861086`;
- PROVEN-record PR #179.

Those historical facts remain true. The broader claim that the mechanism is fail-closed against the
attack classes below is falsified by new evidence and is therefore not treated as currently PROVEN.

## Cold falsification on live protected main

All six probes were executed against a clean detached checkout of
`cf33cc1318b4505ccbf57d6296136b99c41fdee1`. Each probe expected the invariant evaluator to return
`FAIL`; all six instead returned `PASS` with an empty `failed_invariants` set.

1. **F-04 — pack failure not load-bearing:** adding `continue-on-error: true` to canonical pack
   verification remained accepted.
2. **F-05 — candidate execution decoy:** a literal controller command kept as a comment plus dynamic
   `node "$CANDIDATE_RUNNER"` execution in `pull_request_target` remained accepted.
3. **F-06 — protected-base assertion removal:** removing both the `main` event filter and runtime
   `BASE_REF == DEFAULT_BRANCH` assertion remained accepted.
4. **F-08 — report substitution:** overwriting the generated pack report before artifact upload
   remained accepted; the final trusted status was not bound to re-verification of that report.
5. **F-13 — path traversal:** a prefix-valid
   `governance/devgov/invariant-packs/../../../../evil.json` pack path could escape
   `controllerRoot` and remained accepted.
6. **F-14 — non-impact skip:** adding caller-controlled `if: ... non_impacting != 'true'` conditions
   around pack execution remained accepted.

## Repairs

The candidate closes the attack classes, rather than only the exact fixtures:

- canonical realpath containment and strict pack-path segments prevent traversal/symlink escape;
- shell and JavaScript line comments are stripped before structural checks;
- pack execution blocks reject dynamic Node targets and caller-controlled conditional skipping;
- DG-IP-007 independently requires default-branch/base-ref equality;
- canonical gate pack verification cannot become `continue-on-error`;
- the generated report is re-verified for result, registry version, digest, controller SHA and
  candidate SHA;
- final `DEV-GOV-V0 / trusted-execution` success additionally requires a load-bearing `pack_ok`;
- permanent regression tests cover all six findings plus future-controller realpath escape.

## Required proof

RED on the frozen base must show that the post-PROVEN hardening guards are absent while the existing
Step 5 machinery is present. GREEN on the exact candidate must prove:

1. the hardening guards are present;
2. the live invariant evaluator passes;
3. focused invariant/orchestration/trusted-workflow tests pass;
4. the complete Dev-Gov suite passes;
5. all changed files pass targeted formatting.

A separate cold rerun must retain the six adversarial probes as negative controls.

## Scope and non-claims

This unit changes no LU, W1, W2, GIS, document, database, product, API or UI code. It does not alter
the attestation signer, invariant registry contents, pack membership or orchestrator workflow.

It also does **not** close the broader F4 status-authority question: branch protection currently
requires `DEV-GOV-V0 / trusted-execution` from the GitHub Actions app identity rather than a unique
workflow identity. The main-only, human-reviewed `devgov-attestation` environment and F-11
`repository_dispatch` closure remain intact, but uniqueness of status publication authority is a
separate hardening problem.

## Finalization

Remain CANDIDATE until exact-SHA trusted RED/GREEN, canonical gate, merge topology/tree equality and
a separately gated PROVEN record for this hardening have all succeeded.
