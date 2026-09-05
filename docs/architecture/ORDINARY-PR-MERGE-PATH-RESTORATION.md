# Ordinary PR Merge Path Restoration — Design Audit

Status: **DESIGN AUDIT / READ-ONLY — NO IMPLEMENTATION, NO POLICY CHANGE**
Date: 2026-09-05
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
