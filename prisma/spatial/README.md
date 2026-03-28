# Spatial Data Versioning (Schema: env)

Dessa tabeller hanterar data frÃ¥n SGU (Sveriges Geologiska UndersÃ¶kning) och NaturvÃ¥rdsverket. De Ã¤r medvetet exkluderade frÃ¥n `prisma/schema.prisma` fÃ¶r att undvika komplikationer med PostGIS-typer och prestandakritiska GIST-index.

## Tabeller

- **`env.sgu_ground_layer`**: Jordartskartor (jordmÃ¥n, lager).
- **`env.sgu_landslide_feature`**: Jordskred och raviner.
- **`env.natura2000_area`**: Skyddade omrÃ¥den enligt Natura 2000.
- **`env.protected_area`**: Naturreservat och nationalparker (NVR).

## Installation / Migration

FÃ¶r att Ã¥terskapa strukturen i en ny miljÃ¶, kÃ¶r:

```bash
psql $DATABASE_URL -f prisma/spatial/001_env_spatial_tables.sql
```

## Import av data

Datan i dessa tabeller fÃ¶rvÃ¤ntas fyllas pÃ¥ via importscript som finns under `scripts/import/`, i synnerhet:
- `scripts/import/import-sgu-risk-layers.ts`

## VarfÃ¶r inte Prisma?

1. **Spatiala Index**: Prisma stÃ¶djer inte fullt ut `GIST`-index i alla versioner.
2. **Geometri-typer**: Tabellerna anvÃ¤nder `geometry` som oftast inte behÃ¶ver exponeras direkt som modeller i Prisma, dÃ¥ vi frÃ¤mst gÃ¶r spatiala frÃ¥gor via SQL (`ST_Intersects`, `ST_Distance`).
3. **Prestanda**: Genom att separera dessa frÃ¥n Prisma-migreringar undviker vi lÃ¥ngsamhet vid normala schemaÃ¤ndringar.
