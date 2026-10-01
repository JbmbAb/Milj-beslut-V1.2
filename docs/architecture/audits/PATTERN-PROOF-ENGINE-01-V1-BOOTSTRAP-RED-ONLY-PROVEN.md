# PATTERN-PROOF-ENGINE-01-V1-BOOTSTRAP-RED-ONLY — PROVEN

**Final state:** PROVEN
**Scope:** `BOOTSTRAP_RED_ONLY` of PATTERN-PROOF-ENGINE-01 V1 only. `FULL_PATTERN_PROOF` is not proven and is not claimed.
**Promotion PR:** #205
**Gated candidate:** `de6551af90451647df383ae9ddd4d593a8fa88c5`
**Merge commit:** `b40b7ff3bc0d8cc916ea7e456760b1e720433385`
**Merge tree:** `a695c30be51aca9f6473a0de3ca4165c3e003917`
**Candidate tree:** `a695c30be51aca9f6473a0de3ca4165c3e003917`

This record is introduced by its own DEV-GOV unit, `PATTERN-PROOF-ENGINE-01-V1-BOOTSTRAP-RED-ONLY-PROVEN-DOC-V1`. The
unit's final state takes effect when this record is itself merged through that gate. It documents history; it does not
rewrite it. The candidate record `PATTERN-PROOF-ENGINE-01-V1-BOOTSTRAP-RED-ONLY.md` keeps every existing byte (the unit's
GREEN pins that with a prefix hash) and receives exactly one appended section, §20, which names the frozen base anchor
that the shipped unit definition actually carries. No PPE code, test, workflow or controller file is touched by this unit.

## Anchors

- Base before the merge (`main`): `e8baf567ea218d275f8e3d9984aadaa5a69446bd` (the merge of PR #206,
  `AUTOMATED-REBASE-REVERIFY-01`).
- Gated candidate: `de6551af90451647df383ae9ddd4d593a8fa88c5`, parent `5c5cf96ffc35a31a1bd06255e76035c6999246af`
  (a merge of `903f648b` and the refreshed design anchor `1e9d523f`).
- Frozen base carried by the shipped unit definition (`base_sha` at the gated candidate):
  `1e9d523fd551b940651e835f3194d412dd60409e`, the refreshed design anchor. The base named in the candidate record's header
  is the earlier design-branch tip `e617c7b7bb4613b95c6934004201eb14bec89ba0`; the refresh is described below and in §20
  of the candidate record.
- Cold-reviewed pre-refresh anchor: `903f648b0918f7e0be72ee44e9deb5b68cd25671` (tree
  `00b7b68bcc9e8b6750c94afd94facf4f4a5bde44`). It was never dispatched; the refresh superseded it before any trusted run.
- Delta of the merge against the pre-merge `main`: 103 files, 100 added, 3 modified, 0 deleted (`+26045/-0`). The three
  modified files are `tsconfig.json`, `vitest.config.ts` and `scripts/audit/master-boundary-audit.test.ts`. 101 of the 103
  paths are inside the unit's `allowed_paths`; the other two are the frozen design documents
  `docs/architecture/PATTERN-PROOF-ENGINE-01-DESIGN-V1-FROZEN.md` and
  `docs/architecture/PATTERN-PROOF-ENGINE-01-V1-BOOTSTRAP-RED-ONLY-DESIGN-FROZEN.md`, which belong to the unit's base anchor
  but were never on `main`, so they appear in a diff against `main` and in no diff against `base_sha`. Measured against
  `base_sha`, the candidate touches no path outside `allowed_paths` and none in `forbidden_paths`.

## Trusted execution evidence (the gated candidate)

- Protected Dev-Gov orchestration run: `36839859536` (`success`, 13 jobs; controller `e8baf567` on `main`): plan, controller
  invariant packs, 2 RED, 6 GREEN, signing, gate dispatch, handoff.
