# ADR‑24‑22 — Canonical Signature & Attestation Model
**Status: Accepted (Frozen)**

## Purpose
Definiera den normativa modellen för hur canonical artifacts kan signeras, attesteras och verifieras inom Mimer‑plattformen, utan att låsa plattformen till någon specifik kryptografisk algoritm eller implementation.

ADR‑24‑22 etablerar:
- hur signaturer representeras canonicalt
- hur attestering fungerar
- hur verifiering representeras canonicalt
- hur signaturprofiler styr semantik
- hur signaturer kopplas till aktörer och trust‑domäner (ADR‑24‑21)
- hur verifieringsresultat blir deterministiska och audit‑bara

Detta dokument är den normativa länken mellan Actor Identity & Trust (ADR‑24‑21) och alla governance‑beslut som kräver kryptografisk bindning.

## Scope
Gäller:
- SignatureEnvelopeArtifact
- AttestationArtifact
- SignatureProfileArtifact
- VerificationArtifact
- VerificationResultArtifact

Gäller inte:
- kryptografiska algoritmer
- nyckelhantering
- transportformat (PEM, DER, JWK, COSE, PGP, etc.)
- runtime‑autentisering

## Constitutional Alignment
ADR‑24‑22 SHALL operationalize, and SHALL NOT redefine:
- MIMER‑20‑I8 — Explicit Mutation Authority
- MIMER‑20‑I9 — Evidence Preservation
- MIMER‑20‑I12 — Canonical Graph Integrity
- MIMER‑20‑I13 — Canonical Reference Closure
- MIMER‑20‑I15 — Constitutional Specialization

ADR‑24‑22 är en specialisering av konstitutionen och får inte införa nya universella invariants.

## Normative Definitions

### Signature Envelope
En canonical kapsling som binder:
- vad som signerats (canonical payload hash)
- vem som signerat (ActorArtifact)
- vilken trust‑domän som gäller (TrustDomainArtifact)
- hur det signerades (SignatureProfileArtifact)
- vilken delegation eller authority evidence som gäller (AuthorityEvidenceArtifact)

### Attestation
Ett canonical påstående om ett artifact.
En attestation behöver inte vara en digital signatur.
Exempel: “Denna artifact uppfyller policy X”.

### Verification
Canonical representation av resultatet av en signatur‑ eller attesteringsverifiering.

### Signature Profile
Versionerad canonical specifikation av:
- canonicalization rules
- hashing rules
- signature algorithm semantics
- verification semantics
- trust requirements
- allowed actor types

## Artifact Model

**SignatureEnvelopeArtifact**
Innehåller:
- reference: ActorArtifact
- reference: TrustDomainArtifact
- reference: SignatureProfileArtifact
- reference: AuthorityEvidenceArtifact
- canonical payload hash
- opaque signature bytes
- optional: AttestationArtifact

**AttestationArtifact**
Canonical representation av ett påstående om ett artifact.
Innehåller:
- attestation type
- attestation semantics
- reference: ActorArtifact
- reference: TrustDomainArtifact
- canonical payload hash

**SignatureProfileArtifact**
Versionerad canonical specifikation av signatursemantik.
Innehåller:
- canonicalization rules
- hashing rules
- signature algorithm semantics
- verification semantics
- trust requirements
- allowed actor types

**VerificationArtifact**
Canonical representation av verifieringsprocessen.
Innehåller:
- reference: SignatureEnvelopeArtifact
- reference: SignatureProfileArtifact
- reference: ActorArtifact (verifier)
- verification evidence
- reference: VerificationResultArtifact

**VerificationResultArtifact**
Canonical verdict:
`VALID | INVALID | INDETERMINATE`

## Normative Invariants

**SIG‑22‑I1 — Canonical Signature Representation**
SignatureEnvelopeArtifact SHALL represent signatures canonicalt och deterministiskt.

