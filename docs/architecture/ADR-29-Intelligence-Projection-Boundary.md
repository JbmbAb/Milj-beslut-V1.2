# ADR-29: Intelligence Projection Boundary

**Date**: 2026-08-07
**Status**: Accepted

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

## Consequences
- **Positive**: AI cost and latency decouple from data volume. The AI only reads heavily distilled, mathematically verified `DecisionImpactArtifacts`.
- **Positive**: The Replay Engine remains isolated from AI reasoning formats, ensuring Sovereign DoD compliance.
- **Negative**: Adds architectural complexity by introducing a materialization step before data becomes available for AI querying.
