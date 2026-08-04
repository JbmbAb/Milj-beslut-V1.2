# ADR-25-21: Audit Graph Presentation Contract (Phase 21)

## Status
Accepted

## Context
Phase 20 introduced the `CanonicalGraphProjection` and `DeterministicLayoutFunction` to build a pure, reproducible, and verifiable layout for our audit trails. We now need a strict contract for the frontend (Phase 21) to ensure the UI acts exclusively as a read-only viewport. The frontend must not cache, mutate, or synthesize compliance state.

## Decision
We establish the `AuditGraphViewerKernel` as the authoritative interface between the verifiable backend state (represented by the `AuditRenderSnapshotArtifact`) and the frontend presentation layer.

We enact the **VIEW-21** invariants:

### VIEW-21 Invariants

**VIEW-21-I1 — No Rendering of Unknown Nodes**
The Viewer SHALL NOT render unknown or unverified nodes. Any injected node lacking a verifiable artifact reference MUST result in immediate rejection.

**VIEW-21-I3 — Strict Immutability of Graph State**
The Viewer SHALL NOT mutate graph state. All structures provided to the Viewer MUST be deeply frozen. Attempting to alter labels, positions, or hashes MUST throw a `TypeError`.

**VIEW-21-I5 — Render Determinism**
The same `AuditRenderSnapshotArtifact` SHALL produce identical frame hashes. The presentation layer MUST NOT alter its output based on temporal, environmental, or unpredictable browser state.

**VIEW-21-I7 — No Synthesized Provenance Edges**
The Viewer SHALL NOT synthesize provenance edges. All rendered edges MUST be strictly backed by canonical artifact evidence. Any edge lacking evidence MUST result in rejection.

**VIEW-21-I9 — Strict Snapshot Lifecycle**
The Viewer SHALL reject snapshots that do not match the current canonical release state. Cross-release snapshot loading is explicitly forbidden.

**VIEW-21-I11 — Certified Export Proof**
Any compliance export (PDF, report, image) SHALL be backed by an `AuditExportArtifact` that seals the frame hash and renderer version.

## Consequences
- The UI layer cannot use stateful graph caching systems (like Redux or IndexedDB) that assume ownership of the graph data.
- The UI becomes a pure "audit-browser" where interactions (e.g. clicking a node) trigger a resolution of a `ProofPath`, pulling raw artifact details strictly from the backend kernel.
- The `AuditRenderSnapshotArtifact` is introduced to formalize the bridge between Phase 20 and 21, closing the loop on graph determinism prior to rendering.
