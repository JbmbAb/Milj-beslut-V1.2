-- Partitionerad fastighetsmodell (SQL-ägd) med audit-trigger och per-län-index.
-- Idempotent: scriptet kan köras om via spatial bootstrap.

CREATE SCHEMA IF NOT EXISTS lm;
CREATE SCHEMA IF NOT EXISTS audit;

COMMENT ON SCHEMA lm IS
  'SQL-ägt schema för storskalig geodata (Lantmäteriet). Prisma konsumerar via vyer/rå SQL.';
COMMENT ON SCHEMA audit IS
  'Databasnivå-audit för chain-of-custody och revisionsspår.';

-- Audit-tabell (idempotent) för geodataändringar.
CREATE TABLE IF NOT EXISTS audit.property_change_log (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  lan_kod INTEGER,
  objekt_id UUID,
  action TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by TEXT,
  old_row JSONB,
  new_row JSONB
);

CREATE INDEX IF NOT EXISTS idx_property_change_log_changed_at
  ON audit.property_change_log (changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_property_change_log_lan_kod
  ON audit.property_change_log (lan_kod);

-- Triggerfunktion: databasnivåaudit som inte kan kringgås av applikationskod.
CREATE OR REPLACE FUNCTION audit."appendPropertyAudit"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO audit.property_change_log (table_name, lan_kod, objekt_id, action, old_row)
    VALUES (TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, OLD.lan_kod, OLD.objekt_id, TG_OP, to_jsonb(OLD));
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit.property_change_log (table_name, lan_kod, objekt_id, action, old_row, new_row)
    VALUES (TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, NEW.lan_kod, NEW.objekt_id, TG_OP, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSE
    INSERT INTO audit.property_change_log (table_name, lan_kod, objekt_id, action, new_row)
    VALUES (TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, NEW.lan_kod, NEW.objekt_id, TG_OP, to_jsonb(NEW));
    RETURN NEW;
  END IF;
END;
$$;

DO $$
BEGIN
  -- Om tabellen finns men inte är partitionerad stoppar vi med tydligt fel.
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'fastighet' AND n.nspname = 'lm'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_partitioned_table p
    JOIN pg_class c ON c.oid = p.partrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'fastighet' AND n.nspname = 'lm'
  ) THEN
    RAISE EXCEPTION
      'lm.fastighet finns men är inte partitionerad. Migrera tabellen till PARTITION BY LIST (lan_kod) före bootstrap.';
  END IF;

  -- Föräldratabell (skapas en gång).
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'fastighet' AND n.nspname = 'lm'
  ) THEN
    CREATE TABLE lm.fastighet (
      objekt_id UUID NOT NULL,
      fastighetsbeteckning VARCHAR(255) NOT NULL,
      lan_kod INTEGER NOT NULL,
      skapad_datum TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      geom GEOMETRY(MultiPolygon, 3006),
      CONSTRAINT fastighet_pk PRIMARY KEY (lan_kod, objekt_id),
      CONSTRAINT fastighet_lan_kod_chk CHECK (lan_kod BETWEEN 1 AND 25)
    ) PARTITION BY LIST (lan_kod);

    COMMENT ON TABLE lm.fastighet IS
      'Partitionerad föräldratabell för fastighetsdata. Fysisk lagring sker i lm.fastighet_lan_XX.';
  END IF;
END $$;

-- Partitioner + index + audit-trigger per län (idempotent loop).
DO $$
DECLARE
  lan_koder INTEGER[] := ARRAY[
    1, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 17, 18, 19, 20, 21, 22, 23, 24, 25
  ];
  lan_kod INTEGER;
  part_name TEXT;
  idx_geom_name TEXT;
  idx_skapad_name TEXT;
  idx_objekt_name TEXT;
  trg_name TEXT;
BEGIN
  FOREACH lan_kod IN ARRAY lan_koder
  LOOP
    part_name := format('fastighet_lan_%s', lpad(lan_kod::TEXT, 2, '0'));
    idx_geom_name := format('idx_%s_geom', part_name);
    idx_skapad_name := format('idx_%s_skapad_datum_brin', part_name);
    idx_objekt_name := format('idx_%s_objekt_id', part_name);
    trg_name := format('trg_audit_%s', part_name);

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS lm.%I PARTITION OF lm.fastighet FOR VALUES IN (%s)',
      part_name,
      lan_kod
    );

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON lm.%I USING GIST (geom)', idx_geom_name, part_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON lm.%I USING BRIN (skapad_datum)', idx_skapad_name, part_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON lm.%I (objekt_id)', idx_objekt_name, part_name);

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON lm.%I', trg_name, part_name);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON lm.%I FOR EACH ROW EXECUTE FUNCTION audit."appendPropertyAudit"()',
      trg_name,
      part_name
    );

    EXECUTE format(
      'COMMENT ON TABLE lm.%I IS ''Fastighetsdata för län %s (partition av lm.fastighet).''',
      part_name,
      lan_kod
    );
  END LOOP;
END $$;

-- Prisma/applikation ska konsumera via vy eller rå SQL, inte äga underliggande partitioner.
CREATE OR REPLACE VIEW lm.fastighet_app_v AS
SELECT
  CONCAT('lm:', f.objekt_id::text) AS source_key,
  f.fastighetsbeteckning AS designation,
  NULL::text AS municipality_code,
  NULL::text AS municipality_name,
  LPAD(f.lan_kod::text, 2, '0') AS county_code,
  'lm.fastighet'::text AS source_dataset,
  f.skapad_datum AS source_updated_at,
  (to_jsonb(f) - 'geom') AS raw_properties,
  f.geom,
  core.normalize_designation(f.fastighetsbeteckning) AS designation_norm,
  f.lan_kod
FROM lm.fastighet f;

COMMENT ON VIEW lm.fastighet_app_v IS
  'App-vy för Prisma/rå SQL. Inkluderar lan_kod för partition-pruning i spatiala frågor.';

