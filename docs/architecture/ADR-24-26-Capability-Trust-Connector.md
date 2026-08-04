# ADR‑24‑26 — Capability Trust & Connector Governance Model
**Status: Accepted (Frozen)**

## Purpose
Definiera den normativa modellen för:
- capability‑identitet
- connector‑identitet
- endpoint‑identitet
- capability‑certifiering
- trust‑domäner för exekvering
- deterministisk capability‑resolution
- governance‑styrd integration med externa system
- replay‑kompatibel trust‑evidens

ADR‑24‑26 etablerar en canonical trust‑modell för alla exekveringskapabiliteter, interna och externa.

## Scope
Gäller:
- CapabilityArtifact
- ConnectorArtifact
- EndpointArtifact
- CapabilityCertificationArtifact
- CapabilityTrustAnchorArtifact
- CapabilityResolutionArtifact
- CapabilityPolicyArtifact

Gäller inte:
- nätverksprotokoll
- API‑format
- autentiseringsmetoder
- runtime‑transport
- implementation av connectors

## Constitutional Alignment
ADR‑24‑26 SHALL operationalize, and SHALL NOT redefine:
- MIMER‑20‑I6 — Provenance Completeness
- MIMER‑20‑I7 — Replay Determinism
- MIMER‑20‑I8 — Explicit Mutation Authority
- MIMER‑20‑I9 — Evidence Preservation
- MIMER‑20‑I12 — Canonical Graph Integrity
- MIMER‑20‑I13 — Canonical Reference Closure
- MIMER‑20‑I15 — Constitutional Specialization

## Normative Definitions

### Capability
En canonical representation av en funktion som kan exekveras.
Capability beskriver vad som kan göras, inte vem som får göra det.

### Connector
Canonical representation av en mekanism som kan exekvera en capability.

### Endpoint
Canonical representation av en exekveringsadress för en connector.

### Capability Certification
Canonical representation av att en capability är godkänd för användning inom en trust‑domän.

### Capability Trust Anchor
Canonical representation av den rot av tillit som krävs för att en capability ska vara auktoriserad.

### Capability Resolution
Canonical representation av hur en execution identity väljer capability, connector och endpoint.

## Artifact Model

**CapabilityArtifact**
Innehåller:
- capability type
- capability semantics
- canonical parameters
- version reference

**ConnectorArtifact**
Innehåller:
- connector type
- supported capability types
- canonical connector semantics
- reference: CapabilityTrustAnchorArtifact

**EndpointArtifact**
Innehåller:
- endpoint type
- endpoint address (opaque)
- canonical endpoint semantics
- reference: ConnectorArtifact

**CapabilityCertificationArtifact**
Innehåller:
- reference: CapabilityArtifact
- reference: TrustDomainArtifact
- reference: CapabilityTrustAnchorArtifact
- certification profile
- certification evidence

**CapabilityTrustAnchorArtifact**
Innehåller:
- trust root semantics
- canonical trust rules
- reference: SignatureProfileArtifact

**CapabilityResolutionArtifact**
Innehåller:
- reference: ExecutionIdentityArtifact
- reference: CapabilityArtifact
- reference: ConnectorArtifact
- reference: EndpointArtifact
- reference: CapabilityCertificationArtifact
- canonical resolution semantics

**CapabilityPolicyArtifact**
Innehåller:
- allowed capabilities
- allowed connectors
- allowed endpoints
- trust requirements
- certification requirements

## Normative Invariants

### Capability Identity
**CAP‑26‑I0 — Capability Identity Independence**
CapabilityArtifact SHALL NOT embed trust semantics.

**CAP‑26‑I1 — Capability Semantic Stability**
Capability semantics SHALL be canonical and versioned.

### Connector & Endpoint
**CAP‑26‑I2 — Connector Trust Binding**
ConnectorArtifact SHALL reference exactly one CapabilityTrustAnchorArtifact.

**CAP‑26‑I3 — Endpoint Determinism**
EndpointArtifact SHALL represent canonical endpoint semantics, not runtime network state.

### Certification
**CAP‑26‑I4 — Certification Binding**
CapabilityCertificationArtifact SHALL reference exactly one CapabilityArtifact and one TrustDomainArtifact.