- Canonical trusted evidence gate: `36840591032`.
- Gate verdict: `PASS`, `proof_status: PROVEN`, 8 proof ids (2 RED + 6 GREEN).
- Gate trust-policy digest: `2c9ef79592495aba9dd2ddc7913e91f48b6f233b4aa35b9573848dfadec246d5`
- Gate OIDC audience bound to the exact candidate SHA:
  `devgov-v0-gate:2c9ef79592495aba9dd2ddc7913e91f48b6f233b4aa35b9573848dfadec246d5:de6551af90451647df383ae9ddd4d593a8fa88c5`
- Repository workflow `devgov-v0-gate.yml@refs/heads/main`; environment `devgov-attestation`; GitHub-hosted runner.
- Controller invariant packs: registry version 1, result `PASS`, pack-set digest
  `57f2e7f5b7c071d941b27e94476b3bbaad47edf68ae0e805a6862a7417278366`.
- Required commit status on the candidate:
  - context: `DEV-GOV-V0 / trusted-execution`
  - state: `success`
  - description: `Trusted RED/GREEN and controller-owned packs verified for exact candidate SHA`
- Signed attestations (8): issuer `github-actions:JbmbAb/Milj-beslut-V1.2:devgov-v0-attest`, key id `devgov-ci-ed25519-v1`,
  runner identity `github-hosted:ubuntu-latest`. Every attestation carries `candidate_sha` `de6551af…`, `controller_sha`
  `e8baf567…` and `base_sha` `1e9d523f…`.

### Trusted RED (executed at `base_sha` `1e9d523f…`, observed `FAIL`, exit 1)

- `ppe-engine-absent`
- `ppe-package-unregistered`

### Trusted GREEN (executed at the candidate, observed `PASS`, exit 0)

- `ppe-engine-absent`
- `ppe-package-unregistered`
- `ppe-fixture-suite`
- `ppe-package-lint-clean`
- `ppe-red-probe-builder-is-red`
- `ppe-red-probe-production-base-is-red`

### Approvals

The orchestration run waited once on the protected `devgov-attestation` environment (the signing job) and the gate run
waited once. GitHub's approvals API records one approval for each of the runs `36839859536` and `36840591032`, by the
reviewer account `JImMMbt`. The controller's own preflight note is that the producer cannot approve, and the producer of
this candidate did not.

## Earlier trusted executions of this unit (history, not erased)

| Candidate  | Orchestration run | Result    | Gate run                  | Note                                                                                            |
| ---------- | ----------------- | --------- | ------------------------- | ----------------------------------------------------------------------------------------------- |
| `e4b058ec` | `36747167246`     | `failure` | none                      | Docker availability was decided by exit status; corrected in `8036a32c` (candidate record §14b) |
| `b62ddb3a` | `36767326235`     | `success` | `36768293778` (`success`) | PR #205 was opened from this head; CodeQL then reported seven ReDoS alerts on it                |
| `98cac708` | `36776030683`     | `success` | `36780265080` (`success`) | the seven regular expressions were replaced; CodeQL `success`                                   |
| `903f648b` | not dispatched    | none      | none                      | cold-verified pre-refresh anchor, superseded by the stale-base refresh                          |
| `de6551af` | `36839859536`     | `success` | `36840591032` (`success`) | the gated candidate that was merged                                                             |

The pull request title still names `b62ddb3a` as the gated SHA. That is the historical state at the time the PR was opened
and was not edited.

## CodeQL ReDoS correction

On PR #205 at `b62ddb3a`, GitHub code scanning (CodeQL) reported seven alerts of the rule "Polynomial regular expression
used on uncontrolled data" (`js/polynomial-redos`), posted as review comments `4148858828`, `4148858855`, `4148858872`,
`4148858884`, `4148858902`, `4148858919` and `4148858929` at `docker/classify.ts:206`, `docker/executors.ts:119`,
`docker/executors.ts:192`, `docker/lifecycle-scripts.ts:83`, `docker/stage-prefix.ts:66`, `docker/stage-prefix.ts:101` and
`docker/stage-prefix.ts:305`. The owner decided to correct them before any merge, without suppression or dismissal.

