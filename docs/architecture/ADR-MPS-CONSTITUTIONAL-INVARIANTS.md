# ADR-MPS-CONSTITUTIONAL: Frozen Identity & Truth Layers

| Field | Value |
| --- | --- |
| **Status** | **FROZEN** |
| **Date** | 2026-08-07 |
| **Owner** | MPS Architecture Governance |
| **Purpose** | Separate *constitutional invariants* from *implementation details* so refactors cannot silently break identity |

---

## 0. Rule of change

| Kind | May change without ADR? | Examples |
| --- | --- | --- |
| **Constitutional invariant** | **No** — requires ADR + golden/property tests | Hash domain, lineage rules, retrieval boundary, dual-track isolation |
| **Implementation detail** | Yes — within contracts | In-memory vs Postgres CAS, planner budgets, logging, UI |

Future refactors MUST NOT move fields across identity/metadata boundaries or bypass frozen pipelines.

---

## 1. Package 21 — Replay Truth (constitutional)

**Frozen:**

- `ExecutionManifest` identity + canonical serialization
- `ReplayEngine` determinism
- Runtime snapshots **only** for replay acceleration

**Hard boundary:**

- No dependencies on Package 22 diagnostics
- No dependencies on Decision Knowledge Plane

---

## 2. Package 22 — Diagnostic Truth (constitutional)

**Frozen:**

- `ExecutionEventLog` (append-only governance stream)
- `FailureArtifact` identity / metadata split
- `FailureCodeRegistry` semantic stability
- `CorrelationContext` (navigation only)

**Invariant:**

```text
Diagnostics SHALL observe execution.
Diagnostics SHALL NOT influence execution.
CorrelationContext is navigation, not identity.
```

**Paused (not constitutional yet):** Package 22.5 Replay Differential

---

## 3. mps-decision-governance — Decision Truth (constitutional)

Four stacked identity layers:

```text
Canonical Identity
        │
        ▼
Canonical Hash  (version-bound — see §5)
        │
        ▼
Lineage
        │
        ▼
Retrieval Boundary
```

### Lineage rules (constitutional)

| Rule | Rejection code |
| --- | --- |
| Self reference | `SELF_REFERENCING_EVIDENCE_SET` |
| Previous hash exists | `PREVIOUS_EVIDENCE_SET_NOT_FOUND` |
| Sequence monotonicity | `LINEAGE_SEQUENCE_REGRESSION` |
| Scope stability | `LINEAGE_SCOPE_MISMATCH` |
| Fork detection | `LINEAGE_FORK_DETECTED` |
| **LINEAGE_SLOT_UNIQUENESS** | `LINEAGE_SEQUENCE_AMBIGUITY` |

EvidenceSet is an **append-only DAG with restricted topology** (not a free graph).

### Retrieval boundary (constitutional — not merely a QueryPlanner rule)

**Allowed:**

```text
GENERAL QUERY → DecisionImpact → (optional) EvidenceSet → (optional) Raw Evidence
```

**Forbidden:**

```text
GENERAL QUERY → Raw Evidence
```

This is **MIMER-SCALE-I01** / DecisionRetrievalContract — an architecture invariant so token cost does not grow linearly with document count.

---

## 4. Implementation details (NOT constitutional)

These may evolve without breaking identity:

- Concrete CAS backend (memory, disk, Postgres)
- Expansion budgets (`max_decision_impacts`, …)
- Extractor/parser internals behind Materialization Pipeline contracts
- OTEL / `trace_root_id` transport
- UI, logging, operational dashboards
- alpha-runtime wiring that *calls* frozen contracts

---

## 5. Version-bound canonical hashing (constitutional)

`canonical_version` is **not** ordinary metadata beside the hash.

```text
artifact_hash = SHA256( canonical_version || "\n" || canonical_payload )
```

```text
dg-canonical-1 → canonical bytes → SHA256 → artifact identity
```

### C-02 Canonical Domain Separation

An artifact hash generated under canonical version **X** SHALL never equal the identity of the same payload generated under canonical version **Y**.

```text
hash(dg-canonical-1 || A) ≠ hash(dg-canonical-2 || A)
```

Constant: `DECISION_GOVERNANCE_CANONICAL_VERSION` (`dg-canonical-1`) in `CanonicalDecisionImpactHash.ts`

---

## 5b. Lineage closure before authority (constitutional)

```text
No EvidenceSet SHALL become authoritative before lineage closure succeeds.
```

**Wrong:** commit EvidenceSet → then validate lineage  
**Right:** build lineage graph → verify lineage → commit EvidenceSet

---

## 6. Materialization Pipeline (constitutional shape)

```text
Incoming Artifact → CAS lookup → (reuse | Parse → DecisionFacts → DecisionImpact)
  → lineage closure → Repository commit → Retrieval available
```

QueryPlanner MAY optimize ranking/latency/cost.  
QueryPlanner MUST NEVER alter the truth layer or open GENERAL QUERY → Raw Evidence.

---

## 7. Constitutional test contracts (required before 22.5)

| ID | Contract | Proof |
| --- | --- | --- |
| **C-01** | Serializer stability / canonical idempotence / materialization determinism | `ConstitutionalPropertyTests.test.ts` |
| **C-02** | Canonical domain separation | `ConstitutionalGateContracts.test.ts` |
| **C-03** | Lineage closure before authority | same |
| **C-04** | Retrieval boundary (no DocumentChunk entry) | same |
| **C-05** | Materialization replay (restart → same hash) | same |

**22.5 Replay Differential** remains paused until these gates stay green and Materialization Pipeline is the primary implementation of this constitution.

---

## 8. Package boundary — Materialization Pipeline v1

**Home:** `packages/mps-materialization/` (contract-first; **no LLM in core**)

| File | Role |
| --- | --- |
| `MaterializationContract.ts` | Frozen versions + `materialize(VerifiedEvidenceSet)` |
| `LineageValidator.ts` | C-03: assertClosed → commit |
| `DecisionFactsBuilder.ts` | Deterministic rules extraction |
| `DecisionImpactBuilder.ts` | Identity + version-bound hash |
| `MaterializationRepository.ts` | CAS put/get |
| `MaterializationPipeline.ts` | Orchestration |

**Definition of Done:** lineage closure · canonical version in hash domain · deterministic hash · CAS idempotency · restart reproducibility · no RawDocumentChunk entry · no AI in core.

### MIMER-MAT-I01 — Materialization Authority Boundary

```text
Only Materialization Pipeline MAY create DecisionImpactArtifact authority state.
Retrieval, UI, AI, and runtime components SHALL NOT create or mutate Decision Truth artifacts.
```

Forbidden: `Chat Agent → DecisionImpactArtifact` (write)  
Allowed: `Chat Agent → DecisionImpactArtifact` (read) → Answer

### Materialization Registry

Binds `materialization_version` ↔ `rule_version` ↔ `canonical_version` ↔ artifact type  
(`decision_impact_v1` → `dg-canonical-1` + `rules-1` + `mat-1`).

Boundary hardening tests (not features): adversarial tamper → `LINEAGE_VERIFICATION_FAILED`; cross-process determinism; version boundary (`mat-1` ≠ `mat-2` hashes).

