# Ingest — Negative Boundary Inventory

Status: Inventory. No implementation.
Owner: Data Governance Domain
Purpose: establish, for each negative ingest case, which layer owns the barrier
and whether that barrier exists in production code.

## The rule this inventory serves

> Every negative test must strike a real enforcement boundary in production
> code. A test may never itself create the boundary it claims to verify.

This is the lesson from ORCH-007. The state machine had declared `QUARANTINED`
terminal since it was written, and a test asserting that the state machine
rejects an illegal transition would have passed. Execution never carried the
verdict out: the exception travelled up the call stack and the checkpoint kept
claiming the state the run had before the violation. The barrier existed in a
class; it did not exist on the path.

An inventory is therefore not a list of names. For each case it must answer
where the barrier sits, whether code reaches it, and who owns it.

## Scope correction

The eight negative cases are the ones originally specified. Four
quarantine-related cases were proven in passing by `091cbf1` and are recorded
separately at the end; they are additional coverage, not substitutes. Cases 5
through 8 of the original list remain in force and are inventoried here.

---

## The eight original cases

### 1. Unknown source → stop

| | |
| :-- | :-- |
| Enforcement point | Source admission |
| Exists | **No** |
| Owner | Undefined |

`source_authority` is a free string supplied by the caller and copied into the
manifest without inspection:

```90:123:scripts/import/utils/harvesting.ts
  source_authority: string;
```

There is no registry, no allowlist and no validation. More importantly the
field exists only under `scripts/`, on the ungoverned path. The governed
package has no concept of a source at all: `HarvestExecutionRequest` carries a
`dataset_ref` and an `execution_id`, and never asks where the bytes came from.

An unknown source is therefore not rejected; it is not a question the governed
pipeline currently asks.

**Open question.** Who may authorise that observed raw material passes from
Loke to verified evidence? Until that is answered, `type SourceAuthority =
string` with validation around it would encode the absence of an answer rather
than an answer.

### 2. Policy violation → stop

| | |
| :-- | :-- |
| Enforcement point | Ingest policy gate |
| Exists | **No** |
| Owner | Undefined |

Nothing on the governed path evaluates fetch policy — robots, rate, licence,
permitted URL space.

**Naming hazard.** `mps-retrieval-governance` already owns `RetrievalPolicy`,
but that governs which evidence may be retrieved for a decision. It is a
different axis from which external material may be fetched. Reusing the name
for ingest would reproduce exactly the collision that `CanonicalArtifact`
caused across four packages. The ingest-side concept needs its own name.

### 3. Tampered payload → stop

| | |
| :-- | :-- |
| Enforcement point | CAS read integrity |
| Exists | **Mechanism yes, enforcement no** |
| Owner | CAS boundary (`mimers-brunn-core`) |

The CAS can detect tampering. `FileCASRepository.getBytes` recomputes the
digest and raises `CASIntegrityError`, and `verifyStoredObject`,
`verifyDescriptor` and `quarantineObject` all exist and work.

But verification is opt-in and defaults to off:

```225:252:packages/mimers-brunn-core/src/cas/FileCASRepository.ts
  async getBytes(hash: string, options?: { verifyHash?: boolean }): Promise<Uint8Array | null> {
```

Every caller that passes `verifyHash: true` is a recovery or external-proof
path — `IntegrityVerifier`, `SystemRecovery`, `verifyPromotionAgainstCas`,
`prove-external-verify`. No ordinary read enables it, and no ingest code enables
it. Tamper detection is currently a parameter, not a boundary.

A second point matters here. `assertContentReferenceMatches` compares two
references to each other — id, algorithm, digest, schema — and never compares a
reference to bytes:

```44:51:packages/mps-core/src/references.ts
  if (
    actual.id !== expected.id ||
    actual.content_hash.algorithm !== expected.content_hash.algorithm ||
    actual.content_hash.digest !== expected.content_hash.digest ||
    schemaMismatch
  ) {
```

It detects two references disagreeing. It cannot detect content that changed
under a reference that still agrees with itself. Reference consistency and
content integrity are different properties, and only the first is enforced.

