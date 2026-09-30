# PATTERN-PROOF-ENGINE-01-V1-BOOTSTRAP-RED-ONLY — CANDIDATE

**Status:** CANDIDATE / NOT YET PROVEN
**Frozen base:** `e617c7b7bb4613b95c6934004201eb14bec89ba0` (tip of `docs/pattern-proof-engine-01-v1-design`; `origin/main` `740b2fdf` is its ancestor and the only delta between them is the two frozen design documents)
**Unit definition:** `governance/devgov/units/pattern-proof-engine-01-v1-bootstrap-red-only-v1.json`
**Branch:** `claude/modest-hamilton-ndpu4t`
**Authority:** `docs/architecture/PATTERN-PROOF-ENGINE-01-DESIGN-V1-FROZEN.md` (v6, `ACCEPT / FROZEN`) and
`docs/architecture/PATTERN-PROOF-ENGINE-01-V1-BOOTSTRAP-RED-ONLY-DESIGN-FROZEN.md` (`ACCEPT / FROZEN FOR BOOTSTRAP_RED_ONLY`);
Jimmy's go for creating the `PATTERN-PROOF-ENGINE-V1` routine and running its `BOOTSTRAP_RED_ONLY` mode only.

This record is CANDIDATE, not PROVEN. It names the frozen base, the audited scope, the claims, the non-claims and the
finalization rule. Every "executed" statement below was executed in the session that produced this branch and is
labelled with where its evidence lives; nothing un-run is counted as PASS.

## 0. Process deviations, disclosed up front

1. **Commit identity.** `docs/architecture/development-governance.md` §1.1 states verbatim "GitHub Copilot Agent är den
   **ENDA** AI som får commita kod till repot". Observed practice on `origin/main` is commits authored under the
   `Copilot` git identity with `Co-Authored-By: Claude …` trailers. The commits on this branch are authored
   `Claude <noreply@anthropic.com>` with the session's attribution trailers; no Copilot identity was spoofed. The frozen
   design (§12 point 4) explicitly leaves this policy unresolved and states that the writer-commit constraint applies
   from `FULL_PATTERN_PROOF` onward, not to this bootstrap's engine-building work. The owner decides.
