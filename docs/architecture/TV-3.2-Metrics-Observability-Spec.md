# TV-3.2 — Metrics & Observability Spec (for TV-3.3)

| Field | Value |
| --- | --- |
| **Status** | **SPEC** — collection required before TV-3.3 decision |
| **Date** | 2026-08-07 |
| **Parent** | [TV-3.0](./TV-3.0-PostgreSQL-Physical-Data-Strategy-Freeze.md) |
| **Purpose** | Produce measured evidence for whether `document_chunk` may be partitioned |
| **Does not authorize** | Partition DDL, production cutover, ANN index rebuild as authority change |

---

## 1. Metrics to collect

### 1.1 Chunk volume

| Metric | Unit | Notes |
| --- | --- | --- |
| Total chunk count | count | Live `DocumentChunk` (+ any projection twin) |
| Chunks per document | distribution (p50/p95/max) | Hot-document skew |
| Chunks per municipality | count | Governance join pressure |
| Growth rate | chunks / month | Capacity planning |

### 1.2 ANN latency

| Metric | Unit | Notes |
| --- | --- | --- |
| HNSW search latency | ms — p50 / p95 / p99 | Primary ANN path |
| Metadata-filter latency | ms — p50 / p95 / p99 | Filter-then-ANN or ANN-then-filter |
| Vector-scan fallback frequency | rate | When HNSW/path cannot be used |

### 1.3 Vacuum pressure

| Metric | Unit | Notes |
| --- | --- | --- |
| Vacuum cost (candidate) | time / I/O | Per hypothetical partition |
| Bloat growth | % / week | Heap + TOAST |
| Index fragmentation | qualitative + size delta | HNSW + btree |

### 1.4 Index size

| Metric | Unit | Notes |
| --- | --- | --- |
| HNSW index size | bytes | Correlate with QPS |
| Metadata index size | bytes | btree / gin as applicable |
| Size vs query frequency | ratio | Avoid oversized cold indexes |

### 1.5 Query patterns

| Metric | Notes |
| --- | --- |
| Top-N retrieval queries | Shape, filter columns, temporal vs non-temporal |
| Cross-domain joins | Frequency + documented justification (PHYS-I04) |
| CAS-referencing queries | Digest lookups only — no identity minting |
| Temporal vs non-temporal access | Critical for whether a time partition key is even valid |

---

## 2. Observability requirements

### 2.1 OTEL instrumentation

| Signal | Requirement |
| --- | --- |
| `retrieval_trace` events | Emit per retrieval execution (TRACE package); never write DecisionImpact |
| ANN latency metrics | Histograms for HNSW + filter paths |
| Chunk access patterns | document_id / municipality / temporal bucket (aggregated) |
| Partition-candidate stress | Controlled load tests against shadow layouts |

### 2.2 Shadow mode

Simulate **partitioned vs non-partitioned** chunk table without cutting over production:

| Experiment | Measure |
| --- | --- |
| Partitioned shadow | ANN degradation (Δ p95 / p99) |
| Same workload | Cross-partition scan frequency |
| Same workload | Vacuum / index size deltas |
| Recovery drill | Rebuild index from CAS/materialized truth still feasible |

Shadow results feed TV-3.3; they are not themselves authority.

---

## 3. Decision gates for TV-3.3

Partitioning of `document_chunk` MAY proceed only if **all** gates pass:

| Gate | Criterion |
| --- | --- |
| G1 ANN | ANN latency within agreed threshold (p95/p99) |
| G2 Vacuum | Vacuum pressure manageable under projected growth |
| G3 Index | Index size stable / predictable |
| G4 Joins | Documented cross-domain joins unaffected or re-approved |
| G5 Recovery | Recovery hierarchy intact (CAS → materialized truth → indexes) |
| G6 CAS | CAS authority preserved (no Postgres-as-truth) |
| G7 Authority | No authority inversion risk (PHYS-I01, PHYS-I04, MAT-I05) |
| G8 Determinism | Deterministic Retrieval Equivalence (see below) |

### G8 — Deterministic Retrieval Equivalence

Partitioning SHALL NOT change retrieval determinism.

The same:

- query embedding
- retrieval policy
- corpus state
- governance release

SHALL produce equivalent ranked retrieval results within the accepted evaluation tolerance.

Validation requires:

- recall comparison
- ranking delta analysis
- false negative analysis

| Gate | Secures |
| --- | --- |
| G1 ANN | Retrieval performance |
| G2 Vacuum | Operability |
| G3 Index | Storage scalability |
| G4 Joins | Domain separation |
| G5 Recovery | Rebuild capability (PHYS-I05) |
| G6 CAS | Authority boundary |
| G7 Authority | Governance integrity |
| G8 Determinism | Reproducible retrieval |

**Fail-closed:** any failed gate ⇒ remain unpartitioned; re-measure after remediation.

Threshold numbers are set in the filled [TV-3.3](./TV-3.3-Document-Chunk-Partition-Decision-Template.md) decision record (not in this spec). This document defines *what* must be measured, not the numeric SLOs.

---

## 4. Minimum evidence package for TV-3.3

A TV-3.3 proposal MUST attach:

1. Volume snapshot (1.1) with measurement window
2. ANN latency report (1.2) partitioned vs control
3. Vacuum / bloat sample (1.3)
4. Index size trend (1.4)
5. Query-pattern summary (1.5) including temporal access share
6. Shadow-mode delta table (2.2)
7. Explicit sign-off that G5–G8 hold (human in the loop)
8. Determinism package for G8 (recall / ranking delta / false negatives)

---

## Related

- [TV-3.0](./TV-3.0-PostgreSQL-Physical-Data-Strategy-Freeze.md)
- [TV-3.1](./TV-3.1-Table-Definition-Drafts.md)
- [TV-3.3](./TV-3.3-Document-Chunk-Partition-Decision-Template.md)
- [ADR-MPS-RETRIEVAL-TRACE](./ADR-MPS-RETRIEVAL-TRACE.md)
- [ADR-MPS-QUERY-BUDGET](./ADR-MPS-QUERY-BUDGET.md)
- [postgis_scalability_report.md](./postgis_scalability_report.md) — separate ops partitioning track
