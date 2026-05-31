# Spatial Data Versioning (Schema: env/lm/audit)

Dessa tabeller hanterar spatial data som medvetet ligger utanfÃ¶r `prisma/schema.prisma` nÃ¤r fysisk databasdesign mÃ¥ste styras med rÃ¥ SQL (partitionering, GiST/BRIN, triggers, PostGIS-specifika constraints).

## Tabeller

- **`env.sgu_ground_layer`**: Jordartskartor (jordmÃ¥n, lager).
- **`env.sgu_landslide_feature`**: Jordskred och raviner.
- **`env.natura2000_area`**: Skyddade omrÃ¥den enligt Natura 2000.
- **`env.protected_area`**: Naturreservat och nationalparker (NVR).
- **`lm.fastighet`**: SQL-Ã¤gd partitionerad tabell per `lan_kod` (LIST partitioning).
- **`audit.property_change_log`**: DatabasnivÃ¥-audit (triggerbaserad chain-of-custody fÃ¶r fastighetsÃ¤ndringar).

## Arkitekturansvar

1. SQL-migrationer i `prisma/spatial/*.sql` Ã¤ger:
   - `lm.fastighet` (föräldratabell + partitioner)
   - partitionsvisa GiST/BRIN-index
   - constraints och databastriggers
2. Prisma anvÃ¤nder:
   - vyer (t.ex. `lm.fastighet_app_v`)
   - rå SQL när PostGIS-funktioner behövs
3. ETL gÃ¥r direkt mot PostgreSQL/PostGIS (`COPY`, `ogr2ogr`, batchad klient)
4. Spatiala queries ska inkludera `lan_kod` nÃ¤r affÃ¤rsfallet tillÃ¥ter det fÃ¶r partition pruning.

## Installation / Migration

FÃ¶r att Ã¥terskapa strukturen i en ny miljÃ¶, kÃ¶r bootstrap-flÃ¶det:

```bash
npm run db:spatial
```

Bootstrappen (`scripts/db/spatial-bootstrap.ts`) applicerar `prisma/spatial/*.sql` i lexikografisk ordning och loggar checksummor i `spatial_migrations`.

## Import av data

Datan i dessa tabeller fÃ¶rvÃ¤ntas fyllas pÃ¥ via importscript som finns under `scripts/import/`, i synnerhet:

- `scripts/import/import-sgu-risk-layers.ts`

## VarfÃ¶r inte enbart Prisma?

1. **Spatiala Index**: Prisma stÃ¶djer inte fullt ut `GIST`-index i alla versioner.
2. **Geometri-typer**: Tabellerna anvÃ¤nder `geometry` som oftast inte behÃ¶ver exponeras direkt som modeller i Prisma, dÃ¥ vi frÃ¤mst gÃ¶r spatiala frÃ¥gor via SQL (`ST_Intersects`, `ST_Distance`).
3. **Partitionering**: Deklarativ partitionering med partition-specifika index/triggers Ã¤r enklare och sÃ¤krare i rÃ¥ SQL.
4. **Prestanda**: Genom att separera dessa frÃ¥n Prisma-migreringar undviker vi lÃ¥ngsamhet vid normala schemaÃ¤ndringar.
