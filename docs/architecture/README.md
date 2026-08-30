# Arkitekturdokumentation

Canonical översikt för Miljöbeslut V2.0.

## Authority chain (läs detta först)

```
ARCHITECTURAL SEMANTICS
    ADR-MPS-CONSTITUTIONAL-INVARIANTS.md          — current, normative

PROGRAM / PROOF CONVERGENCE
    PROGRAM-P0-P8-AUTHORITY-2026-08-11.md          — program sequencing + proof
                                                      convergence only; does NOT
                                                      define architectural semantics

OPERATIONAL PROOF REGISTRY
    architecture-authority-map.jsonc               — tracks PROVEN/UNPROVEN/
                                                      KNOWN_BROKEN against the two
                                                      authorities above

HISTORICAL PREDECESSOR
    ADR-24-20-Constitution.md                      — superseded 2026-08-30,
                                                      NORMATIVE_TODAY: false
```

No other document in this index defines architectural truth or program/proof
state independently. Every entry below is classified as one of:
**CURRENT NORMATIVE**, **PROGRAM/PROOF AUTHORITY**, **ACTIVE DOMAIN/TV CONTRACT**,
**HISTORICAL/SUPERSEDED**, or **LEGACY**.

---

## 1. Current normative architecture (constitutional)

The single source of architectural truth is `ADR-MPS-CONSTITUTIONAL-INVARIANTS.md`.
Everything else in this section is a domain-scoped, package-owned specialization
frozen under it — none of them individually claim constitutional/root authority.

| Dokument | Syfte |
| -------- | ----- |
| [ADR-MPS-CONSTITUTIONAL](./ADR-MPS-CONSTITUTIONAL-INVARIANTS.md) | **CURRENT NORMATIVE — FROZEN.** Identity layers vs implementation details; Materialization Pipeline v1 in `packages/mps-materialization` |
| [ADR-MPS-RETRIEVAL](./ADR-MPS-RETRIEVAL-GOVERNANCE.md) | **FROZEN** Retrieval Governance (MIMER-RET-I01–I06) in `packages/mps-retrieval-governance` |
| [ADR-MPS-INTELLIGENCE-PROJECTION-BOUNDARY](./ADR-MPS-INTELLIGENCE-PROJECTION-BOUNDARY.md) | **FROZEN** Decision Knowledge Plane / MIMER-SCALE-I01 retrieval boundary (formerly `ADR-29-Intelligence-Projection-Boundary.md`) |
| [ADR-MPS-QUERY-BUDGET](./ADR-MPS-QUERY-BUDGET.md) | **FROZEN** Query Budget (MIMER-BUD-I01–I07) in `packages/mps-query-budget` |
| [ADR-MPS-RETRIEVAL-TRACE](./ADR-MPS-RETRIEVAL-TRACE.md) | **FROZEN** Retrieval Execution Trace (TRACE-I01–I03) in `packages/mps-retrieval-trace` |
| [ADR-MPS-EVIDENCE Lineage Slot](./ADR-MPS-EVIDENCE-LINEAGE-SLOT.md) | **FROZEN** LINEAGE_SLOT_UNIQUENESS / SEQUENCE_AMBIGUITY |
| [ADR-MPS-CAS-STORAGE-BOUNDARY](./ADR-MPS-CAS-STORAGE-BOUNDARY.md) | **FROZEN** CAS identity/authority boundary (unlocks TV-3) |
| [ADR-MPS-MATERIALIZATION-BOUNDARY](./ADR-MPS-MATERIALIZATION-BOUNDARY.md) / [ADR-MPS-SINGLE-MATERIALIZATION-AUTHORITY](./ADR-MPS-SINGLE-MATERIALIZATION-AUTHORITY.md) | **FROZEN** materialization authority (unlocks TV-3) |
| [ADR-MPS-022](./ADR-MPS-022-Diagnostic-Governance-Layer.md) | **FROZEN** Package 22 Diagnostic Governance (22.1–22.4 in `packages/mps-diagnostics`; 22.5 paused) |
| [ADR-RUNTIME-SNAPSHOT-BOUNDARY](./ADR-RUNTIME-SNAPSHOT-BOUNDARY.md) | **FROZEN** SNAP boundary — runtime snapshots are replay acceleration only, never truth |
| [ADR-MPS-HARVEST-GOVERNED-INGESTION-ORCHESTRATOR](./ADR-MPS-HARVEST-GOVERNED-INGESTION-ORCHESTRATOR.md) | **ACTIVE**, documents current `HarvestOrchestrator`/`ImportGate` code; see doc for proof-status caveats |

