# DEVGOV-V1-THROUGHPUT-SAME-RUN-SIGNING-V1

**Frozen base:** `81260bcf2fec45ddeb281fb32ea8680ecad457af` (main; implemented and reviewed against
`12e633803eff4e396e7fc5b41939ce17d6177b25`, fast-forwarded to this SHA immediately before commit --
the 9 intervening commits are all W3a/W3b LU application-code work with zero file overlap with this
change, confirmed by `git diff --name-only` before merging; full invariant-pack and test suite
re-run clean at the new base before commit)

## Process note: this is not a governed Dev-Gov unit

Every file this change touches (`scripts/devgov/devgov.mjs`,
`scripts/devgov/invariant-packs.mjs`, `.github/workflows/devgov-v0-attest.yml`,
`.github/workflows/devgov-v0-orchestrate.yml`) is inside `CONTROLLER_OWNED_FLOOR_PATHS`
(DEVGOV-CONTROLLER-OWNED-PATH-FLOOR-V1). By that unit's own explicit, owner-chosen design, no
Dev-Gov candidate can ever touch these paths again through the governed RED/GREEN/gate mechanism --
only a direct commit to `main` outside it. This document is therefore **not** paired with a
`governance/devgov/units/*.json` unit definition, was never dispatched through
`devgov-v0-orchestrate.yml`, and has no RED/GREEN/gate proof to cite. "Verification" below means
**Local Proof only**: real invariant-pack and test-suite runs against the real files on this
machine, not a trusted, protected-runner execution.

Per the owner's explicit standing instruction for this specific change: because there is no
automated gate forcing "one author, one verifier, never self-review" here the way there is for
every governed unit, that principle is upheld manually. This session (author) does not request
push authorization until an independent peer session has cold-reviewed this exact diff. The owner
pushes it himself; this session never pushes or dispatches it.

**Independent cold review outcome (2026-09-29, W1-VERIFY-DB peer session)**: verdict
`SOUND_WITH_CHANGES`. All four specifically-requested re-derivations (signing-oracle closure,
gate.yml/OIDC non-interference, `TRUSTED_EXECUTION_WORKFLOW_REF` safety, `DG-IP-002`'s new
block-extraction) were independently confirmed by direct code reading and by the reviewer's own
re-run of the invariant-pack suite and full test suite -- not accepted from this document. One
real, narrow finding surfaced and is now fixed; see "Review finding and fix" below. **The fix
itself was then also independently re-verified** by the same reviewer, from scratch rather than
from this document's account: they built their own byte-identical duplicate of the real `sign:`
block, confirmed the old logic falsely passed it and the new logic correctly fails it, confirmed by
construction that `block()`'s behavior at its other six call sites is algebraically unchanged, and
independently reran the full suite (105/105 on their own tracked subset). Final verdict: closed,
sound, ready for the owner.

## Summary

Today, promoting one Dev-Gov candidate costs **N+1** human approval clicks, not N: each declared
RED/GREEN proof signs on its own dispatch of the reusable `devgov-v0-attest.yml` (N clicks, one per
`attest:` job run), and `devgov-v0-gate.yml`'s own `evidence-gate` job is a **separate** click on
the same protected `environment: devgov-attestation`. Both click sets exist because GitHub only
stamps a job's OIDC token with `environment: devgov-attestation` when that job genuinely runs under
that protected environment -- the human-approval requirement and the OIDC trust claim are the same
`environment:` reference, checked twice, not two independent safety nets.

This change collapses the N signing clicks into exactly **one**, by moving signing off the
per-proof reusable workflow and onto a single same-run job in the orchestrator. **`gate.yml` is
completely unchanged** -- its own click and its own OIDC verification are untouched. Net result:
**2 clicks total** per candidate (was N+1), with no new GitHub environment, secret, or trust-policy
infrastructure.

## Design process

Two earlier designs were rejected by adversarial review before any workflow YAML was finalized.

