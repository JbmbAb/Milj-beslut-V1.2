# Ordinary PR Merge Path Restoration — Design Audit

Status: **OWNER DECISION MADE (Model B, hardened) — CANDIDATE IMPLEMENTED, NOT YET MIGRATED LIVE**
Date: 2026-09-05 (updated same day after owner decision — see §7)
Scope: Why no PR — DEV-GOV-shaped or ordinary — can currently be merged via GitHub's merge button,
and the candidate designs that would restore an ordinary path without weakening DEV-GOV's exact-SHA
unit semantics. This document proposes nothing to implement without an explicit owner decision on
§5. It does not touch `main`, branch protection, or any workflow.

Trigger: PR #114 (pure documentation, zero code/test/workflow changes) was found un-mergeable via
`gh pr merge --squash`: _"the base branch policy prohibits the merge."_

## 1. Live-verified current state

```text
Branch protection on main (classic — NOT GitHub Rulesets):
  required_status_checks.contexts: ["DEV-GOV-V0 / trusted-execution"]
  required_status_checks.checks:   [{context: "...", app_id: 15368}]
  strict: true, enforce_admins: true
  required_pull_request_reviews: NONE CONFIGURED
  allow_force_pushes: false, allow_deletions: false

GitHub Rulesets on this repo: NONE (`gh api repos/.../rulesets` returns empty; confirmed with a
  direct main-targeted rules query too — zero results either way)

CODEOWNERS: DOES NOT EXIST (checked .github/CODEOWNERS and root CODEOWNERS; neither is tracked)
```

**The one required context, `DEV-GOV-V0 / trusted-execution`, is produced by exactly one mechanism**:
manual dispatch of `devgov-v0-gate.yml` (`workflow_dispatch` only), consuming attestation artifacts
from manually-dispatched `devgov-v0-attest.yml` runs. Nothing in `ci.yml` or any `pull_request`
trigger ever posts this context. Consequence, confirmed by direct observation: **no PR — regardless
of content — has a path to satisfying `main`'s required check via the GitHub merge button today.**
Every DEV-GOV unit landed in this engagement (`f7600ebb` through `2855f6c6`) bypassed the merge
button entirely, landing by direct fast-forward push after the ceremony. That is the only path that
has ever actually worked.

## 2. What GitHub's policy engine can and cannot express

Verified against this repo's actual configuration and general platform behavior, not assumed:

- **Required status checks (classic branch protection and Rulesets alike) are a flat, ANDed list of
  context names.** Neither supports "check A is required only when path X changed, check B
  otherwise." Adding a second required context does not let ordinary PRs skip the first — both would
  be required unconditionally for every PR, DEV-GOV-shaped or not.
- **The one native GitHub mechanism that IS path-conditional is required-review-via-CODEOWNERS**
  ("Require review from Code Owners" + a `CODEOWNERS` file mapping paths to reviewers). This repo
  has neither a `CODEOWNERS` file nor that branch-protection option enabled.
- GitHub Rulesets add a `file_path_restriction`-style rule type (restricting what paths a push may
  touch), but this is orthogonal to required status checks — it still cannot make a _status check_
  conditional on diff content.

**Conclusion, stated plainly: there is no way to make a single required-status-check name mean "real
exact-SHA proof for DEV-GOV changes, ordinary CI for everything else" through GitHub policy alone.**
Any design either (a) gives one context name two different production paths gated by diff content
(a workflow-level decision, not a GitHub-policy one), or (b) uses two different enforcement
mechanisms for two different landing routes entirely.

## 3. A second entanglement: the existing static gates are not currently green

`ci.yml`'s `typecheck`, `lint`, `format`, `audit` jobs already run on every `pull_request` — they are
the obvious auto-producible signal an ordinary PR could satisfy. But per
`DEV-GOV-V0-REGRESSION-BASELINE.md`'s sibling document (the repository convergence ledger) and this
engagement's CI recovery work, on live `main` today:

```text
format:     131 unformatted files (real, pre-existing debt)
lint:        53 first-party errors (real, pre-existing debt)
typecheck:   87 errors (real, pre-existing debt)
audit:       7 advisories, 6 high (real, expected-red per U3)
```

