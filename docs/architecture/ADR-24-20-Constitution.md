# ADR‑24‑20 — Mimer Canonical Artifact Governance Constitution (FINAL FROZEN)
**Status: HISTORICAL — NORMATIVE_TODAY: false**
**Superseded by:** [ADR-MPS-CONSTITUTIONAL-INVARIANTS.md](./ADR-MPS-CONSTITUTIONAL-INVARIANTS.md)

## Purpose
Definiera de universella normativa principerna som alla canonical artifacts, alla ADR:er, alla domäner och alla implementationer inom Mimer‑plattformen måste följa.

ADR‑24‑20 etablerar invariants som krävs för:
- deterministisk identitet
- reproducerbar execution
- audit‑bar provenance
- immutable state
- cross‑domain interoperability
- verifierbar governance
- långsiktig semantisk stabilitet

Detta dokument är konstitutionen för hela Mimer‑arkitekturen.

## Scope
ADR‑24‑20 gäller:
- alla CanonicalArtifact‑implementationer
- alla artifact repositories
- alla ContentReferences
- alla artifact lifecycle transitions
- alla auditkedjor
- alla governance‑modeller
- alla runtime pipelines
- alla domäner inom Mimer

ADR‑24‑20 gäller inte:
- domänspecifik semantik
- workflowlogik
- constraint‑regler
- promotionbeslut
- operativ implementation

## Normative Definitions

### Canonical Artifact
En immutable, content‑addressed representation av ett semantiskt objekt.

Ett canonical artifact SHALL:
- ha stabil identitet
- vara deterministiskt serialiserbart
- vara verifierbart
- kunna reproduceras från samma input

### Artifact Identity
Identity SHALL derive exclusively from:
- canonical payload
- canonical serialization
- canonical hashing algorithm

Identity SHALL NOT derive from:
- timestamps
- runtime metadata
- machine identity
- execution order
- storage location

## Normative Invariants (MIMER‑20)

**MIMER‑20‑I1 — Canonical Identity**
Every canonical artifact SHALL have a stable, content‑derived identity.

**MIMER‑20‑I2 — Deterministic Serialization**
Serialization SHALL be deterministic, platform‑independent, order‑stable och byte‑reproducerbar.

**MIMER‑20‑I3 — Content Addressability**
Identity SHALL be derived from canonical content hash; ändrad payload kräver ny identitet.

**MIMER‑20‑I4 — Immutability**
Published artifacts SHALL NOT be mutated, overwritten eller ersättas tyst.

**MIMER‑20‑I5 — Reference Integrity**
Every ContentReference SHALL resolve till exakt ett canonical artifact av korrekt typ och identitet.

**MIMER‑20‑I6 — Provenance Completeness**
Every derived artifact SHALL preserve provenance till sina source artifacts.

**MIMER‑20‑I7 — Replay Determinism (extended)**
Given identical:
- input artifacts
- configuration artifacts
- policy artifacts
- execution version

the produced artifact graph SHALL be identical.

Replay SHALL NOT depend on:
- runtime environment
- machine identity
- execution timing
- external mutable state

**MIMER‑20‑I8 — Explicit Mutation Authority**
State changes SHALL only occur via canonical transition artifacts.

**MIMER‑20‑I9 — Evidence Preservation (strengthened)**
Every governance decision SHALL reference sufficient canonical evidence artifacts to reconstruct:
- input state
- applied rules
- evaluation results
- resulting decision

A decision without reconstructable evidence SHALL be considered invalid.

**MIMER‑20‑I10 — Validation Hierarchy**
Validation SHALL occur in layers:
- Schema
- Artifact
- Reference
- Semantic
- Governance

Later layers SHALL NOT replace earlier ones.

**MIMER‑20‑I11 — Artifact Type Stability**
Artifact types och deras kontrakt får inte ändras utan ny version och ny identitet.

**MIMER‑20‑I12 — Canonical Graph Integrity (revised)**
Artifact graphs SHALL be internally consistent.

Canonical graphs SHALL NOT contain:
- unresolved references
- ambiguous ownership
- non‑deterministic traversal paths
- provenance‑breaking structures

Cycles SHALL only exist where explicitly permitted by the governing artifact model.

**MIMER‑20‑I13 — Canonical Reference Closure**
Alla ContentReferences inom ett canonical artifact graph SHALL resolve till existerande canonical artifacts.

Inga:
- dangling references
- unresolved identities
- ambiguous references
- non‑canonical references

får förekomma.

**MIMER‑20‑I14 — Semantic Immutability**
Ett publicerat artifact får inte ändra betydelse över tid.

Ny tolkning av typ, fält eller semantik kräver:
- ny artifact version
- ny canonical identity
- ny provenance chain

**MIMER‑20‑I15 — Constitutional Precedence**
Where a conflict exists between this Constitution and any subordinate ADR,
the Constitution SHALL take precedence.

Subordinate specifications SHALL NOT:
- weaken
- override
- contradict
any constitutional invariant.

Any required deviation SHALL be introduced by revising this Constitution.