**Rejected: merge signing into `gate.yml`.** The first design folded the one remaining signing step
into `evidence-gate` itself, removing a click entirely (down to 1) by reusing gate's existing
approval. Two independent reviewers, one with a live proof-of-concept, found this **unsound**: it
is a "signing oracle". The design's record-binding check compared each unsigned record's claimed
`workflow_run_id`/`workflow_ref` against an *explicitly supplied expected value* -- but under
`repository_dispatch`, that expected value is itself attacker-controllable payload data. A probe
script built against the real controller functions dispatched a fabricated run, forged RED/GREEN
records, and had them signed and gate-verified as `PASS`/`PROVEN` with zero real execution ever
occurring, after exactly one approval click. This was the key validating case for adversarial review
before implementation: the flaw was in the payload/expected-value comparison, not in anything
visible from reading the workflow YAML alone.

**Rejected: strip `environment:` from `gate`'s job.** The follow-up proposal kept signing in
`gate.yml` but removed its protected-environment binding on the theory that gate's own verification
step "doesn't touch the signing key, so it doesn't need the click." This was also wrong, and was
caught only because the owner explicitly asked for the underlying OIDC mechanism to be shown before
it was accepted: `PINNED_VERIFIER_AUTHORITY.environment` (`scripts/devgov/github-oidc.mjs`) is
hardcoded to `'devgov-attestation'`, and GitHub issues that `environment` claim in a job's OIDC
token **only** when the job genuinely runs under that protected environment. Removing
`environment:` from gate's job would not just remove a click -- it would break gate's own trust-policy
verification of *its own* identity, silently turning a real check into a no-op.

**Adopted: a same-run `sign:` job in `devgov-v0-orchestrate.yml`.** Signing moves out of the
reusable, per-proof `devgov-v0-attest.yml` entirely and into one new job in the orchestrator that
runs once per candidate, after `red`/`green`, before `gate`. `gate.yml` is not touched at all --
it keeps its own existing click and its own existing, already-sound OIDC verification. This closes
the signing-oracle class structurally rather than by tightening the vulnerable comparison: `sign:`
is a job of the *same* orchestration run as every `execute:` job it signs for, so its own ambient
`GITHUB_RUN_ID`/`GITHUB_RUN_ATTEMPT` are genuinely, safely ambient values (not derived from any
`repository_dispatch` payload) that naturally match what `execute:` already stamped into every
unsigned record it produced. There is no "expected value" input left for an attacker to control.

## What changed

- **`.github/workflows/devgov-v0-attest.yml`**: the `attest:` job is deleted entirely. Only
  `execute:` remains -- unprotected, reusable, unchanged in purpose. Its unsigned-record artifact
  `retention-days` is bumped from `1` to `5` (signing now happens in a later job of the same run,
  not immediately after).
- **`.github/workflows/devgov-v0-orchestrate.yml`**: `secrets: inherit` removed from `red`/`green`
  (never needed by `execute:`). New `sign` job added between `green` and `gate`, gated by
  `environment: devgov-attestation`: downloads every unsigned-record artifact produced by this same
  run (`devgov-execution-${{ github.run_id }}-${{ github.run_attempt }}-*`), runs
  `devgov.mjs attest-all`, uploads exactly two artifacts
  (`devgov-attestation-RED-<candidate_sha>`, `devgov-attestation-GREEN-<candidate_sha>`,
  `retention-days: 90`, `overwrite: false`, `if-no-files-found: error`) matching what `gate.yml`
  already downloads and counts, unchanged. `gate`'s `needs:` gains `sign`.