These are whole-repository assertions (`tsc --noEmit`, `eslint .`, `prettier --check <glob>` over the
full tree), not diff-scoped. **Promoting them to required status checks as-is would not restore
ordinary merging — it would block every PR, including ones touching none of the offending files,**
until that backlog reaches zero. This is a real prerequisite dependency the design must account for,
not a detail to gloss over.

## 4. Candidate designs

### Model A — single shared context, content-conditioned production

A new lightweight workflow, triggered on `pull_request`, inspects the diff: if it touches
`governance/devgov/**`, `scripts/devgov/**`, or `.github/workflows/devgov-*.yml`, it does nothing
(the real ceremony must supply the context); otherwise it runs ordinary, diff-scoped checks and
posts `DEV-GOV-V0 / trusted-execution: success` itself.

- Preserves a single required context — no branch-protection change beyond potentially widening
  who/what can post it.
- **Risk, and the reason the owner's framing leans against this:** the context's meaning becomes
  conditional on a workflow's own judgment about "does this diff touch DEV-GOV," which is exactly
  the shape of hole this engagement found twice already (U4's scope-narrowing gap; the three verified
  bypasses in the rejected `CI-TEST-EVIDENCE-EXECUTION-UNLOCK` probe). A bug or manipulation in the
  path-classification logic would let a real DEV-GOV-shaped change slip through the "ordinary" branch
  and get auto-approved without proof.

### Model B — separate landing routes, no shared context

Replace `main`'s required context with something ordinary PRs can actually produce — new, narrow,
diff-scoped checks (not the whole-repo static gates as-is, per §3), e.g. "no new typecheck/lint
errors introduced relative to base" plus a real merge-gate on format for changed files only. DEV-GOV
units continue to bypass the merge button entirely (already the only route that has ever worked in
practice) via the established fast-forward ceremony — `DEV-GOV-V0 / trusted-execution` stops being a
branch-protection-required context and becomes a **procedurally** enforced one, exactly as
`DEV-GOV-V0-PLATFORM-HANDOFF.md` step 7 already documents.

- Cleanest separation of concerns; matches the owner's stated preference (§ "instead of trying to
  get a check to mean two things").
- **Real cost, stated honestly:** GitHub's merge button would no longer structurally prevent someone
  from squash-merging a PR that happens to contain a `governance/devgov/units/*.json` manifest
  without ever running the real ceremony — that invariant would rest on maintainer discipline and
  code review, not GitHub policy. Partial mitigation available: add a `CODEOWNERS` entry for
  `governance/devgov/**`, `scripts/devgov/**`, and `.github/workflows/devgov-*.yml` plus "require
  review from Code Owners" — the one native path-conditional mechanism GitHub actually offers. This
  does not reach exact-SHA-proof strength, but it does add a real, GitHub-enforced human checkpoint
  specifically on DEV-GOV surface.

### Model C — do not restore the merge button; require the ceremony for everything

Leave branch protection exactly as-is. Every merge — DEV-GOV-shaped or not — lands via a
maintainer-run promotion (not necessarily the full RED/GREEN/attest/gate ceremony for ordinary
changes, but always a manual, out-of-band push, never the GitHub UI).

- Zero branch-protection change, zero new workflow.
- Does not actually satisfy the stated goal ("restore a normal merge path for ordinary PRs") — it
  formalizes the current blocked state as permanent policy instead. Included for completeness, not
  as a recommendation.

## 5. Recommendation and blocking questions for the owner

**Recommendation: Model B, with the CODEOWNERS mitigation**, because it is the only option that does
not make DEV-GOV's required context mean two different things depending on unaudited diff
inspection. This is a policy/branch-protection change and is explicitly **not** authorized by this
document — it requires the owner's own decision, per every precedent in this engagement.

Blocking questions, none resolved here:

1. Does the owner accept Model B's real cost — that GitHub's merge button stops being the
   enforcement point for DEV-GOV exact-SHA proof, shifting it to maintainer discipline (+ optional
   CODEOWNERS) — or is that cost unacceptable, in which case Model A's shared-context risk needs its
   own dedicated adversarial review before any implementation (the same discipline that caught three
   live bypasses in the last probe of this shape)?
2. If Model B: what exactly should the new ordinary-PR required check assert? A genuinely diff-scoped
   probe needs its own careful design (and adversarial review) — this document does not attempt to
   design it, only to name that it is a separate, real design task.
