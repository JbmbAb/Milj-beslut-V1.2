# DEVGOV-REPOSITORY-DISPATCH-ADAPTER-COMPAT-V1 — PROVEN

**Final state:** PROVEN
**Promotion PR:** #190
**Gated candidate:** `5fd57ac421a5a7ed6b93732f240efb4d77ef0a04`
**Merge commit:** `0a3e8d9861153445f8262e497b2e5f980e7e91a8`
**Merge tree:** `a4e198722ea55ce2ea986832a9bf2faf4a7b3bef`
**Candidate tree:** `a4e198722ea55ce2ea986832a9bf2faf4a7b3bef`

This record is introduced by its own DEV-GOV unit,
`DEVGOV-REPOSITORY-DISPATCH-ADAPTER-COMPAT-V1-PROVEN-DOC-V1`.
Its final state takes effect when this record is itself merged through that gate.
It does not edit or replace the candidate record
`DEVGOV-REPOSITORY-DISPATCH-ADAPTER-COMPAT-V1.md`.

## Anchors

- Base before implementation merge: `052582bd4ea8799de73ceffdb1c5744a48865b4b`
- Gated candidate: `5fd57ac421a5a7ed6b93732f240efb4d77ef0a04`
- Promotion merge: `0a3e8d9861153445f8262e497b2e5f980e7e91a8`
- Promotion PR: #190
- Candidate and merge trees are byte-identical at the Git tree level.

## Trusted execution evidence

- Protected Dev-Gov orchestration run: `36448052406`
- Canonical trusted evidence gate: `36449050386`
- Gate verdict: `PASS`, `proof_status: PROVEN`
- Proof cardinality: 9 executions (4 RED + 5 GREEN)
- Gate trust-policy digest:
  `2c9ef79592495aba9dd2ddc7913e91f48b6f233b4aa35b9573848dfadec246d5`
- Gate OIDC audience:
  `devgov-v0-gate:2c9ef79592495aba9dd2ddc7913e91f48b6f233b4aa35b9573848dfadec246d5:5fd57ac421a5a7ed6b93732f240efb4d77ef0a04`
- Controller-owned invariant packs: `pack_set_sha256`
  `5be20e1bff4d9fe67471804192c80c1f1072da92f31f5481c34b2c6bb84ea8c3`, result `PASS` (registry v1).
  This is the first unit in this lineage to carry pack evidence in its trusted-execution status,
  since Step 5's post-PROVEN hardening (F-08, folding `pack_set_sha256` into the commit-status
  description) landed on `main` after B and C were already gated.
- Required commit status:
  - context: `DEV-GOV-V0 / trusted-execution`
  - state: `success`
  - description (as published; the trailing digest is truncated by GitHub's status-description
    length limit, not by this unit):
    `Trusted RED/GREEN and controller-owned packs verified for exact candidate SHA; packs=v1:PASS:5be20e1bff4d9fe67471804192c80c1f1072da92f31f548`

### RED proofs

- `dispatch-wire-call-repository-dispatch-shape`
- `dispatch-correlator-event-predicate-repository-dispatch`
- `correlation-store-schema-version-bumped`
- `dispatch-correlator-candidate-sha-cross-match-guard`

All four RED executions ran against the protected base (`052582bd`) and observed the expected
violation.

### GREEN proofs

- `dispatch-wire-call-repository-dispatch-shape`
- `dispatch-correlator-event-predicate-repository-dispatch`
- `correlation-store-schema-version-bumped`
- `dispatch-correlator-candidate-sha-cross-match-guard`
- `control-plane-repository-dispatch-regression-tests`

All five GREEN executions ran against the exact candidate (`5fd57ac4`) and passed, including the
full `tests/unit/control-plane/**` regression suite run via the real `child_process.spawnSync`
invocation this unit's own GREEN check performs.

## Merge topology and tree verification