**CAP‑26‑I5 — Certification Evidence Completeness**
Certification SHALL include all canonical evidence required to verify capability trust.

### Trust Anchors
**CAP‑26‑I6 — Trust Anchor Determinism**
CapabilityTrustAnchorArtifact SHALL define deterministic trust semantics.

**CAP‑26‑I7 — Trust Anchor Independence**
Trust anchors SHALL NOT depend on runtime environment properties.

### Resolution
**CAP‑26‑I8 — Resolution Determinism**
CapabilityResolutionArtifact SHALL be deterministically derivable from ExecutionIdentityArtifact and CapabilityPolicyArtifact.

**CAP‑26‑I9 — Resolution Completeness**
CapabilityResolutionArtifact SHALL reference capability, connector, endpoint, certification and trust anchor.

**CAP‑26‑I10 — Resolution Minimality**
CapabilityResolutionArtifact SHALL contain no fields not required by the governing capability policy.

### Governance
**CAP‑26‑I11 — Policy Binding**
CapabilityPolicyArtifact SHALL govern all capability resolution.

**CAP‑26‑I12 — Authority Binding**
CapabilityCertificationArtifact SHALL reference exactly one AuthorityEvidenceArtifact.

### Replay
**CAP‑26‑I13 — Replay Compatibility**
CapabilityResolutionArtifact SHALL be replay‑compatible and SHALL NOT depend on transient runtime state.

### Reference Closure
**CAP‑26‑I14 — Capability Reference Closure**
All ContentReferences in capability, connector, endpoint, certification and resolution artifacts SHALL resolve within the canonical evidence graph.

### Execution Integration
**CAP‑26‑I15 — Execution Identity Binding**
CapabilityResolutionArtifact SHALL reference exactly one ExecutionIdentityArtifact.

### Trust Domain Isolation
**CAP‑26‑I16 — Domain Isolation**
Capability certification SHALL be valid only within the referenced TrustDomainArtifact.

### Connector Independence
**CAP‑26‑I17 — Connector Independence**
ConnectorArtifact SHALL NOT embed capability semantics.

### Endpoint Independence
**CAP‑26‑I18 — Endpoint Independence**
EndpointArtifact SHALL NOT embed connector trust semantics.

## Normative Process Model

### 1. Capability Definition
```
CapabilityArtifact
        ↓
CapabilityCertificationArtifact
```

### 2. Connector Definition
```
ConnectorArtifact
CapabilityTrustAnchorArtifact
        ↓
EndpointArtifact
```

### 3. Capability Policy
```
CapabilityPolicyArtifact
        ↓
Allowed capabilities, connectors, endpoints
```

### 4. Capability Resolution
```
ExecutionIdentityArtifact
CapabilityPolicyArtifact
CapabilityArtifact
ConnectorArtifact
EndpointArtifact
CapabilityCertificationArtifact
        ↓
CapabilityResolutionArtifact
```

### 5. Execution Manifest Integration (ADR‑24‑25)
```
CapabilityResolutionArtifact
        ↓
ExecutionManifestArtifact
```

### 6. Replay Integration (ADR‑24‑23)
```
CapabilityResolutionArtifact
ObservedExecutionGraphArtifact
        ↓
ReplayVerificationArtifact
```

## Conformance Requirements
Implementations SHALL prove:
- capability identity correctness
- connector trust correctness
- endpoint determinism
- certification evidence correctness
- resolution determinism
- resolution completeness
- replay compatibility
- reference closure correctness
- trust domain isolation correctness

## Non‑Goals
ADR‑24‑26 SHALL NOT define:
- network protocols
- API formats
- authentication methods
- connector implementation details
- runtime transport semantics

## Relationship to Adjacent ADRs
ADR‑24‑26 governs capability trust for:
- ADR‑24‑19 Workflow Contract
- ADR‑24‑20 Constitution
- ADR‑24‑21 Actor Identity & Trust
- ADR‑24‑22 Signature & Attestation
- ADR‑24‑23 Replay Model
- ADR‑24‑24 Retention Model
- ADR‑24‑25 Execution Identity Model

ADR‑24‑26 SHALL be enforced by MCS‑001 — Mimer Conformance Specification.