3. Should a `CODEOWNERS` file be introduced at all, independent of this decision? It does not exist
   today and nothing in this engagement has needed it until now.
4. Timing: does this block on, or run independent of, clearing the existing 131/53/87 first-party
   defect backlog (§3)? Model B's diff-scoped design avoids that dependency; promoting the
   whole-repo static gates as-is does not.

**Until decided: PR #114 stays open. No `--admin` merge. No fast-forward-for-ordinary-PRs default.**

## 6. Documentation correction needed elsewhere (not applied by this document)

`DEV-GOV-V0-PLATFORM-HANDOFF.md` §3 currently states ordinary PRs "merge exactly as `CONTRIBUTING.md`
... already describe — PR + squash." That is the _intended_ model, not the _current operative_ one.
Pending addendum text, to be applied once this design is settled or immediately as a factual
correction:

```text
Ordinary PR merge path:
DESIGNED / INTENDED
but currently BLOCKED by required DEV-GOV check policy
until ORDINARY-PR-MERGE-PATH-RESTORATION is completed.
```

## 7. Owner decision and implemented candidate (2026-09-05)

**Owner decision: hardened Model B — separate landing paths via GitHub Ruleset, with a dedicated
GitHub App as the sole bypass actor** (not a repository role, not admin). Model A explicitly
rejected (shared-context risk). Rationale, verbatim intent: "det löser kärnproblemet utan att ge
samma statuskontext två olika betydelser."

### Critical capability verified first, before any design commitment

The owner's condition — verify the App-Integration bypass actor is actually usable on this
personal-account-owned repo before proceeding, stop with `BLOCKED_DESIGN` otherwise — was tested
directly, not assumed:

```text
POST /repos/JbmbAb/Milj-beslut-V1.2/rulesets
  bypass_actors: [{actor_id: 4835462, actor_type: "Integration", bypass_mode: "always"}]
  enforcement: "disabled"   (zero live effect by construction, regardless of outcome)

RESULT: 201 Created. GitHub echoed the bypass_actors entry back verbatim.
"current_user_can_bypass": "never"  — confirms the human operator (JbmbAb) does NOT get bypass;
only the App does.
```

**Capability confirmed. Not `BLOCKED_DESIGN`.** The probe ruleset (id `22310758`) was deleted
immediately after this single confirmation — it was a capability test, not the candidate.

### Promoter identity

```text
name:            mimer-devgov-promoter
App ID:          4835462
Installation ID: 159159185
repo scope:      JbmbAb/Milj-beslut-V1.2 only
permissions:     Contents: read/write, Metadata: read — nothing else
credentials:     devgov-promoter environment
                   secret:  DEVGOV_PROMOTER_PRIVATE_KEY_PEM
                   vars:    DEVGOV_PROMOTER_APP_ID, DEVGOV_PROMOTER_INSTALLATION_ID
```

**Finding, not yet acted on:** the `devgov-promoter` environment currently has **zero protection
rules** (no required reviewers), unlike `devgov-attestation` (which has `prevent_self_review: true`
plus a named required reviewer). Given this identity can push directly to `main`, adding equivalent
reviewer protection is recommended but is itself a live settings change requiring separate owner
sign-off — not applied here.

### Candidate produced (branch `codex/ordinary-pr-merge-path-restoration`, base = live main)

**`.github/workflows/devgov-promote.yml`** — `workflow_dispatch`-only (cannot trigger from a
`pull_request` by construction). Fail-closed checks, in order, before any push is attempted:

1. Dispatch must target `refs/heads/<default_branch>` (same pattern as `devgov-v0-attest.yml` /
   `devgov-v0-gate.yml` — a modified copy of this file on a feature branch or fork cannot promote
   anything).
2. `candidate_sha` must match `^[0-9a-f]{40}$` exactly.
3. `candidate_sha` must exist in the repository (`git cat-file -e`).
4. `candidate_sha`'s exact parent must equal live remote `main` — pure fast-forward only; no merge,
   rebase, or substitution is accepted.
