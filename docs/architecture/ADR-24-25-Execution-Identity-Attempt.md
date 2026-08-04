# ADR‑24‑25 — Execution Identity & Attempt Model
**Status: Accepted (Frozen)**

## Purpose
Definiera den normativa modellen för:
- logisk exekveringsidentitet
- exekveringsinstanser (attempts)
- exekveringsmanifest
- kausal relation mellan attempts
- outcome‑neutral identitet
- deterministisk replay‑kompatibilitet
- promotion‑evidens
- audit‑reachability
- referensslutning för exekveringsgrafen

ADR‑24‑25 binder samman workflow‑intention (ADR‑24‑19), governance‑auktoritet (ADR‑24‑21), signaturer (ADR‑24‑22), replay (ADR‑24‑23) och retention (ADR‑24‑24) till en sammanhängande exekveringsmodell.

## Scope
Gäller:
- ExecutionIdentityArtifact
- ExecutionAttemptArtifact
- ExecutionManifestArtifact
- ExecutionOutcomeArtifact
- ObservedExecutionGraphArtifact
- ExecutionRetryPolicyArtifact

Gäller inte:
- runtime‑scheduler
- maskin‑specifika detaljer
- capability‑trust (ADR‑24‑26)
- exekveringsoptimering

## Constitutional Alignment
ADR‑24‑25 SHALL operationalize, and SHALL NOT redefine:
- MIMER‑20‑I6 — Provenance Completeness
- MIMER‑20‑I7 — Replay Determinism
- MIMER‑20‑I9 — Evidence Preservation
- MIMER‑20‑I12 — Canonical Graph Integrity
- MIMER‑20‑I13 — Canonical Reference Closure
- MIMER‑20‑I15 — Constitutional Specialization

## Normative Definitions

### Execution Identity
Canonical representation av en logisk körning.
Identiteten är outcome‑neutral och semantiskt komplett.

### Execution Attempt / Instance
Ett faktiskt försök att utföra en logisk körning.
Flera attempts kan existera för samma identity.

### Execution Manifest
Canonical representation av exakt vad som kördes:
- workflow
- workflow‑version
- inputs
- configuration
- policies
- capability‑resolution
- runtime‑profile

### RuntimeProfileArtifact
Canonical execution environment descriptor.
It SHALL NOT contain:
- machine identity
- transient runtime state
- scheduling information
- infrastructure topology

Det beskriver vilken typ av miljö som exekveringen kräver, inte vilken maskin som råkade köra den.

### Observed Execution Graph
Canonical projektion av exekveringsresultatet (ADR‑24‑23).

### Execution Outcome
Canonical representation av resultatet:
SUCCESS | FAILURE | PARTIAL | CANCELLED | UNKNOWN

### Execution Retry Policy
Canonical representation av retry‑regler som inte påverkar execution identity.

## Artifact Model

**ExecutionIdentityArtifact**
Innehåller:
- reference: WorkflowArtifact
- reference: WorkflowVersionArtifact
- reference: ConfigurationArtifacts
- reference: PolicyArtifacts
- reference: CapabilityResolutionArtifacts
- canonical execution parameters
- canonical execution scope
- optional: ExecutionRetryPolicyArtifact

**ExecutionManifestArtifact**
Innehåller:
- reference: ExecutionIdentityArtifact
- reference: WorkflowArtifact
- reference: WorkflowVersionArtifact
- reference: InputArtifacts
- reference: ConfigurationArtifacts
- reference: PolicyArtifacts
- reference: CapabilityArtifacts
- reference: RuntimeProfileArtifact

**ExecutionAttemptArtifact**
Innehåller:
- reference: ExecutionIdentityArtifact
- reference: ExecutionManifestArtifact
- reference: ActorArtifact (executor)
- reference: TrustDomainArtifact
- reference: AuthorityEvidenceArtifact
- reference: ExecutionOutcomeArtifact
- reference: ObservedExecutionGraphArtifact
- reference: PreviousCausalEventArtifact (optional)
- canonical attempt metadata

**ExecutionOutcomeArtifact**
Innehåller:
- SUCCESS | FAILURE | PARTIAL | CANCELLED | UNKNOWN
- canonical termination reason
- canonical runtime‑independent metadata

**ExecutionRetryPolicyArtifact**
Innehåller:
- retry semantics
- retry constraints
- retry governance rules

## Normative Invariants

### Identity & Attempts
**EXEC‑25‑I0 — Logical Execution Identity**
A logical execution SHALL be represented by exactly one ExecutionIdentityArtifact.

**EXEC‑25‑I1 — Identity Stability**
Execution identity SHALL NOT depend on execution outcome.

**EXEC‑25‑I2 — Attempt Multiplicity**
A logical execution MAY have multiple ExecutionAttemptArtifacts.

**EXEC‑25‑I3 — Attempt Immutability**
ExecutionAttemptArtifact SHALL be immutable after publication.

### Manifest & Semantics
**EXEC‑25‑I4 — Manifest Completeness**
ExecutionManifestArtifact SHALL reference all canonical artifacts required to reproduce execution semantics.

**EXEC‑25‑I5 — Manifest Determinism**
ExecutionManifestArtifact SHALL be deterministically derivable from ExecutionIdentityArtifact and governed policies.

