# Workspace Lifecycle Controller V1 — vocabulary mapping

**Unit:** WORKSPACE-LIFECYCLE-CONTROLLER-V1
**Canonical base:** `0d7b2bd566b0d5f7c9d27d645c941acd66cb1e85`
**Normative authority:** spec 1.1 A30 and Del D item 18 — a written vocabulary mapping delivered
with a justification for every deviation. Del G fixes the row set.
**Machine-readable form:** `packages/mps-workspace-observer/contracts/vocabulary-mapping-v1.json`
(`schemaId` `WORKSPACE_LIFECYCLE_V1_VOCABULARY_MAPPING`, version 1.0.0). The two files carry the
same rows; `packages/mps-workspace-harness/src/VocabularyMapping.test.ts` fails if they drift.

**Extends, does not restate.** Phase 0 delivered its own mapping (`PHASE0_VOCABULARY_MAPPING_V1`,
`vocabularyMappingDigest` `62e9defd99ee4825f79d0da026b7ff30fb985fd2c70729039ae19c9c0dd95e20`,
recomputed byte-identically from the frozen mirror while writing this document). Its rows record
what Phase 0 did, which for most concepts was to introduce nothing. These rows record what V1
actually built against each existing contract, and why each divergence exists. A Phase 0 ruling
that still holds is not repeated — it is extended with the V1 construction that now depends on it.

Every evidence claim below names a file that was opened at the canonical base and the real field
names found in it. A claim with no such file is not a row.

| Workspace concept | Ruling |
|---|---|
| unitId, baseSha, candidateSha, branch, scope | REUSE_EXACT_SEMANTICS |
| unit lifecycle and terminality | OBSERVE_ONLY_NO_SECOND_STATE_MACHINE |
| IMPLEMENTER / VERIFIER lease evidence | OBSERVE_EXISTING |
| future cleanup lease | V2_SPECIALIZATION_ONLY |
| workspace blockers and findings | DO_NOT_REUSE_THE_TYPE |
| identityDigest versus CAS content_hash | SEPARATE_IDENTITY_DOMAINS_NEVER_ALIASED |
| canonicalization primitive and domains | REUSE_PHASE0_FROZEN_PRIMITIVE_NEVER_REPLACE |
| reconciliation evidence | NO_REGISTRY_AT_BASE_DEFAULT_NONE |
| Observer to Classifier boundary | MECHANISED_IN_THIS_UNIT |
| authoritative acceptance | REUSE_THE_DEVGOV_EXTERNAL_AUTHORITY_PATTERN |
| observation states versus capture coverage codes versus transport failure codes | THREE_DISTINCT_VOCABULARIES_NEVER_COLLAPSED |
| artifact schemaId versus canonicalization domain schemaId | DISTINCT_NAMESPACES_NOT_HARMONISED |

---

### unitId, baseSha, candidateSha, branch, scope

**Ruling:** REUSE_EXACT_SEMANTICS

**Existing contract.** `MultiAgentUnitState` in
`packages/mps-control-plane/src/multi-agent/types.ts`, with the persisted form in
`governance/control-plane/schema/unit-state-v1.schema.json` (`schema_version`
`multi-agent-unit-state-v1`).

**Evidence.** The type declares `readonly unitId`, `unitDefinitionHash`, `baseSha`,
`candidateSha?`, `branch`, `scope: readonly string[]`, `proofContractHash?`,
`controllerContractVersion: 'multi-agent-control-plane-v1'`, `state`, `revision` and `updatedAt`.
The schema requires `unit_id`, `unit_definition_hash`, `base_sha`, `branch`, `scope`, `state`,
`controller_contract_version`, `revision` and `updated_at`, with `additionalProperties: false` and
`base_sha` / `candidate_sha` pinned to `^[0-9a-f]{40}$`. All five named concepts exist there under
those names with those meanings, so V1 borrows the meanings and defines none of its own.

**Deviation.** V1 neither constructs, persists nor imports `MultiAgentUnitState`: grepping
`MultiAgentUnitState` and `unitState` over `packages/mps-workspace-observer/src` and
`packages/mps-workspace-harness/src` returns nothing. The snapshot's per-workspace key is `caseId`,
derived from the observed path by `PathPolicy.caseIdFromComparisonKey`; it is an observation key
and is never equated with a `unitId`. The TypeScript type also omits `active_lineage_id` and
`supersedes_candidate_sha`, which the schema carries — V1 uses neither, as Phase 0 also recorded.