5. The candidate must carry an existing, genuine `DEV-GOV-V0 / trusted-execution` success status —
   read from `GET /commits/{sha}/statuses` (the list endpoint, which includes `creator`; **the
   combined `/status` endpoint was tried first and rejected for this purpose — it has no `creator`
   field at all, and using it would have silently rejected every candidate, including valid ones**),
   filtered on `context === 'DEV-GOV-V0 / trusted-execution'`, and the match's `creator.login` must
   be exactly `github-actions[bot]`. This is the canonical, already-existing proof source — nothing
   new was invented.
6. Only then: mint a scoped installation token via `actions/create-github-app-token@v1` using the
   App credentials, and `git push` (no `--force`) the exact candidate SHA to `refs/heads/main`. A
   non-force push means that even if live `main` moved between step 4's check and the push (a race),
   git itself refuses the update rather than silently overwriting anything.
7. Verify post-push: re-fetch remote `main`, confirm it equals the exact candidate SHA.

**A real bug was found and fixed while testing this design, before commit:** the first version
queried the combined `/status` endpoint for creator identity, which does not carry that field —
every promotion, including genuine ones, would have been permanently rejected. Caught by testing the
actual embedded script against live API responses (not just reading it), fixed to use the list
endpoint, re-verified against both a real successful status (accepts) and a SHA with zero status
history (rejects).

**Candidate ruleset created — `enforcement: "disabled"`, zero live effect, verified**
(id `22310992`, name `main-landing-policy`):

```json
{
  "target": "branch",
  "enforcement": "disabled",
  "conditions": { "ref_name": { "include": ["refs/heads/main"] } },
  "bypass_actors": [{ "actor_id": 4835462, "actor_type": "Integration", "bypass_mode": "always" }],
  "rules": [
    { "type": "pull_request", "parameters": { "required_approving_review_count": 0 } },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [{ "context": "Analyze (JavaScript / TypeScript) (javascript-typescript)" }]
      }
    }
  ]
}
```

CodeQL's analyze check is the only currently-green, whole-repo-scoped `pull_request` signal (see §3)
— confirmed live: `conclusion: success` on current `main`, while `Format check` / `Lint` /
`Typecheck` / `Security audit` are `failure` and the four test jobs are `skipped`. This is the
Phase-4 "interim policy state": ordinary PRs are gated on real, currently-passing CI, not on the
whole first-party debt backlog (§3), and not on a fabricated always-pass check.

### Verified locally (not via a live dispatch — no promotion has been attempted)

Each fail-closed branch was tested against real repository/API state, not asserted:

| Case                                                                       | Result                                                       |
| -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Malformed SHA shape                                                        | rejected                                                     |
| Well-formed but nonexistent SHA                                            | rejected (`git cat-file -e` fails)                           |
| Real SHA whose parent ≠ live main (tested candidate = current main itself) | rejected                                                     |
| SHA with zero status history                                               | rejected (empty match)                                       |
| SHA with a genuine `github-actions[bot]`-created success status            | **accepted**                                                 |
| Simulated tampered context string                                          | correctly finds no match                                     |
| `git push` flags                                                           | no `--force` / `-f` present anywhere in the workflow         |
| Trigger surface                                                            | `on:` is `workflow_dispatch` only — confirmed via YAML parse |

### What is explicitly NOT done in this pass (Phase 5 — separate authorization required)

- The candidate ruleset's `enforcement` remains `"disabled"`. It has not been set to `"active"`.
- Classic branch protection on `main` is **completely unchanged** — still requires
  `DEV-GOV-V0 / trusted-execution` exactly as before. Re-verified live after every step above.
- No promotion has been attempted. `devgov-promote.yml` has never been dispatched.
- `PR #114` remains open and `BLOCKED`, unchanged.
- The `devgov-promoter` environment's missing reviewer protection is flagged, not fixed.

Enabling the ruleset and removing/superseding the classic protection rule must happen together (per
the original design audit, §2) to avoid a gap where neither mechanism enforces anything — that paired
action is Phase 5, and requires its own explicit, live, real-time owner go-ahead, matching every
branch-protection-touching action in this engagement's history.

### Known cross-branch note

This candidate branch (`codex/ordinary-pr-merge-path-restoration`) is based on live `main` and
carries its own copies of the five DEV-GOV maintainer-handoff documents (including this one), updated
in place. The still-open `PR #114` (`docs/devgov-maintainer-handoff`) independently modifies the same
files. Both are documentation-only; whichever lands first, the other will need a trivial rebase —
flagged here so it is not a surprise later.
