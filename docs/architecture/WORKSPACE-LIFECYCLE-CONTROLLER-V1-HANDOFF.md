# Workspace Lifecycle Controller V1 — implementation handoff

Role: V1 IMPLEMENTER. Normative authority: `workspace-lifecycle-controller-v1.1-SPEC-FREEZE.md`
(version 1.1, FREEZE + PATCH 1).

External test authority: the Phase 0 protected mirror, bound by
`phase0-authority-reference-v1.sha256-96e784e7683aa7815ecad807fe43d7ee11bf11ad5a31c5a407c575cedc090f84.json`.
The implementer consumed the frozen corpus and expectations through the prescribed replay interface
and modified neither.

    BASE_SHA        0d7b2bd566b0d5f7c9d27d645c941acd66cb1e85
    WORKTREE        C:\wt-workspace-lifecycle-controller-v1
    BRANCH          feat/workspace-lifecycle-controller-v1
    CANDIDATE_SHA   2af747e8e94c25931706c0e8b2646dc78f1e5d92 (implementation)
                    plus one follow-up commit recording this SHA and section L

---

## A. WHAT WAS BUILT

Three packages, and the split between them is the spec's central structural requirement rather than
a matter of taste.

    packages/mps-workspace-observer     read-only I/O -> immutable WorkspaceSnapshotArtifact
    packages/mps-workspace-classifier   pure classify(snapshot, operation) -> disposition
    packages/mps-workspace-harness      the ONLY component that reads the frozen expectations

The Observer is driven by the frozen command surface rather than by a copy of it. `CommandSurface`
refuses to construct unless the bytes it is handed hash to the digest the caller was given, and the
argv the Observer spawns is assembled from those bytes and asserted against the family's template
before it leaves the process. A hard-coded argv list in the implementer's own source would be the
substitution path the authority model exists to close: the candidate would then control both the
request and the assertion that the request was permitted.

The same Observer runs against all three test layers. Only the port changes — `ReplayTransport` for
the frozen corpus, `LiveRequestPort` for the machine — which is what makes a green replay run mean
something about the live one.

---

## B. AUTHORITY BINDING

    authority reference     96e784e7683aa7815ecad807fe43d7ee11bf11ad5a31c5a407c575cedc090f84
    mirror content digest   e2eb8fbd111ae0e6efdf2b40e2b746e97b1f708d0f34c6ee45576f852e9b22a6
    authority manifest      f5cffb073a0193d5e47e5f2c6a0eb49c6f33aaca14a4d183625cf617cee70f50

    expectationsDigest            48f06939fc70cf493c2fbdd0be8fc11e739ee47ae2887a15faed0b677e038890
    captureManifestDigest         d203443ad2d00746f9fcb050d9cadd295fb2608862442e534c99ae08031d41f3
    commandSurfaceDigest          d1213675fcf2b945ea74a189eac7ede88ebf4474402b591e5730728698b6f642
    canonicalizerContractDigest   577f47aec266eb969e0edf20ede3b8cc3b8cd4b75f89f2cd4fb7981a45096433
    replayContractDigest          240fa421e2b3a201656e331858e9b279908724273cfd5c137927ca23ea586ba5
    redactionPolicyDigest         e6c7cd9d3ac08444f9c32a8eb4b05184b0bf78d3d41470906093f737f5e2ed11
    captureBundleSchemaDigest     d4ee3cedcea6c4722ecbfad845dd533c1b12c566603bfcf7e07ef8f886d3168a
    vocabularyMappingDigest       62e9defd99ee4825f79d0da026b7ff30fb985fd2c70729039ae19c9c0dd95e20

All eight are RECOMPUTED from the mirrored bytes at every acceptance run, never copied out of the
manifest — reading them from the manifest would prove only that the manifest is self-consistent,
which is not the question. Every bound file is additionally checked for both digest and byte length,
so an encoding conversion is visible as a length change as well. Any mismatch is
`AUTHORITY_DIGEST_MISMATCH` and blocks approval; it is never a soft finding (A24).