PR #190 was merged with a merge commit pinned to the exact candidate SHA.
Squash and rebase were not used. The merge was authorized directly by the repository owner in
conversation with a single explicit word ("merge"), addressed to the session holding the
candidate — not inferred from a cross-session relay, consistent with every prior unit in this
lineage.

Merge parents:

1. `052582bd4ea8799de73ceffdb1c5744a48865b4b`
2. `5fd57ac421a5a7ed6b93732f240efb4d77ef0a04`

Immediately after merge:

```text
tree(0a3e8d9861153445f8262e497b2e5f980e7e91a8)
==
tree(5fd57ac421a5a7ed6b93732f240efb4d77ef0a04)
==
a4e198722ea55ce2ea986832a9bf2faf4a7b3bef
```

The diff between merge commit and candidate is empty.

## Proven claims

This unit proves the adapter-compat property only:

1. `packages/mps-control-plane`'s multi-agent dispatch/correlation code
   (`GitHubDevGovDispatchAdapter`, `GitHubRunCorrelation`) issues `repository_dispatch`
   (`{eventType, clientPayload}`) calls, not `workflow_dispatch`-shaped (`{workflow, ref, inputs}`)
   calls.
2. `matchCandidates()` predicates on `run.event === 'repository_dispatch'`.
3. The correlator additionally requires `displayTitle.includes(candidate_sha)`, closing the FA-02
   silent cross-match hazard between concurrent dispatches for different candidates (proven via a
   constructed two-concurrent-candidates test case that fails pre-fix and passes post-fix).
4. `RepositoryDispatchCorrelator` / `RepositoryDispatchCorrelatorOptions` are named for the
   contract they actually implement (FA-04).
5. Crash/idempotency semantics are preserved: the `UNCERTAIN_DISPATCH` → `dispatchAttemptedAt` →
   `AWAITING_RUN` state machine and never-blind-redispatch invariant are unchanged in substance —
   only the external call shape and the event-string comparison changed.
6. The one workflow-file touch in this lineage (`devgov-v0-orchestrate.yml`'s `run-name:` line,
   echoing `client_payload.candidate_sha`) is present on the merged tree and does not alter any
   trigger, permission, or gating logic in that file.

## Non-claims

This unit does **not**:

- wire `GitHubDevGovDispatchAdapter` or `RepositoryDispatchCorrelator` into any production
  entrypoint; both remain instantiated only in `tests/unit/control-plane/**` on the merged tree,
  independently re-verified repo-wide as part of this unit's own implementation;
- claim F-01–F-14 (Step 5's own falsification battery) have been rerun after this merge;
- close the permissions micro-unit (8 workflows still missing a top-level `permissions:` block)
  or reconcile Step 5's own already-merged hardening (PR #178/#179) against this session's earlier
  structural-verification framing — both remain separate, not-yet-started units in the program
  order (D → permissions micro-unit → Step 5 reconciliation);
- change `devgov-v0-attest.yml`, signer authority, trust-policy schema, application code, or data.

At merge time the required trusted-execution status was green. Non-required CI jobs
(`Typecheck`, `Lint`, `Format check`, `Security audit`, `Require staging proof in PR`) were red at
merge time; each is a pre-existing, repo-wide condition disclosed in PR #190's own body (87
`tsc` errors identical on base and candidate; lint/format checked only against this unit's own 11
changed files, which were clean) and was not used as authority for this promotion. The branch's
only required status check is `DEV-GOV-V0 / trusted-execution`, confirmed directly against the
GitHub branch-protection API before merge, not assumed.

## Final disposition

`DEVGOV-REPOSITORY-DISPATCH-ADAPTER-COMPAT-V1 = PROVEN`

The adapter's dispatch/correlation contract now matches what the protected controller actually
dispatches against (`repository_dispatch`), and the FA-02 concurrent cross-match hazard is closed.
The permissions micro-unit and Step 5's reconciliation onto this protected main remain as the next
two units in the program order.
