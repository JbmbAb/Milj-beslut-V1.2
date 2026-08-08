# ADR-MPS-QUERY-BUDGET: Query Budget Contract

| Field | Value |
| --- | --- |
| **Status** | **FROZEN** (Commit E) |
| **Date** | 2026-08-07 |
| **Package** | `packages/mps-query-budget` |
| **Depends on** | ADR-MPS-RETRIEVAL-GOVERNANCE (MIMER-RET-I01..I06) |

---

## Separation

| Layer | Question |
| --- | --- |
| Retrieval Governance | **What** may be read? (truth source / artifact class) |
| **Query Budget** | **How much** may be read / may execution proceed? |

```text
Wrong:  Budget → picks cheaper source → different truth
Right:  Policy → selects truth source
        Budget → decides whether execution may proceed
```

Budget SHALL NEVER say: “this truth is too expensive, pick another truth.”  
Budget MAY only say: “this retrieval plan exceeds the operational limit.”

---

## Order

```text
Query
 |
 v
Retrieval Policy
 |
 v
Allowed Artifact Classes
 |
 v
Expansion Plan
 |
 v
Budget Evaluation
 |
 +-----> Execution Trace (metadata only)
 |
 v
Retrieval
 |
 v
LLM
```

Not:

```text
Budget
 |
 v
Choose another artifact
```

---

## Stack placement (after RET freeze)

```text
                 CAS
                  |
                  v
       Materialization Authority
                  |
                  v
       DecisionImpactArtifact
                  |
                  v
       Retrieval Governance
        (What may be read?)
                  |
                  v
       Query Budget
        (How much may be read?)
                  |
                  v
       Retrieval Execution
                  |
                  v
              LLM
        (interpretation only)
```

| Layer | Owns |
| --- | --- |
| CAS | Identity and content |
| Materialization | Creation of decision truth |
| Retrieval Governance | Access policy |
| Query Budget | Operational cost |
| PostgreSQL | Index / projection (PHYS-I01, PHYS-I06) |
| LLM | Language and presentation |

---

## Invariants

### MIMER-BUD-I01 — Budget Isolation

Budget decisions SHALL NOT alter artifact identity, decision identity, or materialization output.

Same query + `policy_version` + `artifact_snapshot` with `budget=1000` vs `budget=10000`  
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

### MIMER-BUD-I05 — Budget Metadata Exclusion

Query budget state SHALL NOT participate in:

- `artifact_hash`
- `decision_identity_hash`
- `materialization_hash`
- lineage identity
- CAS object identity

Budget parameters are **execution metadata only**.

Changing:

- token budget
- latency budget
- expansion limit
- cost threshold

SHALL NOT produce a new truth identity.

### MIMER-BUD-I06 — Budget Snapshot Binding

Every retrieval execution SHALL record:

- `budget_policy_version`
- `budget_parameters`
- `estimated_cost`
- `final_budget_state`

inside execution / retrieval-trace **metadata**.

Budget metadata is audit information only.  
It SHALL NOT influence authority resolution.

### MIMER-BUD-I07 — Partial Result Integrity

A `PARTIAL` retrieval result SHALL:

- preserve artifact identity
- preserve policy compliance
- preserve lineage references
- explicitly declare incompleteness

A `PARTIAL` result SHALL NOT:

- remove evidence references silently
- downgrade authority class
- substitute forbidden artifact classes
- imply completeness

---

## Invariant summary

| Invariant | Function |
| --- | --- |
| BUD-I01 | Budget does not alter truth identities |
| BUD-I02 | Budget is operational only |
| BUD-I03 | Soft failure first (v1) |
| BUD-I04 | Budget cannot override RET policy |
| BUD-I05 | Budget excluded from authority hashes |
| BUD-I06 | Budget recorded as trace metadata |
| BUD-I07 | PARTIAL preserves integrity + declares incompleteness |

---

## Package boundary

```text
mps-retrieval-governance/   ← policy (authority-of-access)
mps-query-budget/           ← operational cost (this ADR)
```

Do not merge these packages.

---

## SCALE-I01 — End-to-end negative boundary

`executeQueryBudget({ artifactClass: "RawDocumentChunk", target: "DecisionImpactArtifact" })`  
SHALL throw `AUTHORITY_BOUNDARY_VIOLATION`.

Budget MUST NOT become an alternate path around Materialization / Retrieval authority.

---

## Compatibility

| Prior freeze | Status |
| --- | --- |
| CAS-I02–I07 | Compatible |
| MAT-I05 Single Materialization Authority | Compatible |
| PHYS-I01 / PHYS-I06 PostgreSQL not authority | Compatible |
| RET-I01–I06 Retrieval boundary | Compatible |
| BUD-I01–I07 Operational isolation | This ADR |

## Next

Observation of budget decisions without authority: Retrieval Trace / Runtime Execution Evidence  
([ADR-MPS-RETRIEVAL-TRACE](./ADR-MPS-RETRIEVAL-TRACE.md)).
