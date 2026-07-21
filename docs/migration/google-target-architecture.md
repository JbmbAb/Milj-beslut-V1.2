## Google target architecture (pre-migration)

Målbilden är att kunna flytta utan att “lyfta en monolit och sedan designa om allt igen”.

### Körs i Cloud Run (sync/runtime)

- **API + SPA**: Express backend + statisk frontend (nuvarande modell)
  - Endpoints: `/api/*` inkl. GIS-lager (`/api/layers/*`), property lookup, admin readiness.
  - **Runtime/live** integrationer: OGC Features, WMS/WMTS, produkt-API, Vertex AI.
- **WebSocket / långlevande processer**: om krävs (annars separat).

### Asynkront (Pub/Sub / Eventarc)

- **Ingest & indexering**
  - Dokumentuppladdning → Pub/Sub “DocumentUploaded”
  - OCR/text extraction → “DocumentTextExtracted”
  - Chunking/embeddings → “DocumentEmbedded”
  - Knowledge graph update → “GraphUpdated”
- **Audit verification**
  - Schemalagd verifiering kan köras som Cloud Scheduler → HTTP till Cloud Run
  - Alternativt Pub/Sub “AuditVerifyTick”

### Data

- **Postgres + PostGIS**: Cloud SQL
  - Prisma-managed domänmodeller (Project, DocumentRecord, Requirement*, Submission*)
  - SQL-managed `env.*` spatial tables (migrationer i `prisma/spatial/*`)
- **Objektlagring**: Cloud Storage
  - PDF/originalfiler, export-artefakter, backups

### AI / Vertex

- **Vertex AI** används för all generativ text/JSON.
- **RAG**:
  - Embeddings i Postgres (pgvector) eller i separat vector store (om ni väljer senare).
  - Retrieval: `searchRepository` + knowledge graph.

### Secrets & auth

- **Secrets**: Secret Manager → Cloud Run env injection
- **Auth**:
  - BankID / eIDAS enligt befintliga flöden
  - Service-to-service: IAM (Cloud Run)

### Observability

- **Logs**: Cloud Logging (structured logs)
- **Metrics**: Cloud Monitoring
- **Tracing**: Cloud Trace
- **Error tracking**: Sentry (om fortsatt) eller Cloud Error Reporting

### Release gate (före migrering)

- `GET /api/admin/migration/readiness` ska returnera `report.ok=true` i target-miljön.