- **`scripts/devgov/devgov.mjs`**:
  - `TRUSTED_EXECUTION_WORKFLOW_REF`, a hardcoded constant naming `devgov-v0-attest.yml`, added so
    every signed record still claims the workflow identity the existing trust-policy/gate
    infrastructure already expects, even though the job that actually signs it now runs in
    `devgov-v0-orchestrate.yml`. It is not attacker-influenceable (a literal in the protected
    controller's own source, not derived from any input) and not part of `proofId`'s hash (confirmed
    empirically). This is a different use case from the dynamic `job.workflow_ref` mechanism
    `execute:` already uses to *stamp* its own records -- that mechanism stays exactly as-is; this
    constant is only for *validating* an incoming record inside a job that has no self-referential
    "the workflow that really executed this" value of its own. A previous attempt at a hardcoded
    ref constant for the stamping use case (`CANONICAL_ATTEST_WORKFLOW_REF`, commit `817fa18b`) was
    replaced within hours by the dynamic mechanism (`b9ac9155`); `devgovOrchestration.test.ts`
    still asserts that name never reappears, confirmed still passing.
  - `signOneExecutionRecord(unitDefinition, candidateSha, kind, id, record, signer)`: the binding
    check shared by both signing paths below. `kind`/`id` always come from the caller (a declared
    unit-definition entry), never read back out of the record's own self-reported fields, so a
    record whose content doesn't match what was asked for is caught by field-by-field comparison
    rather than grading its own homework.
  - `attest-execution` (existing single-record CLI command): kept for backward compatibility, now
    calling `signOneExecutionRecord`.
  - `attest-all` (new): the one-approval batch signer `sign:` invokes. Reads `required_red`/
    `required_green` **only** from the verified unit definition (never from shell/YAML-templated
    loop variables), signs every declared id via the same `signOneExecutionRecord` path, and fails
    the **entire batch closed** -- zero output files written -- if even one record is missing or
    fails validation, so a partially broken candidate can never walk away with partial
    trusted-execution evidence. Reads `GITHUB_RUN_ID`/`GITHUB_RUN_ATTEMPT` directly from its own
    ambient environment (validated as positive integers), not from separate CLI flags.
- **`scripts/devgov/invariant-packs.mjs`**:
  - `DG-IP-002-SIGNER-ISOLATION` re-anchored: checks `attest.yml`'s sole `execute:` job has no
    environment/secret access, that the *rest* of `orchestrate.yml` (everything outside the `sign:`
    block) has none either, and that `sign:`'s own block has both.
  - `noTemplateSpliceInRunBlocks`/`findRunBlocks` (used by `DG-IP-009`, unchanged in this unit's
    scope of intent but touched here because the fix was found while re-verifying this change):
    hardened to also catch `run: |2` (indentation-indicator digits), `run: | # comment` (trailing
    comments), and single-line inline `run: <command>` forms -- none of which the original
    block-scalar-header regex matched. Verified against synthetic edge cases and against zero false
    positives on the real, current file content.
  - `DG-IP-009` now also runs `noTemplateSpliceInRunBlocks` against `orchestrate.yml` (previously
    `attest.yml` only), since the signing job's shell text now lives there.
- **Tests**: `devgovTrustedWorkflow.test.ts`, `devgovOrchestration.test.ts`,
  `devgovInvariantPacks.test.ts` updated to assert the new job shape instead of the old one (see
  Verification). New file **`devgovAttestAll.test.ts`** added -- four tests driving the real CLI
  end to end (real throwaway git candidate, real unsigned-record artifacts on disk, real signer):
  happy path signs both records and produces attestations the real gate independently accepts as
  `PROVEN`; a missing record denies the whole batch and writes zero files; a record whose content
  doesn't match its declared id is denied with `test_id mismatch`; a record forged under a
  different `workflow_ref` is denied with `workflow_ref mismatch`. This formalizes a throwaway probe
  script used during design as permanent regression coverage, per an explicit review finding that it
  should not remain throwaway-only.

## Review finding and fix

The peer reviewer's one finding: `DG-IP-002-SIGNER-ISOLATION`'s new block-extraction computed
`restOfOrchestrator` via `orchestratorSource.split(signBlock).join('')` -- content-based removal,
which deletes **every** occurrence of that exact text in the file, not just the one real `sign:`
job. `block()` itself is position-based (`indexOf`), so the two could disagree: a future edit that
reintroduced a byte-identical copy of the `sign:` block's text elsewhere in the file (a bad merge,
pasted reference text -- these checks read raw source text, not parsed YAML structure, so this does
not require a second literal `sign:` job key) would have its `environment:`/private-key lines
silently stripped out of `restOfOrchestrator` too, and `DG-IP-002` would report `PASS` despite two
copies of signer access existing. Not exploitable by a governed candidate today (F-10 already
blocks any candidate from touching `orchestrate.yml` at all), but a real gap in the one property
this invariant exists to make machine-verified for the actual live threat model here -- a future
direct-main-commit, reviewed the same way this one is being reviewed right now.