**V1 impact.** The Observer records what a workspace *claims* about governed units —
`WorkspaceObservation.declaredUnitFiles`, the sorted `*.json` entry names under that checkout's
`governance/devgov/units` (family R-W-05) — and keeps it apart from the canonical registry's claim
(`RepositoryObservation.canonicalUnitFiles`, R-G-08/R-G-09). A23 requires each source's claim
retained separately, because when two sources disagree the disagreement *is* the finding. Nothing
merges them into a unit view, and no unit state is derived from either.

### unit lifecycle and terminality

**Ruling:** OBSERVE_ONLY_NO_SECOND_STATE_MACHINE

**Existing contract.** `MultiAgentState` in the same `types.ts`, with the transition table
`governance/control-plane/state-transitions-v1.json`.

**Evidence.** The union has 20 values and the transition table keys all 20. Exactly three have an
empty successor list, and that empty list is what terminality means here:

```text
CLOSED       []
CANCELLED    []
SUPERSEDED   []
PROMOTED     ["CLOSED"]          <- NOT terminal
BLOCKED_*    non-empty           <- recoverable, not terminal
```

`PROMOTED` is the state most likely to be mistaken for the end, and it is not: promotion is
followed by closure.

**Deviation.** Terminality is implicit in an empty successor list and no `isTerminal` helper exists
at the base, so any reader who wants the terminal set has to compute it from the table. That is
precisely how the plausible-but-false reading survives, which is why the set is written out here.

**V1 impact.** V1 defines no `workspaceLifecycleState` and no second machine. Unit state is also
not observable on this machine at all: the frozen command surface's `knownNonSources` records that
no persisted unit-state registry path is defined at the base — `FileDurableControlPlaneStore.ts`
persists units, events, accepted agent runs and the outbox, and unit state reaches no registry file
— so the snapshot carries no unit-state field rather than a defaulted one. `REMOVED` is likewise
not a lifecycle value anywhere in V1: removal is an operation, not a state (A14).

### IMPLEMENTER / VERIFIER lease evidence

**Ruling:** OBSERVE_EXISTING

**Existing contract.** `AgentLease` in `types.ts` and
`governance/control-plane/schema/lease-v1.schema.json` (`schema_version` `multi-agent-lease-v1`).

**Evidence.** `AgentLease` carries `leaseId`, `unitId`, `role: 'IMPLEMENTER' | 'VERIFIER'`,
`holder`, `scope`, `candidateSha?`, `issuedAt`, `expiresAt`, `heartbeatAt` and
`status: 'ACTIVE' | 'RELEASED' | 'EXPIRED' | 'REVOKED'`. The schema repeats the same fields in
snake_case with `additionalProperties: false` and the same two-value `role` enum. Phase 0's
`knownNonSources` records that at the frozen base leases exist only in `InMemoryLeaseRegistry.ts`,
that `FileDurableControlPlaneStore.ts` has no leases section, and that no non-test code
instantiates a durable store with a path.

**Deviation.** No lease is observable at the frozen base. No request family in the frozen command
surface observes one, so the corpus contains no lease evidence at all.

**V1 impact.** V1 emits **no lease field**: a case-insensitive grep for `lease` over
`packages/mps-workspace-observer/src` returns nothing. Not `leaseActive: false`, not `lease: null`,
not an `OBSERVED` record with an empty value. A snapshot field whose raw input is absent from the
same artifact violates A2, and asserting a lease state over an observation window in which it was
never read violates A16. Absence is encoded by omission — which is also what keeps the identity
digest reproducible, since the pinned canonicaliser digests an omitted field and an explicit `null`
differently.

### future cleanup lease

**Ruling:** V2_SPECIALIZATION_ONLY

**Existing contract.** The existing Control Plane lease protocol, which has no cleanup role.

**Evidence.** The two role surfaces, quoted as found:

```ts
export type MultiAgentRole =
  | "IMPLEMENTER"
  | "VERIFIER"
  | "CONTROLLER"
  | "SIGNER"
  | "GATE"
  | "PROMOTER";

// AgentLease, strictly narrower:
readonly role: "IMPLEMENTER" | "VERIFIER";
```

`lease-v1.schema.json` repeats `"role": { "enum": ["IMPLEMENTER", "VERIFIER"] }` with
`additionalProperties: false`. There is no `CLEANUP` in any of the three surfaces.