The mirror was independently re-verified at consumption time with the Phase 0 transfer kit's
dependency-free `mirror-verify.mjs`: checks M1–M8 pass, 283 bound files, all eight digests
reproduced, 123 bundle digests reproduced, expectations shape 122/28/7.

**These local runs create no verification authority.** They execute inside the implementer's own
worktree. The authoritative run happens outside that write domain, fetches the same bytes by content
hash, and prints the same eight digests — so substitution becomes a deviation visible in the
artifact rather than an invisible event.

---

## C. ACCEPTANCE RESULT — TEST LAYERS 1 AND 2

Frozen transcript → Observer → snapshot → Classifier → disposition → comparison against the
independently frozen expectations, for all 122 cases, operation `WORKTREE_REMOVAL`.

    SAFETY                SATISFIED     0 false SAFE_TO_REMOVE
    UTILITY               SATISFIED     7 / 7 utilityRequired cases reach SAFE_TO_REMOVE
    TOTALS                pass 122 / hard failure 0 / stricter finding 0 / corpus drift 0 / error 0

The agreement is exact: 28 SAFE_TO_REMOVE and 94 BLOCKED, matching the adjudication case for case.
No case needed the A6 stricter-reading allowance.

The controller's REASONS were cross-tabulated against the adjudicator's `expectedSafetyClass`, which
the harness never compares mechanically — the facit is an independent hypothesis, not a
specification of this implementation, and forcing the vocabularies to line up would quietly turn it
into one. The cross-tabulation:

| adjudicator's class | n | controller's blockers |
|---|---|---|
| PROVEN_SAFE_EXACT_ANCESTOR | 28 | none (SAFE_TO_REMOVE) |
| PRESERVE_UNIQUE_HISTORY | 33 | UNIQUE_COMMITS_PRESENT (33) |
| PRESERVE_NORMALIZATION_NOISE_CLUSTER | 15 | TRACKED_MODIFICATIONS_PRESENT, ± UNIQUE_COMMITS_PRESENT, ± UNTRACKED_ENTRIES_PRESENT |
| BLOCKED_UNREGISTERED_FILESYSTEM_ONLY | 12 | TOPLEVEL_NOT_CANDIDATE (8), UNREGISTERED_FILESYSTEM_ONLY (4) |
| BLOCKED_PATH_MISSING | 7 | WORKSPACE_PATH_ABSENT (7) |
| BLOCKED_DANGLING_GITDIR_POINTER | 7 | DANGLING_GITDIR_POINTER (7) |
| PRESERVE_DIRTY_UNTRACKED | 6 | UNTRACKED_ENTRIES_PRESENT, ± UNIQUE_COMMITS_PRESENT |
| PRESERVE_DIRTY_TRACKED | 5 | TRACKED_MODIFICATIONS_PRESENT, ± UNTRACKED_ENTRIES_PRESENT |
| PRESERVE_IN_PROGRESS_OPERATION | 5 | OPERATION_IN_PROGRESS |
| BLOCKED_FOREIGN_REPOSITORY | 3 | FOREIGN_REPOSITORY (3) |
| PRESERVE_MAIN_WORKTREE | 1 | MAIN_WORKTREE + its real dirty state |

Every SAFE_TO_REMOVE decision cites positive proof from four recorded requests (A19): R-W-04 for the
working-tree state, R-G-11 for object existence, R-G-12 for ancestry and R-G-15 for the absence of
unique commits. A test asserts that no safe decision may be reached without all four.

One modelling flaw was found and fixed by this cross-check rather than by the verdicts, which were
already right. The main worktree is listed by `git worktree list` and has no `.git/worktrees/<id>`
directory, because only linked worktrees have one. Fed to a registration axis that reads exactly
those two sources, it looks identical to a genuine source disagreement, and the conflict table
blocked it as `SOURCE_DISAGREEMENT_REGISTRATION` — right verdict, false explanation. Main-worktree
identity is now decided before the table, matching the adjudication precedence.

