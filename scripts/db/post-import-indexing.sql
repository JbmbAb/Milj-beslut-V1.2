-- ================================================================
--  Post-import indexering för 100M–500M rader geodata
--  Kör EFTER att all data är inne
--  psql -U postgres -d miljobeslut -f scripts/db/post-import-indexing.sql
-- ================================================================

-- Sätt hög maintenance_work_mem för parallellt index-bygge
SET maintenance_work_mem = '4GB';
SET max_parallel_maintenance_workers = 4;

-- ── AKTIVERA AUTOVACUUM IGEN ─────────────────────────────────────
ALTER SYSTEM SET autovacuum = on;
SELECT pg_reload_conf();

-- ================================================================
--  INDEXERINGSSTRATEGI FÖR STORSKALIG GEODATA
--
--  GiST  → geometry-kolumner (spatial queries)
--  BRIN  → sekventiella stora tabeller (registerenhetsomradesytor etc.)
--           BRIN är 100-1000x mindre än B-tree, perfekt för 100M+ rader
--           med naturlig insert-ordning
--  B-tree→ UUID/beteckning/kommunnamn (point lookups)
-- ================================================================

-- ── env.registerenhetsomradesytor (Lantmäteriet fastigheter) ─────
--  Förväntat: 30–40M rader (alla fastighetsgränser i Sverige)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_regenhet_geom
  ON env.registerenhetsomradesytor USING GIST (geom) WITH (fillfactor=80);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_regenhet_trakt
  ON env.registerenhetsomradesytor (trakt);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_regenhet_etikett
  ON env.registerenhetsomradesytor (etikett);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_regenhet_kommunnamn
  ON env.registerenhetsomradesytor (kommunnamn);

-- Sammansatt index för standarduppslag (kommunnamn + trakt + etikett)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_regenhet_lookup
  ON env.registerenhetsomradesytor (kommunnamn, trakt, etikett);

-- BRIN-index på ogc_fid (insert-ordning) – mycket kompakt för 30M rader
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_regenhet_brin_ogcfid
  ON env.registerenhetsomradesytor USING BRIN (ogc_fid) WITH (pages_per_range=128);

-- ── env.registerenhetsomradeslinjer (Lantmäteriet gränser) ───────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_regenhet_linjer_geom
  ON env.registerenhetsomradeslinjer USING GIST (geom) WITH (fillfactor=80);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_regenhet_linjer_brin
  ON env.registerenhetsomradeslinjer USING BRIN (ogc_fid) WITH (pages_per_range=128);

-- ── env.sgu_soil_type_25k_100k (SGU jordarter) ───────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sgu_soil_geom
  ON env.sgu_soil_type_25k_100k USING GIST (geom) WITH (fillfactor=90);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sgu_soil_jg2tx
  ON env.sgu_soil_type_25k_100k (jg2_tx);

-- ── env.sgu_ground_layer_1m ───────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sgu_ground_geom
  ON env.sgu_ground_layer_1m USING GIST (geom) WITH (fillfactor=90);

-- ── env.sgu_well (brunnar – punktdata, stor tabell) ─────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sgu_well_geom
  ON env.sgu_well USING GIST (geom);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sgu_well_brin
  ON env.sgu_well USING BRIN (ogc_fid) WITH (pages_per_range=256);

-- ── env.sgu_landslide_feature ────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sgu_landslide_geom
  ON env.sgu_landslide_feature USING GIST (geom);

-- ── env.sgu_aktsamhet_efterarbetad ───────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sgu_aktsam_geom
  ON env.sgu_aktsamhet_efterarbetad USING GIST (geom);

-- ── env.sgu_erosion_aktiv ─────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sgu_erosion_geom
  ON env.sgu_erosion_aktiv USING GIST (geom);

-- ── env.sgu_fastmark_stabilitet ──────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sgu_fastmark_geom
  ON env.sgu_fastmark_stabilitet USING GIST (geom);

-- ── env.env_sgu_grundvatten_sarbarhet ────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sgu_gw_geom
  ON env.env_sgu_grundvatten_sarbarhet USING GIST (geom);

-- ── core.lm_mark (Lantmäteriet topografi mark) ───────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lm_mark_geom
  ON core.lm_mark USING GIST (geom) WITH (fillfactor=80);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lm_mark_brin
  ON core.lm_mark USING BRIN (ogc_fid) WITH (pages_per_range=128);

-- ── core.lm_byggnad (Lantmäteriet byggnader) ─────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lm_byggnad_geom
  ON core.lm_byggnad USING GIST (geom) WITH (fillfactor=80);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lm_byggnad_brin
  ON core.lm_byggnad USING BRIN (ogc_fid) WITH (pages_per_range=128);

-- ── topo10.vatten ─────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_topo10_vatten_geom
  ON topo10.vatten USING GIST (geom) WITH (fillfactor=90);

-- ── env.nv_skyddad_natur ──────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nv_skyddad_geom
  ON env.nv_skyddad_natur USING GIST (geom);

-- ── env.nv_naturreservat ──────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nv_naturres_geom
  ON env.nv_naturreservat USING GIST (geom);

-- ── env.raa_fornlamning ───────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_raa_fornlamning_geom
  ON env.raa_fornlamning USING GIST (geom);

-- ── env.lst_vattenskyddsomrade ────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lst_vattensky_geom
  ON env.lst_vattenskyddsomrade USING GIST (geom);

-- ── env.kulturmiljo_omrade ────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_kulturmiljo_geom
  ON env.kulturmiljo_omrade USING GIST (geom);

-- ================================================================
--  VACUUM FREEZE på alla env/core/topo10-tabeller
--  (freeze förhindrar transaction-ID wraparound vid 500M rader)
-- ================================================================
VACUUM (VERBOSE, ANALYZE, FREEZE) env.registerenhetsomradesytor;
VACUUM (VERBOSE, ANALYZE, FREEZE) env.registerenhetsomradeslinjer;
VACUUM (VERBOSE, ANALYZE) env.sgu_soil_type_25k_100k;
VACUUM (VERBOSE, ANALYZE) env.sgu_ground_layer_1m;
VACUUM (VERBOSE, ANALYZE) env.sgu_well;
VACUUM (VERBOSE, ANALYZE) env.sgu_landslide_feature;
VACUUM (VERBOSE, ANALYZE) env.nv_skyddad_natur;
VACUUM (VERBOSE, ANALYZE) env.nv_naturreservat;
VACUUM (VERBOSE, ANALYZE) env.raa_fornlamning;
VACUUM (VERBOSE, ANALYZE) env.lst_vattenskyddsomrade;
VACUUM (VERBOSE, ANALYZE) core.lm_mark;
VACUUM (VERBOSE, ANALYZE) core.lm_byggnad;
VACUUM (VERBOSE, ANALYZE) topo10.vatten;

-- ── Kontroll: Tabellstorlekar och indexstatus ─────────────────────
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
  pg_size_pretty(pg_relation_size(schemaname||'.'||tablename))       AS table_size,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)
    - pg_relation_size(schemaname||'.'||tablename))                  AS index_size,
  (SELECT count(*) FROM pg_indexes
   WHERE schemaname = t.schemaname AND tablename = t.tablename)      AS index_count
FROM pg_tables t
WHERE schemaname IN ('env', 'core', 'topo10')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
