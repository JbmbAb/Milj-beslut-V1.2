# ADR‑24‑23 — Audit Reconstruction & Replay Model
**Status: Accepted (Frozen)**

## Purpose
Definiera den normativa modellen för hur en canonical auditkedja SHALL rekonstrueras, hur en canonical execution graph SHALL produceras, hur replay SHALL verifieras och hur equivalence SHALL fastställas.

ADR‑24‑23 operationaliserar konstitutionens replay‑invariant (MIMER‑20‑I7) och gör replay deterministisk, audit‑bar och maskinellt verifierbar.

## Scope
Gäller:
- AuditReconstructionProfileArtifact
- ReconstructedExecutionGraphArtifact
- ObservedExecutionGraphArtifact
- ReplayVerificationProfileArtifact
- ReplayVerificationArtifact
- ReplayEquivalenceReportArtifact

Gäller inte:
- runtime‑specifika exekveringsdetaljer
- workflow‑implementation
- optimeringsstrategier
- domänspecifik semantik

## Constitutional Alignment
ADR‑24‑23 SHALL operationalize, and SHALL NOT redefine:
- MIMER‑20‑I6 — Provenance Completeness
- MIMER‑20‑I7 — Replay Determinism
- MIMER‑20‑I9 — Evidence Preservation
- MIMER‑20‑I12 — Canonical Graph Integrity
- MIMER‑20‑I13 — Canonical Reference Closure

ADR‑24‑23 är en specialisering av konstitutionen, inte en parallell normativ källa.

## Normative Definitions

### Audit Reconstruction
En canonical process som, givet ett AuditChainArtifact och dess transitiva evidensmängd, SHALL producera exakt en canonical execution graph.

### Execution Graph
En canonical projektion av exekveringsbevis.
Den SHALL representera:
- inputs
- workflow‑topologi
- intermediate artifacts
- outputs
- events
- provenance

Den SHALL NOT inkludera runtime‑specifika detaljer irrelevanta för replay‑verifiering.

### Observed Execution Graph
En canonical projektion av en faktisk körning (replay, shadow execution, regression, migration, cross‑runtime).

### Replay Verification
En canonical process som jämför en rekonstruerad execution graph med en observerad execution graph enligt en verifieringsprofil.

### Equivalence Verdict
Det canonical resultatet av replay‑verifieringen:
`EQUIVALENT | DIVERGENT | INCONCLUSIVE`

## Artifact Model
**AuditReconstructionProfileArtifact**
Versionerad, canonical specifikation av rekonstruktionsregler, traversal‑strategi, normaliseringsregler och deterministiska constraints.

**ReconstructedExecutionGraphArtifact**
Canonical projektion av den rekonstruerade exekveringen.

**ObservedExecutionGraphArtifact**
Canonical projektion av en observerad exekvering.

**ReplayVerificationProfileArtifact**
Versionerad specifikation av ekvivalensdimensioner och verifieringsregler.

**ReplayVerificationArtifact**
Canonical representation av replay‑verifieringen.

**ReplayEquivalenceReportArtifact**
Canonical verdict och referenser till verifieringsbevis.

## Normative Invariants

**AUD‑23‑I0 — Evidence Basis**
Reconstruction SHALL be performed from the transitive closure of canonical evidence artifacts reachable from exactly one AuditChainArtifact.
Given an identical AuditChainArtifact and an identical evidence closure, reconstruction SHALL produce exactly one ReconstructedExecutionGraphArtifact.

**AUD‑23‑I1 — Profile Determinism**
AuditReconstructionProfileArtifact SHALL be deterministic and canonical.

**AUD‑23‑I2 — Profile Versioning**
Changed reconstruction semantics SHALL require a new profile version.

**AUD‑23‑I3 — Profile Binding**
AuditChainArtifact SHALL reference exactly one AuditReconstructionProfileArtifact.

**AUD‑23‑I4 — Graph Completeness**
ReconstructedExecutionGraphArtifact SHALL include all canonical artifacts required to reconstruct the audited execution.