---

## D. WHAT THESE LAYERS DO NOT PROVE

Stated as measurements taken from the frozen bytes by the acceptance runner itself, not as
inherited claims:

- **0 TIMEOUT records** in the corpus. The timeout path to a fail-closed classification — which the
  spec names as the most common route to a false safe result — is not exercised by layers 1 and 2.
- **0 SPAWN_ERROR records.**
- **0 non-UTF-8 streams.** The base64 branch of every parser is unexercised.
- **0 truncation records.** TR1, TR2 and the output limit are frozen but unexercised.
- **0 inconclusive filesystem errors.** All 919 recorded filesystem errors are ENOENT, the single
  code the contract calls conclusive; EACCES, EPERM, ELOOP and FS_TIMEOUT are unexercised.

A 122/122 green run says nothing about any of these. They are covered instead by SYNTHETIC tests
(`classify.failClosed.test.ts`), which are labelled as synthetic and are not a substitute for a live
run that actually hits a timeout. The acceptance report prints this list on every run, so a reader
cannot mistake a green result for coverage it does not have.

---

## D2. ACCEPTANCE RESULT — TEST LAYER 3, THE LIVE DISK

The Observer was run against `C:\miljöbeslut` itself, read-only, through `LiveRequestPort`. Two
runs are reported because the second one found something, and reporting only the clean one would be
the kind of selective evidence this whole unit exists to prevent.

