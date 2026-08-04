# ADR‑24‑21 — Actor Identity & Trust Model
**Status: Accepted (Frozen)**

## Purpose
Definiera den normativa modellen för aktörsidentitet, trust‑domäner, trust‑ankare, trust‑delegation och authority‑evidence inom Mimer‑plattformen.

ADR‑24‑21 etablerar:
- vad en aktör är
- hur aktörer identifieras canonicalt
- hur trust etableras och versioneras
- hur delegation fungerar
- hur authority‑evidence representeras canonicalt
- hur trust‑traversering sker deterministiskt

Detta dokument är den normativa grunden för ADR‑24‑22 (Signature & Attestation Model) och för alla governance‑beslut som kräver explicit mutation authority.

## Scope
Gäller:
- ActorArtifact
- HumanIdentityArtifact
- ServiceIdentityArtifact
- TrustAnchorArtifact
- TrustDomainArtifact
- TrustDelegationArtifact
- AuthorityEvidenceArtifact
- ActorLifecycleArtifact

Gäller inte:
- kryptografiska signaturer (ADR‑24‑22)
- capability‑trust (ADR‑24‑26)
- execution identity (ADR‑24‑25)
- runtime‑autentisering

## Constitutional Alignment
ADR‑24‑21 SHALL operationalize, and SHALL NOT redefine:
- MIMER‑20‑I8 — Explicit Mutation Authority
- MIMER‑20‑I9 — Evidence Preservation
- MIMER‑20‑I12 — Canonical Graph Integrity
- MIMER‑20‑I13 — Canonical Reference Closure
- MIMER‑20‑I15 — Constitutional Specialization

ADR‑24‑21 är en specialisering av konstitutionen och får inte införa nya universella invariants.

## Normative Definitions

### Actor
En entitet som kan fatta beslut, initiera mutationer, attestera artifacts eller delta i governance.

### Actor Identity
En canonical representation av en aktörs identitet.
Actor identity SHALL NOT bero på runtime‑metadata, autentiseringssessioner eller miljöberoende detaljer.

### Trust Domain
En canonical policy‑domän som definierar trust‑regler, constraints och delegation‑semantik.
En aktör kan delta i flera trust‑domäner.

### Authority Evaluation
En canonical process som avgör om en aktör har rätt att utföra en handling inom ett specifikt trust‑domän.

### Trust Anchor
Canonical rot av tillit inom ett trust‑domän.

### Trust Delegation
Canonical mekanism för att överföra trust från en aktör till en annan.

### Authority Evidence
Canonical representation av beviset för att en aktör hade rätt att utföra en handling.

## Artifact Model

**ActorArtifact**
Canonical representation av en aktör.
Innehåller:
- actor identity
- actor type
- references: TrustDomainArtifact(s)
- lifecycle state

**HumanIdentityArtifact**
Canonical representation av en mänsklig identitet.

**ServiceIdentityArtifact**
Canonical representation av en tjänst eller systemidentitet.

**TrustAnchorArtifact**
Canonical rot för trust inom ett trust‑domän.

**TrustDomainArtifact**
Canonical definition av trust‑domänets regler, scope och constraints.

**TrustDelegationArtifact**
Canonical representation av delegation.
Innehåller:
- delegator
- delegatee
- scope
- activation artifact
- expiration artifact
- revocation artifact

**AuthorityEvidenceArtifact**
Canonical representation av authority‑bevis.
Innehåller:
- ActorArtifact
- TrustDomainArtifact
- TrustAnchorArtifact
- TrustDelegationArtifact (optional)
- EvaluationProfileArtifact (optional)

**ActorLifecycleArtifact**
Canonical representation av aktörens livscykel:
CREATED → ACTIVE → SUSPENDED → REVOKED

## Normative Invariants

**ACT‑21‑I1 — Canonical Actor Identity**
Every actor SHALL have a canonical, content‑addressed identity.

**ACT‑21‑I2 — Actor Type Stability**
Actor type SHALL NOT change without new identity.

