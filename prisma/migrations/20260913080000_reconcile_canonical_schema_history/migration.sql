-- MIGRATION-HISTORY-RECONCILIATION-01
-- Forward-only reconciliation of canonical Prisma schema with migration-derived schema.
-- Scope:
--   M2: BankIdSession.identity_environment
--   M3: User.organisationId nullability
--   M4: project_context_bindings base table
--
-- Existing canonical objects are accepted only when their shape is compatible.
-- Incompatible pre-existing state fails closed instead of being silently accepted.

-- M2 — BankIdSession.identity_environment.
DO $$
DECLARE
  v_type TEXT;
  v_not_null BOOLEAN;
  v_default TEXT;
BEGIN
  SELECT
    format_type(a.atttypid, a.atttypmod),
    a.attnotnull,
    pg_get_expr(d.adbin, d.adrelid)
  INTO v_type, v_not_null, v_default
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
  WHERE n.nspname = 'public'
    AND c.relname = 'BankIdSession'
    AND a.attname = 'identity_environment'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF NOT FOUND THEN
    ALTER TABLE "public"."BankIdSession"
      ADD COLUMN "identity_environment" TEXT NOT NULL DEFAULT 'LEGACY';
  ELSIF v_type <> 'text'
     OR NOT v_not_null
     OR COALESCE(v_default, '') NOT IN ('''LEGACY''::text', '''LEGACY''::character varying') THEN
    RAISE EXCEPTION
      'MIGRATION_HISTORY_RECONCILIATION_M2_INCOMPATIBLE: public.BankIdSession.identity_environment has type=%, not_null=%, default=%',
      v_type, v_not_null, v_default;
  END IF;
END
$$;

-- M3 — User.organisationId is nullable in canonical schema.
DO $$
DECLARE
  v_type TEXT;
  v_not_null BOOLEAN;
BEGIN
  SELECT
    format_type(a.atttypid, a.atttypmod),
    a.attnotnull
  INTO v_type, v_not_null
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'User'
    AND a.attname = 'organisationId'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'MIGRATION_HISTORY_RECONCILIATION_M3_MISSING: public.User.organisationId does not exist';
  END IF;

  IF v_type <> 'text' THEN
    RAISE EXCEPTION
      'MIGRATION_HISTORY_RECONCILIATION_M3_INCOMPATIBLE: public.User.organisationId has type=%',
      v_type;
  END IF;

  IF v_not_null THEN
    ALTER TABLE "public"."User"
      ALTER COLUMN "organisationId" DROP NOT NULL;
  END IF;
END
$$;

-- M4 — project_context_bindings base projection.
DO $$
DECLARE
  v_text_col TEXT;
  v_column_count INTEGER;
  v_created_default TEXT;
BEGIN
  IF to_regclass('public.project_context_bindings') IS NULL THEN
    CREATE TABLE "public"."project_context_bindings" (
      "id" TEXT NOT NULL,
      "project_id" TEXT NOT NULL,
      "binding_artifact_id" TEXT NOT NULL,
      "project_context_artifact_id" TEXT NOT NULL,
      "project_context_artifact_type" TEXT NOT NULL,
      "binding_version" TEXT NOT NULL,
      "authority_artifact_id" TEXT NOT NULL,
      "authority_artifact_type" TEXT NOT NULL,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT "project_context_bindings_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "project_context_bindings_project_id_fkey"
        FOREIGN KEY ("project_id") REFERENCES "public"."Project"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
    );

    CREATE UNIQUE INDEX "project_context_bindings_binding_artifact_id_key"
      ON "public"."project_context_bindings"("binding_artifact_id");

    CREATE UNIQUE INDEX "project_context_bindings_project_id_project_context_artifac_key"
      ON "public"."project_context_bindings"(
        "project_id",
        "project_context_artifact_id",
        "project_context_artifact_type"
      );

    CREATE INDEX "project_context_bindings_project_id_project_context_artifac_idx"
      ON "public"."project_context_bindings"(
        "project_id",
        "project_context_artifact_id",
        "project_context_artifact_type"
      );
  ELSE
    SELECT COUNT(*)
    INTO v_column_count
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'project_context_bindings';

    IF v_column_count <> 9 THEN
      RAISE EXCEPTION
        'MIGRATION_HISTORY_RECONCILIATION_M4_INCOMPATIBLE: public.project_context_bindings has % columns, expected 9',
        v_column_count;
    END IF;

    FOREACH v_text_col IN ARRAY ARRAY[
      'id',
      'project_id',
      'binding_artifact_id',
      'project_context_artifact_id',
      'project_context_artifact_type',
      'binding_version',
      'authority_artifact_id',
      'authority_artifact_type'
    ]
    LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'project_context_bindings'
          AND column_name = v_text_col
          AND data_type = 'text'
          AND is_nullable = 'NO'
      ) THEN
        RAISE EXCEPTION
          'MIGRATION_HISTORY_RECONCILIATION_M4_INCOMPATIBLE: column % is missing or not canonical TEXT NOT NULL',
          v_text_col;
      END IF;
    END LOOP;

    SELECT column_default
    INTO v_created_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'project_context_bindings'
      AND column_name = 'created_at'
      AND data_type = 'timestamp without time zone'
      AND datetime_precision = 3
      AND is_nullable = 'NO';

    IF NOT FOUND
       OR COALESCE(v_created_default, '') NOT IN ('CURRENT_TIMESTAMP', 'now()') THEN
      RAISE EXCEPTION
        'MIGRATION_HISTORY_RECONCILIATION_M4_INCOMPATIBLE: created_at is not canonical TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP (default=%)',
        v_created_default;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_catalog = tc.constraint_catalog
       AND kcu.constraint_schema = tc.constraint_schema
       AND kcu.constraint_name = tc.constraint_name
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'project_context_bindings'
        AND tc.constraint_type = 'PRIMARY KEY'
      GROUP BY tc.constraint_catalog, tc.constraint_schema, tc.constraint_name
      HAVING array_agg(kcu.column_name ORDER BY kcu.ordinal_position) = ARRAY['id']::TEXT[]
    ) THEN
      RAISE EXCEPTION
        'MIGRATION_HISTORY_RECONCILIATION_M4_INCOMPATIBLE: canonical primary key on id is missing';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_catalog = tc.constraint_catalog
       AND kcu.constraint_schema = tc.constraint_schema
       AND kcu.constraint_name = tc.constraint_name
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_catalog = tc.constraint_catalog
       AND rc.constraint_schema = tc.constraint_schema
       AND rc.constraint_name = tc.constraint_name
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_catalog = rc.unique_constraint_catalog
       AND ccu.constraint_schema = rc.unique_constraint_schema
       AND ccu.constraint_name = rc.unique_constraint_name
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'project_context_bindings'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'project_id'
        AND ccu.table_schema = 'public'
        AND ccu.table_name = 'Project'
        AND ccu.column_name = 'id'
        AND rc.delete_rule = 'RESTRICT'
        AND rc.update_rule = 'CASCADE'
    ) THEN
      RAISE EXCEPTION
        'MIGRATION_HISTORY_RECONCILIATION_M4_INCOMPATIBLE: canonical project_id foreign key is missing';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'project_context_bindings'
        AND indexdef LIKE 'CREATE UNIQUE INDEX%'
        AND replace(indexdef, '"', '') LIKE '%(binding_artifact_id)%'
    ) THEN
      RAISE EXCEPTION
        'MIGRATION_HISTORY_RECONCILIATION_M4_INCOMPATIBLE: unique binding_artifact_id index is missing';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'project_context_bindings'
        AND indexdef LIKE 'CREATE UNIQUE INDEX%'
        AND replace(indexdef, '"', '') LIKE '%(project_id, project_context_artifact_id, project_context_artifact_type)%'
    ) THEN
      RAISE EXCEPTION
        'MIGRATION_HISTORY_RECONCILIATION_M4_INCOMPATIBLE: canonical project/context unique index is missing';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'project_context_bindings'
        AND indexdef LIKE 'CREATE INDEX%'
        AND replace(indexdef, '"', '') LIKE '%(project_id, project_context_artifact_id, project_context_artifact_type)%'
    ) THEN
      RAISE EXCEPTION
        'MIGRATION_HISTORY_RECONCILIATION_M4_INCOMPATIBLE: canonical project/context lookup index is missing';
    END IF;
  END IF;
END
$$;
