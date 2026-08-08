# TV-3.3 — `document_chunk` Partition Decision Template

| Field | Value |
| --- | --- |
| **Status** | **Deferred — Decision Required** (template FROZEN; verdict open) |
| **Date** | 2026-08-07 |
| **Edition** | Optimized |
| **Parent** | [TV-3.0](./TV-3.0-PostgreSQL-Physical-Data-Strategy-Freeze.md) |
| **Evidence input** | [TV-3.2](./TV-3.2-Metrics-Observability-Spec.md) |
| **Design context** | [TV-3.1](./TV-3.1-Table-Definition-Drafts.md) §4 |
| **Purpose** | Controlled decision gate for potential partitioning of `document_chunk` |
| **Scope** | Retrieval substrate: ANN, pgvector/HNSW, metadata filters, high-volume operational load |

**This document does not approve partitioning.** It freezes *how* the decision is made. A filled decision record is required before any migration.

---

## 1. Context

`document_chunk` is a **retrieval substrate**, not an authority surface (PHYS-I01, RET / SCALE-I01).

```
CAS
 → Verified Evidence
 → Materialization
 → Retrieval Projection
 → document_chunk
 → ANN Retrieval
```

Partitioning affects:

| Surface | Risk if mishandled |
| --- | --- |
| ANN determinism | Ordering / recall drift |
| HNSW stability | Per-partition indexes, rebuild cost |
| Metadata filtering | Planner / prune behavior |
| Operational cost | VACUUM, storage, memory |
| Recovery hierarchy | Index rebuild from CAS must remain intact |
| Cross-domain access | Joins and CAS-referencing lookups |

**Therefore:** partitioning is an **architectural decision**, not a database optimization.

---

## 2. Partition candidates

| ID | Strategy | Pros | Cons |
| --- | --- | --- | --- |
| **A** | Temporal `RANGE` (immutable evidence-derived temporal key) | Lifecycle clarity; retention simplicity | Multiple HNSW indexes; weak temporal pruning for ANN; recall risk |
| **B** | Municipality `RANGE`/`LIST` | Locality for municipal workloads | Skew; partition explosion; global retrieval degradation |
| **C** | **No partitioning** (baseline) | Best ANN determinism; simplest HNSW maintenance | Long-term index growth; vacuum pressure risk |

**Candidate A — temporal key constraint (PHYS-I02 / PHYS-I03):**

Temporal `RANGE` MUST use an **immutable evidence-derived** temporal key (e.g. authority-sourced `decision_date`).  
The partition key SHALL NOT be an operational timestamp such as `created_at` unless explicitly justified by measured retrieval access patterns.

**Default under fail-closed:** Candidate **C**.

Candidate A/B MAY only be chosen after TV-3.2 evidence + all gates in §4 pass. Partition key MUST be semantically justified by measured access patterns (PHYS-I02 / TV-3.0 §3.1).

---

## 3. Mandatory measurements (TV-3.2)

