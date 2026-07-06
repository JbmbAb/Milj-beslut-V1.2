# Gemini Enterprise — åtkomst till plattform och PostGIS

Status: operativ guide. Senast uppdaterad: **2026-06-26**.

**Syfte:** Beskriv hur kod, schema och geodata delas så att **Gemini Enterprise** (och Mimer Bibliotekarie) har kontext — utan att lägga levande PostgreSQL-data på Google Drive.

---

## Tre lager — tre kanaler

| Lager | Kanal | Vad som delas | Gemini Enterprise |
|-------|-------|---------------|-------------------|
| **Plattformskod** | **Git** (GitHub) | `server/`, `scripts/`, `prisma/`, `tests/`, `docs/` | Koppla repo via Google Cloud / Workspace-integration eller indexera `knowledge-base/` |
| **Geodata (canonical)** | **Google Drive** (`H:\Delade enheter\Miljöbeslut\`) | `GEO_Master_Archive/` — råfiler, manifest v2, SHA-256 | Dela mappen som kunskapskälla; **inte** som DB |
| **PostGIS (härledd)** | **Schema + snapshot** | SQL-migrationer, data dictionary, valfri `pg_dump` | Indexera schema-dokument; live-DB endast via API/Cloud SQL |

**Gyllene regel:** Master Archive är canonical. PostGIS är en återskapbar läsvy — dela **receptet**, inte Docker-volymen.

---

## Vad som INTE ska på Drive

| Objekt | Varför |
|--------|--------|
| `postgres-data` Docker-volym (`/var/lib/postgresql/data`) | WAL, lås, fsync — korrumperas av Drive-synk |
| `node_modules/`, `.git/` i Drive-mirror | Onödigt, stort, trasigt |
| Online-only Drive-filer som läses med Node `createReadStream` | Ger `EISDIR` (använd PowerShell `Get-FileHash` på H:) |
| PII / BankID-data | ADR-005 — se `docs/architecture/vertex_ai_data_classification.md` |

---

## Rekommenderad mappstruktur på Drive

```text
H:\Delade enheter\Miljöbeslut\
├── GEO_Master_Archive\          ← canonical geodata (Mimers Brunn)
│   ├── Data\<Provider>\<Dataset>\<date>\raw\
│   ├── Documents\Sources\
│   ├── _manifests\              ← audit-rapporter, migrationsplaner
│   ├── _ops\                    ← batch-loggar, manuella granskningar
│   └── _db_snapshots\           ← valfria pg_dump (schema eller full)
├── Platform\                    ← valfri read-only spegling för Gemini (se nedan)
│   ├── knowledge-base\          ← agent-instruktioner (kopia eller symlink-beskrivning)
│   └── docs-architecture\       ← utvalda docs (gap, policy) — inte hela repot
└── (git clone körs lokalt i C:\Dev\ — primär kodsanning)
```

`Platform\` är **valfri** — primär kodsanning ska vara Git. Lägg bara det Gemini behöver läsa ofta (gap, policy, harvesting-faser) om Enterprise inte är kopplat till GitHub.

---

## Steg 1 — Plattformskod till Gemini Enterprise

### Alternativ A: GitHub-koppling (rekommenderad)

1. Repo: `miljobeslut-platform-recovery` på GitHub.
2. I Gemini Enterprise / Vertex AI Search: lägg till datakälla **GitHub repository** (eller Cloud Source Repositories efter mirror).
3. Exkludera: `node_modules`, `storage/manifests/*.log`, stora binärer, `legacy/`, `.quarantine/`.

### Alternativ B: Kuraterad Drive-bundle

Om Gemini Enterprise inte har stabil GitHub-koppling, bygg en säker Drive-bundle:

```powershell
npm run ops:gemini-context:dry
npm run ops:gemini-context
```

Standardmål:

```text
H:\Delade enheter\Miljöbeslut\Platform\Gemini_Enterprise_Context
```

Bundlen skapas av `scripts/ops/export-gemini-context.mjs` och innehåller:

- `GEMINI.md`, `AGENTS.md`, `package.json`, `docker-compose.yml`
- `knowledge-base/`
- `docs/architecture/`, relevanta `docs/ops/` och Google-målarkitektur
- `prisma/schema.prisma`, `prisma/spatial/`
- import-, DB- och serverkod som behövs för PostGIS/Mimers Brunn-kontext
- `gemini-context-manifest.json` med exakt filförteckning

Bundlen exkluderar `.env`, `node_modules`, `.git`, `storage`, stora loggar, binärdata och live PostgreSQL-volymer.

### Alternativ C: Bara knowledge base i repot

Indexera mappen `knowledge-base/` om du vill ha en minimal AI-källa:

| Fil | Innehåll |
|-----|----------|
| `knowledge-base/MIMER_LIBRARIAN.md` | Mandat och Mimers Brunn-regler |
| `knowledge-base/DATA_COVERAGE_GAPS.md` | Kort gap-status |
| `knowledge-base/NATIONAL_HARVESTING_PHASES.md` | LST harvest-plan |
| `GEMINI.md` | Projektinstruktioner (root) |

Detta räcker för instruktioner och gap-status, men ger inte Gemini full plattforms- och PostGIS-kontext.

---

## Steg 2 — PostGIS-kontext till Gemini (utan live-volym)

Gemini behöver **schema och täckning**, inte 17 GB binärdata.

### Alltid indexera (från Git)

| Sökväg | Innehåll |
|--------|----------|
| `prisma/spatial/*.sql` | PostGIS-schema, index, vyer |
| `prisma/schema.prisma` | Domänmodell (Prisma) |
| `docs/architecture/data-dictionary.md` | Entiteter |
| `docs/architecture/data-coverage-gaps.md` | Vad som saknas i DB |
| `docs/architecture/governance/data_matrix.md` | Schema → modulägarskap |
| `scripts/import/config/importRegistry.ts` | Registrerade dataset |

### Valfritt: schema-snapshot på Master Archive

```powershell
# Schema only — liten fil, Drive-vänlig
docker exec miljobeslut-postgres pg_dump -U miljobeslut -d miljobeslut `
  --schema-only --no-owner -Fc `
  -f /master-archive/_db_snapshots/schema_only_2026-06-26.dump
```

Full dump (stor) endast för disaster recovery — inte som primär Gemini-källa.

### Live PostGIS i produktion (framtida)

Enligt `docs/migration/google-target-architecture.md`: **Cloud SQL PostGIS** med IAM — Gemini anropar plattformens API, inte direkt SQL.

---

## Steg 3 — Geodata på Drive (redan på plats)

`docker-compose.yml` monterar Master Archive:

```yaml
source: H:\Delade enheter\Miljöbeslut\GEO_Master_Archive
target: /master-archive
```

Gemini Enterprise kan läsa:

- `manifest.json` per dataset (manifest v2)
- `storage/manifests/archive-local-verify-registry.json` (kopia under `_manifests/` vid behov)
- Harvest-strategier i `knowledge-base/`

**Drive-synk:** Lokal H: är source of truth tills "Hitta utan att leta" är löst (se `data-coverage-gaps.md`).

---

## Steg 4 — Ny maskin / återställning

```powershell
git clone <repo> C:\Dev\miljobeslut-platform-recovery
cd miljobeslut-platform-recovery
npm install
copy .env.example .env

# H: redan synkad via Drive Desktop
docker compose --profile docker-db up -d db
npm run db:bootstrap

# Importera från /master-archive via librarian — ELLER:
# pg_restore från _db_snapshots/ om snapshot finns
```

---

## Checklista — Gemini Enterprise datakällor

- [ ] GitHub-repo kopplat (eller `knowledge-base/` på Drive)
- [ ] `GEMINI.md` + `knowledge-base/MIMER_LIBRARIAN.md` indexerade
- [ ] `docs/architecture/data-coverage-gaps.md` indexerad
- [ ] `prisma/spatial/*.sql` indexerad
- [ ] `GEO_Master_Archive` delad (läsbehörighet)
- [ ] **Ej** indexerad: `.env`, secrets, live `postgres-data` volym, PII-tabeller

---

## Referenser

| Dokument | Innehåll |
|----------|----------|
| [data-coverage-gaps.md](../architecture/data-coverage-gaps.md) | Geodata-gap |
| [import-librarian-only-policy.md](../architecture/import-librarian-only-policy.md) | Import-policy |
| [postgis-docker-drift.md](./postgis-docker-drift.md) | Lokal PostGIS-drift |
| [google-target-architecture.md](../migration/google-target-architecture.md) | Cloud SQL-mål |
| `AGENTS.md` | AI-verktygsdirektiv |
