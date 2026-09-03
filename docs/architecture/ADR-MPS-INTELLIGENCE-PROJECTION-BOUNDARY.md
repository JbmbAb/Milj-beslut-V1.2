# ADR-MPS-INTELLIGENCE-PROJECTION-BOUNDARY: Intelligence Projection Boundary

**Date**: 2026-08-07
**Status**: FROZEN

**Legacy identifier:** ADR-29 (2026-08-07) — renumbered during document-authority
normalization (2026-08-30) to join the `ADR-MPS-*` constitutional-invariant family
(MIMER-SCALE-I01 is enforced alongside MIMER-RET-I0*/MIMER-MAT-I01 from that
lineage). Content and the MIMER-SCALE-I01 invariant unchanged.

## Context
Mimer Platform Edition is expanding to support hundreds of millions of environmental records, documents, and spatial artifacts. Historically, AI models have directly queried the raw `DocumentChunk` and `LegalCorpusChunk` evidence layers. This turns the AI into an implicit OLAP engine, leading to exponential increases in token costs, latency, and context-window saturation as the dataset grows. Furthermore, relying on AI to summarize raw evidence dynamically at inference time breaks the deterministic replayability and verification guarantees of the platform.

To scale securely and efficiently, we must establish a hard boundary between raw evidence and AI intelligence.

## Decision
We establish the **Decision Knowledge Plane** governed by the following core invariant (**MIMER-SCALE-I01**):

> **MIMER-SCALE-I01**: 
> Raw evidence SHALL only serve verification and provenance.
> Decision artifacts SHALL serve intelligence and reasoning.
> Runtime snapshots SHALL serve replay acceleration.
> These three layers SHALL NOT be merged.

The architecture strictly enforces three distinct lifecycles:

1. **RAW EVIDENCE**: Sourced from external systems, hashed, and stored in CAS. Serves only verification and spatial search.
2. **DECISION ARTIFACTS (Projections)**: Materialized facts generated from Raw Evidence. Serves AI reasoning and intelligence.
3. **RUNTIME SNAPSHOTS**: Compacted state vectors. Serves only the Replay Engine.

**Projections (DecisionImpactArtifact):**
- Projections MAY be created.
- Projections MAY be versioned.
- Projections MAY be superseded.
- Projections MAY be verified.
- Projections **SHALL NEVER** mutate the source evidence.

### Knowledge Plane Boundary Invariant

> **MIMER-SCALE-I02**: 
> General analytical retrieval SHALL begin from Decision artifacts.
> Raw Evidence SHALL only be expanded when required for verification, citation, or drill-down.

This ensures the QueryPlanner is the sole component choosing between `DecisionImpactArtifact`, `EvidenceSet`, and `Raw Evidence`. No other part of the AI layer may bypass this and directly query `DocumentChunk`.

## Belastningsmodell (Scalability Proof)

To prove the scaling invariant, we contrast the legacy architecture with the new Knowledge Plane:

### Före (Exponential AI Cost)
```text
User Query -> DocumentChunk Retrieval (10M chunks) -> LLM Synthesis
```
**Problemet**: AI becomes a history engine, aggregation engine, and database query engine. Token cost and latency scale linearly with historical data volume.

### Efter (Constant AI Cost)
```text
User Query -> Query Planner -> DecisionImpactArtifact -> EvidenceSetArtifact & targeted expansion -> LLM reasoning
```
**Lösningen**: The LLM works strictly with pre-materialized decision facts + verifiable evidence. It does **not** process the entire raw history. Token cost remains roughly constant regardless of total historical volume, shifting the load curve from AI back to the database.

## Executable retrieval contract

Frozen in `packages/mps-decision-governance/src/DecisionRetrievalContract.ts` (version `"1"`):

**Allowed:**

```text
GENERAL QUERY
        ↓
DecisionImpactArtifact
        ↓
(optional) EvidenceSet
        ↓
(optional) Raw Evidence
```

**Forbidden:**

```text
GENERAL QUERY
        ↓
Raw Evidence
```

**Invariant (executable MIMER-SCALE-I01):**  
Raw Evidence SHALL NOT be the initial retrieval target for analytical queries.  
Raw expansion MUST pass through EvidenceSet (no DecisionImpact → Raw skip).  
AI MUST NOT use raw material as the primary knowledge source as data volume grows.

Modules:

| Module | Responsibility |
| --- | --- |
| `DecisionKnowledgeRepository` | CAS: hash → artifact (no AI) |
| `DecisionKnowledgeResolver` | Traversal: Impact → EvidenceSet → documents (no LLM) |
| `DecisionExpansionPlanner` | Bounded expansion plan/execute |
| `DecisionRetrievalContract` | Frozen pipeline + I01 checks |

## Consequences
- **Positive**: AI cost and latency decouple from data volume. The AI only reads heavily distilled, mathematically verified `DecisionImpactArtifacts`.
- **Positive**: The Replay Engine remains isolated from AI reasoning formats, ensuring Sovereign DoD compliance.
- **Negative**: Adds architectural complexity by introducing a materialization step before data becomes available for AI querying.
