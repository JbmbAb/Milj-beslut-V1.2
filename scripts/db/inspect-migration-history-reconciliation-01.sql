-- MIGRATION-HISTORY-RECONCILIATION-01
-- READ-ONLY inspection pack. Safe to run only after confirming the connection target.
-- Produces catalog evidence for M2/M3/M4 and the Prisma migration ledger.

BEGIN TRANSACTION READ ONLY;

SELECT current_database() AS database_name,
       current_user AS database_user,
       inet_server_addr() AS server_addr,
       inet_server_port() AS server_port;

SELECT table_schema,
       table_name,
       column_name,
       data_type,
       is_nullable,
       column_default,
       datetime_precision
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'User' AND column_name = 'organisationId')
    OR (table_name = 'BankIdSession' AND column_name = 'identity_environment')
    OR table_name IN ('project_context_bindings', 'project_context_binding_supersessions')
  )
ORDER BY table_name, ordinal_position;

SELECT tc.table_schema,
       tc.table_name,
       tc.constraint_name,
       tc.constraint_type,
       kcu.column_name,
       ccu.table_schema AS referenced_table_schema,
       ccu.table_name AS referenced_table_name,
       ccu.column_name AS referenced_column_name,
       rc.update_rule,
       rc.delete_rule
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_catalog = tc.constraint_catalog
 AND kcu.constraint_schema = tc.constraint_schema
 AND kcu.constraint_name = tc.constraint_name
LEFT JOIN information_schema.referential_constraints rc
  ON rc.constraint_catalog = tc.constraint_catalog
 AND rc.constraint_schema = tc.constraint_schema
 AND rc.constraint_name = tc.constraint_name
LEFT JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_catalog = COALESCE(rc.unique_constraint_catalog, tc.constraint_catalog)
 AND ccu.constraint_schema = COALESCE(rc.unique_constraint_schema, tc.constraint_schema)
 AND ccu.constraint_name = COALESCE(rc.unique_constraint_name, tc.constraint_name)
WHERE tc.table_schema = 'public'
  AND tc.table_name IN ('User', 'BankIdSession', 'project_context_bindings', 'project_context_binding_supersessions')
ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position;

SELECT schemaname,
       tablename,
       indexname,
       indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('User', 'BankIdSession', 'project_context_bindings', 'project_context_binding_supersessions')
ORDER BY tablename, indexname;

SELECT migration_name,
       started_at,
       finished_at,
       rolled_back_at,
       applied_steps_count
FROM "_prisma_migrations"
ORDER BY started_at, migration_name;

ROLLBACK;