Confirmed independently before fixing (pure-function probe against synthetic text, isolated from
YAML/git overhead): appending the exact extracted `signBlock` text verbatim elsewhere in a
synthetic source made the old `split(signBlock).join('')` logic remove both copies (`hasNone` would
incorrectly pass), while position-based removal correctly left the second copy intact (`hasNone`
correctly fails). Two earlier probe constructions (a differently-named decoy job; a same-run
`evaluateInvariantPacks` mutation inserted before the next `\n  gate:` marker) did not reproduce the
defect and were discarded once it was clear why -- both accidentally kept the text either
non-byte-identical or inside `block()`'s own naturally-extracted span; the true trigger requires the
duplicate to be byte-identical to the *entire* extracted span, including its own `  sign:` prefix,
sitting outside that span. **Precisely stated, to avoid overstating the historical exposure**: a
second job under a *different* name (e.g. `sign-decoy:`) was never at risk from this bug, old or
new -- `split()` matches on exact string content, and a different job-name prefix alone already
breaks byte-identity with `signBlock`. The bug's actual reach was narrower and specifically about
literal text reappearing, not about any old differently-labelled duplicate signing job. This was
independently re-derived and confirmed by the reviewer as well, from a fresh build of the same
scenario, not from reading this paragraph.

Fix: `scripts/devgov/invariant-packs.mjs` -- `block()` and a new `removeBlock()` now share a
`findSpan()` helper that computes the same `{start, end}` offsets once; `block()` slices that span
out, `removeBlock()` splices it out by position (`slice(0, start) + slice(end)`), so the two can
never disagree about which occurrence is "the" `sign:` block. `DG-IP-002`'s `restOfOrchestrator`
now uses `removeBlock`, not `split`/`join`. `block()`'s external behavior on all six of its other,
unaffected call sites is unchanged (verified by construction: `findSpan` reproduces the exact same
edge-case semantics `block()` had, including the "no explicit end marker" and "end marker not
found" cases both falling back to slicing to end-of-string).

New permanent regression test added:
`devgovInvariantPacks.test.ts`, *"fails DG-IP-002 if a byte-identical duplicate of the sign: block
appears elsewhere in the file"* -- appends the real, extracted `sign:` block text verbatim to the
end of the fixture's `orchestrate.yml` and asserts `DG-IP-002` still fails.

## Known, accepted consequences

- The approval-click count for every future Dev-Gov candidate permanently changes from N+1 to 2.
  This is the intended effect of this change, not a side effect.
- `attest.yml`'s `attest:` job is gone permanently; anything that referenced it by name (nothing
  found outside `devgov-v0-orchestrate.yml`'s own `uses:` line, which is updated in this same
  change) would break.