Commit `98cac708` replaced the seven regular expressions with linear string operations in
`src/internal/linear-text.ts`, with an exhaustive differential test against the old regular expressions and pathological
200 000-character inputs under a time budget. The CodeQL check was `success` on `98cac708` and on every later head,
including the gated candidate. The code-scanning alert API was not readable by the producing session, so the alert states
themselves were not queried; the evidence is the check conclusion.

## Hardening from the automated review (Codex), fixed before the merge

Each finding below was reproduced before it was fixed, and each fix came with regression tests and a mutation check in the
session that produced it; this record does not re-derive those runs.

- `7ef11f48`: a huge `file_line` range was expanded before it was bounded (the bound is `MAX_FILE_LINE_REF_LINES` = 100 000);
  a COPY/ADD source or destination could leave its sandbox (`../`); a symlink inside the repository resolved as
  repository-governed `file_line` evidence (now a `realpath` containment check); a rejecting attestation lookup escaped
  instead of failing closed (`ATTESTATION_LOOKUP_UNAVAILABLE`).
- `d1b091da`: symlinks inside copied context entries that pointed, or led through a directory link, outside the repository.
- `bc092fa3`: a global `ARG` before the first `FROM` was dropped from the rendered probe Dockerfile; `dockerfilePath`
  accepted an absolute path, a `..` escape or a symlink resolving outside the repository root (now `PPE_PROBE_BLOCKED`).
- `903f648b`: `fs.cpSync` rewrites even a relative symlink whose target stays inside the repository to an absolute path into
  the source checkout, so every symlink among copied entries is now refused as `PPE_PROBE_BLOCKED`, including a symlinked
  directory source on the host path (the repository root itself is exempt).

The review threads, by the commit that fixed them, are: for `7ef11f48`, comments `4149014279`, `4149014290`, `4148879466` and `4148879469`; for `d1b091da`,
`4149737716`; for `bc092fa3`, `4149819202` and `4149819219`; for `903f648b`, `4149941382`. No reply was posted on these
threads.

## Findings that are open, deferred or not shown (explicitly not resolved)

Nothing in this section is resolved by the PROVEN state. Locations are as the reviewer reported them on the commit named.

### Deferred to the `FULL_PATTERN_PROOF` unit

These live in phases that `BOOTSTRAP_RED_ONLY` never enters (the state machine stops at `RED_SYNTHESIS`, `stoppedByMode`).
Each thread carries a reply stating the deferral.

1. `docker/verification-from-probes.ts:89` (thread `4148879449`): the verification derived from probes is not bound to the
   full frozen RED plan.
2. `validators.ts:259` (thread `4148879458`): the allow-list cover check misses globs such as `packages/*/src/new-file.ts`
   (reproduced).
3. `state-machine.ts:638` (thread `4149014300`): packaged `provenInvariants` are not bound to the verifier's claims.
4. `state-machine.ts:637` (thread `4149014308`): `proofPackage.tree` is not verified against the candidate tree.
5. `state-machine.ts:593` (thread `4149737705`): isolation evidence is not bound to the stored candidate, base and RED-plan
   digest.

### Design and API questions, recorded separately

6. `docker/executors.ts:734` (thread `4149819214`): the `host-npm` executor does not reproduce earlier `RUN` steps. This is
   its documented lower fidelity, recorded in every result. Refusing such prefixes would make the host fallback refuse the
   repository's real Dockerfile (its `builder` and `production-base` lineages have `apk add` and `adduser` steps before the
   install), which would change whether the bootstrap unit can run without a Docker daemon. Left for a separate design
   assessment.