**AUD‑23‑I5 — Graph Determinism**
Given identical evidence closure and profile, reconstruction SHALL produce identical canonical graphs.

**AUD‑23‑I6 — Graph Immutability**
ReconstructedExecutionGraphArtifact SHALL be immutable after publication.

**AUD‑23‑I7 — Verification Determinism**
ReplayVerificationArtifact SHALL be deterministically reproducible.

**AUD‑23‑I8 — Verification Evidence**
ReplayVerificationArtifact SHALL reference all canonical artifacts required to prove replay equivalence.

**AUD‑23‑I9 — Canonical Verdict**
ReplayEquivalenceReportArtifact SHALL contain a canonical, reproducible verdict.

**AUD‑23‑I10 — Verdict Evidence Binding**
ReplayEquivalenceReportArtifact SHALL reference exactly one ReplayVerificationArtifact.

**AUD‑23‑I11 — Replay Equivalence Semantics**
Two execution graphs SHALL be considered EQUIVALENT iff every mandatory equivalence dimension defined by the referenced ReplayVerificationProfileArtifact evaluates as equivalent.

**AUD‑23‑I12 — Verification Profile Binding**
ReplayVerificationArtifact SHALL reference exactly one ReplayVerificationProfileArtifact.

**AUD‑23‑I13 — Reconstruction Closure**
Every ContentReference in a ReconstructedExecutionGraphArtifact SHALL resolve successfully within the reconstructed evidence closure.

**AUD‑23‑I14 — Inconclusive Conditions**
A replay result SHALL be INCONCLUSIVE only when required canonical evidence is missing, corrupted, or unverifiable.
INCONCLUSIVE SHALL NOT be used for semantic disagreement between execution graphs.

**AUD‑23‑I15 — Reconstruction Minimality**
A ReconstructedExecutionGraphArtifact SHALL contain no canonical artifacts that are not required to reconstruct the audited execution according to the governing AuditReconstructionProfileArtifact.

## Normative Process Model

### 1. Evidence Closure
```
AuditChainArtifact
        ↓
Transitive closure of referenced canonical evidence
```
The closure SHALL be complete, deterministic, and canonical.

### 2. Reconstruction
```
Evidence Closure
AuditReconstructionProfileArtifact
        ↓
ReconstructedExecutionGraphArtifact
```
Reconstruction SHALL:
- follow the governing profile
- be deterministic
- be minimal
- be canonical
- be environment‑independent

### 3. Observation
```
WorkflowArtifact + Inputs + Version
        ↓
ExecutionAttempt
        ↓
ObservedExecutionGraphArtifact
```
Observation SHALL produce a canonical projection of execution evidence.

### 4. Verification
```
ReconstructedExecutionGraphArtifact
ObservedExecutionGraphArtifact
ReplayVerificationProfileArtifact
        ↓
ReplayVerificationArtifact
```
Verification SHALL:
- compare all mandatory equivalence dimensions
- be deterministic
- be canonical

### 5. Verdict
```
ReplayVerificationArtifact
        ↓
ReplayEquivalenceReportArtifact
```
Verdict SHALL be:
- EQUIVALENT
- DIVERGENT
- INCONCLUSIVE (only under AUD‑23‑I14 conditions)

## Conformance Requirements
Implementations SHALL prove:
- deterministic reconstruction
- deterministic verification
- canonical projection correctness
- equivalence semantics correctness
- minimality
- closure correctness
- verdict correctness

Runtime‑validering är obligatorisk.

## Non‑Goals
ADR‑24‑23 SHALL NOT define:
- traversal algorithms
- caching strategies
- runtime execution semantics
- workflow scheduling
- optimization heuristics

## Relationship to Adjacent ADRs
ADR‑24‑23 governs replay semantics for:
- ADR‑24‑14 Audit Chain
- ADR‑24‑19 Workflow Contract
- ADR‑24‑20 Constitution

ADR‑24‑23 SHALL be enforced by MCS‑001 — Mimer Conformance Specification.
