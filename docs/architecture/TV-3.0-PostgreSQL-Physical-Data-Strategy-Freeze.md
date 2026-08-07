# TV-3.0 — PostgreSQL Physical Data Strategy Freeze

| Field | Value |
| --- | --- |
| **Status** | **FRYST** (ACTIVE Final) |
| **Date** | 2026-08-07 |
| **Type** | Physical data architecture freeze — **not** a migration plan |
| **Depends on** | [ADR-MPS-CAS-STORAGE-BOUNDARY](./ADR-MPS-CAS-STORAGE-BOUNDARY.md), [ADR-MPS-MATERIALIZATION-BOUNDARY](./ADR-MPS-MATERIALIZATION-BOUNDARY.md), [ADR-MPS-SINGLE-MATERIALIZATION-AUTHORITY](./ADR-MPS-SINGLE-MATERIALIZATION-AUTHORITY.md), [ADR-RUNTIME-SNAPSHOT-BOUNDARY](./ADR-RUNTIME-SNAPSHOT-BOUNDARY.md) |
| **Unlocks** | TV-3.1 (design drafts), TV-3.2 (metrics), TV-3.3 (chunk partition decision) |
| **Non-goals** | Runnable migrations, Prisma schema cutover, PostGIS spatial partitioning (TV-4), ingest throughput (TV-5) |

---

## 1. Scope

TV-3.0 freezes the **physical role and partitioning principles** of PostgreSQL in Mimer / Miljöbeslut.

This document answers:

- what PostgreSQL is allowed to be
- when partitioning may be introduced
- which domains own which tables
- how recovery relates to physical layout

It does **not** authorize schema deploy, data cutover, or partition of `document_chunk`.

Companion docs:

| Doc | Role |
| --- | --- |
| [TV-3.1](./TV-3.1-Table-Definition-Drafts.md) | Design-only DDL drafts |
| [TV-3.2](./TV-3.2-Metrics-Observability-Spec.md) | Metrics required before TV-3.3 |
| [TV-3.3](./TV-3.3-Document-Chunk-Partition-Decision-Template.md) | Partition decision gate (template FROZEN; verdict deferred) |

---

## 2. PostgreSQL’s role (FRYST)

PostgreSQL **is**:

| Role | Meaning |
| --- | --- |
| Index engine | Lookup, filters, secondary indexes |
| Spatial query engine | PostGIS predicates and joins (operational projection) |
| Operational metadata store | Runtime/ops metadata that is discardable and rebuildable |

PostgreSQL **is not**:

| Forbidden role | Authority lives in |
| --- | --- |
| CAS | Content-addressed store (CAS-I02–I07) |
| Decision Authority | Single Materialization Authority (MAT-I05) |
| Materialization Truth | Materialization Pipeline + governance identity |

```
Authority
   │
   v
  CAS
   │
   +── Governance metadata / event history
   │
   v
Materialized truth (CAS-bound)
   │
   v
PostgreSQL read models / indexes / acceleration
```

**Invariant PHYS-I01 — Read model, not authority store**

PostgreSQL SHALL hold only derived, discardable, or operational state.
Database optimization SHALL NOT create, mutate, or imply Decision Authority.

---

## 3. Partitioning principles

### 3.1 Ground rule (FRYST)

**No partition without access-pattern proof.**

Partitioning MAY be introduced only when **all** of the following hold:

1. Access patterns are **measured** (not assumed).
2. Partition key is **semantically correct** for the owning domain.
3. Partitioning does **not** degrade ANN performance or recovery capability beyond accepted gates (see TV-3.2 / TV-3.3).

### 3.2 Domain-based partitioning (FRYST)

Each table is partitioned according to its domain semantics — never by convenience columns (e.g. “whatever is indexed”).

| Table | Domain | Partition key | Status |
| --- | --- | --- | --- |
| `document_evidence` | Governance | `decision_date` | design-only (TV-3.1) |
| `execution_event` | Runtime | `created_at` | design-only (TV-3.1) |
| `retrieval_trace` | Observability | `executed_at` | design-only (TV-3.1) |
| `document_chunk` | Retrieval | none (initially) | **deferred to TV-3.3** |

**Invariant PHYS-I02 — Deferred chunk partition**

`document_chunk` SHALL remain unpartitioned until TV-3.3 gates pass.
Premature partition migrations are quarantined and MUST NOT be applied.

### 3.3 `decision_date` authority semantics (FRYST)

| Rule | Normative statement |
| --- | --- |
| Origin | `decision_date` SHALL originate from the authoritative decision source. |
| Materialization | Materialization SHALL NOT derive, modify, infer, or “correct” `decision_date`. |
| Immutability | `decision_date` is immutable after admission into the governance projection. |
| Corrections | Corrections create a **new identity**, not in-place mutation or cross-partition moves. |

**Invariant PHYS-I03 — No cross-partition authority mutation**

Moving a row across partitions to “fix” dates is forbidden. New evidence identity + supersession only.

### 3.4 Domain ownership (FRYST)

