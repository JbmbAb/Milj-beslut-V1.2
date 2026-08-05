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
| [mimers-brunn-offline-first.md](./mimers-brunn-offline-first.md) | Master-arkiv, harvesting |
| [mimers_brunn_archive_policy.md](./mimers_brunn_archive_policy.md) | Policyreferens |
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
| [ADR-30](./ADR-30-LU-Runtime-v1-Freeze-ExecutionKernel-Cutover.md) | **Execution Kernel v1.0 – LU Cutover Complete** (normativ LU-runtime) |
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
- [ADR-30](./ADR-30-LU-Runtime-v1-Freeze-ExecutionKernel-Cutover.md) — LU Runtime v1 Freeze (Execution Kernel v1.0)
- [MPS-Execution-Motor-Implementation-Plan.md](./MPS-Execution-Motor-Implementation-Plan.md) — Execution motor roadmap (post-cutover: shared infra)

## Arkiverat

| Mapp | Innehåll |
| ---- | -------- |
| [docs/archive/architecture-snapshots/](../archive/architecture-snapshots/) | Q1–Q2 2026-analyser, äldre systembeskrivning |
| [docs/archive/vision/](../archive/vision/) | Tillsynsindex, regulatorisk intelligence |
| [docs/archive/README.md](../archive/README.md) | Övriga sidospår (Millbygård, examens, m.m.) |