**REP-19-I1 — Lineage Integrity**
Artifact lineage SHALL reference a valid predecessor state.

**REP-19-I3 — Temporal Monotonicity**
Sequence SHALL never decrease inside an accepted lineage branch.

**REP-19-I5 — Deterministic Fork Resolution**
Equal inputs SHALL always produce identical resolution.

**REP-19-I7 — Violation Evidence Closure**
Every rejected replication attempt SHALL produce a ReplicationViolationArtifact.

**AUDIT-20-I1 — Node Canonical Identity**
Every AuditNode SHALL reference an existing immutable ArtifactContract.

**AUDIT-20-I3 — Edge Provenance Validity**
Every AuditEdge SHALL be derivable from canonical artifact references.

**AUDIT-20-I5 — Topological Determinism**
Same release hash SHALL produce identical audit graph topology AND layout.

**AUDIT-20-I7 — Zero Projection State**
Audit projection SHALL not alter artifact state and SHALL never introduce state not present in canonical artifacts.

## Required Platform Components
Mimer SHALL contain:
- CanonicalArtifact model
- ContentReference model
- canonical serializer
- content hash service
- artifact validator
- provenance resolver
- replay verifier
- audit reconstruction mechanism

## Conformance Requirements
Implementations SHALL prove:
- canonical serialization correctness
- hash stability
- artifact immutability
- reference integrity
- replay determinism
- provenance completeness

Runtime‑validering är obligatorisk.

## Relationship to Existing ADRs (Historical — superseded, non-normative)

At the time this document was written (2026-08-04), ADR‑24‑20 intended to govern a
two-level hierarchy of subordinate ADRs numbered ADR‑24‑07 through ADR‑24‑19. Those
files were never committed to this repository under that numbering, on any branch
(verified via full git history during the 2026-08-30 document-authority
reconciliation). The invariants and mechanisms they were meant to specialize were
instead materialized under different, currently-normative documents. This section
is retained for historical provenance only and SHALL NOT be read as a live
governs-list. Historical ADR‑24‑07..19 SHALL NOT be recreated under this numbering.