7. `docker/red-probe.ts:170` (thread `4149941398`): the frozen probe claims describe the root Dockerfile even when
   `dockerfilePath` names another file, for example `Dockerfile.gcp`. Evidence still cites the file actually probed and its
   blob id. Left as a separate API/design question (restrict to the root Dockerfile, or derive claims per target).

### Not reproduced, and not shown to be bootstrap-reachable

None of these was reproduced by the producing session. The reachability statement below is an analysis, not a proof: the
repository's root `Dockerfile` has no `RUN --mount` and no numeric `FROM`, installs only from the root `package*.json`, and
the unit probes only `--dockerfile Dockerfile` with the stages `builder` and `production-base`. The unit's GREEN commands
do not run an end-to-end adapter flow beyond the fixture suite.

8. `workflow/ppe-v1.js:835` (thread `4149941393`): the relay loop checks only that one result exists per stage and does not
   bind probe id, asserted behavior, authority or command to the stored RED plan. The reviewer reported that the checked-in
   evidence cites `docker-compose.staging.yml:5-8` where the probe output cites `:6-8`.
9. `docker/red-probe.ts:188` (thread `4153169210`): lifecycle metadata is derived from the root `package.json`, not from the
   staged manifest.
10. `docker/executors.ts:306` (thread `4153169221`): `RUN --mount` bind sources are not part of the probe context.
11. `docker/stage-prefix.ts:357` (thread `4153169233`): numeric `FROM <index>` references are not rewritten after the
    lineage is sliced.
12. `scripts/ppe-cli.ts:255` (thread `4153569027`): `--base-sha` is checked by shape only, while evidence is resolved from
    the mutable worktree.
13. `workflow/ppe-v1.js:725` (thread `4153569036`): the `runtime_result` ledger is written by the same agent lane that makes
    the claim.
14. `workflow/ppe-v1.js:950` (thread `4153569039`): a decision-gate stop returns before the authoritative state is
    persisted.
15. The `packageJsonPath` option of `executeRedProbe` is not bound to the repository root, the same class as the fixed
    `dockerfilePath` containment. The CLI does not expose it, so it is reachable only through the programmatic API. It was
    outside the scope the owner set for the fix.

### Other

- CodeQL's stricter `security-extended` suite, which GitHub's default setup does not run, reported two results that were
  not fixed: `js/file-system-race` at `src/authority.ts:288` (a `statSync` before a `readFileSync`) and
  `js/insecure-temporary-file` at `tests/authority.test.ts:43`. The GitHub CodeQL check is `success`.
- The Dockerfile defect that the two RED probes confirm (the declared install step fails on an absent lifecycle-script
  dependency) is still present. This unit does not fix the Dockerfile.

## Stale-base refresh

While the cold-reviewed `903f648b` waited for its gate, `main` moved to `e8baf567` (PR #206) and PR #205 became `behind`.
The unit's frozen `base_sha`, `e617c7b7`, is not the tip of `main` but the tip of the design branch: it contains the two
frozen design documents, which `main` does not. The refresh followed the shape of `AUTOMATED-REBASE-REVERIFY-01`, a
`--no-ff` merge of `[pre-merge tip, new base]` followed by one single-line bump of `base_sha`, and was applied by hand using
that script's exported `bumpBaseShaInText` and `phase2VerifyOwnEdit`, not by running the script.

- **Rejected variant.** Merging `main` and bumping `base_sha` to `main` (commits `4f77b0af` and `88ec11d5`, never pushed)
  made the controller's repository gate report `CTL-REPO NOT_ALLOWED` for the two frozen design documents, preflight
  verdict `LIKELY_TO_FAIL`. It was rejected and does not exist on the remote; it survives only in the review bundle.
- **Accepted variant.** The new base is the design anchor refreshed onto `main`:
  `1e9d523fd551b940651e835f3194d412dd60409e`, a merge of `e617c7b7` and `e8baf567` with tree
  `81cb334d5555d185876e6e6ccf22ce8dca4ecf82` and no PPE paths. The candidate is a merge of `903f648b` and `1e9d523f`
  (`5c5cf96f`, tree `3d99ba24e3d598c91d2be61a596ba77d3b6175f2`) plus one commit that changes exactly one line of the unit
  definition, `base_sha` `e617c7b7…` to `1e9d523f…`, giving tree `a695c30b…`.
- **Mechanical identity against `903f648b`.** The `packages/mps-pattern-proof` subtree, including the two files of the
  symlink fix, is byte-identical (equal tree and blob ids); so are `tsconfig.json`, `vitest.config.ts`, the master-boundary
  audit test, the evidence directory, the candidate record and both frozen design documents. Every other difference is main's
  four files from PR #206 (`devgov-v0-rebase-reverify.yml`, its audit record, its unit definition and
  `automated-rebase-reverify.mjs`, each blob-identical to `main`) plus the one `base_sha` line. The gate diff
  `1e9d523f..de6551af` equals the earlier `e617c7b7..903f648b` footprint apart from that line.
