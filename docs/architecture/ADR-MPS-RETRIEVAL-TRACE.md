# ADR-MPS-RETRIEVAL-TRACE: Retrieval Execution Trace

| Field | Value |
| --- | --- |
| **Status** | **FROZEN** (Commit F) |
| **Date** | 2026-08-07 |
| **Package** | `packages/mps-retrieval-trace` |
| **Depends on** | ADR-MPS-RETRIEVAL-GOVERNANCE, ADR-MPS-QUERY-BUDGET |

---

## Role

Observation surface only — **not** authority, cache, or DecisionImpact.

```text
Retrieval Governance → Query Budget → Retrieval Trace → LLM Projection
```

Hard invariant:

```text
RetrievalTrace
      |
      X
      |
DecisionImpactArtifact
```

---

## Identity vs metadata

**Identity → `trace_hash`:**

```text
canonical(query_hash, policy_version, artifact_snapshot, selected_refs, budget_profile, expansion_path)
```

**Metadata (excluded):** `duration_ms`, `estimated_cost`, `token_estimate`, `executed_at`, user, model name.

---

## Invariants

### TRACE-I01 — Trace is reproducible

Same identity fields ⇒ same `trace_hash` regardless of metadata.

### TRACE-I02 — Trace can never create authority

RetrievalTrace SHALL NEVER write DecisionImpactArtifact / Decision Truth CAS.

### RET-I05 — Retrieval set stability

Same query + policy + artifact snapshot ⇒ same selected refs / `trace_hash`.

---

## Related

**SCALE-I01** (in `mps-query-budget`): RawDocumentChunk → Query Budget → DecisionImpactArtifact throws `AUTHORITY_BOUNDARY_VIOLATION`.
