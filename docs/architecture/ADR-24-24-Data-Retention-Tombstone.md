# ADR‑24‑24 — Data Retention & Tombstone Model
**Status: Accepted (Frozen)**

## Purpose
Definiera den normativa modellen för hur canonical artifacts kan bevaras, göras otillgängliga, gallras eller tombstonas utan att bryta:
- canonical identity
- provenance
- audit‑kedjan
- replay‑determinism
- governance‑evidens

ADR‑24‑24 etablerar:
- separation mellan artifact och payload
- canonical retention‑beslut
- tombstone‑semantik
- recoverability‑status
- replay‑beteende vid saknad payload
- evidenskrav för gallring
- governance‑styrning av retention

Detta dokument är helt storage‑ och crypto‑agnostiskt.

## Scope
Gäller:
- PayloadArtifact
- EncryptedPayloadArtifact
- TombstoneArtifact
- RetentionDecisionArtifact
- RecoverabilityStateArtifact

Gäller inte:
- krypteringsalgoritmer
- nyckelhantering
- storage‑implementation
- blob‑format
- runtime‑åtkomstkontroll

## Constitutional Alignment
ADR‑24‑24 SHALL operationalize, and SHALL NOT redefine:
- MIMER‑20‑I4 — Immutability
- MIMER‑20‑I6 — Provenance Completeness
- MIMER‑20‑I8 — Explicit Mutation Authority
- MIMER‑20‑I9 — Evidence Preservation
- MIMER‑20‑I12 — Canonical Graph Integrity
- MIMER‑20‑I13 — Canonical Reference Closure
- MIMER‑20‑I15 — Constitutional Specialization

ADR‑24‑24 är en specialisering av konstitutionen och får inte införa nya universella invariants.

## Normative Definitions

### Artifact vs Payload
Ett canonical artifact består av:
- Artifact Metadata (canonical, immutable, replay‑relevant)
- Payload Reference (pekare till payload‑artefakt)

Payload är inte en del av artifact‑identiteten.

### PayloadArtifact
Canonical representation av payloadens existens och typ.

### EncryptedPayloadArtifact
Canonical representation av en krypterad payload.
ADR‑24‑24 definierar semantik, inte algoritmer.

### TombstoneArtifact
Canonical representation av att payload inte längre är recoverable.

### RetentionDecisionArtifact
Canonical governance‑beslut som styr payloadens retention‑status.

### Recoverability State
Canonical representation av payloadens återställningsstatus:
- RECOVERABLE
- NON_RECOVERABLE
- DESTROYED
- UNKNOWN

Recoverability är separat från artifact‑lifecycle.

## Artifact Model

**PayloadArtifact**
Representerar payloadens existens.
Innehåller:
- payload type
- payload location (opaque)
- reference: ArtifactMetadata

**EncryptedPayloadArtifact**
Representerar krypterad payload.
Innehåller:
- encryption profile reference
- encrypted blob (opaque)
- payload hash

**RetentionDecisionArtifact**
Canonical governance‑beslut.
Innehåller:
- reference: ActorArtifact
- reference: AuthorityEvidenceArtifact
- reference: TrustDomainArtifact
- retention policy reference
- target payload reference
- resulting recoverability state

**TombstoneArtifact**
Representerar att payload inte längre är recoverable.
Innehåller:
- reference: RetentionDecisionArtifact
- canonical reason
- canonical timestamp (logical, not wall‑clock)
- resulting recoverability state

**RecoverabilityStateArtifact**
Representerar payloadens återställningsstatus.
Innehåller:
- RECOVERABLE | NON_RECOVERABLE | DESTROYED | UNKNOWN
- reference: RetentionDecisionArtifact

## Normative Invariants

**RET‑24‑I1 — Artifact Immutability**
Retention SHALL NOT mutate canonical artifacts.

**RET‑24‑I2 — Payload Separation**
Payload SHALL NOT be part of canonical artifact identity.

**RET‑24‑I3 — Tombstone Non‑Replacement**
A TombstoneArtifact SHALL NOT replace or mutate an existing canonical artifact.
It SHALL only represent the canonical lifecycle state of the associated payload.

**RET‑24‑I4 — Governance Binding**
Every retention action SHALL be governed by exactly one RetentionDecisionArtifact.

**RET‑24‑I5 — Authority Binding**
RetentionDecisionArtifact SHALL reference exactly one AuthorityEvidenceArtifact.

**RET‑24‑I6 — Deterministic Retention Semantics**
Retention semantics SHALL be deterministic and canonical.

**RET‑24‑I7 — Evidence Preservation**
Payload destruction SHALL NOT invalidate canonical identity, provenance, governance evidence, or audit reconstruction.

**RET‑24‑I8 — Recoverability Independence**
Recoverability state SHALL be independent of artifact lifecycle.

**RET‑24‑I9 — Replay Compatibility**
Replay SHALL treat tombstoned payloads as canonical evidence of intentional unavailability, not as missing data.

**RET‑24‑I10 — Reference Closure**
RetentionDecisionArtifact and TombstoneArtifact SHALL NOT break canonical reference closure.

**RET‑24‑I11 — Minimality**
Retention artifacts SHALL contain no fields not required by the governing retention policy.

**RET‑24‑I12 — Policy Neutrality**
Retention semantics SHALL NOT embed storage‑ or crypto‑specific rules.

**RET‑24‑I13 — Recoverability Determinism**
RecoverabilityStateArtifact SHALL be deterministically derivable from retention decisions.

## Normative Process Model

### 1. Payload Creation
```
ArtifactMetadata
        ↓
PayloadArtifact
```
Payload creation SHALL NOT affect artifact identity.

### 2. Optional Encryption
```
PayloadArtifact
EncryptionProfileArtifact
        ↓
EncryptedPayloadArtifact
```
Encryption SHALL be canonical and algorithm‑neutral.

### 3. Retention Decision
```
ActorArtifact
AuthorityEvidenceArtifact
TrustDomainArtifact
RetentionPolicyArtifact
PayloadArtifact
        ↓
RetentionDecisionArtifact
```
RetentionDecisionArtifact definierar:
- varför payload ska gallras
- hur recoverability ska förändras
- vilken policy som gäller

### 4. Tombstone Creation
```
RetentionDecisionArtifact
        ↓
TombstoneArtifact
        ↓
RecoverabilityStateArtifact
```
TombstoneArtifact representerar canonical payload‑förlust.

### 5. Replay Handling
```
ReconstructedExecutionGraphArtifact
ObservedExecutionGraphArtifact
        ↓
ReplayVerificationArtifact
```
Replay SHALL:
- treat tombstones as canonical evidence
- never fail due to missing payload
- use tombstone semantics for equivalence evaluation

## Conformance Requirements
Implementations SHALL prove:
- artifact/payload separation correctness
- retention decision correctness
- tombstone correctness
- recoverability correctness
- replay compatibility
- authority evidence correctness
- reference closure correctness

## Non‑Goals
ADR‑24‑24 SHALL NOT define:
- cryptographic algorithms
- key management
- storage formats
- blob formats
- runtime access control

## Relationship to Adjacent ADRs
ADR‑24‑24 governs retention semantics for:
- ADR‑24‑20 Constitution
- ADR‑24‑21 Actor Identity & Trust Model
- ADR‑24‑22 Signature & Attestation Model
- ADR‑24‑23 Replay Model
- ADR‑24‑25 Execution Identity Model

ADR‑24‑24 SHALL be enforced by MCS‑001 — Mimer Conformance Specification.