2. **Where the run happened.** The routine could not be created from the Remote Control session that owned this work:
   that session (CLI 2.1.284, bridge environment) hit a `session_request.worker` schema rejection on every attempt, and
   Remote Control sessions on 2.1.277–2.1.284 no longer receive the Claude Code Remote connector at all
   (anthropics/claude-code#98059). This cloud session (environment `Default`, `env_01V7tB9AC4uxbjumaVZJjifR`) verified
   that `create_session` and `create_trigger` succeed from a cloud session, performed the `BOOTSTRAP_RED_ONLY` build
   itself, and created the routine (§11) for future runs.
3. **A Docker daemon was started inside the session container** (`dockerd --host=unix:///run/ppe/docker.sock
--bridge=none --iptables=false`, data-root in the session scratchpad) because the container ships the Docker CLI
   without a daemon socket. Builds need `--network host`; outbound TLS is intercepted, so the probe injects a declared CA
   prelude (`PPE_DOCKER_CA_BUNDLE=/root/.ccr/ca-bundle.crt`). None of this is assumed elsewhere: without a daemon the
   docker executor classifies `BLOCKED/DOCKER_UNAVAILABLE`, and `--executor auto` falls back to the host-npm equivalent
   (fidelity recorded in every result).
4. **`blocked_exit_codes: [2]`** is used (the dominant unit convention, 157 occurrences) although the controller's own
   `EXIT_CODE.BLOCKED_ENVIRONMENT` is 3; both are honoured by `scripts/devgov/devgov.mjs` (`blocked_exit_codes` is per
   command). Every probe program follows the three-way contract: exit 0 holds, 1 violation, 2 harness fault.
5. **Adapter location.** The Workflow-tool adapter lives inside the package (`packages/mps-pattern-proof/workflow/ppe-v1.js`)
   and is invoked by `scriptPath`, not as a `.claude/workflows/<name>.js` command, to respect AGENTS.md "Modularitet
   först" and the unit's allow-list. Claude Code documents both invocation forms.
6. **CAS writer admission.** `packages/mps-pattern-proof/src/persistence.ts` was added to `AUTHORIZED_CAS_WRITERS` in
   `scripts/audit/master-boundary-audit.test.ts` in its own commit (`957d3de4`) so the admission can be rejected
   independently of the engine. It is the only file in the package that calls `.put(`, and it writes only through the
   injected `ArtifactRepositoryPort` (frozen §13 "Reuse entirely … not a new store"). That audit is red at baseline on
   seven pre-existing `packages/mps-lu/tests/*.test.ts` files (identical with the admission stashed); not fixed here.
7. **Base SHA.** `base_sha` is the design-branch tip rather than `origin/main`, so `base..candidate` contains exactly
   the engine. If `docs/pattern-proof-engine-01-v1-design` is merged with a different history (squash), a base bump in
   its own commit is required before dispatch, per the program's base-staleness discipline.

## 1. Purpose

Build the engine infrastructure the frozen BOOTSTRAP design §7 names, then stop:
`schemas/validators -> state machine -> orchestrator adapter -> isolation proof -> six terminal fixtures -> executable
solution-neutral Docker RED probes`, plus this unit record and the reusable on-demand routine. The Docker target's RED
plan (BOOTSTRAP §5.4) stays RED: no `Dockerfile` change is made or proposed here.

## 2. What this is not

- Not a Dockerfile fix and not a writer-GREEN of any kind. `Dockerfile*`, `docker-compose*.yml`, `package.json` and
  `package-lock.json` are forbidden paths of the unit.
- Not `FULL_PATTERN_PROOF`. The adapter and the routine hard-refuse any mode other than `BOOTSTRAP_RED_ONLY`; no
  WRITER/VERIFY agent prompts, no candidate freeze CLI and no owner-go bypass exist in this unit. `FULL_PATTERN_PROOF`
  is a separate unit requiring its own review and its own go (BOOTSTRAP §7).
- Not `PROVEN`, not promotion, not authority. The engine produces evidence; final `PROVEN`/promotion remains with
  Dev-Gov / trusted execution (frozen §12 point 3). `NOT_PROVEN` is a PPE workflow verdict and is never emitted under a
  field named `proof_status`.
- Not a parallel workflow runtime, replay authority, signing model, CAS or promotion authority (frozen §13, reuse table
  in §3 below).
- Not a PR and not a merge. The branch is pushed and stops for cold review.
- The routine is created but **not fired** in this unit; firing it is the owner's separate action (§11).
- The `WRITER -> DONE` half of the state machine is exercised only by synthetic contract fixtures (§6), never against
  the target.

## 3. Existing-platform reuse (frozen §13), row by row

| §13 row                     | What this unit does                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow execution          | Not wired in V1. `WorkflowRuntime` has no conditional/terminal branching, needs a registry snapshot and capability handlers, and hashes execution-ref ids/order, not artifact contents; the PPE state machine is a pure function over §2 artifacts (`src/state-machine.ts`). Persisting a completed run as an execution spine is future work.                                       |
| Execution state / retries   | Not needed: a bootstrap run has no ticket queue, lease or retry (`ExecutionInfrastructure` consumers are the admitted-ticket worker and two verification tests).                                                                                                                                                                                                                    |
| Artifact storage            | **Reused.** `PatternProofArtifactStore` (`src/persistence.ts`) writes/reads through `ArtifactRepositoryPort` from `@miljobeslut/mps-runtime`; fixtures use `CasBackedArtifactRepository` over `MemoryByteStorageBackend`; content hash verified on load; WORM re-put surfaced, not caught.                                                                                          |
| Replay                      | Semantics reused, engine not: `DefaultReplayEngine.replay()` requires a domain `RuntimeState.attempt` and is ADR-24-23's candidate-replay path. `src/replay.ts` only compares digests of a regenerated `ProofPackage` against its declared `InputManifest` (frozen §7); `NON_REPRODUCIBLE` is PPE's classification on top. No `Replay*` noun is exported except `ReplayComparison`. |
| Security/admission          | Not needed in V1 (its `SigningKeyProvider` is an HMAC string signer unrelated to mimers-brunn-core's Ed25519 provider; do not conflate).                                                                                                                                                                                                                                            |
| Verifier separation         | **Reused as the isolation mechanism.** `src/isolation.ts` accepts only a `VerificationKeyProvider` for the verifier context and rejects at runtime any provider carrying a `sign` member (`LocalPemVerificationKeyProvider` has none by construction); the orchestrator signer attests the declared input bundle.                                                                   |
| Attestation                 | **Reused.** `createArtifactAttestation` / `verifyArtifactAttestation` / `attestationSubjectBinding`; PPE binds `attestation.signer` to the expected key id itself because the core verify function does not.                                                                                                                                                                        |
| Adversarial testing         | Mechanics generalised into the fixtures (§6): Tampered Artifact → `FALSIFIED` WORM re-put; Wrong Release / Fake Capability → `MISSING_AUTHORITY` fails closed on unresolvable refs; Tampered Registry → frozen allow-list; Replay Attack → `NON_REPRODUCIBLE` determinism. Duplicate Ticket Flood has no V1 counterpart.                                                            |
| Verification composition    | `PlatformHarness` not needed: the six fixtures are pure state-machine contract tests with in-memory resolvers and an in-memory CAS; a real kernel execution is not required to exercise any terminal state.                                                                                                                                                                         |
| Canonical verification name | Respected: the package exports `PatternVerificationArtifact`, never `VerificationArtifact` (ADR-24-22).                                                                                                                                                                                                                                                                             |
| Final proof/promotion       | Respected: nothing here mints `PROVEN`.                                                                                                                                                                                                                                                                                                                                             |
| Canonical identity          | All PPE digests use `canonicalizeStrict` + `hashCanonicalValue` from `@miljobeslut/mimers-brunn-core` (`src/identity.ts`); the CAS envelope's `content_hash` is the same digest, so PPE identity and stored hash cannot disagree.                                                                                                                                                   |

Not re-verifiable here: frozen §13 cites `docs/architecture/MIMER-EVOLUTION-TRACK-GOVERNANCE-V0.md` as "verified
verbatim" `DRAFT / NON_CANONICAL / IMPLEMENTATION_DENIED`. That file exists neither in the working tree nor in any of
the 1497 commits reachable from all remote refs; only the reuse-map commit mentions it. Recorded, not resolved.

## 4. Changed paths

Everything under `packages/mps-pattern-proof/**` (new package, registered in `tsconfig.json` paths and in
`vitest.config.ts` root alias, compliance-project alias and compliance include, per the K2.2 precedent; root
`package.json`/`package-lock.json` untouched), `scripts/audit/master-boundary-audit.test.ts` (three-line admission, §0.6),
`docs/architecture/audits/evidence/ppe-v1/**` (executed probe results), this record and the unit definition. See the
unit's `allowed_paths`.

Commits on the branch above the frozen base: `2b7146ba` scaffold, `957d3de4` CAS-writer admission, `cf088a50` artifact
protocol/persistence/authority/isolation, `79e506b3` state machine/replay/fixtures/Docker probes, `924d2d45` adapter,
CLI and schema generator, `1290f76f` unit definition, first draft of this record and the first executed probe evidence,
`e3f3e4f3` cold-review round 1 corrections (R1, 18 findings), `21366c53` record §10, `41ad8001` cold-review round 2
corrections (R2, findings F2–F11), then the evidence commit carrying this rewrite of the record (R2 F1), the adapter smoke-run evidence and the probes
re-executed under the corrected code, and the packaging commit that fills §11, §13–§15 and §18 (a commit cannot contain
its own SHA; the packaging commit names the evidence commit).

## 5. The engine, module by module

- **Artifact protocol** (`src/evidence.ts`, `src/artifacts.ts`, `src/validators.ts`, `src/schemas.ts`,
  `src/schema-subset.ts`). Every BOOTSTRAP §2 interface, camelCase, readonly, exactly the frozen enums
  (`EvidenceGround` uses `WRITER_TEST_REGRESSION`, not `_ONLY`). Hand-rolled validators return deep-frozen copies of
  present keys only and enforce: non-empty evidence on findings, edges, probes, compliance and claims; dangling graph
  edges rejected; `MECHANICAL` requires `derivation`, other classifications require `blockingReason` (presence of the
  other field is not rejected, per the frozen wording); unique probe ids each with `authorityEvidence`; candidate shas
  40-hex, a claimed `PASS` rejected when compliance evidence names a path outside `allowedPaths`; `allowedPaths` may
  never cover a proof-policy path. The frozen list `PROOF_POLICY_PATH_PREFIXES` is `packages/mps-pattern-proof`,
  `governance/devgov`, `scripts/audit`, `scripts/devgov`, `docs/architecture/PATTERN-PROOF-ENGINE-01-*`,
  `docs/architecture/audits`, `.claude`, `.github`, `vitest.config.ts`, `tsconfig.json`, `package.json`,
  `package-lock.json`. Plan D10 named the first, second, third, fifth and seventh of these; adding the Dev-Gov
  controller, the audit records and their evidence, CI, and the root registration and lockfile files is this unit's
  documented extension of D10 (R1 F17). Every allow-list entry is additionally matched against representative
  proof-policy paths with the same matcher `isPathAllowed` uses, so glob entries (`*`, `**`, `docs/**`, `**/*.ts`,
  `packages/*/src/**`, `scripts/**`) are rejected while `scripts/*`, `Dockerfile*` and brace patterns are admitted.
  `materialInvariant` requires `VERIFIER_OWNED_PROBE` or `INDEPENDENT_CODE_DERIVATION`; `NOT_PROVEN` requires
  `reasonCode`; `ACCEPT`/`FALSIFIED` require `isolationEvidence`; `InputManifest` secret material is rejected by value
  (PEM headers, `://user:pass@`, JWT shape, long hex/base64 blobs that are not `sha256:` fingerprints, `ed25519:` key
  ids or whole 40-hex git object ids, R2 F9), `candidateShaOrDiff` is constrained to `<sha>` or `<base>..<cand>`,
  `fixtureContentHashes` values must be sha256 digests and `toolchainIdentity` is scanned too (R1 F10). The JSON
  schemas for the adapter use only
  `type/properties/required/items/enum/minItems/additionalProperties/description`; a test walks every schema and
  rejects any other keyword; every fixture passes both its validator and its schema.
- **Identity and persistence** (`src/identity.ts`, `src/persistence.ts`): `sha256:<hex>` over canonical bytes; ids
  `ppe:<kind>:<hex>`; artifact types `PPE_<KIND>`; `loadArtifact` recomputes the hash and fails closed on mismatch.
  The stored body is the canonical form of the validated body (`canonicalizeStrict` key order at every level, R1 F9),
  so two canonically equal bodies share one id and identical stored bytes and never trip a spurious WORM violation on
  the second put, while a different body under an existing id surfaces the backend's WORM violation uncaught.
- **Authority resolution** (`src/authority.ts`, frozen §8): `InMemoryAuthorityResolver` for fixtures and
  `RepositoryAuthorityResolver` for checkouts — `file_line` in the forms `path:N`, `path:N-M`, `path:N,M,…` (every named
  line must exist, no traversal outside the root), `git_object` via `git cat-file -e` (spawned, no shell; a bare id or a
  `<sha>..<sha>` range whose objects are checked separately; exit 1, and a `fatal:` that names a missing object or
  path, are `GIT_OBJECT_NOT_FOUND`; exit 128 with a repository-level refusal — not a repository, dubious ownership,
  cannot change directory, which is the candidate user's situation on the trusted runner — or a timeout is
  `GIT_UNAVAILABLE`, never "not found", R2 F10), `cas_artifact` via the store, `signed_attestation` via a verify-only provider with signer binding, `runtime_result` via an explicit ledger,
  `postgis_ref` → `NOT_SUPPORTED_IN_V1` (unresolvable, fails closed).
- **State machine** (`src/state-machine.ts`, frozen §3, BOOTSTRAP §3/§4): pure transitions, deep-frozen states, a
  timestamp-free transition history. Terminal triggers as frozen: `HUMAN_DECISION_REQUIRED` / `MISSING_AUTHORITY` /
  `SCOPE_VIOLATION` from the decision gate (the `DecisionClassification` enum includes `SCOPE_VIOLATION`, so
  `DECISION_GATE` is an additional trigger source beyond the §3 table's `WRITER`; the terminal record carries
  `atPhase`); `MISSING_AUTHORITY` from RED synthesis when a probe's authority is not among the locators established by
  discovery/graph (`AUTHORITY_NOT_IN_DISCOVERY_OR_GRAPH`) or does not resolve — no `RedPlanArtifact` is stored;
  `SCOPE_VIOLATION` from a diff derived independently of the writer's claim, and from any claimed/derived mismatch in
  either direction; `VERIFY` and `ADVERSARIAL_PROBES` are one transition consuming one `PatternVerificationArtifact`
  (`atPhase: VERIFY+ADVERSARIAL_PROBES`; no state ever awaits input at `ADVERSARIAL_PROBES`); isolation evidence must
  resolve for `ACCEPT` **and** `FALSIFIED`, else `NOT_PROVEN` / `VERIFICATION_BLOCKED`; `NON_REPRODUCIBLE` from a replay
  comparison bound to the package's own digests (an unbound comparison is rejected, `PPE_REPLAY_UNBOUND`). In mode
  `BOOTSTRAP_RED_ONLY` a successful RED synthesis sets an absorbing `stoppedByMode` at `RED_SYNTHESIS`: `WRITER` is never
  entered and every later transition throws `PPE_RUN_STOPPED`. Binding (R1 F4, R2 F6): a run started with a `baseSha`
  records it; an admitted candidate's `baseSha` must equal it, its `diffRef` must be the `git_object` range
  `baseSha..candidateSha` and must resolve before compliance is derived; a `ProofPackage` must carry the admitted
  candidate's `candidateSha` and `baseSha`, a manifest whose `candidateShaOrDiff` is that same range, and exactly the
  stored `RedPlan`'s probe identities (no subset, no foreign id) — else `PPE_PROOF_PACKAGE_UNBOUND`, an inadmissible
  artifact, never a terminal state. (The standalone `InputManifest` validator still admits a bare candidate sha in
  `candidateShaOrDiff`, as the frozen field name allows; a run binds only the range form.) Terminal records are never evidence-free (R1 F16): a gate stop cites `decision-gate-item:<i>:<classification>`,
  a scope stop cites `derived-compliance:<derived>;claimed:<claimed>`, and a `NOT_PROVEN` whose isolation evidence is
  empty carries `runtime_result verification:NOT_PROVEN:<reasonCode>`. Storage rule: an artifact is stored iff the
  machine admitted it (a gate that stops the run is stored; an unauthorised red plan, an inadmissible candidate or a
  verification whose isolation did not resolve is not).
- **Isolation proof** (`src/isolation.ts`, frozen §4, §13): `VerifierInputBundle` is a closed key set at every level
  (repository identity, candidate identity + diff ref, frozen-spec locators, red-plan digest, declared runtime
  inputs); any undeclared key such as `writerTranscript` is rejected. The orchestrator signer attests
  `digestOf(bundle)` with predicate type `ppe/verifier-input-bundle/v1` and the sorted declared keys; the verifier
  context is constructible only with a verify-only provider (runtime rejection of any `sign` member), verifies the
  attestation, binds the signer key id, re-derives the bundle digest and yields two `isolationEvidence` locators
  (`signed_attestation` = the attestation subject binding, `runtime_result` = `verifier-context:<digest>`). The verifier
  prompt is a deterministic function of the declared inputs only, and every declared slot is bounded so that none can
  smuggle a transcript: `verifierRuntimeInputs` keys match `PPE_[A-Z0-9_]{1,64}` with single-line values of at most
  512 characters, the repository remote and every locator ref in the bundle are single-line and bounded, and notes are
  folded and capped when rendered (R1 F12, R2 F5). What this proves and does not prove is stated in §9.
- **Docker RED probes** (`src/docker/*`, `scripts/red-probe.ts`, BOOTSTRAP §5.4): solution-neutral by construction —
  everything is derived from the candidate Dockerfile and `package.json`, nothing from a base snapshot. The stage
  prefix is the lineage (root base first), every ancestor instruction, and the target stage's own instructions up to
  and including its single project-install RUN: a command among the RUN's `&&`/`;`/`||`/`|`-separated commands of the
  form `npm ci|install|i` followed only by flags (positional package specs, `-g`, `--global`, `--location=global`,
  `npm cache …`, `npm run …` and `npm install -g npm@10` never qualify, R1 F3, R2 F8). Zero or two such RUNs in the
  target stage fail closed with `PPE_INSTALL_STEP_NOT_FOUND` ("ambiguous"; exit 2, `BLOCKED`), and so do install
  commands the predicate does not model — value-taking flags with a separate argument, redirections, inline `#`
  comments and the `clean-install`/`install-clean` aliases (documented in the module header): a candidate can make the
  derivation refuse, never make it pass. Plain COPY/ADD sources (never `--from`), WORKDIR, ENV and ARG defaults are
  recorded. The lifecycle set L is derived from the candidate `package.json` (`preinstall`, `install`, `postinstall`,
  `prepare`, split on `&&`/`||`/`|`/`;`, `npm run <name>` resolved one level, quotes stripped, node script paths
  normalised against the derived WORKDIR); runner-only hooks (`npx`, `tsx`, `sh -c`, subshells) yield an empty L. The
  outcome is classified from the captured output, never from the exit code alone (npm exits 1 for RED and for a
  network failure alike; docker exits 1 for any inner failure), in the order **BLOCKED > FAIL > PASS**:
  - `BLOCKED` — a spawn error, a timeout, a kill by signal or an install step that never started (unconditional);
    and, on a non-zero exit only, daemon/socket/network/TLS/image-fetch signatures, `CONTEXT_INCOMPLETE` (npm
    `ENOENT`, unreadable `package.json`), `LIFECYCLE_RUNNER_UNSUPPORTED` (a failed install whose hooks run through a
    runner L cannot follow) and `INSTALL_FAILED_UNATTRIBUTED` (any failed install without the probed package's own
    lifecycle banner, R1 F2). The host executor refuses a prefix with `COPY --from` or an unexpanded `$` in the
    install command before spawning (`HOST_FIDELITY_UNSUPPORTED`, R1 F8), and refuses to run when `package.json` did
    not land in the materialised context.
  - `FAIL` (RED confirmed) — exit ≠ 0, the banner `> <name>@<version> <hook>` of the probed package, `Cannot find module '<p>'` (CJS or `ERR_MODULE_NOT_FOUND` shape, R2 F2) with `<p>` resolving against the derived WORKDIR to a
    member of L, `code: 'MODULE_NOT_FOUND'`, `npm error command sh -c <exact hook string>`, and in docker output the
    failed-step line naming exactly the derived install command (a failed ancestor step never counts; the install-step
    header match is exact, R2 F7). Without the code or command line the reason is
    `LIFECYCLE_SCRIPT_MODULE_NOT_FOUND_TRUNCATED`.
  - `PASS` — exit 0 (`INSTALL_COMPLETED`, or `INSTALL_COMPLETED_WITH_LIFECYCLE_ERROR_TEXT` with the masked lines in
    `matched` when a completed install still printed the error text, R1 F6/F11), or a failed install whose banner is
    present but whose failure is not the asserted one (`INSTALL_FAILED_AFTER_LIFECYCLE_STARTED`: the hook was found and
    ran; the failure lies elsewhere and is not this pattern).

  Two executors: `docker-stage-prefix` (real `docker build --network host --progress plain --no-cache` of the derived
  prefix with the declared CA prelude) and `host-npm` (the derived context materialised in a temp dir, the derived
  install command run there). `auto` prefers docker when `docker info` succeeds and otherwise falls back to
  `host-npm`; the fidelity used is a field of every result. Exit codes 0 PASS / 1 FAIL / 2 BLOCKED. The two frozen
  probes are embedded verbatim (`src/docker/red-plan-probes.ts`), and `src/docker/verification-from-probes.ts` maps
  probe classifications to a `PatternVerificationArtifact` verdict: any `BLOCKED` → `NOT_PROVEN`
  (`VERIFICATION_BLOCKED`), else any `FAIL` → `FALSIFIED`, else `ACCEPT`.

- **Orchestrator adapter and CLI** (`workflow/ppe-v1.js`, `scripts/ppe-cli.ts`, `scripts/gen-workflow-adapter.ts`):
  see §10.

## 6. The six terminal-state fixtures (`tests/terminal-states.test.ts`, BOOTSTRAP §6)

Fixtures 3–6 drive the pure state machine in mode `FULL_PATTERN_PROOF` on synthetic artifacts only: no agent, no real
diff, no Dockerfile change. That is contract-test coverage of the frozen state machine, not a `FULL_PATTERN_PROOF` run.

| Terminal state            | Fixture                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Reused mechanic              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `HUMAN_DECISION_REQUIRED` | synthetic `DecisionGateArtifact` with a genuine owner-level item → halts before `WRITER`; any later transition throws (terminal states are absorbing)                                                                                                                                                                                                                                                                                                                                                                                                            | —                            |
| `MISSING_AUTHORITY`       | probe cites `services/mapLayerSelection.ts:1` (absent from discovery/graph) → `AUTHORITY_NOT_IN_DISCOVERY_OR_GRAPH`; separately, a locator present in the graph but unresolvable → resolver reason; `redPlan` undefined in both                                                                                                                                                                                                                                                                                                                                  | fake capability fails closed |
| `SCOPE_VIOLATION`         | `allowedPaths: ['Dockerfile']`, independently derived diff `['Dockerfile', 'package.json']` → derived `FAIL`; plus claimed-PASS/derived-FAIL inconsistency                                                                                                                                                                                                                                                                                                                                                                                                       | frozen registry              |
| `FALSIFIED`               | frozen synthetic candidate persisted through the reused CAS repository; a verifier-owned probe oracle exercises both stages of a candidate that fixes only `production-base` → `builder` FAIL → verdict `FALSIFIED`; re-put under the original id throws `WORM violation` (not edited in place); negative: same verdict with unresolvable isolation evidence → `NOT_PROVEN`/`VERIFICATION_BLOCKED`, never `FALSIFIED`. `tests/falsified-derivation.test.ts` repeats the fixture with the real stage-prefix derivation and classifier over captured probe output. | tampered artifact (WORM)     |
| `NOT_PROVEN`              | a real `executeRedProbe` against an unreachable docker host (`unix:///nonexistent/ppe.sock`) classifies `BLOCKED/DOCKER_UNAVAILABLE`; `verificationFromRedProbeResults` turns it into verdict `NOT_PROVEN`, `reasonCode: VERIFICATION_BLOCKED`, and the terminal record carries the `runtime_result` locator `verification:NOT_PROVEN:VERIFICATION_BLOCKED`; never `ACCEPT`/`FALSIFIED` (a second, synthetic `available: false` runner is kept as the simpler contract case)                                                                                     | —                            |
| `NON_REPRODUCIBLE`        | schema-valid, complete `InputManifest`; the regeneration program (`tests/fixtures/regenerate-proof-package.ts`) is spawned once per iteration with the undeclared input `PPE_FIXTURE_MODE=A` then `B` → digests diverge → `NON_REPRODUCIBLE`; control `A,A` → `DONE`                                                                                                                                                                                                                                                                                             | replay determinism           |

## 7. The frozen target artifacts through the engine (`tests/target-artifacts.test.ts`)

BOOTSTRAP §5.1–§5.4 JSON, transcribed mechanically and verbatim (`tests/fixtures/frozen-target-artifacts.ts`), passes
every validator and, driven through the machine in mode `BOOTSTRAP_RED_ONLY` with `RepositoryAuthorityResolver` rooted
at this checkout and a runtime ledger seeded with the four `runtime_result` refs the frozen JSON cites, stops at
`RED_SYNTHESIS` with `stoppedByMode` and the frozen `RedPlanArtifact` stored; every discovery, graph and red-plan
locator resolves; a red plan citing `services/mapLayerSelection.ts:1` terminates `MISSING_AUTHORITY`. The same
sequence is exercised end to end through `ppe-cli run` (§10).

## 8. Docker RED probes — executed results

Executed in this session against the unmodified `Dockerfile` (blob `a3b31b8eda0280c2a899cebdaf856a3eacbfd103`). Result
files: `docs/architecture/audits/evidence/ppe-v1/bootstrap-red-only-20260930/red-probes/*.json` (each carries the
derived prefix, toolchain identity, evidence locators and the decisive output lines).

| Run                    | Stage             | Executor requested → used | Classification | Reason                              | Fidelity              | Elapsed | Evidence file (sha256, first 12)                   |
| ---------------------- | ----------------- | ------------------------- | -------------- | ----------------------------------- | --------------------- | ------- | -------------------------------------------------- |
| docker, daemon present | `production-base` | docker → docker           | **FAIL (RED)** | `LIFECYCLE_SCRIPT_MODULE_NOT_FOUND` | `docker-stage-prefix` | 124.5 s | `production-base.docker.json` `91bc87b2c164`       |
| docker, daemon present | `builder`         | docker → docker           | **FAIL (RED)** | `LIFECYCLE_SCRIPT_MODULE_NOT_FOUND` | `docker-stage-prefix` | 118.4 s | `builder.docker.json` `8bf77f49da14`               |
| host equivalent        | `production-base` | host → host               | **FAIL (RED)** | `LIFECYCLE_SCRIPT_MODULE_NOT_FOUND` | `host-npm`            | 40.5 s  | `production-base.host.json` `4dfcd26ab68d`         |
| host equivalent        | `builder`         | host → host               | **FAIL (RED)** | `LIFECYCLE_SCRIPT_MODULE_NOT_FOUND` | `host-npm`            | 47.5 s  | `builder.host.json` `e53d14dbe9a9`                 |
| no daemon, docker      | `production-base` | docker → none             | **BLOCKED**    | `DOCKER_UNAVAILABLE`                | —                     | 0 s     | `production-base.docker-unset.json` `0710237a8e65` |
| no daemon, auto        | `production-base` | auto → host               | **FAIL (RED)** | `LIFECYCLE_SCRIPT_MODULE_NOT_FOUND` | `host-npm`            | 36.5 s  | `production-base.auto-unset.json` `6699ce761b37`   |

Provenance caveat, disclosed (R2 F1): the six files above were produced at commit `1290f76f` with the classifier of
`924d2d45`, before the R1 and R2 corrections. Their `matched` lines and reason codes are unchanged under the corrected
classifier only because `tests/classify.test.ts` re-classifies the same captured signatures; the files themselves were
not regenerated. Both probes were therefore re-executed under the corrected code (`41ad8001`) into
`docs/architecture/audits/evidence/ppe-v1/bootstrap-red-only-20260930/red-probes-r2/`:

| Run (corrected code `41ad8001`) | Stage             | Executor requested → used | Classification | Reason                              | Fidelity              | Elapsed | Evidence file (sha256, first 12)             |
| ------------------------------- | ----------------- | ------------------------- | -------------- | ----------------------------------- | --------------------- | ------- | -------------------------------------------- |
| docker, daemon present          | `production-base` | docker → docker           | **FAIL (RED)** | `LIFECYCLE_SCRIPT_MODULE_NOT_FOUND` | `docker-stage-prefix` | 74.0 s  | `production-base.docker.json` `f7695096e255` |
| docker, daemon present          | `builder`         | docker → docker           | **FAIL (RED)** | `LIFECYCLE_SCRIPT_MODULE_NOT_FOUND` | `docker-stage-prefix` | 81.1 s  | `builder.docker.json` `91b49aec83aa`         |
| host equivalent                 | `production-base` | host → host               | **FAIL (RED)** | `LIFECYCLE_SCRIPT_MODULE_NOT_FOUND` | `host-npm`            | 35.6 s  | `production-base.host.json` `8fcd2af99107`   |
| host equivalent                 | `builder`         | host → host               | **FAIL (RED)** | `LIFECYCLE_SCRIPT_MODULE_NOT_FOUND` | `host-npm`            | 40.1 s  | `builder.host.json` `b208a67888a3`           |

The docker results under the corrected classifier carry five `matched` lines — the four of the first run plus the
BuildKit failed-step line naming exactly the derived install command (`#12 ERROR: process "/bin/sh -c npm ci --omit=dev
--legacy-peer-deps" did not complete successfully: exit code: 1`, R1 F7/R2 F7); the host results carry four (no docker
step line exists there). Each `.stderr` file beside a result holds the CLI's one-line verdict. Same Dockerfile blob,
same toolchain identity as the first run; the docker builds were faster because the base image was already present in
the session daemon (the `--no-cache` rule applies to layers, not to the pulled image).

Derived prefixes (from the candidate Dockerfile, not asserted): `builder` — lineage `base, builder`, context
`package*.json, tsconfig.json`, install `npm ci --legacy-peer-deps` at line 20; `production-base` — lineage
`base, production-base`, context `package*.json`, install `npm ci --omit=dev --legacy-peer-deps` at line 37. Decisive
docker-run lines (production-base, step `#12`):

```
#12 42.51 > miljobeslut-se-2.0@0.0.0 postinstall
#12 42.58 Error: Cannot find module '/app/scripts/postinstall-prisma-generate.mjs'
#12 42.58   code: 'MODULE_NOT_FOUND',
#12 42.59 npm error command sh -c node scripts/postinstall-prisma-generate.mjs && node scripts/copy-cesium-assets.cjs
#12 ERROR: process "/bin/sh -c npm ci --omit=dev --legacy-peer-deps" did not complete successfully: exit code: 1
```

Positive controls from the grounding phase (same file sets with `--ignore-scripts`) install successfully; the failure
is caused solely by the absent lifecycle-script dependency. Solution neutrality: `--ignore-scripts`, a `COPY scripts
./scripts` before the install RUN, or a removed `postinstall` each change the derived prefix or lifecycle set and would
classify `PASS` (`tests/stage-prefix.test.ts`, `tests/classify.test.ts`, `tests/falsified-derivation.test.ts`); today's
Dockerfile classifies `FAIL` under both executors. Toolchain identity of the docker runs: `node v22.22.2; npm 10.9.7;
linux x64 6.18.44-fc-v50; docker client 29.3.1; docker server 29.3.1; base image
node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402`.

Caveats, disclosed: the docker executor runs with `--no-cache`, so each build rebuilds the apk layer (~2 min); failed-
build layers stay in the session daemon's BuildKit cache (not pruned, nothing tagged); the in-image node version
(`v22.23.3` in the build output) is not part of the identity line; `DOCKER_HOST` and `--network host` are process
inputs, not fields of the result; on the trusted runner the `devgov-candidate` user cannot reach a docker socket, so the
unit's GREEN probes run with `--executor auto` and are expected to report `host-npm` fidelity there.

## 9. Isolation proof — what it demonstrates

Demonstrated by `tests/isolation.test.ts`: a verifier context cannot be constructed with a signing-capable provider; a bundle
with an undeclared key never reaches a verifier context; an attestation from a different key, a different signer id or
over a tampered bundle is rejected; the verifier prompt is a deterministic function of the declared inputs only;
`'sign' in verifyOnlyProvider === false` (same check as `P2SRVerifyOnly01.test.ts`). The `signed_attestation` locator
resolves through `RepositoryAuthorityResolver` with a verify-only provider.

Not proven here, and recorded as the `FULL_PATTERN_PROOF` precondition (frozen BOOTSTRAP §4): that a live verifier
agent was instantiated with only those inputs. Workflow subagents receive the repository's `AGENTS.md`/`CLAUDE.md`
injection and repository access; the runtime evidence for a live run must therefore be a ledger written by the
adapter run (bundle digest, verifier prompt digest, digests of the injected instruction files declared as
`verifierRuntimeInputs`, and an assertion that no writer artifact existed on disk when the verifier started), resolved
as a `runtime_result` locator. That ledger is not implemented in this unit because no verifier runs in
`BOOTSTRAP_RED_ONLY`.

## 10. Orchestrator adapter and CLI

**Adapter** (`packages/mps-pattern-proof/workflow/ppe-v1.js`, BOOTSTRAP §4 as the first orchestrator adapter, plan
D2/D3/D7/D14/T4/T5/T13). Plain JavaScript for the Claude Code Workflow tool: a `/* global … */` directive, then
`export const meta` as the first statement (name `ppe-v1`, phases `DISCOVER`, `BUILD_GRAPH`, `DECISION_GATE`,
`RED_SYNTHESIS`, a pure literal), then a generated block `const PPE_SCHEMAS = …` holding the package's eight artifact
schemas (emitted by `scripts/gen-workflow-adapter.ts` from `PPE_ARTIFACT_SCHEMAS`, prettier-formatted, idempotent
(`unchanged`), byte-compared by `tests/workflow-adapter.test.ts`), then hand-written control flow:

- refuses, before any agent runs, every mode other than `BOOTSTRAP_RED_ONLY` and any call missing `evidenceDir`,
  `runStamp` or `baseSha`; there is no `FULL_PATTERN_PROOF` path and no owner-go bypass;
- runs exactly four sequential `agent()` calls, one per phase, each with a harness schema
  `{ artifact: PPE_SCHEMAS[kind], validation: { ok, errors }, artifactPath }` (RED_SYNTHESIS additionally
  `runSummary` and `probeResults`); every stage reads only the artifact files of the earlier stages under
  `evidenceDir` (never a transcript), writes its own artifact file and validates it with
  `ppe-cli validate --kind <kind> --file …`; `runtime_result` refs an agent cites must be recorded in
  `evidenceDir/runtime-ledger.json`;
- the authoritative transition is `ppe-cli run --dir <evidenceDir> --mode BOOTSTRAP_RED_ONLY --repo-root . --run-id
<runStamp> --base-sha <baseSha> --json` (the pure state machine over the written files, plan D3), executed by the
  RED_SYNTHESIS stage and required to report `stoppedAtPhase: RED_SYNTHESIS` (exit 0) or a terminal state (exit 3);
  the stage then executes both RED probes with `--executor auto` and reports their classifications;
- fails closed (`failedClosed` with the phase and reason) on a `null` agent result, `validation.ok !== true`, or any
  other run summary; returns early at `DECISION_GATE` on a non-`MECHANICAL` item as a candidate verdict, naming the
  `ppe-cli run` command that yields the authoritative one;
- uses no `Date.now`/`Math.random`, no imports and no filesystem; keeps to four agents.

What the script sees, disclosed (R2 F3): having no filesystem or process access by design, the script never observes
`ppe-cli run` or the probes itself — it consumes the RED_SYNTHESIS agent's **relay** of their output. Before its
success return it therefore requires exactly one probe result per requested stage, each with a classification,
`runSummary.phase === 'RED_SYNTHESIS'`, `stoppedByMode.reason === 'BOOTSTRAP_RED_ONLY'` and the four stored
artifacts, and it validates `baseSha` (40-hex) and `evidenceDir`/`runStamp` (letters, digits, `_ . / -`: no spaces,
no shell metacharacters) before interpolating them into any agent command line. That character set still admits an
absolute path and `..` segments — the smoke run itself used an absolute scratchpad path — so where the agents write is
bounded by the stage prompts' "only under `evidenceDir`" rule and by the routine's relative `evidenceDir`, not by the
script. The relay is checked rather than trusted: the routine (§11, prompt
§4) re-runs `ppe-cli run` over the same artifact files into a separate `run-state.routine.json` and re-executes both
probes into `probe-<stage>.routine.json`, and a disagreement is a failed run. The same re-check was applied to the
smoke run in §14a.

Harness caveat, disclosed: the Workflow tool validates `agent()` schemas with Ajv (draft-07 default class,
`validateFormats: false`, inferred from the Claude Code 2.1.285 binary, not from documentation); the adapter therefore
uses only `type/properties/required/items/enum/minItems/additionalProperties/description`, and semantic invariants
beyond that are enforced by the package validators through `ppe-cli`. In an interactive auto-mode session the agents'
`npx tsx …` and docker commands need pre-approval; routine runs are autonomous.

**CLI** (`packages/mps-pattern-proof/scripts/ppe-cli.ts`): `validate --kind <kind> [--file]` prints the validator
verdict as JSON (exit 0 ok, 1 inadmissible, 2 harness fault); `run --dir <dir> --mode BOOTSTRAP_RED_ONLY [--repo-root]
[--run-id] [--base-sha] [--ledger] [--out] [--json]` replays `discovery.json`, `dependency-graph.json`,
`decision-gate.json` and `red-plan.json` through the state machine with `RepositoryAuthorityResolver` rooted at the
checkout and the runtime ledger, writes `run-state.json` and exits 0 on `stoppedByMode` at `RED_SYNTHESIS`, 3 on a
terminal state, 1 on an inadmissible artifact, 2 on a harness fault including the refusal of any other mode;
`schemas` prints the artifact schemas.

Executed in this session: `ppe-cli run` over the frozen §5 artifacts (seeded with their four `runtime_result` refs)
→ exit 0, `stoppedAtPhase: RED_SYNTHESIS`, `storedArtifacts: discovery, dependency-graph, decision-gate, red-plan`
(`tests/ppe-cli.test.ts` repeats this, plus `MISSING_AUTHORITY` → exit 3, an evidence-less finding → exit 1, and
`--mode FULL_PATTERN_PROOF` → exit 2 quoting BOOTSTRAP §7). The adapter itself was executed once through the real
Workflow tool in this session as a smoke run of the orchestration path; its outcome and evidence are recorded in §14a.

Three different things are named "workflow" in this repository and must not be conflated: the Claude Code **Workflow
tool** (agent orchestration; this adapter), `packages/mps-runtime`'s `WorkflowRuntime` (platform domain execution,
frozen §13), and `packages/mps-workflow` (an ADR-24-19 contract with a missing `src/index.ts` and a single test
consumer). The adapter exports no `Workflow*` name.

## 11. Routine

_Trigger id filled in by the packaging commit._ `PATTERN-PROOF-ENGINE-V1`: environment `Default`
(`env_01V7tB9AC4uxbjumaVZJjifR`), no schedule (fired manually), prompt versioned at
`packages/mps-pattern-proof/routine/PATTERN-PROOF-ENGINE-V1.prompt.md`. The routine reads only `mode`, `branch` and
`runStamp` from the fire payload, refuses any mode other than `BOOTSTRAP_RED_ONLY`, runs the adapter by `scriptPath`,
re-runs `ppe-cli run` and both RED probes itself, commits the evidence to a `claude/ppe-v1-run-<runStamp>` branch and
stops. Created, **not fired**, in this unit.

## 12. Design citation drift found (frozen documents not edited)

| Frozen citation                                                    | Current tree                                                                                                                        |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `package.json:44` (postinstall)                                    | line 46                                                                                                                             |
| `.github/workflows/deploy-gcp.yml:88-89`                           | build step lines 89–97 (`-f Dockerfile.gcp` at 92)                                                                                  |
| `.github/workflows/deploy-staging.yml:1-6`                         | header lines 1–7 (compose mention at 7)                                                                                             |
| BOOTSTRAP §1 "`COPY --from=builder` lines 40-50"                   | 41–50 (line 40 is a context `COPY prisma ./prisma`)                                                                                 |
| frozen §5 "the F04 auto-dispatch regression"                       | no document or commit uses "auto-dispatch"; two candidate referents (invariant-pack F-04; COLD-AUDIT-04D-R1-F04) — owner to confirm |
| frozen §13 `MIMER-EVOLUTION-TRACK-GOVERNANCE-V0.md` status markers | file absent from tree and history (§3)                                                                                              |

The frozen §5 JSON with the stale line numbers still resolves (the lines exist), which is exactly the limit of a
`file_line` locator: it proves a governed line exists, not what it says. The unit's own probe results cite current
lines and the Dockerfile blob id.

## 13. RED (executed at `base_sha`)

_Filled in by the packaging commit (executed with `devgov-helper preflight --execute --base-worktree` against a clean
detached worktree at `e617c7b7`)._

## 14. GREEN (executed at the candidate)

_Filled in by the packaging commit._

## 14a. Adapter smoke run (executed through the Workflow tool in this session)

Executed once through the real Claude Code Workflow tool (plan D7) as
`Workflow({ scriptPath: 'packages/mps-pattern-proof/workflow/ppe-v1.js', args: { mode: 'BOOTSTRAP_RED_ONLY', runStamp:
'20260930T135500Z', baseSha: 'e3f3e4f30e2fc846dc963a12bc74d1fdeddade05', target: { dockerfile: 'Dockerfile', stages:
['production-base', 'builder'] }, evidenceDir: '<session scratchpad>/ppe-v1-run/20260930T135500Z' } })`. The branch
head at that moment was `e3f3e4f3` (the R1 code, before the R2 corrections), which is the run's recorded `baseSha`.

Outcome: four agents (one per phase), no agent error, 85 tool uses, 20.3 min wall clock. The script returned
`stoppedAt: RED_SYNTHESIS, terminal: false`. The RED_SYNTHESIS agent's relay of `ppe-cli run` reported exit 0,
`stoppedAtPhase: RED_SYNTHESIS`, `storedArtifacts: discovery, dependency-graph, decision-gate, red-plan`; both probes,
run by that agent with `--executor auto`, classified `FAIL / LIFECYCLE_SCRIPT_MODULE_NOT_FOUND` with fidelity
`host-npm` (`builder` 39.3 s, `production-base` 33.5 s). The agents' processes carried no `DOCKER_HOST`, so
`docker info` failed and `auto` fell back to the host executor, as designed and as each result file records
(`executorRequested: auto`, `executorUsed: host`). The docker-fidelity results for the same Dockerfile are in §8.

Agent-written artifacts (evidence of the orchestration path, not further evidence about the defect beyond §8):
`discovery.json` — 11 findings, 46 locators (`file_line`, `git_object`, `runtime_result`; the two runtime refs are an
isolated reproduction of the builder install with exactly the stage's file set, exit 1, and a positive control with
`--ignore-scripts`, exit 0, both recorded in `runtime-ledger.json`); `dependency-graph.json` — 41 nodes, 60 edges;
`decision-gate.json` — 10 items, all `MECHANICAL`, each with a derivation citing files at the base; `red-plan.json` —
the two probes with authority `docker-compose.staging.yml:5-8`; `run-state.json` — the four stored artifacts and the
history `DISCOVER → BUILD_GRAPH → DECISION_GATE → RED_SYNTHESIS → stoppedByMode`.

Copied verbatim to `docs/architecture/audits/evidence/ppe-v1/adapter-smoke-run-20260930T135500Z/` (sha256, first 16):

| File                           | sha256             |
| ------------------------------ | ------------------ |
| `discovery.json`               | `4a3fab135412575c` |
| `dependency-graph.json`        | `aebfe95f11fa5b1f` |
| `decision-gate.json`           | `c432e47041567fa6` |
| `red-plan.json`                | `98b15f51e12e531b` |
| `runtime-ledger.json`          | `e72b83b8a477290f` |
| `run-state.json`               | `6f3f198afc3c9a5e` |
| `probe-builder.json`           | `5e56e6cb65f04722` |
| `probe-production-base.json`   | `13e60d69072e183e` |
| `probe-builder.stderr`         | `00ad34bda96c6e70` |
| `probe-production-base.stderr` | `3c32ce5f387c8a23` |

Not copied: three agent scratch files (two temp-directory names and a resolver check script). Caveat: `red-plan.json`,
and therefore the stored red plan inside `run-state.json`, carry the session scratchpad's absolute path as the probes'
`--out` argument, exactly as the agent wrote them.

Independent re-check (routine prompt §4, applied by hand under the corrected code `41ad8001`): `ppe-cli run --dir
<copied dir> --mode BOOTSTRAP_RED_ONLY --repo-root . --run-id 20260930T135500Z --base-sha e3f3e4f3… --out
run-state.routine.json --json` → exit 0, `stoppedAtPhase: RED_SYNTHESIS`, the same four stored artifacts, every
`file_line`, `git_object` and ledger-backed `runtime_result` locator resolved against this checkout; the resulting
`run-state.routine.json` (kept beside the original) is byte-identical to the adapter stage's `run-state.json` (sha256
`6f3f198afc3c9a5e` for both), so the relayed state claim is reproduced by the pure state machine over the same files.
The probe half of the re-check is the `red-probes-r2` table in §8: the same Dockerfile blob, under the corrected code,
on both executors.