## 2. Program / proof authority

These two documents govern *sequencing and proof state*, not architecture. They
must never be read as redefining anything in Section 1.

| Dokument | Syfte |
| -------- | ----- |
| [PROGRAM-P0-P8-AUTHORITY-2026-08-11.md](./PROGRAM-P0-P8-AUTHORITY-2026-08-11.md) | **PROGRAM/PROOF AUTHORITY** — the only roadmap/program-sequencing authority; explicitly scoped away from architectural semantics |
| [architecture-authority-map.jsonc](./architecture-authority-map.jsonc) | **OPERATIONAL PROOF REGISTRY** — PROVEN/UNPROVEN/KNOWN_BROKEN per component, executed-test-backed; architecturally based on §1, program/proof-governed by the row above |
| [PROGRAM-RECONCILIATION-P0-P8-2026-08-11.md](./PROGRAM-RECONCILIATION-P0-P8-2026-08-11.md) | Working reconciliation notes feeding the program authority above (not itself authoritative) |

## 3. Active domain / TV contracts

Domain- and package-scoped, currently enforced contracts. These specialize
Section 1 for a specific subsystem; they do not compete with it.

| Dokument | Syfte |
| -------- | ----- |
| [LU-Flow.md](./LU-Flow.md) | LU-flöde + default UI (`MimerProductShell`; rollback `VITE_ENABLE_LEGACY_UI=1`) |
| [ADR-27](./ADR-27-LU-Architecture-Charter.md) | LU Architecture Charter |
| [ADR-28](./ADR-28-LU-Definition-Scope.md) | LU Definition & Scope |
| [ADR-29](./ADR-29-Runtime-Contract-Freeze-ExecutionKernel.md) | Runtime Contract Freeze & ExecutionKernel (identity freeze major) |
| [ADR-30](./ADR-30-LU-Runtime-v1-Freeze-ExecutionKernel-Cutover.md) | Execution Kernel v1.0 – LU Cutover Complete (LU = active MVP/product lane **and** reference Assessment Capability/client; owns no CAS/promotion authority) |
| [ADR-31](./ADR-31-Post-LU-Platform-Infrastructure-Focus.md) | Epoch II — Execution Platform v1 (Qualified → Architecture Freeze) |
| [MPS-Epoch-Roadmap.md](./MPS-Epoch-Roadmap.md) | Epoch I–IV roadmap (Execution Platform → Knowledge → Ecosystem) |
| [MPS-Epoch-II-Verification-Charter.md](./MPS-Epoch-II-Verification-Charter.md) | Epoch II verification model + Fas 9 Platform Qualification |
| [MPS-Execution-Motor-Implementation-Plan.md](./MPS-Execution-Motor-Implementation-Plan.md) | Active Execution Platform plan |
| [mimers-brunn-v2.0.1.md](./mimers-brunn-v2.0.1.md) | **ACTIVE** — Mimers Brunn Final Frozen Edition (data governance; governs `DatasetApprovalArtifact` §7) |
| [mimers_brunn_archive_policy.md](./mimers_brunn_archive_policy.md) | AIP / Riksarkivet long-term archive |
| [TV-3.0 — PostgreSQL Physical Data Strategy Freeze](./TV-3.0-PostgreSQL-Physical-Data-Strategy-Freeze.md) | **FRYST** — Postgres = read model; PHYS-I01–I06; chunk deferral |
| [TV-3.1 — Table Definition Drafts](./TV-3.1-Table-Definition-Drafts.md) | Design-only DDL (`document_evidence` / `execution_event` / `retrieval_trace`) |
| [TV-3.2 — Metrics & Observability Spec](./TV-3.2-Metrics-Observability-Spec.md) | Mätkrav före TV-3.3 (`document_chunk` partition decision) |
| [TV-3.3 — document_chunk Partition Decision](./TV-3.3-Document-Chunk-Partition-Decision-Template.md) | **Template FROZEN** — verdict deferred (A/B/C fail-closed → C) |
| [TV-4.0](./TV-4.0-Spatial-Foundation-Roadmap.md) | **Frozen** Spatial Foundation Roadmap (formerly `ADR-29-TV4-Spatial-Foundation.md`) |
| [data-coverage-gaps.md](./data-coverage-gaps.md) | Aktiva dataluckor |
| [manifest-schema-v2.md](./manifest-schema-v2.md) | Importmanifest |
| [ADR-005-vertex-ai-data-minimization.md](./ADR-005-vertex-ai-data-minimization.md) | PII mot Vertex |
| [vertex_ai_data_classification.md](./vertex_ai_data_classification.md) | Dataklassning |
| [ai-model-selection.md](./ai-model-selection.md) | Modellval |
| [rag-flow.md](./rag-flow.md) / [rag-hybrid-retrieval.md](./rag-hybrid-retrieval.md) | RAG |
| [ADR-MPS-CORE-001](./ADR-MPS-CORE-001.md) | MPS-CORE Review Constitution (package-scoped, not platform constitution) |
| [docs/qa/MODULE_IMPLEMENTATION_PLAN.md](../qa/MODULE_IMPLEMENTATION_PLAN.md) | Tre fokusmoduler |
| [massa_logistik_implementation.md](./massa_logistik_implementation.md) | Schaktmassa/logistik (aktiv kod) |
| [geo-regulatory-engine.md](./geo-regulatory-engine.md) | Domänpack-förberedelse (`server/geo-regulatory/`) |
| [submission-spine.md](./submission-spine.md) | Ut-/inbound submission-modeller |
| [ADR-004](./ADR-004-verified-tool-trace.md) | Verified tool trace |
| [ADR-006](./ADR-006-strangler-fig-pattern.md) | Strangler fig |

