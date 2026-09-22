# DEV-GOV authoring prompts

Status: **authoring aid only**. This document, the authoring preflight, Claude, and Codex are not
trusted execution authorities. The existing DEV-GOV controller and protected trusted evidence gate
remain authoritative.

## Producer template (Claude)

Use this template before implementation.

### Frozen question

- Unit:
- Frozen base SHA:
- Claim:
- Non-claims:
- RED property:
- Evidence/proof class:
- Scope that may change:
- Explicit stop conditions:

Claim, non-claims, RED, base SHA, and evidence/proof class are frozen before implementation.
The allowed_paths and GREEN fields may evolve only as implementation-plan details; widening the
proof class requires a new cold review.

### STEP 0

Before editing, report:

- exact repository and remote;
- current branch and HEAD;
- frozen base and merge-base;
- working-tree state;
- proposed changed paths and why each is required;
- whether any proposed path widens the proof/evidence class.

Do not modify controller, trusted workflow, signer, trust policy, or authority code unless the unit
explicitly exists to change that layer.

### RED honesty

RED must fail on the frozen base for the semantic property under test.

- Do not rely on a candidate-only test/module being absent on the base.
- If a RED intentionally proves absence of a new record, state that explicitly.
- Give harness/environment failures a dedicated blocked exit code (R1 convention: exit 2).
- A semantic violation should use a different exit (R1 convention: exit 1).
- Include a positive control so "the proof never reached the behavior" cannot look like RED.
- Remember that trusted jobs install with npm ci --ignore-scripts; generated clients/assets needed
  by the proof must be provisioned explicitly inside the proof or the proof must block.

When a candidate definition exists, run:

~~~text
node scripts/tooling/devgov-authoring-preflight.mjs \
  --definition governance/devgov/units/<unit>.json \
  --candidate-sha <candidate> \
  --worktree <repo>
~~~

Treat its output as early feedback only. A local PASS is never trusted evidence.

### Completion report

Return exact candidate SHA, changed paths, RED command/reason, GREEN commands/results, non-claims,
new gaps, local authoring-preflight result, and working-tree state. Do not push/dispatch unless the
owner asked for it.

## Cold verifier template (Codex)

You are independent verifier. Do not use producer reasoning as evidence.

Pin:

- frozen base SHA;
- exact candidate SHA;
- candidate tree SHA;
- merge-base/ancestry;
- complete changed-path set;
- clean independent worktree.

Then independently falsify:

1. the frozen claim;
2. RED honesty on the frozen base;
3. GREEN behavior on the exact candidate;
4. scope/non-claim preservation;
5. candidate-only proof dependencies;
6. new type/lint/format regressions in changed files;
7. any bypass not exercised by producer tests.

Classify failures as NEW_CANDIDATE_FAILURE, PRE_EXISTING_BASE_FAILURE, or
ENVIRONMENT_NOT_PROVEN. Never convert an unexecuted or blocked proof to PASS.

Final status must be one of:

- APPROVED_FOR_DEV_GOV_CANDIDATE
- BLOCKED
- NOT_PROVEN

Approval means only that the exact candidate may proceed to trusted RED/GREEN.

## R1 lessons encoded by the helper

The authoring helper deliberately checks the recurring mechanical failures found during
LU-CANONICAL-RUNTIME-HARDENING-R1:

- controller preflight is reused, not reimplemented;
- candidate-only paths referenced by base RED are surfaced;
- overly broad/stale allowed_paths entries are surfaced;
- RED harnesses without blocked-environment exit handling are surfaced;
- Prettier is run only on changed files already covered by the repository's current
  format:check scope;
- ESLint is run only on changed lintable files;
- missing local node_modules produces a warning/skip, never fake trusted evidence.

Do not add policy to this helper merely because a future unit is inconvenient. If a rule must become
authoritative, promote it deliberately through the controller/invariant-pack process.
