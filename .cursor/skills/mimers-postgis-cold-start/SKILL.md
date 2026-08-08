---
name: mimers-postgis-cold-start
description: >-
  Optimizes prerequisites and cold-starts Mimers PostGIS for Miljöbeslut:
  relic sanitation, disk/RAM prep, app-HITL dump, clean engine, then PDF/chunking
  before heavy geodata import. Use when rebuilding PostGIS, freeing Docker/VHDX
  space, sanitizing recovery relics, preparing import, or choosing PDF chunking
  vs topo/geodata import order.
---

# Mimers PostGIS Cold-Start

Project skill for **Miljöbeslut / Mimers Brunn**. Master archive is truth; PostGIS is a rebuildable derived view.

## Priority order (do not invert)

1. **Prerequisites** — disk free on C:, Docker healthy, no relic bloat in `PGDATA`
2. **Dump unique app/HITL** — tiny tables that are *not* re-importable from geodata
3. **Sanitize relics** — recovery clones, unused images, files wrongly stored under `PGDATA`
4. **Cold engine** — one PostGIS container, extensions (`postgis`, `vector`), Prisma migrate, smoke
5. **PDF + chunking** — archive → extract → `evidence_chunks` (needs schema, **not** topo50)
6. **Geodata import** — last, batchwise via `IMPORT_REGISTRY` from master (SHA first)

Never dump all PDFs straight into RAG. Never copy master datasets into `PGDATA`.

## Prerequisites checklist

```
- [ ] C: has comfortable free space (prefer >80 GB before bulk import)
- [ ] Docker Desktop running; note VHDX size vs `docker system df` logical size
- [ ] No leaked mcp/node-code-sandbox containers (idle ~70 MB RAM each)
- [ ] `PGDATA` has no `geo_master_archive/` file tree (bind-mount master RO instead)
- [ ] Prefer one geodata engine; avoid parallel empty “prod” DBs confusing DATABASE_URL
- [ ] Unique app rows dumped before any volume wipe
```

## Unique data to dump before wipe

Dump from `miljobeslut-postgres` / DB `miljobeslut` (user `miljobeslut`):

- `evidence_chunks`
- `environmental_cases`
- `judgment_records`
- `"User"`, `"Project"` (and related HITL if non-empty)

Geodata schemas (`topo50`, `topo250`, `viss`, `culture`, …) are **re-importable** from `GEO_Master_Archive`.

## Relic sanitation (safe defaults)

**Remove / stop when unused:**

- MCP sandbox containers (`ancestor` = `mcp/node-code-sandbox` image)
- Images: `hello-world`, unused MCP/tooling, obsolete recovery images **after** engine replaced
- Empty/orphan volumes (`Links: 0` and confirmed legacy)
- Files under `/var/lib/postgresql/data/geo_master_archive` (especially NMD copies)

**Do not delete without explicit OK:**

- Named volume `miljobeslut-platform-recovery_postgres-data` while it is still the live engine (dump first)
- Active Postgres data that has not been dumped
- `Desktop\Telefon`, personal Downloads media

After large Docker deletes: `wsl --shutdown` + elevated `diskpart` compact of  
`%LOCALAPPDATA%\Docker\wsl\disk\docker_data.vhdx` (UAC). Restart Docker Desktop after.

## Process / reboot / memory

| Action | When |
|--------|------|
| Close Chrome / heavy IDEs / LDPlayer | Before bulk import or VHDX compact |
| Stop leaked sandboxes | Always before RAM-heavy work |
| Reboot | Optional; use if RAM fragmented or Docker wedged after compact |
| Import | Prefer fresh session with ~50%+ free RAM; one heavy job at a time |

Postgres tuning for local Docker: keep `shared_buffers` modest vs host RAM; raise `maintenance_work_mem` only during index/import windows; `VACUUM ANALYZE` after batches. See `docs/ops/postgis-docker-drift.md`.

## Cold engine steps

1. Point `DATABASE_URL` at the **intended** single PostGIS service  
   `postgresql://miljobeslut:miljobeslut@localhost:5432/miljobeslut?sslmode=disable`
2. Ensure master is mounted **read-only** (never copied into `PGDATA`)  
   - Canonical truth: `H:\…\GEO_Master_Archive` (Google Shared Drive)  
   - Docker runtime mirror: `D:\GEO_Master_Archive_Runtime` via `docker-compose.geodata.yml`  
   - Validate: `node scripts/ops/check-postgis-prerequisites.cjs`
3. `CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS vector;`
4. Prisma migrate / spatial bootstrap as in repo
5. PostGIS smoke / readiness (`pg_isready` + extensions check)
6. Restore HITL dump if needed
7. Run PDF/chunk pipeline
8. Only then geodata via `scripts/import/config/importRegistry.ts`

See `docs/ops/postgis-prerequisites-checklist.md`.

## PDF + chunking vs geodata

- **PDF/chunking first** after cold engine — unlocks cases, legal, RAG
- **Geodata second** — hours of I/O/RAM; spatial features only

## Receipts

Write ops receipts under `storage/manifests/` (e.g. `disk-reclaim-*`, dump paths). Do not commit secrets.

## References

- `docs/architecture/mimers-brunn-v2.0.1.md` (**ACTIVE** data governance — Final Frozen Edition)
- `docs/ops/postgis-docker-drift.md`
- `GEMINI.md` (agent summary)
- `scripts/import/config/importRegistry.ts`
