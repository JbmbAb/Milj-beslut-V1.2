# Arkitekturdokumentation

Canonical översikt för Miljöbeslut V2.0. Läs i denna ordning vid onboarding.

## Styrning & policy

| Dokument | Syfte |
| -------- | ----- |
| [development-governance.md](./development-governance.md) | Kvalitetsgates, AI-regler |
| [ombyggnadsstrategi_bygga_nytt_bygga_ratt.md](./ombyggnadsstrategi_bygga_nytt_bygga_ratt.md) | Strangler/migrering `server/` → `src/` |
| [modulregister_ombyggnad.md](./modulregister_ombyggnad.md) | Modulstatus (BEHÅLL/ARKIVERA/BYGG OM) |
| [ARCHITECTURE_DEBT_ROADMAP_2026-06-09.md](./ARCHITECTURE_DEBT_ROADMAP_2026-06-09.md) | Teknisk skuld & faser |
| [system_architecture_blueprint.md](./system_architecture_blueprint.md) | Teknisk helhetsyta |

## Data & offline-first

| Dokument | Syfte |
| -------- | ----- |
| [mimers-brunn-v2.0.1.md](./mimers-brunn-v2.0.1.md) | **ACTIVE** — Mimers Brunn Final Frozen Edition (data governance) |
| [mimers-brunn-offline-first.md](./mimers-brunn-offline-first.md) | LEGACY v1.0 — operational detail / historik |
| [mimers_brunn_archive_policy.md](./mimers_brunn_archive_policy.md) | AIP / Riksarkivet long-term archive |
| [data-coverage-gaps.md](./data-coverage-gaps.md) | Aktiva dataluckor |
| [manifest-schema-v2.md](./manifest-schema-v2.md) | Importmanifest |

## AI & Vertex

| Dokument | Syfte |
| -------- | ----- |
| [ADR-005-vertex-ai-data-minimization.md](./ADR-005-vertex-ai-data-minimization.md) | PII mot Vertex |
| [vertex_ai_data_classification.md](./vertex_ai_data_classification.md) | Dataklassning |
| [ai-model-selection.md](./ai-model-selection.md) | Modellval |
| [rag-flow.md](./rag-flow.md) / [rag-hybrid-retrieval.md](./rag-hybrid-retrieval.md) | RAG |

## Produktflöden (canonical)

| Dokument | Syfte |
| -------- | ----- |
| [docs/qa/MODULE_IMPLEMENTATION_PLAN.md](../qa/MODULE_IMPLEMENTATION_PLAN.md) | Tre fokusmoduler |
| [LU-Flow.md](./LU-Flow.md) | LU-flöde + default UI (`MimerProductShell`; rollback `VITE_ENABLE_LEGACY_UI=1`) |
| [ADR-30](./ADR-30-LU-Runtime-v1-Freeze-ExecutionKernel-Cutover.md) | **Execution Kernel v1.0 – LU Cutover Complete** (LU = klient / Assessment Capability) |
| [ADR-31](./ADR-31-Post-LU-Platform-Infrastructure-Focus.md) | Epoch II — **Execution Platform** v1 (Qualified → Architecture Freeze) |
| [MPS-Epoch-Roadmap.md](./MPS-Epoch-Roadmap.md) | Epoch I–IV + Architecture Freeze before Knowledge Platform |
| [MPS-Epoch-II-Verification-Charter.md](./MPS-Epoch-II-Verification-Charter.md) | Epoch II verification model + Fas 9 Platform Qualification |
| [PERMIT_PORTAL_LEGACY.md](./PERMIT_PORTAL_LEGACY.md) | Legacy C-anmälan |
| [PERMIT_PORTAL_RETIREMENT_PLAN.md](./PERMIT_PORTAL_RETIREMENT_PLAN.md) | Avvecklingsplan |
| [massa_logistik_implementation.md](./massa_logistik_implementation.md) | Schaktmassa/logistik (aktiv kod) |
| [geo-regulatory-engine.md](./geo-regulatory-engine.md) | Domänpack-förberedelse (`server/geo-regulatory/`) |
| [submission-spine.md](./submission-spine.md) | Ut-/inbound submission-modeller |

## ADR

- [ADR-004](./ADR-004-verified-tool-trace.md) — verified tool trace
- [ADR-005](./ADR-005-vertex-ai-data-minimization.md) — Vertex dataminimering
- [ADR-006](./ADR-006-strangler-fig-pattern.md) — strangler fig
- [ADR-29](./ADR-29-Runtime-Contract-Freeze-ExecutionKernel.md) — Runtime Contract Freeze & ExecutionKernel
- [ADR-29 Intelligence Projection](./ADR-29-Intelligence-Projection-Boundary.md) — **FROZEN** Decision Knowledge Plane / MIMER-SCALE-I01 retrieval
- [ADR-30](./ADR-30-LU-Runtime-v1-Freeze-ExecutionKernel-Cutover.md) — LU Runtime v1 Freeze (Execution Kernel v1.0)
- [ADR-31](./ADR-31-Post-LU-Platform-Infrastructure-Focus.md) — Epoch II: Execution Platform focus
- [ADR-MPS-CORE-001](./ADR-MPS-CORE-001.md) — MPS-CORE Review Constitution
- [ADR-MPS-022](./ADR-MPS-022-Diagnostic-Governance-Layer.md) — **FROZEN** Package 22 Diagnostic Governance (22.1–22.4 in `packages/mps-diagnostics`; 22.5 paused)
- [ADR-MPS-CONSTITUTIONAL](./ADR-MPS-CONSTITUTIONAL-INVARIANTS.md) — **FROZEN** identity layers vs implementation details; Materialization Pipeline v1 in `packages/mps-materialization`
- [ADR-MPS-RETRIEVAL](./ADR-MPS-RETRIEVAL-GOVERNANCE.md) — **FROZEN** Retrieval Governance (MIMER-RET-I01–I03) in `packages/mps-retrieval-governance`
- [ADR-MPS-QUERY-BUDGET](./ADR-MPS-QUERY-BUDGET.md) — **FROZEN** Query Budget (MIMER-BUD-I01–I04) in `packages/mps-query-budget`
- [ADR-MPS-RETRIEVAL-TRACE](./ADR-MPS-RETRIEVAL-TRACE.md) — **FROZEN** Retrieval Execution Trace (TRACE-I01–I02, RET-I05) in `packages/mps-retrieval-trace`
- [ADR-MPS-EVIDENCE Lineage Slot](./ADR-MPS-EVIDENCE-LINEAGE-SLOT.md) — **FROZEN** LINEAGE_SLOT_UNIQUENESS / SEQUENCE_AMBIGUITY
- [MPS-Epoch-Roadmap.md](./MPS-Epoch-Roadmap.md) — Epoch I–IV roadmap (Execution Platform → Knowledge → Ecosystem)
- [MPS-Execution-Motor-Implementation-Plan.md](./MPS-Execution-Motor-Implementation-Plan.md) — Active Execution Platform plan

## Arkiverat

| Mapp | Innehåll |
| ---- | -------- |
| [docs/archive/architecture-snapshots/](../archive/architecture-snapshots/) | Q1–Q2 2026-analyser, äldre systembeskrivning |
| [docs/archive/vision/](../archive/vision/) | Tillsynsindex, regulatorisk intelligence |
| [docs/archive/README.md](../archive/README.md) | Övriga sidospår (Millbygård, examens, m.m.) |