- **Disclosed deviations.** `AUTOMATED-REBASE-REVERIFY-01` assumes that `base_sha` is the base branch's tip; here the
  refreshed design anchor played that role, and the owner accepted `1e9d523f` as the refreshed anchor for this unit only.
  Phase 1 and the prior-approval lookup did not apply, because `903f648b` was never gated; instead the candidate received a
  full, fresh trusted RED/GREEN/gate. The candidate's own commit subject still reads `(EXPERIMENT, local only)`, and the
  merge commit `5c5cf96f` has the default subject `Merge commit '1e9d523f…' into HEAD`; both are residue of how the
  variant was built, are in the history the owner cold-verified, and were not rewritten.

## Merge topology and tree verification

The candidate was merged with a merge commit only, through PR #205, pinned to the exact candidate head SHA
(`expectedHeadSha`). Squash and rebase were not used.

Merge commit parents:

1. `e8baf567ea218d275f8e3d9984aadaa5a69446bd`
2. `de6551af90451647df383ae9ddd4d593a8fa88c5`

Before the merge, `git merge-tree` of `main` and the candidate produced `a695c30be51aca9f6473a0de3ca4165c3e003917`.
Immediately after the merge:

```text
tree(b40b7ff3bc0d8cc916ea7e456760b1e720433385)
==
tree(de6551af90451647df383ae9ddd4d593a8fa88c5)
==
a695c30be51aca9f6473a0de3ca4165c3e003917
```

Therefore the integration result is identical to the gated candidate tree. A diff between the merge commit and the
candidate is empty, the merge commit is GitHub-verified, and `main` pointed at it. PR #205 was merged at
`2026-10-01T09:17:39Z`.

### Non-required PR checks at merge time

Branch protection on `main` requires only `DEV-GOV-V0 / trusted-execution`, which passed. Four non-required checks failed
on PR #205, the same four that failed on its earlier heads: `Typecheck` (87 errors, unchanged from the baseline measured on
`main`), `Lint` (437 problems, 53 errors and 384 warnings, unchanged), `Format check` (139 flagged files, unchanged) and
`Security audit` (18 advisories, up from 16 only because two `@grpc/grpc-js` advisories were published meanwhile; `main`'s
own lockfile audits to the same 18, and the PR changes no dependency). These baseline failures were not cleaned by this
program. `CodeQL`, `Analyze (JavaScript / TypeScript)`, `DEV-GOV-V0 / invariant-packs`, `Read-only DEV-GOV-V0 validation`
and `Dependency review (PR)` passed.

## Cold verification, as reported to the producing session

The statements below were reported to the producing session and were not re-derived by it.

- `e4b058ec`: the owner's `COLD_VERIFIED_WITH_DECLARED_GOVERNANCE_DEVIATION` (candidate record §18).
- `98cac708`: reported by the owner as independently delta-cold-reviewed `COLD_VERIFIED` before its dispatch.
- `903f648b`: an independent reviewer (Mimer), working from the review bundle with SHA-256
  `570559240c5e96a7f2bdcc0f16a5813dea7e3beb2b39fe1e706d3dec9faeef39`, returned `COLD_VERIFIED` for the delta
  `bc092fa3 → 903f648b`.
