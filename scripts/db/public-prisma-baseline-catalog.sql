-- PUBLIC-PRISMA-BASELINE-RECONCILIATION-01
-- Read-only catalog capture for the Prisma-owned public schema.
-- Extension-owned objects are represented by extension identity, not mistaken for Prisma baseline DDL.
-- This file intentionally contains SELECT-only catalog inspection.
\set ON_ERROR_STOP on

WITH
extension_members AS (
  SELECT
    d.classid,
    d.objid,
    e.extname AS extension_name
  FROM pg_depend d
  JOIN pg_extension e ON e.oid = d.refobjid
  WHERE d.deptype = 'e'
),
relations AS (
  SELECT
    c.oid,
    c.relname AS name,
    c.relkind AS kind,
    c.relpersistence AS persistence,
    c.relrowsecurity AS row_security,
    c.relforcerowsecurity AS force_row_security
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN extension_members em
    ON em.classid = 'pg_class'::regclass
   AND em.objid = c.oid
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    AND em.objid IS NULL
),
columns AS (
  SELECT
    r.name AS relation_name,
    a.attnum AS ordinal_position,
    a.attname AS column_name,
    format_type(a.atttypid, a.atttypmod) AS data_type,
    a.attnotnull AS not_null,
    a.attidentity AS identity_kind,
    a.attgenerated AS generated_kind,
    pg_get_expr(ad.adbin, ad.adrelid) AS column_default,
    coll.collname AS collation_name
  FROM relations r
  JOIN pg_attribute a ON a.attrelid = r.oid
  LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  LEFT JOIN pg_collation coll ON coll.oid = a.attcollation AND a.attcollation <> 0
  WHERE r.kind IN ('r', 'p', 'v', 'm', 'f')
    AND a.attnum > 0
    AND NOT a.attisdropped
),
constraints AS (
  SELECT
    r.name AS relation_name,
    con.conname AS constraint_name,
    con.contype AS constraint_type,
    con.convalidated AS validated,
    con.condeferrable AS deferrable,
    con.condeferred AS initially_deferred,
    pg_get_constraintdef(con.oid, true) AS definition
  FROM relations r
  JOIN pg_constraint con ON con.conrelid = r.oid
),
indexes AS (
  SELECT
    r.name AS relation_name,
    idx.relname AS index_name,
    i.indisprimary AS is_primary,
    i.indisunique AS is_unique,
    i.indisvalid AS is_valid,
    i.indisready AS is_ready,
    pg_get_indexdef(i.indexrelid) AS definition,
    pg_get_expr(i.indpred, i.indrelid) AS predicate
  FROM relations r
  JOIN pg_index i ON i.indrelid = r.oid
  JOIN pg_class idx ON idx.oid = i.indexrelid
),
enums AS (
  SELECT
    t.typname AS enum_name,
    e.enumsortorder AS sort_order,
    e.enumlabel AS enum_value
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  JOIN pg_enum e ON e.enumtypid = t.oid
  LEFT JOIN extension_members em
    ON em.classid = 'pg_type'::regclass
   AND em.objid = t.oid
  WHERE n.nspname = 'public'
    AND em.objid IS NULL
),
views AS (
  SELECT
    v.schemaname,
    v.viewname,
    v.definition
  FROM pg_views v
  JOIN relations r ON r.name = v.viewname AND r.kind = 'v'
  WHERE v.schemaname = 'public'
),
materialized_views AS (
  SELECT
    v.schemaname,
    v.matviewname,
    v.definition
  FROM pg_matviews v
  JOIN relations r ON r.name = v.matviewname AND r.kind = 'm'
  WHERE v.schemaname = 'public'
),
functions AS (
  SELECT
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS identity_arguments,
    pg_get_function_result(p.oid) AS result_type,
    p.prokind AS function_kind,
    l.lanname AS language,
    p.provolatile AS volatility,
    p.prosecdef AS security_definer,
    CASE
      WHEN p.prokind IN ('f', 'p') THEN pg_get_functiondef(p.oid)
      ELSE NULL
    END AS definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
  LEFT JOIN extension_members em
    ON em.classid = 'pg_proc'::regclass
   AND em.objid = p.oid
  WHERE n.nspname = 'public'
    AND em.objid IS NULL
),
triggers AS (
  SELECT
    r.name AS relation_name,
    t.tgname AS trigger_name,
    t.tgenabled AS enabled,
    pg_get_triggerdef(t.oid, true) AS definition
  FROM relations r
  JOIN pg_trigger t ON t.tgrelid = r.oid
  WHERE NOT t.tgisinternal
),
policies AS (
  SELECT
    p.schemaname,
    p.tablename,
    p.policyname,
    p.permissive,
    p.roles,
    p.cmd,
    p.qual,
    p.with_check
  FROM pg_policies p
  JOIN relations r ON r.name = p.tablename AND r.kind IN ('r', 'p')
  WHERE p.schemaname = 'public'
),
sequences AS (
  SELECT
    s.schemaname,
    s.sequencename,
    s.data_type,
    s.start_value,
    s.min_value,
    s.max_value,
    s.increment_by,
    s.cycle,
    s.cache_size
  FROM pg_sequences s
  JOIN relations r ON r.name = s.sequencename AND r.kind = 'S'
  WHERE s.schemaname = 'public'
),
extensions AS (
  SELECT
    e.extname AS extension_name,
    e.extversion AS extension_version,
    n.nspname AS extension_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
)
SELECT jsonb_pretty(
  jsonb_build_object(
    'capture_schema', 'public-prisma-baseline-catalog-v1',
    'database', current_database(),
    'server_version', current_setting('server_version'),
    'extension_member_policy', 'exclude-members-capture-extension-identity',
    'relations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', name,
        'kind', kind,
        'persistence', persistence,
        'row_security', row_security,
        'force_row_security', force_row_security
      ) ORDER BY name, kind) FROM relations
    ), '[]'::jsonb),
    'columns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'relation', relation_name,
        'ordinal_position', ordinal_position,
        'column', column_name,
        'data_type', data_type,
        'not_null', not_null,
        'identity_kind', identity_kind,
        'generated_kind', generated_kind,
        'default', column_default,
        'collation', collation_name
      ) ORDER BY relation_name, ordinal_position) FROM columns
    ), '[]'::jsonb),
    'constraints', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'relation', relation_name,
        'name', constraint_name,
        'type', constraint_type,
        'validated', validated,
        'deferrable', deferrable,
        'initially_deferred', initially_deferred,
        'definition', definition
      ) ORDER BY relation_name, constraint_name) FROM constraints
    ), '[]'::jsonb),
    'indexes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'relation', relation_name,
        'name', index_name,
        'is_primary', is_primary,
        'is_unique', is_unique,
        'is_valid', is_valid,
        'is_ready', is_ready,
        'definition', definition,
        'predicate', predicate
      ) ORDER BY relation_name, index_name) FROM indexes
    ), '[]'::jsonb),
    'enums', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', enum_name,
        'sort_order', sort_order,
        'value', enum_value
      ) ORDER BY enum_name, sort_order) FROM enums
    ), '[]'::jsonb),
    'views', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'schema', schemaname,
        'name', viewname,
        'definition', definition
      ) ORDER BY viewname) FROM views
    ), '[]'::jsonb),
    'materialized_views', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'schema', schemaname,
        'name', matviewname,
        'definition', definition
      ) ORDER BY matviewname) FROM materialized_views
    ), '[]'::jsonb),
    'functions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', function_name,
        'identity_arguments', identity_arguments,
        'result_type', result_type,
        'kind', function_kind,
        'language', language,
        'volatility', volatility,
        'security_definer', security_definer,
        'definition', definition
      ) ORDER BY function_name, identity_arguments) FROM functions
    ), '[]'::jsonb),
    'triggers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'relation', relation_name,
        'name', trigger_name,
        'enabled', enabled,
        'definition', definition
      ) ORDER BY relation_name, trigger_name) FROM triggers
    ), '[]'::jsonb),
    'policies', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'schema', schemaname,
        'relation', tablename,
        'name', policyname,
        'permissive', permissive,
        'roles', roles,
        'command', cmd,
        'using', qual,
        'with_check', with_check
      ) ORDER BY tablename, policyname) FROM policies
    ), '[]'::jsonb),
    'sequences', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'schema', schemaname,
        'name', sequencename,
        'data_type', data_type,
        'start_value', start_value,
        'min_value', min_value,
        'max_value', max_value,
        'increment_by', increment_by,
        'cycle', cycle,
        'cache_size', cache_size
      ) ORDER BY sequencename) FROM sequences
    ), '[]'::jsonb),
    'extensions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', extension_name,
        'version', extension_version,
        'schema', extension_schema
      ) ORDER BY extension_name) FROM extensions
    ), '[]'::jsonb)
  )
);
