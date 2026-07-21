# IMPORT_GUIDE.md

# Komplett importguide – Miljobeeslut.se Geodata Pipeline

Genererad: 2026-04-22

## Forutsaettningar

### 1. Installera GDAL med ogr2ogr

```bash
# Windows
choco install gdal
# eller via OSGeo4W (rekommenderas)
# https://trac.osgeo.org/osgeo4w/

# Verifiera
ogr2ogr --version
# GDAL 3.x.x (kravs)
```

### 2. Saett DATABASE_URL

```bash
# I .env (Miljobeeslut.se/.env)
DATABASE_URL=postgresql://user:pass@host:5432/miljobeeslut

# eller som miljovariabel
$env:DATABASE_URL = "postgresql://..."
```

### 3. Kors SQL-migrationer forst

```bash
psql $DATABASE_URL -f scripts/data-pipeline/create_extended_schemas.sql
```

---

## Extraktionsordning (kors forst om data inte ar extraherad)

### Steg 1 – Batch A Smaa filer (<1 GB) Kors nu

```bash
python root_ops/extract_deferred_data.py A
# Tid: 5-15 min
# Extraherar: kontinuitetsskogar, lovskog, geofysik, SMHI, MFI-del8/9/Sverige
```

### Steg 2 – Batch B Medelstora (1-3 GB) 30-90 min

```bash
python root_ops/extract_deferred_data.py B
# Extraherar: MFI-del3/5/6/7, NMD2023 basskikt v2.1
```

### Steg 3 – Batch C Stora (3-8 GB) Kors natt

```bash
python root_ops/extract_deferred_data.py C
# Extraherar: MFI-del1/2/4, analys_boreonemoral, END-buller, NMD-tradslag
```

---

## Importordning (beroenden respekteras)

### Fas 1: Grundlaaeggande skyddszoner (snabb, kritisk)

```bash
# NVR Naturvardsregistret
python scripts/data-pipeline/import_all_datasets.py nvr

# Natura 2000 + Ramsar + Varldsarv
python scripts/data-pipeline/import_all_datasets.py natura2000

# MSB Oversvamning och risk
python scripts/data-pipeline/import_all_datasets.py msb
```

Tid: ~15-30 min | Resultat: env.protected_area, env.natura2000_area, climate.flood_risk_area

---

### Fas 2: Geologi och vatten

```bash
# SGU Jordarter, grundvatten, berggrund, skredrisk
python scripts/data-pipeline/import_all_datasets.py sgu

# SMHI SVAR Avrinning + vattenforekomster
python scripts/data-pipeline/import_all_datasets.py vatten
```

Tid: ~30-60 min (Store jordarter25k = 3.2 GB extraherad) | Resultat: env.sgu\_\* + env.water_catchment

---

### Fas 3: Marktaecke och naturtyp

```bash
# NMD Markanvaendning 2023
python scripts/data-pipeline/import_all_datasets.py nmd

# Vaetmark, myrskyddsplan, sandmarker
python scripts/data-pipeline/import_all_datasets.py vatmark

# Naturtypskartan RIKS + OECM (891 MB extraherat – tar tid)
python scripts/data-pipeline/import_all_datasets.py naturtyp

# Riksintresse naturvaard
python scripts/data-pipeline/import_all_datasets.py riksintresse
```

Tid: ~60-120 min | Resultat: env.land_cover, env.wetland, env.habitat_type, env.national_interest

---

### Fas 4: Kulturmiljo och RAA Monument

```bash
python scripts/data-pipeline/import_all_datasets.py kulturmiljo
```

Tid: ~10-20 min | Resultat: culture.monument, culture.agricultural_heritage

---

### Fas 5: Skogsanalyser (batch A maste vara klar)

```bash
python scripts/data-pipeline/import_all_datasets.py skog
```

Tid: ~30-60 min | Resultat: env.forest_analytics

---

### Fas 6: Geofysik och SMHI (batch A klar)

```bash
python scripts/data-pipeline/import_all_datasets.py geofysik
python scripts/data-pipeline/import_all_datasets.py smhi
```

Tid: ~15 min | Resultat: env.geophysics, climate.smhi_station

---

### Fas 7: Tunga dataset (batch B+C maste vara klara) – kors natt

```bash
# NMD Markfuktighetsindex – 18 GB extraherat
python scripts/data-pipeline/import_all_datasets.py markfuktig

# NMD Tradslag – 5.3 GB extraherat
python scripts/data-pipeline/import_all_datasets.py tradslag

# END Bullerkartor – 5.4 GB extraherat
python scripts/data-pipeline/import_all_datasets.py buller
```

