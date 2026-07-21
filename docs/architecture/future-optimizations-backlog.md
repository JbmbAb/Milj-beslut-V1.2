# Future optimizations backlog

Status: levande dokument. Senast uppdaterad: **2026-06-26**.

**Placering:** `docs/architecture/` — planerade förbättringar utöver akuta dataluckor.  
**Geodata-gap:** [data-coverage-gaps.md](./data-coverage-gaps.md).

---

## 1. AI & machine learning

### Realtids-features (Optimering)

Vertex AI svarar snabbt; databasen måste hinna med.

**Mål:** PostGIS-funktion `get_ml_features(fastighet_id)` som plattar ut spatiala överlapp (jordart, skredrisk, avstånd) till JSON i ett svep.

### Dynamisk kod/SQL via Claude/Vertex (Optimering/Gap)

AI som kodbyggare för kommunala Excel-filer eller fritext-SQL.

**Kritiskt krav:** Stenhård sandlåda (isolerade Docker-containrar utan skrivrättigheter).

### Kunskapsgrafen (Gap)

`knowledgeGraphService.ts` är stubbad — returnerar tomma resultat. RAG via vektor-retrieval fungerar; grafberikning saknas.

Relaterat: `scripts/import/bridge-extraction-to-graph.ts`.

---

## 2. Produktion & säkerhet

### eIDAS & myndighetsinlämning (Gap)

BankID integrerat. eIDAS-signaturer och live-inlämning av C-anmälningar saknas för bred lansering.

### Staging E2E-tester (Gap)

Staging saknar gröna E2E-bevis utan BankID. Se `docs/qa/README-staging-e2e.md`, `docs/qa/production-scope-without-bankid.md`.

### Skalbarhetstestning (Optimering)

Miljontals rader i drift (`topo10.byggnad` ~8,9M, `env.registerenhetsomradesytor` ~4,2M).

**Mål:** Verifiera PostGIS för >500M rader. Se `docs/architecture/postgis_scalability_report.md`, `docs/ops/postgis-docker-drift.md`.

---

## 3. Modulär skuld (ej dataluckor)

Kodstruktur och legacy-avveckling: `docs/architecture/ARCHITECTURE_DEBT_ROADMAP_2026-06-09.md`.

---

## Referenser

| Dokument | Innehåll |
|----------|----------|
| `docs/architecture/vertex_ai_data_classification.md` | PII vs öppen geodata mot Vertex |
| `docs/architecture/governance/data_matrix.md` | Schema-ägarskap |
| `docs/migration/google-target-architecture.md` | Cloud-målbild |