- `DG-IP-003-EXACT-CANDIDATE-BINDING`, `DG-IP-005-PACKS-LOAD-BEARING`, `DG-IP-007-PR-PROTECTED-BASE`,
  and `DG-IP-008-POST-MERGE-ACTIVATION` remain whole-file substring searches. They would still pass
  even if `sign:`'s own candidate-binding checks were individually weakened, because the same
  required strings already exist elsewhere in `orchestrate.yml` from other jobs. This is a
  pre-existing limitation of those invariants' method (not introduced by this change), noted here
  rather than fixed, consistent with this program's practice of keeping units surgically scoped
  (the same category of non-claim DEVGOV-CONTROLLER-OWNED-PATH-FLOOR-V1 made about
  `DG-IP-005`/`DG-IP-007` sharing a helper with the check that unit *did* rebuild).

## Verification (Local Proof -- no RED/GREEN/gate dispatch is possible for this change)

- YAML syntax: all three workflow files (`devgov-v0-attest.yml`, `devgov-v0-orchestrate.yml`,
  `devgov-v0-gate.yml`) parse cleanly; job lists confirmed as `['execute']`,
  `['plan','invariant-packs','red','green','sign','gate','state']`, `['evidence-gate']`
  respectively -- the last one unchanged, confirming `gate.yml` was not touched.
- Full `evaluateInvariantPacks()` run against the real repository: `result: PASS`, all 9 named
  invariants (`DG-IP-002` through `DG-IP-009`) plus the `DG-IP-000` canonical-set-completeness
  synthetic check pass.
- Full `scripts/audit/devgov*.test.ts` + `scripts/dev-helpers/unit/devgovHelpers.test.ts` suite:
  **149 tests, 13 files, all pass** (144/12 prior to this unit's new `devgovAttestAll.test.ts`,
  which added 4; 148 prior to the post-review `DG-IP-002` regression test, which added 1).
- `attest-all`'s fail-closed batch contract exercised directly via the real CLI (now permanent
  coverage in `devgovAttestAll.test.ts`, described above under What changed).
- Full invariant-pack suite re-run against the real, post-fix files after the review finding was
  fixed: `result: PASS`, all 9 named invariants pass, `pack_set_sha256` unchanged (the fix touches
  invariant-evaluation logic, not the pack registry or its content).

## Non-claims

This change does **not**:

- add, remove, or modify any GitHub repository security setting -- no new environment, no new
  required reviewer, no OIDC trust-policy change. This was the deciding reason this design was
  chosen over the two rejected ones (see Design process).
- touch `devgov-v0-gate.yml` in any way, in content or in its own click/OIDC requirement.
- claim this change has been dispatched, executed, or gated through the real governed Dev-Gov
  mechanism -- impossible by construction, since every file it touches is controller-owned-floor
  protected and this change modifies the mechanism itself.
- rewrite `DG-IP-003`/`DG-IP-005`/`DG-IP-007`/`DG-IP-008` (see Known, accepted consequences).
- claim independent peer cold-review found nothing. It found one real, narrow issue (see Review
  finding and fix); this document records that finding rather than presenting a clean-in-hindsight
  history.
- change application code, data, secrets, or any Dev-Gov schema file.

## Risk assessment

- **Security impact**: closes the signing-oracle exposure class structurally (same-run ambient
  identity, not a payload-supplied "expected value" to compare against) rather than by tightening
  the vulnerable comparison. Reduces the number of separately dispatchable, environment-protected
  signing surfaces from N per-candidate reusable-workflow runs to 1 same-run job. Both remaining
  protected-environment boundaries (`sign` and `gate`) keep their own independent, unweakened OIDC
  verification -- confirmed by direct reading of `github-oidc.mjs`, not merely asserted, after the
  rejected "strip gate's environment" proposal showed why that distinction matters concretely.
- **Backward compatibility**: `attest-execution` (single-record CLI path) is kept working
  unchanged. `execute:`'s own behavior, artifact naming, and `job.workflow_ref` self-stamping are
  untouched.
- **Rollback plan**: revert this direct commit. No Dev-Gov unit state, candidate dispatch, or gate
  run exists for it to reconcile -- a plain `git revert` is sufficient.