## 4. Project governance & process (non-architectural)

Development process, migration strategy, and module status — governs how work is
done, not what is architecturally true.

| Dokument | Syfte |
| -------- | ----- |
| [development-governance.md](./development-governance.md) | Kvalitetsgates, AI-regler |
| [ombyggnadsstrategi_bygga_nytt_bygga_ratt.md](./ombyggnadsstrategi_bygga_nytt_bygga_ratt.md) | Strangler/migrering `server/` → `src/` |
| [modulregister_ombyggnad.md](./modulregister_ombyggnad.md) | Modulstatus (BEHÅLL/ARKIVERA/BYGG OM) |
| [ARCHITECTURE_DEBT_ROADMAP_2026-06-09.md](./ARCHITECTURE_DEBT_ROADMAP_2026-06-09.md) | Teknisk skuld & faser |
| [system_architecture_blueprint.md](./system_architecture_blueprint.md) | Teknisk helhetsyta |

## 5. Historical / superseded

Kept for provenance. **NORMATIVE_TODAY: false** for both entries below — do not
cite either as current authority.

| Dokument | Status |
| -------- | ------ |
| [ADR-24-20-Constitution.md](./ADR-24-20-Constitution.md) | **HISTORICAL** — superseded 2026-08-30 by `ADR-MPS-CONSTITUTIONAL-INVARIANTS.md`; its broken `ADR-24-07..19` governs-list is repaired in-document with an explicit historical→successor mapping table, not by recreating those files |
| [mimers-brunn-offline-first.md](./mimers-brunn-offline-first.md) | **LEGACY v1.0** — superseded by `mimers-brunn-v2.0.1.md`; operational detail / historik only |

## 6. Legacy (retired / retiring product surfaces)

| Dokument | Syfte |
| -------- | ----- |
| [PERMIT_PORTAL_LEGACY.md](./PERMIT_PORTAL_LEGACY.md) | Legacy C-anmälan |
| [PERMIT_PORTAL_RETIREMENT_PLAN.md](./PERMIT_PORTAL_RETIREMENT_PLAN.md) | Avvecklingsplan |

### Arkiverat

| Mapp | Innehåll |
| ---- | -------- |
| [docs/archive/architecture-snapshots/](../archive/architecture-snapshots/) | Q1–Q2 2026-analyser, äldre systembeskrivning |
| [docs/archive/vision/](../archive/vision/) | Tillsynsindex, regulatorisk intelligence |
| [docs/archive/README.md](../archive/README.md) | Övriga sidospår (Millbygård, examens, m.m.) |