### 4. Failed derivation → no DocumentArtifact

| | |
| :-- | :-- |
| Enforcement point | Derivation gate |
| Exists | **No** |
| Owner | Undefined |

`RawSourceArtifact` and `DocumentArtifact` do not exist as types. Derivation is
ad hoc JSON.

The adjacent behaviour that does exist is verification failure: `runVerification`
catches and quarantines. That is a different stage, and reusing it would mean
claiming derivation is governed when only verification is.

### 5. Missing approval → no CAS publication

| | |
| :-- | :-- |
| Enforcement point | ImportGate |
| Exists | **Yes** |
| Owner | `mps-data-governance` |

`ImportGate.evaluate` blocks with `IMPORT_GATE_MISSING_APPROVAL` when no
approval artifact is present, and blocks separately when the approval does not
match the manifest presented for import, or when the decision is not
`APPROVED`. The orchestrator maps `BLOCK_IMPORT` to `BLOCKED` and never reaches
projection.

**Resolved by `26be14a`.** The gate was unreachable for two reasons, and the
second was worse than the type error it presented as. `ArtifactRepository` did
not merely resolve to the wrong path: `mps-artifact-store` exports an interface
of that name which is a read facade with no write side, so the port the gate
needed did not exist anywhere. It now owns a narrow `ImportGateEvidenceStore`.

The inline serializer was `JSON.stringify(obj, Object.keys(obj).sort())`, on the
assumption that the second argument sorts keys. It is a replacer allowlist,
applied recursively, so `manifest_ref` serialized as `{}` and the signed
evidence was blind to which manifest had been gated — two different datasets
blocked for the same reason produced the same content hash and signature. The
serializer is now injected, and a regression test gates two manifests and
asserts their evidence hashes differ.

### 6. Altered artifact → replay does not verify

| | |
| :-- | :-- |
| Enforcement point | Replay integrity |
| Exists | **Partially — wrong property** |
| Owner | Contested |

`ReplayEngine` in `mps-data-governance` validates lineage consistency: which
references may be present in which state, approval without verification,
projection without gate evidence. It never verifies a content hash. It detects
an inconsistent state graph, not an altered artifact.

Real content verification exists in `mimers-brunn-core/src/recovery/IntegrityVerifier.ts`,
which is a separate engine with no connection to the ingest replay path.

**Open question.** Which replay engine is normative for ingest. Two replay
implementations with different guarantees is the same split the artifact types
just had.

### 7. External source unavailable → historical replay still works

| | |
| :-- | :-- |
| Enforcement point | Replay purity |
| Exists | **Yes, structurally** |
| Owner | `mps-data-governance` |

`ReplayEngine.replay` is a static pure function over an `ExecutionManifest`. It
performs no IO, holds no client, and cannot reach the network. Source
unavailability cannot affect it.

**Caveat.** This is only worth proving once the manifest references real
harvested bytes. Against a Loke source whose adapters synthesise content, the
test would pass because nothing was ever fetched — true for the wrong reason.

### 8. Loke attempts to create authority → the architecture stops it

| | |
| :-- | :-- |
| Enforcement point | Librarian-only import policy, and the case graph chokepoint |
| Exists | **Yes, executable since `b6af6c4`** |
| Owner | `mps-data-governance` |

**The original framing was a category error, and correcting it changed the fix.**

This case was inventoried against MAT-I05. That invariant governs who may create
`DecisionImpactArtifact` authority, and it has exactly two production call sites,
both in `alpha-runtime/src/recovery/DecisionArtifactRepository.ts`. Loke never
creates a `DecisionImpactArtifact`. It writes master-archive bytes, manifests,
National Archive documents, PostGIS rows and `environmentalCase` / `caseEvidence`.

Routing Loke through MAT-I05 would therefore have required registering it as a
materialization authority — the opposite of what the invariant protects. The gate
was not being bypassed; it was the wrong gate.

The guard is also fail-closed and working as designed. `MaterializerJob` calls
`repo.save(...)` without the authority argument and fails at the gate, which its
own file header documents as deliberate: it is a deprecated second truth producer,
fenced off on purpose.