| Rule | Normative statement |
| --- | --- |
| Writes | Owning domain controls schema and writes. |
| Reads | Cross-domain reads happen via API / projections. |
| Joins | Cross-domain joins are allowed only if documented and measured. |
| Optimization | DB optimization MUST NEVER create implicit authority paths. |

**Invariant PHYS-I04 — No implicit authority paths**

An index, join, or partition layout SHALL NOT become a de-facto source of truth for decisions, evidence identity, or materialization.

### 3.5 Backup & recovery hierarchy (FRYST)

Recovery order:

1. **CAS**
2. **Materialized truth** (CAS-bound artifacts)
3. **Domain indexes** (PostgreSQL read models)
4. **Runtime acceleration state** (snapshots, caches — SNAP-I01)

**Invariant PHYS-I05 — Partitioning must not reduce reconstructability**

Partitioning SHALL NEVER reduce the ability to reconstruct canonical state from CAS + event history.

**Invariant PHYS-I06 — Projection Rebuildability**

PostgreSQL physical structures SHALL remain rebuildable from authoritative layers.

A PostgreSQL optimization SHALL NOT introduce information that cannot be reconstructed from:

- CAS
- governance metadata
- event history

Any state that cannot be rebuilt SHALL be classified as **authority-bearing** and SHALL NOT exist only inside PostgreSQL.

Consequences:

- Indexes may be recreated.
- Partitions may be recreated.
- Materialized projections may be rebuilt.
- Runtime acceleration state may be discarded.

PostgreSQL SHALL optimize access to truth.  
PostgreSQL SHALL NOT become truth.

---

## 4. Relation to existing surfaces

| Surface | Relation to TV-3 |
| --- | --- |
| Existing Prisma `DocumentChunk` | Operational retrieval index today; not Decision Authority (RET / SCALE-I01) |
| `GpsPosition` / audit log partitioning (`postgis_scalability_report`) | Separate ops track for append-only product tables; does not override TV-3 domain tables |
| Runtime snapshots | Acceleration only ([ADR-RUNTIME-SNAPSHOT-BOUNDARY](./ADR-RUNTIME-SNAPSHOT-BOUNDARY.md)) |
| Retrieval Trace | Observability only ([ADR-MPS-RETRIEVAL-TRACE](./ADR-MPS-RETRIEVAL-TRACE.md)) |
| Spatial Verification Layer | Spatial semantics and evidence ([TV-S1](./TV-S1-Spatial-Verification-Layer.md)); independent of TV-4 tuning |
| Spatial processing compatibility | Constrains TV-4 physical design ([TV-4.3](./TV-4.3-Spatial-Processing-Compatibility.md)) |

---

## 5. Definition of Done (TV-3.0)

| Criterion | Status |
| --- | --- |
| PostgreSQL role frozen (index / spatial / ops metadata) | ✅ |
| Authority hierarchy CAS → materialization → indexes frozen | ✅ |
| Domain partition map frozen (incl. chunk deferral) | ✅ |
| `decision_date` immutability / correction semantics frozen | ✅ |
| Recovery hierarchy frozen (PHYS-I05) | ✅ |
| Projection rebuildability frozen (PHYS-I06) | ✅ |
| Runnable migrations for TV-3 tables | ❌ out of scope |
| `document_chunk` partition decision | ❌ TV-3.3 |

---

## 6. Explicit forbidden actions under TV-3.0

- Applying partition DDL for `document_chunk` without TV-3.3 approval
- Treating Postgres rows as DecisionImpact / Evidence Authority
- Inferring or backfilling `decision_date` in materialization
- Cross-partition UPDATE to “correct” governance dates
- Using recovery from Postgres alone when CAS is available
- Introducing Postgres-only state that cannot be rebuilt from CAS / governance metadata / event history (PHYS-I06)

---

## Final status (TV-3.0 complete)

| Area | Status |
| --- | --- |
| PostgreSQL role | **FRYST** |
| CAS → Materialization → DB hierarchy | **FRYST** |
| Partitioning principle | **FRYST** |
| `document_evidence` semantics | **FRYST** |
| `decision_date` authority | **FRYST** |
| Cross-domain ownership | **FRYST** |
| Backup / recovery | **FRYST** |
| Projection rebuildability (PHYS-I06) | **FRYST** |
| `document_chunk` | Blocked until TV-3.3 |
| Migrations | Not allowed in this phase |

TV-3.0 freezes how PostgreSQL may **exist without competing with CAS and Governance for authority** — not how to make Postgres “faster.”

---

## Related

- [TV-3.1 — Table Definition Drafts](./TV-3.1-Table-Definition-Drafts.md)
- [TV-3.2 — Metrics & Observability Spec](./TV-3.2-Metrics-Observability-Spec.md)
- [TV-3.3 — document_chunk Partition Decision Template](./TV-3.3-Document-Chunk-Partition-Decision-Template.md)
- [ADR-MPS-CAS-STORAGE-BOUNDARY](./ADR-MPS-CAS-STORAGE-BOUNDARY.md)
- [ADR-MPS-SINGLE-MATERIALIZATION-AUTHORITY](./ADR-MPS-SINGLE-MATERIALIZATION-AUTHORITY.md)
