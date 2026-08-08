# PostGIS prerequisites — Mimers Brunn v2.0.1

Before PDF chunking or geodata import, establish this baseline.

## Quick validate

```powershell
docker compose -f docker-compose.geodata.yml up -d
node scripts/ops/check-postgis-prerequisites.cjs
```

Receipt: `storage/manifests/postgis-prerequisites-*/prerequisites-status.json`

## Required (cold-start skill)

| Check | Target |
| --- | --- |
| C: free | ≥ 80 GB |
| Docker Desktop | running |
| Engine | single `miljobeslut-postgres` healthy on `:5432` |
| Extensions | `postgis`, `vector`, `pg_trgm` (+ raster/trgm as present) |
| PGDATA | no `geo_master_archive/` file tree |
| Master mount (MB-004) | `/mnt/geo_master_archive/Data` readable (legacy alias `/master-archive`) |
| HITL dump | present if wipe planned |

## Compose

`docker-compose.geodata.yml` — external volume kept; master bind-mounted RO.

```text
DATABASE_URL=postgresql://miljobeslut:miljobeslut@localhost:5432/miljobeslut?sslmode=disable
MASTER_ARCHIVE_ROOT=H:\Delade enheter\Miljöbeslut\GEO_Master_Archive
```

Runtime inside container: `/mnt/geo_master_archive` (v2.0.1).

## Order after prerequisites pass

1. Schema / spatial bootstrap (no heavy geodata yet)
2. PDF + deterministic chunking
3. Geodata import via registry + DatasetApprovalArtifact

## Known failure / runtime mirror

`H:\…\GEO_Master_Archive` (Google Shared Drive) is **canonical** but Docker Desktop cannot bind-mount it (empty 127 MB stub).

**Runtime mirror (Docker-visible NTFS):** `D:\GEO_Master_Archive_Runtime`

```powershell
node scripts/ops/setup-geo-master-runtime-mirror.cjs
$env:MASTER_ARCHIVE_HOST_PATH='D:/GEO_Master_Archive_Runtime'
docker compose -f docker-compose.geodata.yml up -d
node scripts/ops/check-postgis-prerequisites.cjs
```

Sync more from H: into the mirror before geodata import (Data/…).
