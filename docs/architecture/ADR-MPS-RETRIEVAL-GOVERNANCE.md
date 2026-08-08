# ADR-MPS-RETRIEVAL: Retrieval Governance Contract

| Field | Value |
| --- | --- |
| **Status** | **FROZEN** |
| **Date** | 2026-08-07 |
| **Package** | `packages/mps-retrieval-governance` |
| **Depends on** | MIMER-MAT-I01, MIMER-SCALE-I01, ADR-MPS-CONSTITUTIONAL, ADR-MPS-CAS-STORAGE-BOUNDARY, ADR-MPS-SINGLE-MATERIALIZATION-AUTHORITY |
| **Compatible with** | TV-3 PHYS-I01–I06, ADR-MPS-QUERY-BUDGET, ADR-RUNTIME-SNAPSHOT-BOUNDARY |

---

## Constitutional separation

| Dimension | Answers | Layer |
| --- | --- | --- |
| **Policy** | What may the system read? | Retrieval Governance (this ADR) |
| **Budget** | How much / whether execution may proceed? | Query Budget ([ADR-MPS-QUERY-BUDGET](./ADR-MPS-QUERY-BUDGET.md)) |

```text
Wrong:  Budget → picks cheaper source → different truth
Right:  Policy → selects truth source
        Budget → decides whether execution may proceed
```

Budget MUST NEVER choose a different truth because the plan is expensive.  
Budget MAY only say: this retrieval plan exceeds the operational limit.

---

## Role in the stack

| Layer | Question |
| --- | --- |
| CAS | What is true? |
| Materialization | How is truth produced? |
| **Retrieval Governance** | **What may intelligence use?** |
| Query Budget | How expensive is the chosen strategy / may it run? |
| PostgreSQL | Index / projection access (PHYS-I01, PHYS-I06) |
| LLM | Interpretation / presentation only |

```text
Query
 |
 v
Classification
 |
 v
Retrieval Policy  <-- authority-of-access boundary (this ADR)
 |
 v
Allowed Artifact Classes
 |
 v
Expansion Plan
 |
 v
Query Budget       <-- operational constraint only
 |
 v
Retrieval Trace    <-- observation (not authority)
 |
 v
LLM                <-- interpretation/presentation; never truth creation
```

---

## Frozen invariants

### MIMER-RET-I01 — Decision Artifact First

Initial retrieval SHALL resolve through the Decision Artifact layer.

### MIMER-RET-I02 — Policy-Controlled Access

Artifact class access SHALL be controlled by versioned retrieval policy.

### MIMER-RET-I03 — No Authority Creation

Retrieval SHALL be read-only and SHALL NOT create authority.

### MIMER-RET-I04 — Retrieval Projection Boundary

Retrieval SHALL operate only on approved projections derived from authoritative artifacts.

Retrieval SHALL NOT:

- access raw evidence as authority,
- reinterpret source identity,
- create derived facts that become authoritative,
- bypass materialization governance.

Retrieval output is a **selection and presentation layer**, not a truth layer.

```text
Risk blocked by RET-I04 (semantic authority drift):

DecisionImpactArtifact
        |
        v
Retrieval
        |
        v
LLM summary
        |
        v
"new fact"   ← forbidden; RET-I03 blocks write, RET-I04 blocks semantic elevation
```

### MIMER-RET-I05 — Raw Chunk Non-Authority

`RawDocumentChunk` SHALL NOT be used as the initial retrieval authority surface.

Raw chunks MAY be accessed only when:

- referenced by an authorized artifact,
- required for evidence expansion,
- permitted by retrieval policy version.

Raw chunks SHALL NOT override DecisionArtifact identity.

Binds to: SCALE-I01, Query Budget (BUD-I04), CAS hierarchy.

### MIMER-RET-I06 — Policy Identity

Retrieval policy SHALL be:

- versioned,
- content-identified,
- immutable after release,
- included in Retrieval Trace.

A changed retrieval policy SHALL create a **new policy identity**.

```text
Query
 |
 +-- release_hash
 +-- policy_hash
 +-- query_budget   (execution metadata — see BUD-I05/I06)
 |
 v
RetrievalTraceArtifact
```

Current released identity: `ret-policy-1`.

---

## Authority vs consumption (FRYST)

```text
                 AUTHORITY DOMAIN

Raw Evidence
      |
      v
Evidence Verification
      |
      v
Materialization Pipeline
      |
      v
DecisionImpactArtifact
      |
      v
Decision CAS


              CONSUMPTION DOMAIN

Decision CAS
      |
      v
Retrieval Governance
      |
      v
Query Budget
      |
      v
Retrieval Trace
      |
      v
LLM
```

LLM does **not** consume “the database.”  
LLM consumes a **governance-controlled projection**.

---

## Invariant summary

| Invariant | Function |
| --- | --- |
| RET-I01 | Decision Artifact is initial authority |
| RET-I02 | Policy governs artifact access |
| RET-I03 | Retrieval never creates authority |
| RET-I04 | Retrieval is projection access |
| RET-I05 | Raw chunks are not authority |
| RET-I06 | Policy is immutable governance identity |

---

## DoD (v1) — satisfied

- Retrieval can only read (RET-I03)
- DecisionImpactArtifact is default authority source (RET-I01)
- Retrieval operates on approved projections only (RET-I04)
- `RawDocumentChunk` is never initial retrieval authority surface (RET-I05)
- Policy is deterministic, versioned, content-identified (`ret-policy-1`) (RET-I02, RET-I06)
- Tests prove forbidden paths

## Next

[ADR-MPS-QUERY-BUDGET](./ADR-MPS-QUERY-BUDGET.md) — operational cost over **already authorized** plans (BUD-I01..I07).  
Must remain pure drift optimization: never a hidden RET-policy.
