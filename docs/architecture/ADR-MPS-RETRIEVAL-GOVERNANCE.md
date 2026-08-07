# ADR-MPS-RETRIEVAL: Retrieval Governance Contract

| Field | Value |
| --- | --- |
| **Status** | **FROZEN** |
| **Date** | 2026-08-07 |
| **Package** | `packages/mps-retrieval-governance` |
| **Depends on** | MIMER-MAT-I01, MIMER-SCALE-I01, ADR-MPS-CONSTITUTIONAL |

---

## Constitutional separation

| Dimension | Answers | Layer |
| --- | --- | --- |
| **Policy** | What may the system read? | Retrieval Governance |
| **Budget** | How much may the system read? | Query Budget (next — Commit E) |

Budget MUST NEVER choose a different truth because the plan is expensive.  
Budget MAY only say: this retrieval plan exceeds the operational limit.

---

## Role in the stack

| Layer | Question |
| --- | --- |
| CAS | What is true? |
| Materialization | How is truth produced? |
| **Retrieval Governance** | **What may intelligence use?** |
| Query Budget (later) | How expensive is the chosen strategy? |

```text
Query
 |
 v
Classification
 |
 v
Retrieval Policy  <-- authority boundary (this ADR)
 |
 v
Allowed Artifact Classes
 |
 v
Expansion Plan
 |
 v
Query Budget       <-- operational constraint (later)
 |
 v
Execution
 |
 v
LLM                <-- interpretation/presentation only; never truth creation
```

---

## Frozen invariants

### MIMER-RET-I01

Initial retrieval SHALL resolve through Decision Artifact layer.

### MIMER-RET-I02

Artifact class access SHALL be controlled by versioned retrieval policy.

### MIMER-RET-I03

Retrieval SHALL be read-only and SHALL NOT create authority.

---

## Authority chain

```text
Raw Evidence → Evidence Verification → Materialization Pipeline (ONLY write path)
  → DecisionImpactArtifact → Decision CAS → Retrieval Governance → Query Budget → LLM
```

---

## DoD (v1) — satisfied

- Retrieval can only read
- DecisionImpactArtifact is default authority source
- RawDocumentChunk is never initial retrieval target
- Policy is deterministic and versionable (`ret-policy-1`)
- Tests prove forbidden paths

## Next

[ADR-MPS-QUERY-BUDGET](./ADR-MPS-QUERY-BUDGET.md) — MIMER-BUD-I01..I04 (operational cost over authorized plans).
