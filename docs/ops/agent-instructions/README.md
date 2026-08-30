# Agent-instruktioner — juridisk RAG

Task-adresserade agentinstruktioner (persona LOKE/TOR) för det juridiska RAG-spåret. Flyttade
2026-08-30 från repo-root per disposition redan noterad i
[RC2-WORKTREE-PARKING-RECORD.md](../../architecture/RC2-WORKTREE-PARKING-RECORD.md#group-3--unit-9-juridisk-rag-planning-layer-5-entries)
("UNIT 9 — content is legitimate, location is wrong"). Innehåll oförändrat. Ingen av dessa filer
utgör i sig normativ arkitekturauktoritet — det avgörs uteslutande av dokumentkedjan i
[docs/architecture/README.md](../../architecture/README.md).

| Fil | Live-status (2026-08-30 referenskontroll) |
| --- | --- |
| [TOR_INSTRUKTION_JURIDISK_RAG_IMPLEMENTATION.md](./TOR_INSTRUKTION_JURIDISK_RAG_IMPLEMENTATION.md) | **TASK_SCOPED / historical operational instruction (resolved 2026-08-30).** Was `LIVE_REFERENCED_BY_CODE` — cited as `ADR:` by five production files despite its instruction-style naming. Resolved via DOCUMENTATION_FINAL_NORMALIZATION: the invariant it specified ("SCHEMA-CONVERGENCE-SPEC 2026-08-11") is now formally extracted into [ADR-LEGAL-CORPUS-IMPORT-GATE.md](../../architecture/ADR-LEGAL-CORPUS-IMPORT-GATE.md), and all five production references (`server/security/legalCorpusSigningKey.ts`, `packages/mps-legal-corpus/src/CorpusImportAttestation.ts`, `IngestionManifest.ts`, `CorpusImportGate.ts`, `tests/CorpusImportGate.test.ts`) now point to that ADR instead. This file no longer functions as architecture authority for any code — preserved as historical/operational record only. The two 2026-08-11 planning docs that described it as "frozen spec + PROVEN v1" (`PROGRAM-P0-P8-AUTHORITY-2026-08-11.md`, `LU-MVP-IMPLEMENTATION-PLAN-2026-08-11.md`) are left unmodified as point-in-time historical records, not retroactively rewritten. |
| [LOKE_INSTRUKTION_JURIDISK_HARVESTING.md](./LOKE_INSTRUKTION_JURIDISK_HARVESTING.md) | **TASK_SCOPED.** Refereras endast av `docs/architecture/ADR-DRAFT-Source-Registry-Pipeline.md` (ett draft-dokument, ej fryst), som beskriver dess fyra harvest-workers. Ingen produktionskod refererar filen. Behandla som bakgrundsmaterial för det draftet, inte som körande auktoritet. |
