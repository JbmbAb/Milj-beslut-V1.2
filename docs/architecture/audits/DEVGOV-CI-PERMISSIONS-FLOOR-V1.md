# DEVGOV-CI-PERMISSIONS-FLOOR-V1

**Frozen base:** `d37ae1cb86248f8ea136524b99f28c80d8f1bf41` (main after W3c's merge, PR #192).
Rebase note: this unit was originally built against `6f9b005907197389c3782ef5e4e2ff0e3aa38e94`
(main after D's PROVEN-record merge, PR #191); rebased onto W3c's merge with no conflicts (disjoint
file sets) once main advanced past it, before any push.

## Summary

Adds an explicit top-level `permissions:` block (`contents: read`) to the 8 workflow files in
`.github/workflows/` that previously had none: `smoke-integrations.yml`, `ci.yml`,
`build-postgres-image.yml`, `deploy-gcp.yml`, `deploy-staging.yml`, `mimers-sovereign.yml`,
`staging-e2e-proof.yml`, `staging-proof-gate.yml`. Without a workflow-level default, any job in
these files that omits its own `permissions:` block inherits whatever broad default the
organization/repository settings assign to `GITHUB_TOKEN`. This unit closes that gap with an
explicit least-privilege floor, matching GitHub's own documented best practice and the pattern
these files' authors already applied at the job level in most cases.

This is a **CI/CD configuration hardening** unit only. It does not touch `devgov-v0-*.yml`, the
protected controller, application code, or any other workflow file.

## Per-file analysis

For each file, the table below states the exact scope added, whether any job in the file
previously lacked its own `permissions:` block (meaning the new top-level default has a real
functional effect, not just defense-in-depth), and the justification.

| File                       | Top-level added  | Every job already self-scoped?                                                               | Effect                                                                                   |
| -------------------------- | ---------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `smoke-integrations.yml`   | `contents: read` | **No** — neither `unit-tests` nor `integrations-smoke` had a job-level block                 | **Operative**: this default is what actually constrains both jobs today                  |
| `ci.yml`                   | `contents: read` | Yes — all 8 jobs already declare `permissions: contents: read`                               | Defense-in-depth only                                                                    |
| `build-postgres-image.yml` | `contents: read` | Yes — `build-and-push` already declares `{contents: read, packages: write}`                  | Defense-in-depth only; the job's own broader grant (needed to push to GHCR) is untouched |
| `deploy-gcp.yml`           | `contents: read` | Yes — `guard` has `{}`, `deploy-gcp` has `{contents: read, id-token: write, actions: write}` | Defense-in-depth only; OIDC/actions scopes stay job-level                                |
| `deploy-staging.yml`       | `contents: read` | Yes — `guard` has `{}`, `deploy-staging` has `{contents: read, deployments: write}`          | Defense-in-depth only                                                                    |
| `mimers-sovereign.yml`     | `contents: read` | Yes — both `sovereign-proofs` and `nfs-failover` already declare `contents: read`            | Defense-in-depth only                                                                    |
| `staging-e2e-proof.yml`    | `contents: read` | Yes — `run-staging-e2e` already declares `contents: read`                                    | Defense-in-depth only                                                                    |
| `staging-proof-gate.yml`   | `contents: read` | Yes — `staging-proof` already declares `{contents: read, pull-requests: read}`               | Defense-in-depth only                                                                    |

Every job whose own block grants more than `contents: read` (GHCR push, GCP OIDC, Actions-variable
writes, Deployments API, PR-body read) keeps that grant unchanged at the job level — this unit
never removes or narrows an existing job-level permission, only adds a workflow-level floor.

`smoke-integrations.yml` is the only file where this change has a real functional effect today:
neither of its two jobs declared any `permissions:` block before this unit, so both previously ran
with the org/repo's ambient default token scope. They now run with the least-privilege floor
(`contents: read`) required by `actions/checkout@v4`, which is the only GitHub-token-consuming step
in the file (everything else is `npm ci`, local scripts, and `vitest`).

## Method

Investigated by 8 independent read-only agents, one per file, each asked to trace every step for
GitHub-API or OIDC token consumption and report the minimal required scope with a per-step
citation. One agent's finding (`build-postgres-image.yml`, claiming a top-level block already
existed) was independently re-checked against the raw file and found to be a misread of a
job-level block as workflow-level — corrected before use. A direct `grep -n "permissions:"` across
all 8 files, cross-checked against each agent's cited line numbers, confirmed every remaining
finding.

## Non-claims

This unit does **not**:

- change any job-level `permissions:` block — every existing job-level grant is left exactly as
  it was;
- touch `devgov-v0-orchestrate.yml`, `devgov-v0-gate.yml`, `devgov-v0-attest.yml`,
  `devgov-invariant-packs.yml`, `devgov-v0.yml`, or any of the other 6 workflow files not listed
  above (`codeql.yml`, `python-security.yml`, `release-prompt-optimizer.yml`, `supply-chain.yml`,
  `vertex-wif-smoke.yml`, `vertex_prompt_optimize.yml`, `vertex_prompt_updater.yaml`);
- change any trigger, job dependency, secret, or step in any of the 8 files;
- claim to be a complete audit of `GITHUB_TOKEN` usage repo-wide — only these 8 files were in
  scope, per the owner's program order.

## Risk assessment

- Data/security impact: strictly narrows default token scope; cannot grant anything a workflow did
  not already have, since job-level blocks (where present) always override the workflow-level
  default entirely rather than adding to it.
- Backward compatibility impact: none for 7 of the 8 files (every job already self-scoped to at
  least `contents: read`, confirmed by direct grep). For `smoke-integrations.yml`, the new floor
  grants exactly what `actions/checkout@v4` needs and nothing more — verified against the file's
  only GitHub-token-consuming step.
- Rollback plan: revert this unit's merge commit; the 8 files return to their prior (ambient
  default) state.