**SIG‑22‑I2 — Algorithm Neutrality**
SignatureEnvelopeArtifact SHALL NOT embed algorithm‑specific semantics.
All semantics SHALL be defined in SignatureProfileArtifact.

**SIG‑22‑I3 — Canonical Payload Binding**
Signatures SHALL bind to canonical payload hash, not to serialized runtime objects.

**SIG‑22‑I4 — Actor Binding**
SignatureEnvelopeArtifact SHALL reference exactly one ActorArtifact.

**SIG‑22‑I5 — Trust Domain Binding**
SignatureEnvelopeArtifact SHALL reference exactly one TrustDomainArtifact applicable for the authority evaluation.

**SIG‑22‑I6 — Authority Evidence Binding**
SignatureEnvelopeArtifact SHALL reference exactly one AuthorityEvidenceArtifact.

**SIG‑22‑I7 — Profile Binding**
SignatureEnvelopeArtifact SHALL reference exactly one SignatureProfileArtifact.

**SIG‑22‑I8 — Attestation Optionality**
SignatureEnvelopeArtifact MAY include an AttestationArtifact.

**SIG‑22‑I9 — Verification Determinism**
VerificationArtifact SHALL be deterministically reproducible.

**SIG‑22‑I10 — Verification Profile Binding**
VerificationArtifact SHALL reference exactly one SignatureProfileArtifact.

**SIG‑22‑I11 — Verification Evidence Completeness**
VerificationArtifact SHALL reference all canonical evidence required to verify signature correctness.

**SIG‑22‑I12 — INDETERMINATE Conditions**
INDETERMINATE SHALL only be produced when canonical evidence is missing, corrupted, or unverifiable.
INDETERMINATE SHALL NOT be used for semantic disagreement.

**SIG‑22‑I13 — Signature Minimality**
SignatureEnvelopeArtifact SHALL contain no fields not required by the governing SignatureProfileArtifact.

**SIG‑22‑I14 — Attestation Determinism**
AttestationArtifact SHALL be deterministic and canonical.

**SIG‑22‑I15 — Trust Closure**
Signature verification SHALL use deterministic trust traversal as defined in ADR‑24‑21.

## Normative Process Model

### 1. Canonicalization
```
Artifact
SignatureProfileArtifact
        ↓
Canonical Payload
```
Canonicalization SHALL follow the governing profile.

### 2. Signing
```
Canonical Payload
ActorArtifact
TrustDomainArtifact
AuthorityEvidenceArtifact
SignatureProfileArtifact
        ↓
SignatureEnvelopeArtifact
```
Signing SHALL be canonical and deterministic.

### 3. Attestation (optional)
```
Artifact
ActorArtifact
TrustDomainArtifact
        ↓
AttestationArtifact
```
Attestation SHALL be canonical and deterministic.

### 4. Verification
```
SignatureEnvelopeArtifact
SignatureProfileArtifact
ActorArtifact (verifier)
        ↓
VerificationArtifact
        ↓
VerificationResultArtifact
```
Verification SHALL:
- follow profile semantics
- be deterministic
- be canonical
- be trust‑domain aware

## Conformance Requirements
Implementations SHALL prove:
- canonicalization correctness
- signature envelope correctness
- attestation correctness
- verification correctness
- verdict correctness
- trust traversal correctness
- profile binding correctness
- authority evidence correctness

## Non‑Goals
ADR‑24‑22 SHALL NOT define:
- cryptographic algorithms
- key formats
- certificate formats
- transport formats
- runtime authentication

## Relationship to Adjacent ADRs
ADR‑24‑22 governs signature och attestationssemantik för:
- ADR‑24‑21 Actor Identity & Trust Model
- ADR‑24‑19 Workflow Contract
- ADR‑24‑20 Constitution
- ADR‑24‑23 Replay Model
- ADR‑24‑26 Capability Trust Model

ADR‑24‑22 SHALL be enforced by MCS‑001 — Mimer Conformance Specification.
