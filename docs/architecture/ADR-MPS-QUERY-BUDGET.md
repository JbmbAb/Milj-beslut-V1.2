# ADR-MPS-QUERY-BUDGET: Query Budget Contract

| Field | Value |
| --- | --- |
| **Status** | **FROZEN** (Commit E) |
| **Date** | 2026-08-07 |
| **Package** | `packages/mps-query-budget` |
| **Depends on** | ADR-MPS-RETRIEVAL-GOVERNANCE (MIMER-RET-I01..I03) |

---

## Separation

| Layer | Question |
| --- | --- |
| Retrieval Governance | What may be read? |
| **Query Budget** | **How much may be read?** |

Budget SHALL NEVER say: “this truth is too expensive, pick another truth.”  
Budget MAY only say: “this retrieval plan exceeds the operational limit.”

---

## Order

```text
Query → Classification → Retrieval Policy → Allowed Artifact Classes
      → Expansion Strategy → Budget Evaluation → Execution → LLM
```

---

## Invariants

### MIMER-BUD-I01 — Budget Isolation

Budget decisions SHALL NOT alter artifact identity, decision identity, or materialization output.

Same query + policy_version + artifact_snapshot with `budget=1000` vs `budget=10000`  
⇒ identical `artifact_hash` / `decision_identity_hash` / `materialization_hash`.

### MIMER-BUD-I02 — Budget Is Operational Only

Budget MAY affect: execution path, expansion depth, warning state, degraded (`PARTIAL`) response.  
Budget MUST NOT affect: truth, lineage, CAS, authority.

Allowed: `{ "status": "PARTIAL", "reason": "QUERY_BUDGET_SOFT_LIMIT" }`  
Forbidden: rewriting `decision_facts` because the budget ran out.

### MIMER-BUD-I03 — Soft Failure First

v1: estimate → threshold → telemetry warning → **continue** (not block).

Events: `QUERY_BUDGET_ESTIMATED` | `QUERY_BUDGET_WARNING` | `QUERY_BUDGET_EXCEEDED` | `QUERY_BUDGET_OVERRIDE`

### MIMER-BUD-I04 — Budget Cannot Hide Policy Violations

Budget SHALL only evaluate already authorized retrieval plans.  
High budget MUST NOT allow `RawDocumentChunk` when policy forbids it.

---

## Package boundary

```text
mps-retrieval-governance/   ← policy (authority)
mps-query-budget/           ← operational cost (this ADR)
```

Do not merge these packages.

---

## SCALE-I01 — End-to-end negative boundary

`executeQueryBudget({ artifactClass: "RawDocumentChunk", target: "DecisionImpactArtifact" })`  
SHALL throw `AUTHORITY_BOUNDARY_VIOLATION`.

Budget MUST NOT become an alternate path around Materialization / Retrieval authority.
