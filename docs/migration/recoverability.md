## Recoverability (rollback / replay / rebuild)

Mål: vid migrering ska vi kunna återskapa case state, återskapa snapshots och återbygga read-modeller (RAG-index, GIS-cache) utan att tappa case-integritet.

### Audit replay → deterministisk state

- Audit trail är hash-länkad (`server/security/auditTrail.ts`) och kan verifieras periodiskt.
- Replay byggs genom att läsa events i tidsordning och reducera till en case-view.

### Reproducerbara exports via snapshot

Princip:

- Export bygger på snapshot, inte “live data”.
- LOCKED innebär read-only + kontrollerad export + audit, aldrig mutation.

### Reindex / rebuild

- **RAG**: `SearchJob`-kö (EXTRACT_TEXT/EMBED_DOC) kan fyllas på nytt per projekt/dokument.
- **GIS**: env._ tabeller är SQL-managed och återskapas via `prisma/spatial/_`+`scripts/db/spatial-bootstrap.ts`.

### Admin verktyg

- `GET /api/admin/observability/metrics` – counters för denied mutations, bulk-guard osv.
- `GET /api/admin/migration/readiness` – release gate (måste vara grön).