## 15. Verification (local, this session)

_Filled in by the packaging commit: prettier / eslint / package tsc / vitest counts, root typecheck and lint error
counts before and after, compliance audits._

## 16. Known limitations, disclosed

- `master-boundary-audit` is red at baseline on seven `packages/mps-lu/tests` files (§0.6).
- `tests/persistence.test.ts` mentions `.put(` in a comment; it contains none of the audited substrings.
- PPE digests use `canonicalizeStrict` (mimers-brunn-core), not `json-canonicalize` (`sha256ContentHash` in
  mps-compliance); they agreed on every sampled body but are not proven equal for all inputs. PPE never mixes them.
- `RepositoryAuthorityResolver` rejects a `repoRoot` of `/` (root-boundary check); real checkouts are unaffected.
- `postgis_ref` locators are unresolvable in V1 by design.
- `.dockerignore` matching supports exact names, directory prefixes and `*`/`**` globs, not character classes;
  `COPY --from` sources outside the derived lineage make a docker probe `BLOCKED`, never `PASS`.
- The install-command predicate and the lifecycle derivation model a bounded grammar (§5, Docker RED probes); every
  shape outside it fails closed as `BLOCKED`, which is by design, and a candidate that moves its install into such a
  shape will need a predicate extension in its own unit before it can be probed.