**EXEC‑25‑I14 — Execution Semantic Binding**
ExecutionIdentityArtifact SHALL reference the complete canonical execution definition required to determine execution semantics.

**EXEC‑25‑I20 — Manifest Identity Binding**
Every ExecutionManifestArtifact SHALL reference exactly one ExecutionIdentityArtifact.
An ExecutionManifestArtifact SHALL NOT be reused across different ExecutionIdentityArtifacts.

### Outcome & Replay
**EXEC‑25‑I6 — Outcome Independence**
Execution identity SHALL NOT depend on success, failure, termination reason, or retry count.

**EXEC‑25‑I7 — Attempt Outcome Binding**
ExecutionAttemptArtifact SHALL reference exactly one ExecutionOutcomeArtifact.

**EXEC‑25‑I8 — Replay Compatibility**
ExecutionAttemptArtifact SHALL reference exactly one ObservedExecutionGraphArtifact.

### Audit & Promotion
**EXEC‑25‑I9 — Audit Reachability**
Every ExecutionAttemptArtifact SHALL be reachable from the canonical audit chain.

**EXEC‑25‑I10 — Promotion Binding**
PromotionDecisionArtifact SHALL reference exactly one ExecutionAttemptArtifact.

**EXEC‑25‑I11 — Outcome Evidence Binding**
PromotionDecisionArtifact SHALL reference the ExecutionOutcomeArtifact and ObservedExecutionGraphArtifact used as decision evidence.

### Retry & Causality
**EXEC‑25‑I16 — Retry Semantic Isolation**
ExecutionRetryPolicyArtifact SHALL NOT alter ExecutionIdentity semantics.

**EXEC‑25‑I17 — Attempt Causality**
Every ExecutionAttemptArtifact SHALL reference its causal predecessor when created as a continuation, retry, recovery, or replay attempt.

### Reference Closure & Minimality
**EXEC‑25‑I12 — Reference Closure**
ExecutionIdentityArtifact, ExecutionAttemptArtifact och ExecutionManifestArtifact SHALL NOT break canonical reference closure.

**EXEC‑25‑I18 — Attempt Minimality**
ExecutionAttemptArtifact SHALL contain no fields not required by the governing execution profile.

**EXEC‑25‑I19 — Execution Evidence Closure**
All ContentReferences contained in ExecutionManifestArtifact and ExecutionAttemptArtifact SHALL resolve within the execution evidence graph.

### Runtime Independence
**EXEC‑25‑I15 — Runtime Independence**
Execution semantics SHALL NOT depend on transient runtime environment properties.

## Normative Process Model

### 1. Logical Execution Creation
```
WorkflowArtifact
WorkflowVersionArtifact
ConfigurationArtifacts
PolicyArtifacts
CapabilityResolutionArtifacts
ExecutionParameters
        ↓
ExecutionIdentityArtifact
```

### 2. Manifest Construction
```
ExecutionIdentityArtifact
WorkflowArtifact
WorkflowVersionArtifact
Inputs
Configuration
Policies
Capabilities
RuntimeProfileArtifact
        ↓
ExecutionManifestArtifact
```

### 3. Execution Attempt
```
ExecutionIdentityArtifact
ExecutionManifestArtifact
ActorArtifact (executor)
AuthorityEvidenceArtifact
TrustDomainArtifact
PreviousCausalEventArtifact (optional)
        ↓
ExecutionAttemptArtifact
```

### 4. Execution Outcome
```
ExecutionAttemptArtifact
        ↓
ExecutionOutcomeArtifact
```

### 5. Observed Execution Graph
```
ExecutionAttemptArtifact
        ↓
ObservedExecutionGraphArtifact
```

### 6. Replay Verification (ADR‑24‑23)
```
ExecutionAttemptArtifact
ObservedExecutionGraphArtifact
ReconstructedExecutionGraphArtifact
        ↓
ReplayVerificationArtifact
```

### 7. Promotion & Governance
```
ExecutionAttemptArtifact
ExecutionOutcomeArtifact
ObservedExecutionGraphArtifact
        ↓
PromotionDecisionArtifact
        ↓
RegistryMutationArtifact
```

## Conformance Requirements
Implementations SHALL prove:
- execution identity determinism
- manifest completeness
- manifest identity binding
- attempt immutability
- outcome independence
- replay compatibility
- audit reachability
- promotion evidence correctness
- reference closure correctness
- causal correctness
- runtime independence

## Non‑Goals
ADR‑24‑25 SHALL NOT define:
- runtime scheduling
- distributed execution semantics
- capability trust
- retry algorithms
- execution optimization

## Relationship to Adjacent ADRs
ADR‑24‑25 binds execution semantics för:
- ADR‑24‑19 Workflow Contract
- ADR‑24‑20 Constitution
- ADR‑24‑21 Actor Identity & Trust
- ADR‑24‑22 Signature & Attestation
- ADR‑24‑23 Replay Model
- ADR‑24‑24 Retention Model
- ADR‑24‑26 Capability Trust Model

ADR‑24‑25 SHALL be enforced by MCS‑001 — Mimer Conformance Specification.
