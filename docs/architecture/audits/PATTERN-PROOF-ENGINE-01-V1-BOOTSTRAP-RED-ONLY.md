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
protocol/persistence/authority/isolation, `79e506b3` state machine/replay/fixtures/Docker probes, then the adapter and
CLI commit and the packaging commit that introduces this record (a commit cannot contain its own SHA).

## 5. The engine, module by module

- **Artifact protocol** (`src/evidence.ts`, `src/artifacts.ts`, `src/validators.ts`, `src/schemas.ts`,
  `src/schema-subset.ts`). Every BOOTSTRAP §2 interface, camelCase, readonly, exactly the frozen enums
  (`EvidenceGround` uses `WRITER_TEST_REGRESSION`, not `_ONLY`). Hand-rolled validators return deep-frozen copies of
  present keys only and enforce: non-empty evidence on findings, edges, probes, compliance and claims; dangling graph
  edges rejected; `MECHANICAL` requires `derivation`, other classifications require `blockingReason` (presence of the
  other field is not rejected, per the frozen wording); unique probe ids each with `authorityEvidence`; candidate shas
  40-hex, a claimed `PASS` rejected when compliance evidence names a path outside `allowedPaths`; `allowedPaths` may
  never cover proof-policy paths (`packages/mps-pattern-proof`, `governance/devgov`, `scripts/audit`,
  `docs/architecture/PATTERN-PROOF-ENGINE-01-*`, `.claude`); `materialInvariant` requires `VERIFIER_OWNED_PROBE` or
  `INDEPENDENT_CODE_DERIVATION`; `NOT_PROVEN` requires `reasonCode`; `ACCEPT`/`FALSIFIED` require `isolationEvidence`;
  `InputManifest` secret material rejected by value (PEM headers, `://user:pass@`, JWT shape, long hex/base64 blobs
  that are not `sha256:` fingerprints or `ed25519:` key ids). The JSON schemas for the adapter use only
  `type/properties/required/items/enum/minItems/additionalProperties/description`; a test walks every schema and
  rejects any other keyword; every fixture passes both its validator and its schema.
- **Identity and persistence** (`src/identity.ts`, `src/persistence.ts`): `sha256:<hex>` over canonical bytes; ids
  `ppe:<kind>:<hex>`; artifact types `PPE_<KIND>`; `loadArtifact` recomputes the hash and fails closed on mismatch.
- **Authority resolution** (`src/authority.ts`, frozen §8): `InMemoryAuthorityResolver` for fixtures and
  `RepositoryAuthorityResolver` for checkouts — `file_line` in the forms `path:N`, `path:N-M`, `path:N,M,…` (every named
  line must exist, no traversal outside the root), `git_object` via `git cat-file -e` (no shell), `cas_artifact` via the
  store, `signed_attestation` via a verify-only provider with signer binding, `runtime_result` via an explicit ledger,
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
  entered and every later transition throws `PPE_RUN_STOPPED`. Storage rule: an artifact is stored iff the machine
  admitted it (a gate that stops the run is stored; an unauthorised red plan, an inadmissible candidate or a
  verification whose isolation did not resolve is not).
- **Isolation proof** (`src/isolation.ts`, frozen §4, §13): `VerifierInputBundle` is a closed key set at every level
  (repository identity, candidate identity + diff ref, frozen-spec locators, red-plan digest, declared runtime
  inputs); any undeclared key such as `writerTranscript` is rejected. The orchestrator signer attests
  `digestOf(bundle)` with predicate type `ppe/verifier-input-bundle/v1` and the sorted declared keys; the verifier
  context is constructible only with a verify-only provider (runtime rejection of any `sign` member), verifies the
  attestation, binds the signer key id, re-derives the bundle digest and yields two `isolationEvidence` locators
  (`signed_attestation` = the attestation subject binding, `runtime_result` = `verifier-context:<digest>`). The verifier
  prompt is a deterministic function of the declared inputs only. What this proves and does not prove is stated in §9.
- **Docker RED probes** (`src/docker/*`, `scripts/red-probe.ts`, BOOTSTRAP §5.4): solution-neutral by construction —
  the stage prefix (lineage, instructions up to and including the first `npm ci|install|i` RUN of the target stage,
  plain COPY/ADD sources excluding `--from`, WORKDIR, ENV, ARG) is derived from the candidate Dockerfile text, and the
  outcome is classified from output text signatures, never from exit codes alone (npm exits 1 for both RED and network
  failure; docker exits 1 for any inner failure). `FAIL` requires the lifecycle banner, `Cannot find module` on a
  lifecycle-script path relative to the derived WORKDIR, `code: 'MODULE_NOT_FOUND'` and `npm error command sh -c
<exact script string>`; `BLOCKED` covers daemon/socket/network/TLS failures, timeouts and an install step that never
  started, and is evaluated before `FAIL`; `PASS` is a completed install step or a failure with none of those
  signatures. Two executors: `docker-stage-prefix` (real `docker build --network host --progress plain --no-cache` of
  the derived prefix with the declared CA prelude) and `host-npm` (the derived context materialised in a temp dir, the
  derived install command run there). `auto` prefers docker when `docker info` succeeds. Exit codes 0 PASS / 1 FAIL /
  2 BLOCKED. The two frozen probes are embedded verbatim (`src/docker/red-plan-probes.ts`).
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
| `NOT_PROVEN`              | verifier probe runner reports `available: false` (docker daemon unreachable) → verdict `NOT_PROVEN`, `reasonCode: VERIFICATION_BLOCKED`; never `ACCEPT`/`FALSIFIED`                                                                                                                                                                                                                                                                                                                                                                                              | —                            |
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

## 9. Isolation proof — what it proves

Proven by `tests/isolation.test.ts`: a verifier context cannot be constructed with a signing-capable provider; a bundle
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

_Filled in by the packaging commit after wave 3 lands (adapter structure, agents, fail-closed rules, drift test,
`ppe-cli` commands and the executed `ppe-cli run` over the frozen artifacts)._

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

## 17. Non-claims

This unit does **not**: fix or propose a fix for the Dockerfile; invoke a writer or a verifier against the target;
implement or enable `FULL_PATTERN_PROOF`; claim `PROVEN` or promote anything; create a new trust root; modify
`scripts/devgov/devgov.mjs`, `.github/workflows/**`, `governance/devgov/schema/**` or `governance/devgov/invariant-packs/**`;
open a pull request or merge; fire the routine; register the package in `architecture-authority-map.jsonc` (the map
registers authorities, not packages; PPE owns none); resolve the §0.1 commit-identity policy.

## 18. Cold-review outcome

Pending. Nothing in this record is self-approved.

## 19. Finalization rule

This record remains CANDIDATE until the exact candidate SHA receives `DEV-GOV-V0 / trusted-execution = success` for
every declared RED and GREEN command, is merged with a merge commit, and the merge tree is verified equal to the gated
candidate tree. With no independent cold audit, this unit is not asserted PROVEN by this record alone even after the
gate passes. A `PROVEN` record, if any, is a separate file introduced by its own unit.