**ACT‑21‑I3 — Trust Domain Participation**
An ActorArtifact MAY participate in multiple TrustDomainArtifacts.
Every authority evaluation SHALL reference exactly one TrustDomainArtifact.

**ACT‑21‑I4 — Trust Anchor Root**
Every trust domain SHALL reference exactly one TrustAnchorArtifact.

**ACT‑21‑I5 — Deterministic Trust Closure**
Trust traversal SHALL be deterministic and SHALL produce exactly one canonical authority path for every successful authority resolution.

**ACT‑21‑I6 — Delegation Determinism**
TrustDelegationArtifact SHALL deterministically define:
- delegator
- delegatee
- scope
- activation artifact
- expiration artifact
- revocation artifact

**ACT‑21‑I7 — Delegation Immutability**
Delegation semantics SHALL NOT change without new canonical identity.

**ACT‑21‑I8 — Actor Lifecycle Determinism**
ActorLifecycleArtifact SHALL deterministically define actor state transitions.

**ACT‑21‑I9 — Authority State Independence**
Actor identity SHALL be stable across lifecycle transitions.
Revocation SHALL NOT require new identity for human actors.

**ACT‑21‑I10 — Authority Evidence Binding**
Any governance decision requiring mutation authority SHALL reference exactly one AuthorityEvidenceArtifact.

**ACT‑21‑I11 — Trust Domain Immutability**
Trust domain semantics SHALL NOT change without new canonical identity.

**ACT‑21‑I12 — Trust Domain Minimality**
TrustDomainArtifact SHALL contain no rules not required to define trust.

**ACT‑21‑I13 — Actor Reference Closure**
Every reference to an actor SHALL resolve within the trust domain.

**ACT‑21‑I14 — Authority Evidence Completeness**
AuthorityEvidenceArtifact SHALL reference all canonical artifacts required to prove authority.

## Normative Process Model

### 1. Actor Creation
```
HumanIdentityArtifact | ServiceIdentityArtifact
        ↓
ActorArtifact
        ↓
ActorLifecycleArtifact (CREATED → ACTIVE)
```
Actor creation SHALL be canonical and deterministic.

### 2. Trust Domain Establishment
```
TrustAnchorArtifact
        ↓
TrustDomainArtifact
```
Trust domain SHALL define:
- scope
- constraints
- allowed actor types
- delegation rules

### 3. Delegation
```
ActorArtifact (delegator)
ActorArtifact (delegatee)
TrustDomainArtifact
        ↓
TrustDelegationArtifact
```
Delegation SHALL be:
- explicit
- canonical
- immutable
- revocable

### 4. Authority Evaluation
```
ActorArtifact
TrustDomainArtifact
TrustAnchorArtifact
TrustDelegationArtifact (optional)
EvaluationProfileArtifact (optional)
        ↓
AuthorityEvidenceArtifact
```
AuthorityEvidenceArtifact SHALL be referenced by:
- PromotionDecisionArtifact
- RegistryMutationArtifact
- GovernanceApprovalArtifact
- SignatureEnvelopeArtifact (ADR‑24‑22)

### 5. Revocation
```
ActorArtifact
        ↓
ActorLifecycleArtifact (REVOKED)
```
Revocation SHALL NOT require new identity for human actors.

## Conformance Requirements
Implementations SHALL prove:
- actor identity determinism
- trust domain determinism
- delegation determinism
- authority resolution correctness
- authority evidence correctness
- lifecycle correctness
- trust closure correctness
- revocation correctness

## Non‑Goals
ADR‑24‑21 SHALL NOT define:
- cryptographic signatures
- authentication mechanisms
- runtime identity resolution
- capability trust
- execution identity

## Relationship to Adjacent ADRs
ADR‑24‑21 governs identity and trust for:
- ADR‑24‑22 Signature & Attestation Model
- ADR‑24‑24 Data Retention & Tombstone Model
- ADR‑24‑25 Execution Identity & Attempt Model
- ADR‑24‑26 Capability Trust Model
- ADR‑24‑19 Workflow Contract
- ADR‑24‑20 Constitution

ADR‑24‑21 SHALL be enforced by MCS‑001 — Mimer Conformance Specification.