**Deviation.** None taken. A cleanup role would have to be added to the role union, to
`AgentLease.role` and to the JSON enum simultaneously, and the registry's overlap logic on
`unitId + role + scope` extended to cover it. V1 does none of that.

**V1 impact.** A14's exclusive cleanup lease is documented as a future specialization of `lease-v1`,
never as evidence that `CLEANUP` is already a valid role. V1 has no destruction capability at all:
its terminal output is an evidence-backed disposition, and the compare-and-swap that would consume
one under a lease belongs to V2.

### workspace blockers and findings

**Ruling:** DO_NOT_REUSE_THE_TYPE

**Existing contract.** `AgentFinding` in `types.ts`, enforced again by
`packages/mps-control-plane/src/multi-agent/AgentHandoffCodec.ts` and by
`governance/control-plane/schema/agent-handoff-v1.schema.json`.

**Evidence.** `AgentFinding` is `{ id, severity: 'BLOCKING' | 'NON_BLOCKING', classification,
message }` with the severity field non-optional. The codec re-validates it at runtime and throws
`AgentHandoffValidationError` when it is missing or outside the two values. The handoff schema
lists it among the required properties of each `findings[]` item, with `additionalProperties:
false`. Three independent enforcement points, all demanding the one field the workspace model must
not have.

**Deviation — and this is the row that has to survive review.** The two-valued severity on
`AgentFinding` is roughly isomorphic to the `blockers[]` / `findings[]` split, so folding the
workspace model into the existing type looks free, and someone will eventually propose exactly
that. It is not free. In the workspace domain blocking force is a function of *(blocker,
operation)* through `blockerScope`: the same fact blocks one operation and is inert for another. An
unattributed stash blocks operations capable of destroying or orphaning it, including repository
and ref destruction, and does **not** block an independently proven-safe `WORKTREE_REMOVAL` (A22),
because `git worktree remove` does not delete `refs/stash`. A scalar severity stored on the record
is therefore wrong-by-construction the moment a new scope appears — which is what V2 does when it
adds cleanup operations.

**V1 impact.** No file under `packages/mps-workspace-observer` or `packages/mps-workspace-harness`
imports `AgentFinding`. Blocking weight is derived in the report layer as
`effectiveSeverity(blockerCode, operation)` under `policyVersion`, where the classifier never sees
it and therefore cannot be trimmed against a threshold. The artifact carries no severity and no
confidence field of any kind.

### identityDigest versus CAS content_hash

**Ruling:** SEPARATE_IDENTITY_DOMAINS_NEVER_ALIASED

**Existing contract.** `CanonicalArtifact` and `content_hash` in `packages/mps-core/src/types.ts`,
`packages/mps-core/src/identity.ts` and `packages/mps-core/src/ContentAddressedArtifactStore.ts`.

**Evidence.** `CanonicalArtifact` is `{ artifact_id, artifact_type, content_hash: HashDescriptor,
signature }`. `ArtifactIdentityBuilder.build` serializes the whole envelope, hashes those bytes,
signs the hash, and derives `artifact_id` from `content_hash`; `ContentAddressedArtifactStore.put`
destructures `{ content_hash, signature, artifact_id }` off the artifact and re-hashes the
remaining envelope, comparing algorithm and digest. The repository's hasher is BLAKE3
(`packages/mps-canonical/src/CanonicalHasher.ts` uses `createBLAKE3` from `hash-wasm` and reports
`algorithm: "blake3"`). `identityDigest` is a lowercase-hex SHA-256 over the `SNAPSHOT_V1`-framed
canonical bytes of the digest-eligible projection (`SnapshotDigest.ts`).

**Deviation.** V1 keeps the two apart by construction rather than by convention — different hash
function, different framing, different input set — so they could not collide even if a later reader
tried to substitute one for the other.

**V1 impact, written out because it is the whole reason for the rule.** `content_hash` covers the
entire envelope including provenance and timestamps, exactly what A9 keeps out of `identityDigest`:
`observedAt`, per-request durations, the four versions and `transcriptRef` all live in
`SnapshotMetadata`, outside the digest. Suppose V2's compare-and-swap condition used `content_hash`.
Then two observations of an *untouched* machine would always produce different values, the
condition would never hold, nothing could ever be deleted — and the predictable repair for a
condition that always fails is to loosen it or comment it out. The condition is the safety
property, so loosening it is the failure. The CAS condition uses `identityDigest`. A snapshot
persisted through mps-core may legitimately carry both values side by side; they are never aliased.