**What was actually ungoverned.** The decision-relevant transition is not bytes
landing on disk — the archive is raw material — but bytes becoming queryable
state a decision reads. That happens at two doors: PostGIS promotion and the case
graph. Both already had a designated chokepoint, and it existed only as prose.
`docs/architecture/import-librarian-only-policy.md` has said since 2026-06-22
that permanent geodata reaches PostGIS only through
`scripts/import/import-librarian-manifest.ts`. Thirty-two other scripts held the
capability to write anyway.

So case 8 turned out to be the same disease as case 3: policy in place of
enforcement. Case 3 is a flag that defaults to off; case 8 was a document with no
counterpart in code.

`GovernedWriteCapability` now expresses both chokepoints as an invariant and
fails the build, by filename, on any new holder. The thirty-two existing paths are
frozen as `legacy` at an exact count that may shrink and may not grow.

One legacy entry is worth naming: `scripts/backfill/materialize-cases.ts`
materializes through raw SQL, outside MAT-I05 entirely. It is inside the frozen
count, not fixed.

---

## Proven in passing by 091cbf1

These four hold on the real execution path and are covered in
`packages/mps-data-governance/tests/HarvestOrchestrator.test.ts`.

| Case | Enforcement point | Owner |
| :-- | :-- | :-- |
| Illegal transition → QUARANTINED persisted | `HarvestOrchestrator.saveCheckpoint` | Data Governance |
| Quarantined run cannot resume | `HarvestOrchestrator.execute` terminal guard | Data Governance |
| Late approval cannot release quarantine | `HarvestOrchestrator.resumeWithApproval` | Data Governance |
| No projection or LU init after quarantine | Execution chain | Data Governance |

---

## Summary

| # | Case | Barrier | On the path |
| :-- | :-- | :-- | :-- |
| 1 | Unknown source | absent | — |
| 2 | Policy violation | absent | — |
| 3 | Tampered payload | present | **no** — opt-in flag, off by default |
| 4 | Failed derivation | absent | — |
| 5 | Missing approval | present | yes, since `26be14a` |
| 6 | Altered artifact | wrong property verified | — |
| 7 | Source unavailable | present | yes |
| 8 | Loke writes governed input | present | yes — but against the librarian chokepoint, not MAT-I05 |

Cases 5, 7 and 8 can be proven today against production code. Case 7 remains
weak until a source delivers real bytes.

Three cases — 3, 5 and 8 — did not need new barriers. They needed existing
barriers placed on the path that ingest actually takes. Cases 5 and 8 are done;
case 3 remains, and it is the last of the three.

Cases 1, 2, 4 and 6 still have no barrier, or verify the wrong property. Closing
3 does not finish ingest — it finishes the part that could be closed by wiring up
what already existed.

## A structural observation

The six orchestrator ports — `HarvestExecutor`, `VerificationExecutor`,
`ComplianceRunner`, `ProjectionExecutor`, `LURuntimeInitializer`,
`HarvestCheckpointStore` — had **no implementations anywhere in the
repository**. Only test mocks satisfied them.

`8174992` landed the first: `FileCheckpointStore`. Five remain, and the five
that remain are the ones that touch the outside world — fetching, verifying,
running controls, projecting into PostGIS, initialising LU. The checkpoint store
was the only one that could be built without first deciding on a source.

One near-miss is worth recording, because it is the naming hazard again.
`packages/alpha-runtime/src/verification/VerificationExecutor.ts` exports a
class of that exact name, but it verifies bytes against a signature envelope and
a provenance chain. It has no `verify(manifest_ref)` method and cannot satisfy
the harvest port. Two unrelated concepts already share the name, one package
apart.

The governed pipeline is a complete, now-green state machine with nothing
plugged into it. That is why the two stacks never met: one has the governance
and no execution, the other has the execution and no governance.

Choosing owners for cases 1 to 4 is therefore not only a question of which layer
enforces what. It is also a question of which of the six empty ports each
barrier belongs behind — because a barrier placed outside them would be a
seventh path into the system, and the reason for this inventory is that there
are already two.