Tid: 4-12 timmar | Resultat: env.soil_moisture, env.forest_species, env.noise_area

---

## Verifiera import

```sql
-- Raaekna rader per tabell
SELECT
  'env.protected_area'     AS tbl, COUNT(*) FROM env.protected_area
UNION ALL SELECT 'env.natura2000_area',            COUNT(*) FROM env.natura2000_area
UNION ALL SELECT 'env.water_protection_area',      COUNT(*) FROM env.water_protection_area
UNION ALL SELECT 'env.sgu_soil_type',              COUNT(*) FROM env.sgu_soil_type
UNION ALL SELECT 'env.sgu_well',                   COUNT(*) FROM env.sgu_well
UNION ALL SELECT 'climate.flood_risk_area',        COUNT(*) FROM climate.flood_risk_area
UNION ALL SELECT 'env.land_cover',                 COUNT(*) FROM env.land_cover
UNION ALL SELECT 'env.wetland',                    COUNT(*) FROM env.wetland
UNION ALL SELECT 'env.habitat_type',               COUNT(*) FROM env.habitat_type
UNION ALL SELECT 'env.national_interest',          COUNT(*) FROM env.national_interest
UNION ALL SELECT 'env.forest_analytics',           COUNT(*) FROM env.forest_analytics
UNION ALL SELECT 'env.soil_moisture',              COUNT(*) FROM env.soil_moisture
UNION ALL SELECT 'env.noise_area',                 COUNT(*) FROM env.noise_area
UNION ALL SELECT 'climate.smhi_station',           COUNT(*) FROM climate.smhi_station
ORDER BY tbl;

-- Testa schaktrisk-funktion
SELECT * FROM env.excavation_risk(
    ST_MakeEnvelope(17.9, 59.3, 18.1, 59.4, 4326)
);

-- Kontrollera geometrier
SELECT tbl, ST_IsValid(geometry) AS valid, COUNT(*)
FROM (
    SELECT 'soil_moisture' AS tbl, geometry FROM env.soil_moisture LIMIT 100
) x
GROUP BY tbl, valid;
```

---

## Spatial index – kors efter import

```sql
-- Skapa index paa alla nya tabeller
REINDEX INDEX env.land_cover_geom_idx;
REINDEX INDEX env.soil_moisture_geom_idx;
REINDEX INDEX env.wetland_geom_idx;
REINDEX INDEX env.habitat_type_geom_idx;
REINDEX INDEX env.national_interest_geom_idx;
REINDEX INDEX env.noise_area_geom_idx;
REINDEX INDEX env.forest_analytics_geom_idx;
REINDEX INDEX env.forest_species_geom_idx;
REINDEX INDEX env.geophysics_geom_idx;

-- Vacuuma efter stora importer
VACUUM ANALYZE env.soil_moisture;
VACUUM ANALYZE env.forest_species;
VACUUM ANALYZE env.land_cover;
```

---

## Diskusanvaendning (estimat)

| Fas        | Dataset                   | Extraherat | PostGIS (estimat) |
| ---------- | ------------------------- | ---------- | ----------------- |
| 1          | NVR + Natura2000 + MSB    | ~1 GB      | ~500 MB           |
| 2          | SGU geologi + vatten      | ~12 GB     | ~8 GB             |
| 3          | NMD + vaetmark + naturtyp | ~2 GB      | ~1.5 GB           |
| 4          | Kulturmiljo               | ~0.5 GB    | ~200 MB           |
| 5          | Skogsanalyser             | ~2 GB      | ~1 GB             |
| 6          | Geofysik + SMHI           | ~0.3 GB    | ~100 MB           |
| 7          | MFI + Tradslag + Buller   | ~40 GB     | ~25 GB            |
| **TOTALT** |                           | **~58 GB** | **~36 GB**        |

---

## Loggfiler

- Extraktionslogg: `root_ops/extract_deferred.log`
- Importlogg: `root_ops/import.log`
- Ursprunglig ZIP-analys: `root_ops/zip_analysis_report.md`

---

## Vanliga fel

| Fel                             | Losning                                 |
| ------------------------------- | --------------------------------------- |
| `ogr2ogr: command not found`    | Installera GDAL / laaegg OSGeo4W i PATH |
| `SRID 0` pa geometri            | Laaegg till `-s_srs EPSG:3006`          |
| `duplicate key value`           | Laaegg till `-skipfailures`             |
| `out of memory`                 | Deela upp med `-clipsrc` per laen       |
| Geometrifel vid Naturtypskartan | Laaegg till `-makevalid`                |
