# LOKE-V0 report

**Status: BLOCKED**

This unit does not assign VERIFIED, PROVEN, COLD_VERIFIED or EXECUTION_VERIFIED.

## A. Base

- Commit: `cf1e8f1f9b2c7fbe9c43d77ca638f48e684db301`
- Tree: `6ca7b5808bf5b03d587e7b6c5cf0c704df4bc66f`
- That commit is `origin/main` as cached when the worktree was created (PR #207, 2026-10-01).
- The dirty checkout `feat/p2-p3-governed-chain-reproducible` was not used. It was 505 commits behind this base.
- Local `main` was 65 commits behind and was not used.

## B. Branch and worktree

- Branch: `feature/loke-v0`
- Worktree: `D:\mimer-loke-v0`
- No push, PR, tag, rebase or amend.
- LU, U51 and runtime worktrees were not modified.
- A separate worktree at `C:/miljöbeslut/.claude/worktrees/practical-archimedes-904f08` (`claude/loke-v0-inventory-098826`, same base SHA) was left untouched.

## C. Reuse matrix

See [LOKE-V0-REUSE-INVENTORY.md](./LOKE-V0-REUSE-INVENTORY.md).

## D. Components that would be reused

No new acquisition code was added. The components that already hold the observation path, and that a later slice must call rather than copy:

- `loadVerifiedSourceRegistry`
- `composeHarvestRuntime`
- `GovernedDownloadExecutor`
- `DownloadManifest` / `buildDownloadManifestRef` / `sameSemanticManifest`
- `FileDownloadManifestStore`
- `DiskQuarantineStorage`
- `SingleEndpointTargetResolver` for the ranked first source

## E. Earlier claims that did not hold as stated

- "`HarvestExecutionStateMachine` is unwired" is only half true. `HarvestOrchestrator` calls it. Nothing in the production composition constructs `HarvestOrchestrator`. Reachability is TEST_ONLY.
- "Governed discovery is a GAP" holds for open discovery. Source-bound enumeration is not a gap: PUH and Lantmäteriet STAC resolvers are registered.
- WFS enumeration exists and is tested, but it is UNWIRED. No APPROVED registry entry names it.
- RSS is not a governed enumerator. It sits on the legacy scheduler path, which the scheduler file itself marks non-operational.
- Dataportalen is not a verified registry source on this tree.
- Post-fetch quarantine dedup is not inventory SKIP. The live pilot's second run issues another network fetch.
- `change_detection.strategy = CONTENT_HASH` does not carry a content hash.

## F. First source

Ranked, not harvested: `regeringskansliet-sfs-1998-808`.

It is APPROVED, uses `SINGLE_ENDPOINT_V1`, needs no credentials, and is one URL. The URL is an HTML page. That does not block a fixture test. The identity gap does. No live harvest was run.

## G. V0 invariants

These were the required invariants. They were not implemented, because the comparisons in L-V0-04 and L-V0-06 have no existing identity to bind to.

- L-V0-01 Unregistered or unapproved source never causes network acquisition. Already true inside `GovernedDownloadExecutor` and `loadVerifiedSourceRegistry`. Not re-proven by a new test in this unit.
- L-V0-02 Discovery-only target never causes network or quarantine writes. Unsigned drafts do not materialize. There is no discovery-only lifecycle distinct from non-APPROVED.
- L-V0-03 An observation binds source identity, registry-entry hash, registry artifact id, URL, object SHA-256, byte length and `generated_at`. `DownloadManifest` already has these fields after a fetch. `generated_at` is provenance and is outside the identity hash.
- L-V0-04 Same canonical complete hash causes SKIP, not a new download. **No pre-fetch definition.**
- L-V0-05 Partial state selects RESUME only if the transport contract supports it. The transport does not. There is also no partial state to select. Fail closed remains the only legal outcome, but there is nothing to classify.
- L-V0-06 Stale or hash mismatch is never SKIP. **No stale state and no remote hash.**
- L-V0-07 Failed provenance check does not delete or mutate the original observation. `DiskQuarantineStorage.updateStatus` keeps the bytes. Not exercised here.
- L-V0-08 Loke cannot write CAS. The composition root has no CAS port. No Loke module was added.
- L-V0-09 Loke cannot materialize PostGIS. The composition root does not import the librarian import path.
- L-V0-10 Replay uses a captured observation, not a new fetch. `resolve` can return a stored manifest. The executor still fetches before it consults that identity.
- L-V0-11 An early relevance filter must not drop the observation. Not implemented; nothing new filters.
- L-V0-12 Source rate, size and policy limits fail closed. Already enforced in the executor after a fetch starts. Not an inventory decision.

## H. RED

Not written. A RED test for SKIP / REHARVEST would have fixed a meaning of "complete" and "same hash" that `DownloadManifest` does not provide.

## I. Implementation

None. No new type, orchestrator, downloader, registry, hash function, quarantine store or state machine.

`HarvestExecutionStateMachine` was not wired.

## J. GREEN

Not run. No product change to turn green.

## K. Mutation / falsification

Not run. No new security branch exists to mutate.

## L. Scope diff

Documentation only:

- `docs/architecture/LOKE-V0-REUSE-INVENTORY.md`
- `docs/architecture/LOKE-V0-REPORT.md`

No change under `packages/`, `server/`, `scripts/`, `source-registry/` or tests. No write to `H:\Delade enheter\Miljöbeslut\GEO_Master_Archive`. No bulk download. No reindex.

## M. Open finding

`DownloadManifest` / `ContentReference` identity cannot decide the inventory table before fetch.

Same canonical identity means `sameSemanticManifest`: equal canonical payload, including `execution_id`, `quarantine_id` and object byte hashes. Those last two exist only after `QuarantineStorage.put`.

`FileDownloadManifestStore` cannot list prior manifests for a source. Quarantine byte-hash dedup is not source-scoped. `SourceChangeDetection` names a strategy and stores no remote digest.

Until an owner binds the decision to fields that already exist, or explicitly extends this identity, SKIP would be an invented classification. Wrong SKIP is worse than a redundant download, so this unit does not guess.

## N. Next slice

Do not start with code. The next slice is an owner decision on the comparison key, using the current identity rather than a second manifest:

1. Confirm that pre-fetch SKIP is impossible while object `content_hash` and `quarantine_id` stay inside `buildDownloadManifestIdentityPayload`, and that redundant download remains the fail-closed behavior of `GovernedDownloadExecutor`.
2. Or name an existing field set that is allowed to mean "same observation" without `execution_id` and `quarantine_id`. That is a change to the identity domain in `DownloadManifestIdentity.ts`, not a Loke-only table.
3. Or add a remote digest to a contract that is allowed to carry one. `SourceChangeDetection` currently cannot.

After that decision, the implementation remains: one function in front of `GovernedDownloadExecutor`, temp quarantine in tests, no CAS, no PostGIS, no `HarvestExecutionStateMachine`.

Independent verification of the resulting SHA belongs to a later verifier. This report does not claim it.
