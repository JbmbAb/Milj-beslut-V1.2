# TV-3.1 — Table Definition Drafts (Design-Only)

| Field | Value |
| --- | --- |
| **Status** | **DESIGN-ONLY** — not executable |
| **Date** | 2026-08-07 |
| **Parent** | [TV-3.0 — Physical Data Strategy Freeze](./TV-3.0-PostgreSQL-Physical-Data-Strategy-Freeze.md) |
| **Constraint** | **No migrations are run in TV-3.1.** DDL below is structural design for review. |

---

## PostgreSQL design rules applied (optimizations vs naive draft)

1. **Partition key in primary key** — PostgreSQL requires every UNIQUE/PK on a partitioned table to include the partition key. Drafts use composite PKs.
2. **Logical identity vs physical PK** — Domain identity (`evidence_id`, `execution_id`, `trace_id`) remains the logical key; physical uniqueness is `(id, partition_key)`.
3. **Global uniqueness without partition key** — Attributes like `document_hash` that must be unique across all partitions need an explicit strategy (unique on parent including key, or CAS/governance enforcement). Drafts document this; they do not invent a second authority store.
4. **Naming** — Physical SQL uses `snake_case`. Mapping to Prisma / existing `DocumentChunk` is deferred to an implementation ADR after TV-3.3.
5. **`retrieval_trace`** — Aligns with [ADR-MPS-RETRIEVAL-TRACE](./ADR-MPS-RETRIEVAL-TRACE.md): `trace_hash` is identity; `executed_at` is metadata / partition key only.

---

## 1. `document_evidence` (Governance)

**Owner:** Governance  
**Partition key:** `decision_date` (PHYS-I03)  
**Status:** design-only

```sql
-- DESIGN ONLY — DO NOT APPLY
CREATE TABLE document_evidence (
    evidence_id      TEXT        NOT NULL,
    decision_date    DATE        NOT NULL,
    municipality_id  TEXT        NOT NULL,
    document_hash    TEXT        NOT NULL,  -- CAS digest reference; not Postgres authority
    superseded_by    TEXT,                   -- new identity on correction; never mutate decision_date
    metadata         JSONB,
    PRIMARY KEY (evidence_id, decision_date)
) PARTITION BY RANGE (decision_date);

-- Year partitions (examples)
CREATE TABLE document_evidence_y2025 PARTITION OF document_evidence
    FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE document_evidence_y2026 PARTITION OF document_evidence
    FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE document_evidence_y2027 PARTITION OF document_evidence
    FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');

CREATE INDEX document_evidence_decision_date_idx
    ON document_evidence (decision_date);
CREATE INDEX document_evidence_muni_date_idx
    ON document_evidence (municipality_id, decision_date);
CREATE INDEX document_evidence_document_hash_idx
    ON document_evidence (document_hash);
```

**Notes**

- `document_hash` index is for lookup, not for minting identity (CAS owns digest semantics).
- Supersession: insert new row with new `evidence_id`; set `superseded_by` on the old row **within the same partition**. Do not UPDATE `decision_date`.
- Cross-year “correction” of the same logical decision ⇒ new identity; old row remains for audit.

---

## 2. `execution_event` (Runtime)

**Owner:** Runtime  
**Partition key:** `created_at`  
**Status:** design-only  
**Authority:** none (CAS-I04 / SNAP-I01 — discardable)

```sql
-- DESIGN ONLY — DO NOT APPLY
CREATE TABLE execution_event (
    execution_id   TEXT           NOT NULL,
    created_at     TIMESTAMPTZ    NOT NULL,
    event_type     TEXT           NOT NULL,
    agent_version  TEXT           NOT NULL,
    model_version  TEXT           NOT NULL,
    metadata       JSONB,
    PRIMARY KEY (execution_id, created_at)
) PARTITION BY RANGE (created_at);

-- Monthly partitions (examples)
CREATE TABLE execution_event_2026_01 PARTITION OF execution_event
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE execution_event_2026_02 PARTITION OF execution_event
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE execution_event_2026_03 PARTITION OF execution_event
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

CREATE INDEX execution_event_id_created_idx
    ON execution_event (execution_id, created_at);
CREATE INDEX execution_event_type_created_idx
    ON execution_event (event_type, created_at);
```

**Notes**

- MUST NOT store DecisionFacts / EvidenceAuthority / MaterializedTruth (CAS-I04).
- Retention/detach of old monthly partitions is an ops concern; detach MUST NOT affect CAS reconstructability.

---

## 3. `retrieval_trace` (Observability)

**Owner:** Observability / Retrieval Trace package  
**Partition key:** `executed_at` (metadata; excluded from `trace_hash`)  
**Status:** design-only  
**Authority:** none (TRACE-I02)

```sql
-- DESIGN ONLY — DO NOT APPLY
CREATE TABLE retrieval_trace (
    trace_id        TEXT           NOT NULL,  -- operational row id
    trace_hash      TEXT           NOT NULL,  -- TRACE identity (canonical fields only)
    executed_at     TIMESTAMPTZ    NOT NULL,  -- metadata / partition key
    query_hash      TEXT           NOT NULL,
    policy_version  TEXT           NOT NULL,
    metadata        JSONB,                    -- duration_ms, cost, user, model name, etc.
    PRIMARY KEY (trace_id, executed_at)
) PARTITION BY RANGE (executed_at);

CREATE INDEX retrieval_trace_trace_hash_idx
    ON retrieval_trace (trace_hash);
CREATE INDEX retrieval_trace_query_hash_idx
    ON retrieval_trace (query_hash);
CREATE INDEX retrieval_trace_policy_version_idx
    ON retrieval_trace (policy_version);
CREATE INDEX retrieval_trace_executed_at_idx
    ON retrieval_trace (executed_at);
```

**Notes**

- `trace_hash` reproducibility MUST ignore `executed_at` and other metadata (TRACE-I01).
- Partitioning by `executed_at` is for retention/prune only; it MUST NOT alter selected refs or DecisionImpact paths.

---

## 4. `document_chunk` (Retrieval)

**Owner:** Retrieval  
**Partitioning:** **none in TV-3.1** (PHYS-I02)  
**Status:** defer to TV-3.3 after [TV-3.2](./TV-3.2-Metrics-Observability-Spec.md) gates

**Retain (current / target shape — conceptual):**

| Concern | Keep |
| --- | --- |
| Vectors | pgvector embedding |
| ANN | HNSW index |
| Filters | metadata filters |
| Integrity | unique constraints (e.g. `(document_id, chunk_index)`) |

**Explicitly forbidden under TV-3.1**

- Range partition by `created_at` (or any key) without TV-3.3 decision
- Applying quarantined stub migrations that convert `DocumentChunk` in place

Existing Prisma model `DocumentChunk` remains the live operational table until a separate implementation ADR.

---

## 5. Design stub location

Non-runnable structural stubs (if added later) live under:

```
docs/architecture/tv-3/stubs/
```

They MUST carry header:

```sql
-- TV-3 DESIGN STUB — NOT A PRISMA MIGRATION — DO NOT APPLY
```

Anything under `prisma/migrations/` that partitions `document_chunk` before TV-3.3 is a policy violation and MUST be quarantined.

---

## Related

- [TV-3.0](./TV-3.0-PostgreSQL-Physical-Data-Strategy-Freeze.md)
- [TV-3.2](./TV-3.2-Metrics-Observability-Spec.md)
- [TV-3.3](./TV-3.3-Document-Chunk-Partition-Decision-Template.md)
- [ADR-MPS-RETRIEVAL-TRACE](./ADR-MPS-RETRIEVAL-TRACE.md)