**Two-generation caveat:** the numbers `ADR‑24‑07..19` were independently reused
by two different, unrelated historical design efforts that never produced
committed files — the titles below (from this document's own original text) are
one generation; a separately recovered design-conversation record used the same
numbers for entirely different subject matter (e.g. `24‑10` also meant
"DecisionImpactIndicator Uniqueness & Semantics" there, `24‑15` meant "PostgreSQL
Partition Strategy", `24‑16` meant "PostGIS Physical Optimization", `24‑17` meant
"Ingest Throughput State Machine", `24‑18` meant "Retrieval Governance & Query
Budget"). Where both generations have a real current successor, both are listed.
"Historical wording superseded" is not the same claim as "no semantic successor
exists" — several rows below have real, on-disk, actively-maintained
implementation code that is simply not yet registered in
`architecture-authority-map.jsonc`; that is recorded explicitly rather than
folded into a blanket "no successor" claim.

| Historical reference (never committed) | Current successor authority |
| --- | --- |
| ADR‑24‑07 Canonical AST | `ADR-MPS-CONSTITUTIONAL-INVARIANTS.md` §1–§3 (canonical identity/hashing) |
| ADR‑24‑08 Dependency Taxonomy | `ADR-MPS-CONSTITUTIONAL-INVARIANTS.md` §5 (canonical version namespace ownership); also `packages/mps-dep/src/contracts/DependencyArtifacts.ts`, exercised by `packages/mps-compliance/package24/DEP.test.ts` (unregistered in the proof registry) |
| ADR‑24‑09 Constraint Semantics | `ADR-MPS-EVIDENCE-LINEAGE-SLOT.md`; `validateEvidenceSetLineage.ts`; also `packages/mps-dep/src/validation/DependencyConstraintValidator.ts` (unregistered) |
| ADR‑24‑10 Architecture Profiles | `packages/mps-dep/src/contracts/ArchitectureArtifacts.ts` (`ArchitectureProfileArtifact`, `PackageBoundaryProfileArtifact`), exercised by `packages/mps-compliance/package24/ARCH.test.ts`. Code exists, is imported by a test file included in the `packages/mps-compliance/**/*.test.ts` vitest project, and was last touched 2026-08-19 — but has no `architecture-authority-map.jsonc` entry and was not independently re-executed during this closure; **not** "no successor identified", but **not** claimed `PROVEN` either. The other historical generation's same-numbered concept (indicator uniqueness) separately survives under `ADR-MPS-CONSTITUTIONAL-INVARIANTS.md` / `DecisionImpactIdentity.ts`. |
| ADR‑24‑11 Compliance Evidence | `ADR-RUNTIME-SNAPSHOT-BOUNDARY.md` (SNAP boundary); also `packages/mps-compliance/package24/COMPLIANCE.test.ts` (unregistered) |
| ADR‑24‑12 Promotion Decision | `ADR-MPS-CAS-STORAGE-BOUNDARY.md` (CAS‑I02–I04); also `packages/mps-compliance/package24/PROM.test.ts` (unregistered) |
| ADR‑24‑13 Registry Mutation | `ADR-MPS-CAS-STORAGE-BOUNDARY.md` (CAS‑I05–I07, path resolver); also `packages/mps-registry/src/contracts/RegistryMutationArtifacts.ts` (unregistered) |
| ADR‑24‑14 Audit Chain | `ADR-MPS-SINGLE-MATERIALIZATION-AUTHORITY.md`; MIMER‑MAT‑I01; also `packages/mps-compliance/package24/AUD_CHAIN.test.ts` (unregistered) |
| ADR‑24‑15 Artifact Lifecycle | `packages/mps-registry/src/contracts/ArtifactLifecycleArtifact.ts` (`ArtifactLifecycleTransitionArtifact`), exercised by `packages/mps-compliance/package24/LIFE_STATE.test.ts`. Same existence-without-registry-entry status as `24‑10` above — real, wired, unregistered, not independently re-run here. The other historical generation's same-numbered concept ("PostgreSQL Partition Strategy") separately survives under `TV-3.0-PostgreSQL-Physical-Data-Strategy-Freeze.md` / `TV-3.1-Table-Definition-Drafts.md`. |
| ADR‑24‑16 Registry State Model | `packages/mps-registry/src/contracts/RegistryStateArtifact.ts`, exercised by `packages/mps-compliance/package24/REG.test.ts`. Same status as above. The other generation's same-numbered concept ("PostGIS Physical Optimization & SpatialEvidence") separately survives under `TV-4.0-Spatial-Foundation-Roadmap.md`, `ADR-SPATIAL-QUERY-CONTRACT.md`, `ADR-SPATIAL-PRESENTATION-EVIDENCE-CONTRACT.md`. |
| ADR‑24‑17 Governance Policy Model | `packages/mps-governance/src/contracts/PolicyArtifact.ts` + `packages/mps-governance/src/resolver/PolicyResolver.ts`, exercised by `packages/mps-compliance/package24/GOV_POL.test.ts` and `POL.test.ts`. Same status as above. The other generation's same-numbered concept ("Ingest Throughput State Machine") is the specific reason `ADR-MPS-HARVEST-GOVERNED-INGESTION-ORCHESTRATOR.md` (added 2026-08-30) exists — that document is written from current `HarvestOrchestrator`/`ImportGate` code, not from either historical draft, and is now the current authority for that concept. |
| ADR‑24‑18 Event Emission Model | `packages/mps-events/src/engine/EventEngine.ts` + `packages/mps-events/src/resolver/EventResolver.ts`, exercised by `packages/mps-compliance/package24/EVT.test.ts`. Same status as above. `ADR-MPS-CONSTITUTIONAL-INVARIANTS.md` §2 additionally documents a constitutionally frozen `ExecutionEventLog` (append-only governance stream) as the platform-level event-emission mechanism. The other generation's same-numbered concept ("Retrieval Governance & Query Budget") separately survives under `ADR-MPS-CONSTITUTIONAL-INVARIANTS.md` §3 (MIMER‑SCALE‑I01), `packages/mps-retrieval-governance`. |
| ADR‑24‑19 Workflow Contract | `ADR-MPS-CONSTITUTIONAL-INVARIANTS.md` §6 (Materialization Pipeline shape); also `packages/mps-compliance/package24/WF.test.ts` (unregistered) |

This mapping is a provenance record produced during document-authority
normalization (2026-08-30, corrected 2026-08-30 during closure). It is not a
claim that the successor documents/code were derived from either historical
drafting generation — only that they are the current authorities or current
implementations covering overlapping subject matter. Entries marked
"unregistered" are a real, on-disk, test-exercised implementation whose proof
status this document does not assert, per the platform's own rule that a test
file existing or even running is not the same claim as `PROVEN`
(`architecture-authority-map.jsonc`: "PROVEN is a RESULT, not a document
label"). The current, normative constitution is
`ADR-MPS-CONSTITUTIONAL-INVARIANTS.md`.

## Governance Hierarchy (Historical — as originally drafted; non-normative today)
```
LEVEL 0 — CONSTITUTION (historical)
ADR‑24‑20
        ↓ intended to govern (never materialized under this numbering)

LEVEL 1 — GOVERNANCE MODELS (never committed)
ADR‑24‑15 → ADR‑24‑19

LEVEL 2 — OPERATIONAL ARCHITECTURE (never committed)
ADR‑24‑07 → ADR‑24‑14
```
This diagram documents original intent only. The current, normative governance
hierarchy is defined by `ADR-MPS-CONSTITUTIONAL-INVARIANTS.md`.

## Result
ADR‑24‑20 är nu FRYST.
Det är den normativa roten som definierar:
- vad som får räknas som identitet
- vad som får räknas som bevis
- vad som får räknas som beslut
- vad som får räknas som historik
- vad som får räknas som samma objekt
- vad som krävs för reproducerbarhet
- vad som krävs för audit
- vad som krävs för governance

Det är den konstitution som gör Mimer till ett självverifierande styrsystem.