Attach the [TV-3.2 evidence package](./TV-3.2-Metrics-Observability-Spec.md#4-minimum-evidence-package-for-tv-33). Minimum coverage:

### Retrieval performance

- ANN latency p50 / p95 / p99
- Metadata-filter latency
- Broad vs narrow query behavior

### Index behaviour

- HNSW build / rebuild time
- Index size & memory footprint
- Cache hit ratio

### Operational cost

- VACUUM duration
- ANALYZE duration
- Dead-tuple growth
- Monthly storage growth

### Cross-domain access

- Join patterns (documented)
- CAS-referencing queries (digest lookup only)
- Temporal vs non-temporal access share

Shadow mode (partitioned vs baseline) is required for A/B proposals.

---

## 4. Decision criteria (fail-closed)

Partitioning (A or B) MAY be **APPROVED** only if **all** gates pass. Mapping to TV-3.2 G1–G8:

| Gate | Requirement | TV-3.2 |
| --- | --- | --- |
| ANN Determinism | No regression in ordering, recall, or stability | G1 + shadow |
| ANN Latency | No significant p95/p99 degradation vs agreed threshold | G1 |
| Index Rebuild | Operationally acceptable (measured) | G3 |
| Recovery | Unchanged or improved (CAS → materialized truth → indexes) | G5 |
| Query Planner | Stable; no cross-partition regressions | G4 |
| Cross-domain Access | No negative impact (or re-approved joins) | G4 |
| CAS Authority | Unchanged (PHYS-I01, MAT-I05) | G6–G7 |
| Operational Cost | Within budget (vacuum / storage / memory) | G2–G3 |
| Retrieval Determinism | Same governed corpus + policy SHALL produce equivalent retrieval ranking within accepted tolerance | G8 |

**If any gate fails → Candidate C (no partitioning).**

Numeric thresholds are recorded in the filled decision output (§7), not in this template.

---

## 5. Migration requirements (only if APPROVED for A or B)

```
old document_chunk
      ↓
shadow partitioned structure
      ↓
controlled backfill
      ↓
HNSW rebuild (validated)
      ↓
ANN determinism check
      ↓
cutover
```

### Chunk Identity Boundary (FRYST)

**Invariant CHUNK-I01 — Partition key is not identity**

Partitioning SHALL NOT change chunk identity.

Identity is bound to:

- source document identity
- canonical chunk content
- chunking strategy version
- tokenizer version

Partition key = **storage concern**, not identity concern.

### HNSW Index Boundary (FRYST)

**Invariant CHUNK-I02 — HNSW rebuild is an operational event**

Migration MUST define:

| Item | Required |
| --- | --- |
| Index build procedure | yes |
| Memory requirements | yes |
| Concurrent build strategy | yes |
| Validation dataset | yes |
| Rollback procedure | yes |

HNSW rebuild = operational event, **not** schema migration and **not** authority change.

### Cutover constraints

- No live cutover without ANN determinism check against validation dataset
- Rollback MUST restore baseline ANN behavior without CAS mutation
- Prisma / FK implications (composite keys if partitioned) belong in the implementation ADR after approval — not in this template

---

## 6. Non-goals

Partitioning SHALL NOT:

- create new authority
- alter CAS semantics
- modify materialization logic
- bypass retrieval governance / query budget
- introduce implicit read-authority in Postgres (PHYS-I04)
- introduce Postgres-only non-rebuildable state (PHYS-I06)

---

## 7. Decision output template

Fill and archive under `docs/architecture/tv-3/decisions/` when a verdict is taken (human in the loop).

```text
TV-3.3 Decision:
Date: YYYY-MM-DD
Evidence window: ...
Approver: ...

Candidate: A | B | C
Decision: APPROVED | REJECTED

Rationale Summary:
- ANN determinism: ...
- ANN latency: ...
- Index behaviour: ...
- Recovery: ...
- Cross-domain access: ...
- CAS authority: ...
- Operational cost: ...
- Retrieval determinism (G8): ...

Thresholds used:
- ANN p95 max delta: ...
- ANN p99 max delta: ...
- rebuild max duration: ...
- storage / vacuum budget: ...
- ranking / recall tolerance (G8): ...

Attached evidence:
- [ ] TV-3.2 volume snapshot
- [ ] ANN latency report (shadow vs control)
- [ ] vacuum / bloat sample
- [ ] index size trend
- [ ] query-pattern summary
- [ ] shadow-mode delta table
- [ ] G5–G8 sign-off
- [ ] G8 recall / ranking delta / false-negative analysis

Migration Required: YES | NO
Migration Strategy (if YES):
- shadow structure: ...
- backfill: ...
- HNSW rebuild: ...
- validation: ...
- cutover: ...

Rollback Strategy:
- ...
```

Until a filled record exists, PHYS-I02 holds: **do not partition `document_chunk`**.

---

## 8. TV-3 completion matrix

| TV | Result | Status |
| --- | --- | --- |
| [TV-3.0](./TV-3.0-PostgreSQL-Physical-Data-Strategy-Freeze.md) | PostgreSQL Physical Strategy Freeze | **FRYST** |
| [TV-3.1](./TV-3.1-Table-Definition-Drafts.md) | Table Designs (design-only) | Design-only |
| [TV-3.2](./TV-3.2-Metrics-Observability-Spec.md) | Metrics & Observability | Spec |
| **TV-3.3** (this document) | Partition Decision Gate | Template FROZEN; verdict deferred |

**TV-3 suite is complete as architecture.** Executable partition work remains blocked until §7 is filled with Candidate A/B **APPROVED** (or explicitly closed as C).

---

## Related

- [TV-3.0](./TV-3.0-PostgreSQL-Physical-Data-Strategy-Freeze.md) — PHYS-I01–I05
- [TV-3.1](./TV-3.1-Table-Definition-Drafts.md) — `document_chunk` deferral
- [TV-3.2](./TV-3.2-Metrics-Observability-Spec.md) — G1–G7 + evidence package
- [ADR-MPS-RETRIEVAL-GOVERNANCE](./ADR-MPS-RETRIEVAL-GOVERNANCE.md)
- [ADR-MPS-QUERY-BUDGET](./ADR-MPS-QUERY-BUDGET.md)
- [ADR-MPS-CAS-STORAGE-BOUNDARY](./ADR-MPS-CAS-STORAGE-BOUNDARY.md)
- Quarantined stub: [`tv-3/stubs/document_chunk_partition_QUARANTINED.sql`](./tv-3/stubs/document_chunk_partition_QUARANTINED.sql)
