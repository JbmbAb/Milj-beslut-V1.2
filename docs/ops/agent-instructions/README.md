# Agent-instruktioner — juridisk RAG

Task-adresserade agentinstruktioner (persona LOKE/TOR) för det juridiska RAG-spåret. Flyttade
2026-08-30 från repo-root per disposition redan noterad i
[RC2-WORKTREE-PARKING-RECORD.md](../../architecture/RC2-WORKTREE-PARKING-RECORD.md#group-3--unit-9-juridisk-rag-planning-layer-5-entries)
("UNIT 9 — content is legitimate, location is wrong"). Innehåll oförändrat. Ingen av dessa filer
utgör i sig normativ arkitekturauktoritet — det avgörs uteslutande av dokumentkedjan i
[docs/architecture/README.md](../../architecture/README.md).

| Fil | Live-status (2026-08-30 referenskontroll) |
| --- | --- |
| [TOR_INSTRUKTION_JURIDISK_RAG_IMPLEMENTATION.md](./TOR_INSTRUKTION_JURIDISK_RAG_IMPLEMENTATION.md) | **LIVE_REFERENCED_BY_CODE.** Citeras som `ADR:` i produktionskod: `server/security/legalCorpusSigningKey.ts`, `packages/mps-legal-corpus/src/CorpusImportAttestation.ts`, `packages/mps-legal-corpus/src/IngestionManifest.ts`, `packages/mps-legal-corpus/src/CorpusImportGate.ts` samt testet `CorpusImportGate.test.ts`. Beskrivs även i `PROGRAM-P0-P8-AUTHORITY-2026-08-11.md` och `LU-MVP-IMPLEMENTATION-PLAN-2026-08-11.md` som "frozen spec + PROVEN v1 för mps-legal-corpus". **Anomali att flagga för ägaren:** en fil med instruktionsnamn (task-adresserad TOR-persona) fungerar de facto som en ADR-auktoritet i skriven kod — det är inte samma sak som att formellt vara upptagen i `architecture-authority-map.jsonc`. Denna flytt ändrar inte den statusen; den kodifierar bara var filen fysiskt ligger. Om filen ska vara en riktig ADR-auktoritet krävs ett separat, ägarauktoriserat beslut att skriva en formell ADR som ersätter/absorberar den — utanför detta docs-closure-mandat. |
| [LOKE_INSTRUKTION_JURIDISK_HARVESTING.md](./LOKE_INSTRUKTION_JURIDISK_HARVESTING.md) | **TASK_SCOPED.** Refereras endast av `docs/architecture/ADR-DRAFT-Source-Registry-Pipeline.md` (ett draft-dokument, ej fryst), som beskriver dess fyra harvest-workers. Ingen produktionskod refererar filen. Behandla som bakgrundsmaterial för det draftet, inte som körande auktoritet. |