### canonicalization primitive and domains

**Ruling:** REUSE_PHASE0_FROZEN_PRIMITIVE_NEVER_REPLACE

**Existing contract.** `@miljobeslut/mps-canonical` 0.1.0 `DefaultCanonicalJson`, frozen by Phase 0
in `contracts/canonicalizer-contract-v1.json` (`canonicalizerContractDigest`
`577f47aec266eb969e0edf20ede3b8cc3b8cd4b75f89f2cd4fb7981a45096433`).

**Evidence.** `primitivePin` pins the package name, `packageVersion` 0.1.0 and the SHA-256 of seven
source files at the canonical base. The framing is

```text
preimage = uint32be(len(schemaId)) || schemaId || uint32be(len(payload)) || payload
```

with a lowercase-hex SHA-256 digest, and `domains` declares exactly two: `CAPTURE_BUNDLE_V1` (owner
Phase 0, FROZEN) and `SNAPSHOT_V1` (owner V1, RESERVED_FROZEN, may reuse but may not replace the
primitive or the framing). `CanonicalDigest.ts` imports `DefaultCanonicalJson` and adds only the
framing and the payload restrictions; `SnapshotDigest.ts` frames the identity digest under
`DOMAINS.SNAPSHOT_V1`.

**Deviation.** V1 adds structural payload restrictions P1–P7 that the primitive itself does not
enforce — no `undefined`, finite safe integers, well-formed strings, ASCII non-integer-like keys,
no `Date`/binary/`Map`/`Set`, no cycles — and *reports* non-NFC strings rather than normalising
them. These are preconditions on what may be handed to the primitive, not changes to its byte
behaviour; each removes a case where two conforming re-implementations could disagree on the
produced bytes, and normalising a path silently instead of stopping would turn every replay of that
case into a corpus miss. V1 also never mints a `CAPTURE_BUNDLE_V1` digest: that domain is accepted
only so the harness can recompute a frozen `captureDigest` during load-time verification.

**V1 impact.** The length prefixes make a preimage in one domain unable to be a prefix of, or equal
to, one in another, so the two digest domains cannot be confused. A behavioural change in the
pinned canonicaliser requires a new `schemaId` (`SNAPSHOT_V2`), never a patch bump: without that
rule the digests drift at the next upgrade and every frozen `captureDigest` becomes invalid with
nobody noticing.

### reconciliation evidence

**Ruling:** NO_REGISTRY_AT_BASE_DEFAULT_NONE