**Run A — quiet machine.**

    CANDIDATES DISCOVERED 123        (the 122 frozen cases plus this unit's own worktree)
    WORKTREE METADATA IDS 100
    SHA SET               96
    CANONICAL SHA         0d7b2bd5... from ls-remote, stable across the window
    OBSERVATION COVERAGE  OBSERVED 3491 / UNKNOWN 242 / NOT_ATTEMPTED 112
    FILESYSTEM TIMEOUTS   0
    MUTATION EVIDENCE     102 pairs compared, 0 differing
    DISPOSITIONS          SAFE_TO_REMOVE 28 / BLOCKED 95

All seven `utilityRequired` workspaces reach `SAFE_TO_REMOVE` on the live disk as well as in replay.
The process and OS layer works: the mandatory flags hold, `git status` completes across a hundred
Cesium-sized trees inside its timeout, and no filesystem operation timed out.

**Run B — a concurrent `git add` during the run.** The same command, started while this unit was
being staged for commit in a different worktree:

    MUTATION EVIDENCE     102 pairs compared, 1 differing: R-F-01 BEFORE vs AFTER
    DISPOSITIONS          BLOCKED 123        (all of them, including the seven)
    BLOCKER               REPOSITORY_MUTATED_DURING_OBSERVATION on every workspace

The cause was established rather than assumed: `git add` in
`C:\wt-workspace-lifecycle-controller-v1` wrote its index at 07:59:46Z, which bumped the mtime of
`C:\miljöbeslut\.git\worktrees\wt-workspace-lifecycle-controller-v1`, and the run's BEFORE and
AFTER listings of `.git/worktrees` therefore disagreed. The observation had changed nothing; the
machine had changed underneath it.

Every workspace fell closed, and that is the correct answer. It is also the only unsynthetic
exercise of a fail-closed path this unit has: the corpus contains no timeout, no spawn failure and
no inconclusive filesystem error, so every other fail-closed branch is covered by synthetic tests
alone. Here the mechanism fired on real evidence, for a real reason, at full blast.

**The operational property this implies, stated plainly.** A concurrent git command anywhere in the
repository invalidates the whole run, not just the affected workspace. That is deliberately blunt:
telling harmless mtime churn apart from someone creating a worktree mid-observation is exactly the
judgement an observer must not make. It does mean a usable live run needs a quiet machine — the same
condition Phase 0's capture required — and an operator who sees
`REPOSITORY_MUTATED_DURING_OBSERVATION` on everything should look for concurrent activity before
looking for a bug.

---

## E. THE DIGEST, AND WHAT IS DELIBERATELY OUTSIDE IT

`identityDigest` = SHA-256 over the SNAPSHOT_V1-framed canonical bytes of a digest-eligible
projection, using the Phase 0-frozen primitive unchanged. The seven pinned source files of
`@miljobeslut/mps-canonical` at the canonical base reproduce `primitivePin.sourceSha256` exactly;
a test asserts it.

The inclusion test, applied field by field:

> A field belongs in the digest if and only if a reimplementation with different logic, against an
> unchanged world, necessarily produces the same value.

The exclusions that took judgement, each with the failure mode that justifies it:

| excluded | why |
|---|---|
| `graphRelation` | Our label for a topology, not the topology. Named explicitly by A10. |
| `contentEvidence` | Derived from the cherry result, which is included (A24). |
| `preferredSpelling`, `spellings` | Depend on which discovery sources fired, not on the world. The corpus proves it: one candidate carries `C:\lu-clean-final` from S3 and `C:/lu-clean-final` from S1, S2 and S4. Both resolve to the included comparison key. |
| `filesystem.entryCount` | Passes A10 but fails A9's safety-relevance gate: it counts build output, no removal predicate reads it, and it changes on every compile — including it would guarantee the V2 compare-and-swap never succeeds on an active tree, which is exactly the pressure that gets a CAS condition loosened. |
| `lockFiles`, `inProgressMarkers` | Filtered projections of the raw metadata entry names, under OUR vocabulary of what counts as lock-shaped. The RAW names are included instead. |
| `toplevelMatchesCandidate` | A derivation over two included values (A24). |
| `notAttemptedReason` | A fact about this run's scope, not about the world. |
| `status.pathsElided` | A property of the capture's truncation threshold, not of the workspace; the counts stay exact. |
| `stashes[].selector` | `stash@{n}` is positional and array order is already covered. |
| `mutationEvidence` | Whether OUR observation mutated anything is a property of the run. |
| `metadata.*` | observedAt, durations, versions, coverage, transcript reference (A9). |
| `generation` | Omitted entirely, not merely excluded: an undefined term makes the digest non-portable. |

One inclusion is a knowing trade-off and is recorded as such: `observationState` and
`unknownReason` are covered even though a TIMEOUT depends on machine load, so two observers against
an unchanged world could in principle disagree. The alternative is worse — a digest that cannot
distinguish "the machine answered" from "the machine stopped answering" would let V2 delete on the
strength of a disposition made when the world was still answering.

`identityDigest` is not `CanonicalArtifact.content_hash` and is never aliased to it. `content_hash`
covers the whole envelope including provenance and timestamps, which A9 deliberately keeps out;
using it as the CAS condition would differ on every re-observation of an untouched machine.

Determinism is verified AT DIGEST LEVEL, which is stronger than "the classifier is deterministic":
the same frozen case reproduces its digest across repeated observations, metadata changes do not
move it, a covered field's change does, an excluded field's change does not, and all 122 frozen
cases produce 122 distinct digests with no collision.

---

## F. THE CONFLICT MODEL

A total data table over three axes of independently retained source claims — the filesystem, the two
registration sources, and the workspace's own git view — 6 × 4 × 5 = 120 cells, present as a
`Record` over the full template-literal union so TypeScript refuses to compile if a cell is missing,
plus an unconditional `BLOCKED` default arm for a key built outside the union. Exactly three cells
clear to predicate evaluation; 117 block.

Each source's claim is kept separate in the snapshot rather than merged into one "is this a
worktree" boolean, because when the sources disagree the disagreement IS the finding, and a merged
view has already discarded it.

**The mandated lease row, stated honestly.** A23 names "lease active + filesystem gone" as a row.
There is no lease axis, and that is not an omission: the frozen command surface records under
`knownNonSources` that no lease is observable on disk at the canonical base, so the Observer emits
no lease field at all — a snapshot field without a raw input in the same artifact would violate A2
and A16. An axis reading a field that does not exist would have one inhabited value and two dead
arms, and dead arms rot. The row degenerates into `ABSENT × REGISTERED_CORRELATED`, which is
present, blocked, and exercised by seven frozen cases. Making the lease observable is an adjudicated
contract change, not an Observer fallback.

---

## G. BOUNDARIES, ENFORCED THREE WAYS

The re-con found no existing enforcement in the control-plane package, so it was built here. The
Observer/Classifier boundary (A2, B1) is enforced by:

1. **Package dependencies** — the observer's `package.json` does not depend on the classifier.
2. **An eslint rule** — `no-restricted-imports` on the observer package, plus a rule forbidding the
   classifier from importing `node:fs`, `child_process`, network modules or reading a clock.
3. **A transitive import-graph test** — the one that cannot be silenced with a lint comment: it walks
   every module reachable from the observer's sources and asserts none resolves into the classifier,
   the harness or a policy package.

The classifier declares the snapshot shape structurally rather than importing it, so the dependency
edge runs only one way. The frozen comparison-key rule is reimplemented in the classifier for the
same reason, and a test asserts both implementations agree on all 122 corpus cases — duplication
that is checked rather than hoped.

`classify()` has no clock. The one rule that would obviously want one, canonical-reference staleness,
computes age from two values already inside the snapshot (the observation window's end and the reflog
timestamp), so the same snapshot classifies identically forever.

---

## H. DECISIONS THAT COULD HAVE GONE THE OTHER WAY

**Staleness applies only to a locally-read canonical reference.** When the canonical SHA came from
`ls-remote` during this very observation it cannot be stale, and the reflog age says nothing about
it. Blocking on reflog age there would block every workspace on a machine that has not fetched
lately, while the evidence actually used was current. On the frozen corpus the source is
`R-G-02[BEFORE]`, so this rule is what keeps UTILITY reachable at all.

**An absent `# branch.upstream` or `# branch.ab` header is a conclusive observation, not an
inconclusive one.** Those headers are missing in a large fraction of the frozen cases, including
several `utilityRequired` ones. A parser that read a missing header as "could not observe" would make
provably clean workspaces BLOCKED and fail UTILITY outright.

**An unattributed stash does not block `WORKTREE_REMOVAL`.** `git worktree remove` does not delete
`refs/stash`. Seven repository-global stashes exist on the frozen machine; blocking removal on them
would make UTILITY unsatisfiable for every workspace at once — the content-free criterion the spec
warns about. It blocks `REPOSITORY_REMOVAL`, `GLOBAL_REPOSITORY_MUTATION` and `BRANCH_DELETION`, and
is recorded as a finding for worktree removal.

**A non-zero exit is UNKNOWN by default, and conclusive only where the frozen surface says so.**
`cat-file -e` exit 1 and 128 are conclusive ("object missing"), `merge-base --is-ancestor` exit 1 is
conclusive ("not an ancestor"), and ENOENT/ENOTDIR are conclusive absences. Everything else falls
closed. The per-family readings live where the fact is derived, with the raw exit code beside them.

**The observation scope is an explicit input, not a judgement.** Replay feeds one case bundle at a
time, so a run that issued workspace-local requests for all 122 discovered candidates would be a
corpus miss on 121 of them. Every out-of-scope candidate is still emitted with `NOT_ATTEMPTED` and
the reason `OUT_OF_OBSERVATION_SCOPE` — never omitted (A3), and never mistakable for an inconclusive
observation.

---

## I. ONE CHANGE TO AN EXISTING PACKAGE

`packages/mps-canonical/src/index.ts` now re-exports `DefaultCanonicalJson` and its interface. The
frozen canonicalizer contract pins that class BY NAME and by source SHA-256; reaching it through
`DefaultCanonicalPipeline('JSON')` is the same code path, but the pin is only auditable at the import
site if the pinned class is the thing that gets imported. The change is additive and touches no file
covered by `primitivePin.sourceSha256`.

---

## J. UNRESOLVED GAPS

1. The fail-closed branch is unexercised by the corpus (section D) and is covered only by synthetic
   tests. An independent verifier should treat it as such.
2. `contentEvidence` can only ever be `NONE` or `PATCH_ID_MATCH` in V1. `REGISTERED_RECONCILIATION`
   requires a reconciliation registry that does not exist at the canonical base.
3. `BRANCH_DELETION`, `METADATA_PRUNE`, `REPOSITORY_REMOVAL` and `GLOBAL_REPOSITORY_MUTATION` exist
   as scopes and are honoured by the stash rule, but the frozen corpus supports only
   `WORKTREE_REMOVAL`: `shaSetRule` excludes tips of branches with no worktree, so no ancestry
   evidence exists for them.
4. The 151-file cluster's substance remains unproven — the command surface contains no diff family.
   The classifier treats it exactly like any other tracked modification and records the count as a
   finding rather than as a reason to allow removal.
5. Phase 0's `INDEPENDENT_REDACTION_REVIEW: NOT_PROVEN` still stands. Nothing in V1 changes it.

---

## L. REPOSITORY-WIDE TEST STATE, AND HOW IT WAS ATTRIBUTED

The three new packages are green: `npx tsc --noEmit` reports nothing for them, `npx eslint` is
clean, and 271 tests pass with 2 skips (both of them the deliberate "frozen corpus absent" guards,
which skip precisely because the authority IS present).

The whole `compliance` project is NOT green: 14 files fail, 16 tests of 1802. None of them is in a
package this candidate touches. They were attributed rather than assumed:

- The failures are in `mps-lu`, `spatial-provider-postgis`, `mps-data-governance` and
  `mps-retrieval-trace`. `git show --name-only HEAD` touches none of those packages.
- The visible causes are environmental or pre-existing: `ECONNREFUSED 127.0.0.1:5432` (no PostGIS
  running here), a repo-inventory assertion in `GovernedWriteCapability.test.ts`, and a
  `PackageTypecheck.test.ts` that times out running `tsc` inside a 5-second budget.
- The decisive check: the five shared files this candidate modifies — `.gitignore`,
  `vitest.config.ts`, `tsconfig.json`, `eslint.config.mjs` and `packages/mps-canonical/src/index.ts`
  — were reverted to their base-commit contents and the same two representative tests were re-run.
  They failed identically (2 failed, 16 passed, 2 skipped). The failures are therefore present at
  base `0d7b2bd5…` and are not caused by this candidate.

All five of those shared changes are strictly additive: three alias/path/include registrations for
the new packages, two eslint blocks scoped to them by path, one `.gitignore` negation, and two
re-exports of an already-public class.

---

## K. NEXT ROLE

    NEXT ROLE: INDEPENDENT ADVERSARIAL VERIFIER
    NO CLEANUP HAS BEEN PERFORMED AND NO CLEANUP AUTHORITY IS CLAIMED.

The cleanup freeze remains in force. No workspace, lock, ref, stash or `.git/worktrees` entry was
removed, pruned or altered by this unit. The live machine stays as it was until an independent
verifier approves the end-to-end run.

The verifier's review should include the digest test vectors (A12 places that explicitly in the
handover), the 120-cell conflict table cell by cell, and the synthetic fail-closed tests — the last
because they are the only coverage the corpus cannot provide, and because they are the ones a future
change is most likely to weaken without anyone noticing.
