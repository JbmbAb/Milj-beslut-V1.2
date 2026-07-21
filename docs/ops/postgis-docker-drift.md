# PostGIS i Docker — drift, diskutrymme och akutåterställning

Detta dokument beskriver hur Miljöbeslut.se kör PostGIS lokalt (`miljobeslut-postgres`), vanliga orsaker till att databasen blir oåtkomlig när disken fylls, och ett optimalt tillvägagångssätt för förebyggande åtgärder.

**Miljö:** Docker Desktop (Windows) → container `miljobeslut-postgres` (port **5432**), named volume `miljobeslut-platform-recovery_postgres-data`. Test-DB: `miljobeslut-postgres-test` (port **5433**, ingen persistent volym i compose).

---

## Symtom

- PostgreSQL “försvinner” (container stoppar, `pg_isready` misslyckas, appen får connection refused)
- Docker Desktop / WSL-disk närmar sig 100 %
- Databasen startar inte efter omstart trots att “data finns kvar”

Detta är nästan alltid **resursbrist (disk eller RAM)**, inte att volymen raderats — så länge named volume är korrekt monterad.

---

## Orsaker (prioriterad för vår stack)

### 1. Docker-lagring och föräldralösa volymer (vanligast här)

Massiva datainläsningar skriver till **named volumes**, inte bara till containern. Gamla volymer från tidigare projektnamn (`miljbeslut_postgres-data` m.fl.) kan ligga kvar **utan kopplad container** och äta hundratals GB.

**Diagnos:**

```powershell
docker system df
docker system df -v | Select-String postgres
docker volume ls
docker inspect miljobeslut-postgres --format "{{json .Mounts}}"
```

**Åtgärd:** Ta bort **endast** volymer med `Links: 0` efter visuell kontroll att de är legacy. Rensa build cache vid behov (`docker builder prune`).

---

### 2. Skenande temporära filer (tunga spatial queries)

`ST_Intersects`, `ST_Buffer` m.m. över miljontals rader **utan GIST-index** eller **utan bbox** tvingar PostgreSQL att skapa stora temp-filer under `base/pgsql_tmp`.

**Diagnos:**

```powershell
docker exec miljobeslut-postgres psql -U miljobeslut -d miljobeslut -c `
  "SELECT temp_files, pg_size_pretty(temp_bytes) FROM pg_stat_database WHERE datname='miljobeslut';"

docker exec miljobeslut-postgres bash -c "du -sh /var/lib/postgresql/data/base/pgsql_tmp 2>/dev/null"
```

**Förebyggande (plattform):**

- Kör `npm run db:index:spatial-gist` efter spatial bootstrap
- Använd alltid bbox i kart-API (`postgisLayerService`)
- Efter stora importer: **`VACUUM ANALYZE`** (se punkt 4)
- Sätt `temp_file_limit` (se punkt 6) — konfigurerat i `docker-compose.yml`

**App-specifikt:** vissa routes förväntar `wkb_geometry` medan tabellen har `geom` (t.ex. `env.protected_area`) — fel kolumn ger fel eller onödigt dyra planer. Se `scripts/db/audit-app-gis-layers.mjs`.

---

### 3. Write-Ahead Log (WAL)

WAL växer vid stora INSERT/UPDATE. Om disken redan är full kan checkpoint/recycling inte slutföras.

**Diagnos:**

```powershell
docker exec miljobeslut-postgres psql -U miljobeslut -d miljobeslut -c `
  "SELECT pg_size_pretty(sum(size)) AS wal_size, count(*) AS files FROM pg_ls_waldir();"
```

**Normal drift hos oss:** WAL ~hundratals MB, `archive_mode=off`, `max_wal_size` satt i compose.

**Vid bulk-import:** undvik parallella tunga app-queries; kör `VACUUM ANALYZE` efteråt; överväg tillfälligt högre `max_wal_size` (redan i compose).

---

### 4. Saknad ANALYZE efter massimport (förstärker punkt 2)

Om miljontals geodata-rader laddats utan **`ANALYZE`** (eller `VACUUM ANALYZE`) har planner dålig statistik. Den kan **misstro GIST-index** och välja sequential scan → temp-filer exploderar.

**Efter varje stor import:**

```sql
VACUUM ANALYZE env.registerenhetsomradesytor;
-- upprepa för berörda tabeller, eller:
VACUUM ANALYZE;
```

**Diagnos (dåliga planer):**

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) FROM env.registerenhetsomradesytor t
WHERE t.geom && ST_Transform(ST_MakeEnvelope(17.55, 59.82, 17.75, 59.92, 4326), 3006);
```

Sök efter `Seq Scan` på stora tabeller där `Index Scan` förväntas.

---

### 5. Autovacuum och table bloat

PostgreSQL raderar inte rader fysiskt direkt vid UPDATE/DELETE — **dead tuples** städas av autovacuum. Vid tunga geodata-skrivningar kan autovacuum inte hinna med → tabeller och index **sväller (bloat)** och disk förbrukas i tysthet.

**Diagnos:**

```sql
SELECT schemaname, relname, n_live_tup, n_dead_tup,
       round(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2) AS dead_pct