**Existing contract.** A17's `contentEvidence` vocabulary `NONE | PATCH_ID_MATCH |
REGISTERED_RECONCILIATION(ref)`; no general workspace reconciliation registry exists in the
codebase.

**Evidence.** The frozen command surface's `knownNonSources` records that the identifier
`REGISTERED_RECONCILIATION` appears in no file of the base tree, and that the only reconciliation
evidence available is topological and patch-equivalence evidence from families R-G-12 through
R-G-18. `packages/mps-workspace-observer/src/snapshot/types.ts` declares

```ts
export type ContentEvidence = 'NONE' | 'PATCH_ID_MATCH';
```

so the third value is not expressible. `correlate.ts` sets `PATCH_ID_MATCH` only when
`ancestry.allUniqueCommitsPatchEquivalent === true`, which `git cherry` proved, and `NONE`
otherwise.

**Deviation.** The spec's vocabulary has three values; V1's type has two. Deliberate: a value for
which no evidence source exists is an invitation to emit it without evidence, and the emitted value
would then claim an equivalence nothing proved.

**V1 impact.** Content evidence never shadows topology. `graphRelation` stays a separate field, is
our reading rather than the world's fact, and is excluded from the identity digest by the A10
inclusion test. Branch reuse therefore falls closed instead of being absorbed into an assumed
equivalence. Introducing `REGISTERED_RECONCILIATION` later is a new contract version and a new
corpus, not an Observer fallback.

### Observer to Classifier boundary

**Ruling:** MECHANISED_IN_THIS_UNIT

**Existing contract.** None found. A2 records that re-con found no enforcement in the control-plane
package, so the mechanism had to be built in this unit.

**Evidence.** Three mechanisms exist in the tree:

1. **Package manifests.** `packages/mps-workspace-observer/package.json` depends only on
   `@miljobeslut/mps-canonical`, while `packages/mps-workspace-harness/package.json` depends on the
   observer *and* the classifier. The dependency edge runs one way, so the observer cannot resolve
   policy code at all.
2. **Observer lint scope.** `eslint.config.mjs` scopes a `no-restricted-imports` rule to
   `packages/mps-workspace-observer/**/*.ts`, banning `@miljobeslut/mps-workspace-classifier`,
   `@miljobeslut/mps-workspace-harness`, `@miljobeslut/mps-policy` and their path forms.
3. **Classifier lint scope.** The same file scopes the other half to
   `packages/mps-workspace-classifier/**/*.ts`, banning `node:fs`, `child_process`, `node:net`,
   `node:http`/`node:https` and the harness, plus `no-restricted-globals` on `Date` and
   `no-restricted-properties` on `Math.random` — no disk, no network, no clock, no nondeterminism.

4. **Transitive import-graph test.** `packages/mps-workspace-observer/src/boundary/ObserverBoundary.test.ts`
   walks every non-test module reachable from the observer's sources — 12 roots, 25 reachable
   modules, 0 unresolved specifiers — and asserts that none resolves into the classifier, the
   harness or a policy package. It also asserts that no observer source line names a decision
   identifier, that the package manifest declares no such dependency, and that the artifact types
   carry no `severity` or `confidence` field.

5. **Config-level resolution guard.** `packages/mps-workspace-harness/src/PackageIntegrity.test.ts`
   asserts that each package's `tsconfig.json` `paths` equals its `package.json` `dependencies`
   exactly, in both directions, and that the observer's project resolves neither the classifier nor
   the harness. This one was added by the repair of candidate `32d9a170`: making the harness
   compile package-locally required adding `paths`, and the obvious shortcut — adding the same
   `paths` to every package — would have widened the observer's resolution past the boundary while
   every other mechanism stayed green.

   The import-graph test is the mechanism that matters most, because it is the only one that cannot
   be switched off from inside the file it governs: a package manifest can be edited and a lint rule
   can be silenced with a disable comment, but a test that follows the import graph fails the build
   either way. It did not exist when this mapping was first written and was recorded here as an open
   gap; it exists now, and the gap is closed.

**V1 impact.** The boundary is at policy *loading*, not at derivation. Derived readings stay in the
snapshot — `graphRelation`, `lockFiles`, `inProgressMarkers`, `contentEvidence` — because their raw
inputs sit in the same artifact (`metadataEntryNames`, `mainWorktreeEntryNames`, the ancestry
proofs), which is the condition A2 states. What the observer may not do is import the vocabulary
that decides what those readings mean.

### authoritative acceptance

**Ruling:** REUSE_THE_DEVGOV_EXTERNAL_AUTHORITY_PATTERN

**Existing contract.** The DEV-GOV external-authority pattern: `governance/devgov/units/README.md`
and `governance/devgov/schema/dev-gov-v1-unit-definition.schema.json`.

**Evidence.** The README states verbatim that persisted local evidence is provenance, not execution
authority. The unit-definition schema requires `role` (`producer` | `verifier`) and `mode`
(`writer` | `read_only`) as independent required properties, so a read-only producer is
schema-valid without inventing a role. In V1 the pattern is realised by `AuthorityBinding.ts`,
which recomputes eight digests from the bytes on disk rather than copying them out of the manifest,
and raises the single code `AUTHORITY_DIGEST_MISMATCH`. `REQUIRED_BINDINGS` names the expectations,
capture manifest, command surface, canonicalizer contract, replay contract, redaction policy,
capture-bundle schema and vocabulary mapping.

**Deviation.** The spec names four required digests; Phase 0 requires eight, because each of the
four extra files can silently change what counts as passing. One of the eight is the *Phase 0*
vocabulary mapping, digest `62e9defd99ee4825f79d0da026b7ff30fb985fd2c70729039ae19c9c0dd95e20`,
which recomputes byte-identically from the frozen mirror. This V1 mapping is **not** one of the
eight; it is authority-bound only if the acceptance report or a later manifest binds it.

**V1 impact.** Every local run of the harness — including the run that proved this document —
is diagnostic and carries no acceptance authority: anything executing in the implementer's own
worktree is under the implementer's control, harness and facit reference included. What the binding
buys is visibility: an acceptance report prints the digests actually used, so substituting a corpus
or an expectation becomes a recorded deviation instead of an invisible event.

### observation states versus capture coverage codes versus transport failure codes

**Ruling:** THREE_DISTINCT_VOCABULARIES_NEVER_COLLAPSED

**Existing contract.** A3's observation states, the frozen command surface's
`coverageReasonCodes`, and the replay contract's `failureCodes`. Three vocabularies, three
subjects.

**Evidence.**

```text
this run          OBSERVED | UNKNOWN | NOT_ATTEMPTED        ObservationLedger.ts
                  + NotAttemptedReason (5)  + UnknownReason (7)