- On the trusted runner the `devgov-candidate` user cannot open the root-owned execution checkout with git (exit 128,
  "dubious ownership"), so a `git_object` authority would resolve `GIT_UNAVAILABLE` there and `red-probe` records no
  Dockerfile blob locator; none of the unit's GREEN commands depends on `git_object` resolution (R2 F10).

## 17. Non-claims

This unit does **not**: fix or propose a fix for the Dockerfile; invoke a writer or a verifier against the target;
implement or enable `FULL_PATTERN_PROOF`; claim `PROVEN` or promote anything; create a new trust root; modify
`scripts/devgov/devgov.mjs`, `.github/workflows/**`, `governance/devgov/schema/**` or `governance/devgov/invariant-packs/**`;
open a pull request or merge; fire the routine; register the package in `architecture-authority-map.jsonc` (the map
registers authorities, not packages; PPE owns none); resolve the §0.1 commit-identity policy.

## 18. Cold-review outcome

Pending. Nothing in this record is self-approved. Before the push, three adversarial review rounds were run inside the
producing session by reviewer agents that had not written the code (each instructed to refute, with a reproduction
probe per finding): R1 returned 18 findings, all corrected in `e3f3e4f3`; R2 returned 11 findings (F1 the stale record,
F2–F10 code, F11 wording), corrected in `41ad8001` and by this rewrite; R3_OUTCOME. Those are the session's own
reviews and do not count as the cold review this record waits for.

## 19. Finalization rule

This record remains CANDIDATE until the exact candidate SHA receives `DEV-GOV-V0 / trusted-execution = success` for
every declared RED and GREEN command, is merged with a merge commit, and the merge tree is verified equal to the gated
candidate tree. With no independent cold audit, this unit is not asserted PROVEN by this record alone even after the
gate passes. A `PROVEN` record, if any, is a separate file introduced by its own unit.