- `de6551af`: the same reviewer, working from the review bundle with SHA-256
  `0fdf5a33d93c4ec33528a3bf642fe6baa5eeaca0852d3774996f7f3a729d518a`, returned `COLD_VERIFIED` for the stale-base refresh
  and accepted `1e9d523f` as the refreshed design anchor.
- The independent reviewer reported that it directly verified the final state against GitHub (PR #205 merged; `main` at
  `b40b7ff3`; merge parents `e8baf567` and `de6551af`; tree `a695c30b`) and classified the unit
  `PROVEN / MERGED / FINALIZED`.

This record does **not** assert that the intermediate commits `7ef11f48`, `d1b091da` and `bc092fa3` each received a separate
independent cold review. The PPE code of the gated candidate (the `packages/mps-pattern-proof` subtree) is byte-identical to
`903f648b`, whose delta was reviewed.

## Proven claims

PATTERN-PROOF-ENGINE-01 V1 `BOOTSTRAP_RED_ONLY` proves only what the eight trusted proofs show:

1. The engine is fully present at the candidate (`ppe-engine-absent`, six declared engine files) and was absent at
   `base_sha`.
2. The package is registered in the vitest `compliance` include and alias and in the `tsconfig` paths
   (`ppe-package-unregistered`).
3. The package's own suite is green (`ppe-fixture-suite`): validators, schemas, persistence, authority, isolation, the state
   machine, the six terminal-state fixtures, the frozen target artifacts, Docker probe derivation and classification, the CLI
   and the adapter drift test.
4. The package and the orchestrator adapter are eslint-clean (`ppe-package-lint-clean`).
5. The two solution-neutral Docker RED probes classify `FAIL` on this tree, for the stages `builder` and `production-base`:
   the declared install step fails on an absent lifecycle-script dependency (`ppe-red-probe-builder-is-red`,
   `ppe-red-probe-production-base-is-red`). The proof records only digests of the probes' output, so the fidelity
   (`docker-stage-prefix` or `host-npm`) used on the runner is not part of the claim.
6. The properties asserted in the candidate record §§5–11 hold to the extent that the fixture suite exercises them:
   `BOOTSTRAP_RED_ONLY` stops before `WRITER`, produces evidence only and never mints authority.

## Non-claims

This unit does **not**:

- claim that `FULL_PATTERN_PROOF` is implemented, enabled or proven, or that a writer or verifier was ever invoked against a
  target;
- fix, or propose a fix for, the Dockerfile that the RED probes confirm as failing;
- resolve any finding in the section "Findings that are open, deferred or not shown"; the PROVEN state does not close them;
- claim that every statement of this record is proven by its own unit. The unit's GREEN binds this record to the identifiers
  and statements it requires and checks that the candidate record's existing text is untouched; the identifiers are
  independently checkable against GitHub and git;
- claim an independent audit of the code beyond the cold-verification statements above, which were reported and not
  re-derived;
- resolve the commit-identity policy disclosed in candidate record §0.1, or change, weaken or bypass
  `scripts/devgov/devgov.mjs`, any `.github/workflows/**` file, `governance/devgov/schema/**` or the invariant packs;
- clean the baseline failures of `Typecheck`, `Lint`, `Format check` or `Security audit`;
- introduce any new trust root.

## Final disposition

`PATTERN-PROOF-ENGINE-01 V1 BOOTSTRAP_RED_ONLY = PROVEN`

Further work may rely on the engine under `packages/mps-pattern-proof` as a governed `BOOTSTRAP_RED_ONLY` implementation,
subject to the non-claims above. `FULL_PATTERN_PROOF` needs its own unit, its own candidate and its own gate, and the open
findings above are its starting backlog.