the corpus        CANONICAL_SHA_UNAVAILABLE | PREREQUISITE_FAILED | EXPANSION_EMPTY
                                                            command surface, capture time
the transport     REQUEST_OUTSIDE_COMMAND_SURFACE | NOT_IN_CORPUS |
                  NOT_CAPTURED_BY_PRECONDITION              replay-transport-contract-v1.json
```

The replay contract gives each failure code `raisedAs: "out of band"` and
`neverMappedTo: ["UNKNOWN", "NOT_ATTEMPTED", "BLOCKED"]`; all three are implemented as thrown error
classes in `ReplayTransport.ts` and `CommandSurface.ts`, never as returned values.

**Deviation.** Two capture-time coverage codes share a spelling with observer `NotAttemptedReason`
values (`CANONICAL_SHA_UNAVAILABLE`, `EXPANSION_EMPTY`) while having a different subject: one says
the capture never took this measurement, the other says this run chose not to. Identical names
across different domains are what invites a merge, so the collision is recorded here rather than
tidied away by renaming.

**V1 impact.** Collapsing any pair lets a data-starved observer look correctly fail-closed.
`NOT_IN_CORPUS` folded into `UNKNOWN` becomes `BLOCKED`, and `BLOCKED` is indistinguishable from a
genuinely blocked workspace: the run then satisfies SAFETY while having observed nothing, and the
corpus gap never surfaces. So the transport throws, the run aborts before any
`WorkspaceSnapshotArtifact` exists, and the classifier is never invoked. `UNKNOWN` and
`NOT_ATTEMPTED` stay apart for the weaker but related reason — both fall closed, but a report that
cannot say which one it hit cannot say whether the world refused to answer or nobody asked.

### artifact schemaId versus canonicalization domain schemaId

**Ruling:** DISTINCT_NAMESPACES_NOT_HARMONISED

**Existing contract.** `canonicalizer-contract-v1.json` `framing.schemaId` (the digest domain)
versus the `schemaId` field carried inside the artifact payload.

**Evidence.** `packages/mps-workspace-observer/src/snapshot/types.ts` sets
`SNAPSHOT_SCHEMA_ID = 'WORKSPACE_SNAPSHOT_V1'` and the artifact carries it as a payload field, which
the digest inclusion table includes. `SnapshotDigest.ts` frames the preimage under
`DOMAINS.SNAPSHOT_V1`, the domain name Phase 0 froze. The two strings differ deliberately.

**Deviation.** Two fields named `schemaId` with different value spaces, one inside the payload and
one in the framing. Recorded because the natural tidy-up is to make them equal.

**V1 impact.** Renaming either to match the other would change every identity-digest preimage, or
make the artifact claim a domain name it does not own. A domain change is a new domain id and a new
contract version; it is never a rename.

---

## Verification note

Each row was checked against the base tree in `C:\wt-workspace-lifecycle-controller-v1` at
`0d7b2bd566b0d5f7c9d27d645c941acd66cb1e85`, and against the frozen Phase 0 authority mirror, which
was read but never written. Two claims were first written here as open gaps because the files they
depend on did not exist yet. Both have since been closed, and the closure is recorded rather than
quietly edited away:

- the transitive import-graph test now exists at
  `packages/mps-workspace-observer/src/boundary/ObserverBoundary.test.ts` and is the third
  independent enforcement of the Observer/Classifier boundary;
- `WorkspaceBlocker` and `WorkspaceFinding` are now defined in
  `packages/mps-workspace-classifier/src/types.ts`, neither carries a `severity` or `confidence`
  field, and operational weighting lives in `reporting.ts` as `effectiveSeverity(code, operation)`
  where the classifier cannot read it. The negative half of the row still holds: nothing under
  `packages/mps-workspace-*` imports `AgentFinding`.
