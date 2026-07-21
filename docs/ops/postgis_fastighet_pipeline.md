**PostGIS Fastighetspipeline**

Det har repot har nu ett konkret GIS-spar for snabb fastighetssokning och kontrollerad import till PostGIS.

**Filer**

- Extensions och bas-scheman: [enable_postgis.sql](C:\Users\jimmy\Desktop\utvecklings arbete\Kod\Ny mapp\remix\_-copy-of-miljobeslut.se-portal\scripts\enable_postgis.sql)
- Property pipeline: [create_property_unit_pipeline.sql](C:\Users\jimmy\Desktop\utvecklings arbete\Kod\Ny mapp\remix\_-copy-of-miljobeslut.se-portal\scripts\db\create_property_unit_pipeline.sql)
- Merge staging till core: [merge_property_unit_stage_to_core.sql](C:\Users\jimmy\Desktop\utvecklings arbete\Kod\Ny mapp\remix\_-copy-of-miljobeslut.se-portal\scripts\db\merge_property_unit_stage_to_core.sql)
- Scoped OGC-import till staging: [import-lantmateriet-property-units.ts](C:\Users\jimmy\Desktop\utvecklings arbete\Kod\Ny mapp\remix\_-copy-of-miljobeslut.se-portal\scripts\import\import-lantmateriet-property-units.ts)
- Rasterimport marktacke: [import_lm_marktacke.py](C:\Users\jimmy\Desktop\utvecklings arbete\Kod\Ny mapp\remix\_-copy-of-miljobeslut.se-portal\scripts\import_lm_marktacke.py)

**Mal**

- exakt fastighetsuppslag forst
- fuzzy fallback bara nar exakt uppslag missar
- snabb punkt-i-fastighet for kartklick
- staging fore merge till `core.*`
- inga liveandringar utan manuell korning

**1. Aktivera extensions**
Kor manuellt:

```sql
\i scripts/enable_postgis.sql
```

Detta ger:

- `postgis`
- `pg_trgm`
- `unaccent`
- scheman `stage`, `core`, `admin`, `env`, `hydro`, `infra`

**2. Skapa fastighetspipeline**
Kor manuellt:

```sql
\i scripts/db/create_property_unit_pipeline.sql
```

Detta skapar:

- `stage.property_unit_raw`
- `core.property_unit`
- normaliseringsfunktion `core.normalize_designation(text)`
- index:
  - `btree` pa `designation_norm`
  - `GIN pg_trgm` pa `designation_norm`
  - `GIST` pa `geom`

**2.1 Merge till core**
Kor manuellt efter staging-import:

```sql
\i scripts/db/merge_property_unit_stage_to_core.sql
```

**3. Importprincip**
Professionell ordning:

1. ladda ner kalla
2. importera till `stage.*`
3. validera
4. merge till `core.*` via separat SQL-steg
5. skapa eller uppdatera index
6. `ANALYZE`

**3.1 Scoped import fran Lantmateriet OGC**
Det finns nu ett separat skript som bara importerar till `stage.property_unit_raw` och som kraver uttryckligt filter. Nationell fullimport ar blockerad avsiktligt.

Dry-run forst:

```powershell
npm run import:property-units -- --municipality-code 0182 --dry-run --max-features 20
```

Skarp staging-import:

```powershell
npm run import:property-units -- --municipality-name NACKA --tract ORMINGE --max-features 500
```

Avancerat med ratt CQL2-filter:

```powershell
npm run import:property-units -- --filter "kommunkod = '0182' AND trakt = 'ORMINGE'"
```

Skriptet:

- anvander samma OGC-auth som appen
- upsertar bara till `stage.property_unit_raw`
- bygger full beteckning av `kommunnamn + trakt + etikett`
- lamnar merge till `core.property_unit` som manuellt granskat steg via separat mergefil

**4. Fastighetsuppslag**
Exakt uppslag forst:

```sql
WITH q AS (
  SELECT core.normalize_designation('Orebro 1:23') AS designation_norm
)
SELECT *
FROM core.property_unit pu, q
WHERE pu.designation_norm = q.designation_norm
LIMIT 1;
```

Fuzzy fallback:

```sql
WITH q AS (
  SELECT core.normalize_designation('orebro1-23') AS designation_norm
)
SELECT pu.*, similarity(pu.designation_norm, q.designation_norm) AS sim
FROM core.property_unit pu, q
WHERE pu.designation_norm % q.designation_norm
ORDER BY sim DESC
LIMIT 1;
```

**5. Kartklick**
For punkt-i-fastighet, anvand SWEREF 99 TM (`3006`) och `ST_Covers`:

```sql
WITH p AS (
  SELECT ST_Transform(ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), 3006) AS geom
)
SELECT pu.*
FROM core.property_unit pu, p
WHERE pu.geom && p.geom
  AND ST_Covers(pu.geom, p.geom)
LIMIT 1;
```

**6. Bulkimport av vector**
For stora vectorlager ar rekommendationen:

```bash
ogr2ogr -f PostgreSQL PG:"host=... dbname=... user=... password=..." \
  data.gpkg \
  -nln stage.property_unit_raw \
  -lco GEOMETRY_NAME=geom \
  --config PG_USE_COPY YES
```

For staging med WKT eller CSV gar det ocksa, men da bor du sjalv materialisera till `geom geometry(MultiPolygon,3006)` innan merge. `PG_USE_COPY YES` ar normalt battre an att mellanlanda i CSV for geometri.

**7. Rasterimport marktacke**
`import_lm_marktacke.py` gor nu:

- sakerstaller `postgis` och `env`-schema
- anvander temporar katalog
- kor `raster2pgsql -> psql`
- anvander `PGOPTIONS` for snabbare bulkload
- kor `ANALYZE env.marktacke`

Miljovariabler:

- `DATABASE_URL`
- `LM_MARKTACKE_TILE_SIZE`
- `PGOPTIONS`

Exempel:

```powershell
$env:PGOPTIONS='-c synchronous_commit=off -c maintenance_work_mem=1GB -c work_mem=128MB'
python scripts/import_lm_marktacke.py
```

**8. Juridik och drift**

- lagra bara det som behovs for andamalet
- hall `stage.*` separerat fran `core.*`
- lat merge till `core.*` vara ett manuellt, granskat steg
- bygg inte personkopplade registerutdrag i samma flode utan uttryckligt stod i beslut eller avtal

**9. Aktuella backend-routes**

- `GET /api/system/postgis`
- `POST /api/property/lookup/postgis`

`/api/property/lookup/postgis` gor:

1. exakt `designation_norm`
2. fuzzy fallback vid miss
3. auditloggning och projektkontroll innan svar
