# ADR-26-22: Human Governance Interface (Phase 22)

## Status
Accepted

## Context
Following the completion of the Global Audit Graph (Phase 20) and the Audit Graph Presentation Contract (Phase 21.5), we are introducing the Human Governance Interface (Phase 22). The goal is to introduce human observation into the system without allowing the human viewer to become a secondary source of truth. Human viewing must be isolated into an ephemeral observation boundary.

## Decision
We enact the **VIEW-22** and **PROOF-22** invariants to secure the human interface boundary:

### VIEW-22 Invariants

**VIEW-22-I2 — Capability Provenance**
A viewer capability MUST itself have provenance. It cannot act as a root of trust. A capability must reference the `viewer_identity_ref`, the `granted_by` authority, a valid `policy_ref`, and have a strict `expires_at` boundary.

**VIEW-22-I4 — Audit Session Boundary**
Human observation MUST be recorded in an `AuditSessionArtifact` to separate ephemeral viewing state from canonical truth. A session must be bound to a `ViewerCapabilityArtifact` and explicitly track `inspected_nodes` and `exported_artifacts`.

**VIEW-22-I5 — Viewport Bounding**
Viewer SHALL never materialize more graph state than the active viewport contract permits. This acts as a DoS protection against massive fan-out.

### `VIEW-22-I6`: Strict Probibition on Capability Union
Multiple active capabilities are strictly forbidden. A session must assume exactly ONE deterministic `ViewerCapabilityArtifact` state at a time. The union of separate capabilities is mathematically undefined and introduces unauthorized escalation risks.

### `GOVERNANCE-22.9-I13`: Observation Cannot Become Authority
A `ViewerKernel` can only produce sessions, proof requests, and export requests. It **SHALL NEVER** produce artifacts, governance states, or compliance states. The path from Canonical State to Human UI is strictly unidirectional. UI observation does not alter truth.

**VIEW-22-I7 — Domain Graph Separation**
The Audit Graph SHALL NOT contain domain truth. Domain artifacts (e.g., properties, environmental observations) MAY ONLY be linked as external `evidence_ref`s. The Audit Graph remains exclusively dedicated to the epistemological question: "Why does the system know/allow this?"

### PROOF-22 Invariants

**PROOF-22-I2-A — Forward Integrity**
Target artifacts exposed in the Human Governance Interface MUST have a verified proof closure resolving to the release root.

**PROOF-22-I2-B — Backward Completeness**
The Release root MUST explain all referenced governance dependencies.

**PROOF-22-I2 — No Heuristics**
Proof resolution SHALL only traverse explicitly declared artifact references. Implicit relationships SHALL NOT be inferred.

**PROOF-22-I8 — Materialization Budget**
To prevent massive fan-out DoS, graph materialization must be bounded by strict `max_nodes`, `max_edges`, and `max_depth`. Violations throw `REJECT_PROOF_SCOPE_EXCEEDED`.

**PROOF-22-I9 — Cache Purity**
Proof Path Caching MUST NOT survive process lifetime, MUST NOT influence verification outcomes, and hits/misses MUST produce mathematically identical results.

## Consequences
- The system incorporates `AuditSessionArtifact` for human interactions.
- `ViewerCapabilityArtifact` is hardened with required provenance fields.
- `ProofCompletenessValidator` enforces strict forward and backward validity checks bound to a strict root identity.
- Audit queries are strictly constrained to `resolveProofPath`, preventing arbitrary "graph searches" from generating unverified semantic meaning. `ProofQuestion` must be strictly typed.
- All proof traversal is explicitly iterative to protect against recursive stack overflows.
- A `ProofResolutionBudget` prevents DoS attacks during resolution.