FROM pg_stat_user_tables
WHERE n_dead_tup > 10000
ORDER BY n_dead_tup DESC
LIMIT 20;
```

**Åtgärd:**

- `VACUUM (VERBOSE, ANALYZE)` på svullna tabeller (låg trafik)
- Vid extrem bloat: `VACUUM FULL` (låser tabellen — planera fönster) eller pg_repack
- Övervaka autovacuum i logg (`log_autovacuum_min_duration` vid felsökning)

---

### 6. Proaktiv begränsning — `temp_file_limit`

En enskild dålig query ska inte få äta 100 % disk. Sätt t.ex. **20–50 GB** (Docker Desktop-disk måste ha headroom).

Konfigurerat i `docker-compose.yml` för tjänsten `db`. Vid överskridande avbryts frågan med fel istället för att hela instansen dör.

---

### 7. OOM (minnesbrist)

Tunga spatial queries + `work_mem` × parallella workers kan exhausta RAM. Docker Desktop dödar då Postgres (exit **137**).

**Diagnos (Linux-värd):** `dmesg -T | grep -i oom`  
**Windows:** Docker Desktop → Settings → Resources (RAM), container-loggar.

**Mitigation:** `shm_size: 2gb` (finns), tillräcklig Docker-RAM, sänk `max_parallel_workers_per_gather` under import.

---

## ⚠️ Akut hantering — disk 100 % full (moment 22)

När disken är full vägrar PostgreSQL ofta starta — det finns inget utrymme för kontrollfiler eller WAL-recycling. **Man kan inte “städa inifrån” databasen förrän något utrymme frigjorts utifrån.**

### Gör ALDRIG detta

> **Radera aldrig filer manuellt i `pg_wal/` (eller `pg_xlog/`).**  
> Det leder nästan alltid till **permanent korruption** och kräver restore från backup.

### Gör detta (i ordning)

1. **Frigör utrymme utanför PostgreSQL**
   - Docker: `docker system df` → ta bort **oanvända volymer** (legacy postgres-volym), `docker builder prune`
   - Windows: rensa Docker Desktop disk image, stora nedladdningar, gamla `.gz`-loggar **på värden** (inte i data directory)
   - Molnmiljö: tillfälligt utöka disk

2. **Starta containern**

   ```powershell
   docker start miljobeslut-postgres
   docker logs miljobeslut-postgres --tail 50
   ```

3. **När Postgres svarar igen** — undersök och städa **på rätt sätt**

   ```sql
   -- Temp ackumulerat (statistik)
   SELECT * FROM pg_stat_database WHERE datname = 'miljobeslut';

   -- Bloat / dead tuples
   SELECT relname, n_dead_tup FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 10;
   ```

   ```sql
   VACUUM (VERBOSE, ANALYZE);
   ```

4. **Verifiera hälsa**

   ```powershell
   docker exec miljobeslut-postgres pg_isready -U miljobeslut -d miljobeslut
   curl http://127.0.0.1:5432   # ska inte svara HTTP — men port ska vara öppen
   ```

---

## Rutin (veckovis eller efter stor import)

```powershell
# 1. Docker-disk
docker system df

# 2. DB- och WAL-storlek
docker exec miljobeslut-postgres psql -U miljobeslut -d miljobeslut -c `
  "SELECT pg_size_pretty(pg_database_size('miljobeslut')),
          pg_size_pretty((SELECT coalesce(sum(size),0) FROM pg_ls_waldir()));"

# 3. Dead tuples (topp 5)
docker exec miljobeslut-postgres psql -U miljobeslut -d miljobeslut -c `
  "SELECT relname, n_live_tup, n_dead_tup FROM pg_stat_user_tables
   ORDER BY n_dead_tup DESC LIMIT 5;"

# 4. App-GIS audit (valfritt)
node scripts/db/audit-app-gis-layers.mjs
```

---

## Bulk-import — rekommenderad ordning

1. `COPY` / `ogr2ogr` — inte rad-för-rad via appen  
2. Index **efter** load (eller `CREATE INDEX CONCURRENTLY`)  
3. `VACUUM ANALYZE` på berörda tabeller  
4. `npm run db:index:spatial-gist` om nya spatiala tabeller  
5. Kör `node scripts/db/audit-app-gis-layers.mjs`  
6. Röktest: `BASE_URL=http://localhost:3000 npm run smoke:map-layers`

---

## Relaterade filer i repot

| Fil | Syfte |
|-----|--------|
| `docker-compose.yml` | Postgres-container, volym, tuning |
| `prisma/spatial/001_gist_indexes.sql` | GIST-index |
| `scripts/db/spatial-bootstrap.ts` | Spatial schema |
| `scripts/db/audit-app-gis-layers.mjs` | Jämför app-lager vs DB |
| `scripts/smoke/map-layers.ts` | API-smoke mot kartlager |
| `docs/ops/postgis_fastighet_pipeline.md` | Fastighets-/LM-pipeline |

---

## Snabb referens — vad som gäller för Miljöbeslut just nu

| Kontroll | Typiskt OK-värde (vår dev-miljö) |
|----------|----------------------------------|
| Aktiv DB-volym | ~17 GB databas i ~33 GB volym |
| WAL | ≪ `max_wal_size` (inte GB-tals kö) |
| `pgsql_tmp` | Tom i vila |
| Föräldralös volym | **Ska inte finnas** (172 GB legacy = rensa) |
| GIST på tunga tabeller | Krävs för bbox-frågor |
| Efter import | `VACUUM ANALYZE` obligatoriskt |
