# DEVGOV-CI-PERMISSIONS-FLOOR-V1 -- PROVEN

**Final state:** PROVEN
**Promotion PR:** #193
**Gated candidate:** `b41e1f9768e99a818479e4709b7b768f8ae703bc`
**Merge commit:** `f14e832e55b0b01e8e05191be0b1c7f0e5cfe79c`
**Merge tree:** `ef002a33d426741c99c3478c6bf5d2840873cf3f`
**Candidate tree:** `ef002a33d426741c99c3478c6bf5d2840873cf3f`

This record is introduced by its own DEV-GOV unit,
`DEVGOV-CI-PERMISSIONS-FLOOR-V1-PROVEN-DOC-V1`.
Its final state takes effect when this record is itself merged through that gate.
It does not edit or replace the candidate record
`DEVGOV-CI-PERMISSIONS-FLOOR-V1.md`.

## Anchors

- Base before implementation merge: `d37ae1cb86248f8ea136524b99f28c80d8f1bf41`
- Gated candidate: `b41e1f9768e99a818479e4709b7b768f8ae703bc`
- Promotion merge: `f14e832e55b0b01e8e05191be0b1c7f0e5cfe79c`
- Promotion PR: #193
- Candidate and merge trees are byte-identical at the Git tree level.

## Trusted execution evidence

- Protected Dev-Gov orchestration run: `36534598052`
- Canonical trusted evidence gate: `36535168726`
- Gate verdict: `PASS`, `proof_status: PROVEN`
- Proof cardinality: 2 executions (1 RED + 1 GREEN)
- Gate trust-policy digest:
  `2c9ef79592495aba9dd2ddc7913e91f48b6f233b4aa35b9573848dfadec246d5`
- Gate OIDC audience:
  `devgov-v0-gate:2c9ef79592495aba9dd2ddc7913e91f48b6f233b4aa35b9573848dfadec246d5:b41e1f9768e99a818479e4709b7b768f8ae703bc`
- Controller-owned invariant packs: `pack_set_sha256`
  `5be20e1bff4d9fe67471804192c80c1f1072da92f31f5481c34b2c6bb84ea8c3`, result `PASS` (registry v1).
- Required commit status:
  - context: `DEV-GOV-V0 / trusted-execution`
  - state: `success`
  - description (as published; trailing digest truncated by GitHub's status-description length
    limit, not by this unit):
    `Trusted RED/GREEN and controller-owned packs verified for exact candidate SHA; packs=v1:PASS:5be20e1bff4d9fe67471804192c80c1f1072da92f31f548`

### RED proof

- `ci-workflows-declare-permissions-floor`

Ran against the protected base (`d37ae1cb`) and observed the expected violation: all 8 workflow
files correctly cited as missing a top-level `permissions:` key.

### GREEN proof

- `ci-workflows-declare-permissions-floor`

Ran against the exact candidate (`b41e1f97`) and passed: all 8 files declare a safe least-privilege
top-level floor (`contents: read`, no top-level write/admin scope).

An independent, real-world confirmation ran alongside the trusted chain on the same PR: the
`Sovereign proofs (Linux)` and `NFS failover lab (NFSv4)` CI jobs -- both defined in
`mimers-sovereign.yml`, one of the 8 edited files -- executed and passed on PR #193, demonstrating
the new permissions floor did not break that workflow in practice, not only in the check's own
static analysis.

## Merge topology and tree verification

PR #193 was merged with a merge commit pinned to the exact candidate SHA.
Squash and rebase were not used. The merge was authorized directly by the repository owner in
conversation with an explicit "merge-go: <exact SHA>" message, consistent with every prior unit
in this lineage.

Merge parents:

1. `d37ae1cb86248f8ea136524b99f28c80d8f1bf41`
2. `b41e1f9768e99a818479e4709b7b768f8ae703bc`

Immediately after merge:

```text
tree(f14e832e55b0b01e8e05191be0b1c7f0e5cfe79c)
==
tree(b41e1f9768e99a818479e4709b7b768f8ae703bc)
==
ef002a33d426741c99c3478c6bf5d2840873cf3f
```

The diff between merge commit and candidate is empty.

## Proven claims

This unit proves the CI permissions-floor property only:

1. `smoke-integrations.yml`, `ci.yml`, `build-postgres-image.yml`, `deploy-gcp.yml`,
   `deploy-staging.yml`, `mimers-sovereign.yml`, `staging-e2e-proof.yml`, and
   `staging-proof-gate.yml` each declare a top-level `permissions:` block with `contents: read`
   and no top-level write/admin scope, on the merged tree.
2. No job-level `permissions:` grant in any of the 8 files was narrowed or removed -- every
   existing elevated grant (GHCR `packages: write`, GCP OIDC `id-token: write`, `actions: write`
   for the GCP service-URL variable, `deployments: write`, PR-body `pull-requests: read`) is
   unchanged.
3. `smoke-integrations.yml` had no job-level `permissions:` block at all before this unit, so the
   new top-level floor is the sole binding grant for its two jobs on the merged tree, not merely
   defense-in-depth.
4. `forbidden_paths` in this candidate's implementation unit enumerated the other 12 workflow
   files explicitly rather than using a broad `.github/workflows/**` glob, avoiding overlap with
   `allowed_paths` (the class of bug found and fixed in the adapter-compat lineage).

## Non-claims

This unit does **not**:

- change any job-level `permissions:` block in any of the 8 files, or touch any other workflow
  file (`devgov-v0-*.yml`, `codeql.yml`, `python-security.yml`, `release-prompt-optimizer.yml`,
  `supply-chain.yml`, `vertex-wif-smoke.yml`, `vertex_prompt_optimize.yml`,
  `vertex_prompt_updater.yaml`, `devgov-invariant-packs.yml`, `devgov-v0.yml`);
- claim to be a complete audit of `GITHUB_TOKEN` usage repo-wide -- only the 8 named files were in
  scope, per the owner's program order;
- start or finalize Step 5's rebuild or the V1-THROUGHPUT unit -- both remain separate, not yet
  started, next in the program order;
- change application code, data, or any Dev-Gov schema/controller file.

At merge time the required trusted-execution status was green. Non-required CI jobs (`Typecheck`,
`Lint`, `Format check`, `Security audit`) were red at merge time; each is a pre-existing,
repo-wide condition disclosed in PR #193's own body and was not used as authority for this
promotion -- the branch's only required status check is `DEV-GOV-V0 / trusted-execution`, confirmed
directly against the GitHub branch-protection API before merge, not assumed.

## Final disposition

`DEVGOV-CI-PERMISSIONS-FLOOR-V1 = PROVEN`

The 8 named workflows now declare an explicit least-privilege `GITHUB_TOKEN` floor at the
workflow level; no existing job-level grant was changed. Step 5's rebuild and the V1-THROUGHPUT
unit remain as the next units in the program order.
