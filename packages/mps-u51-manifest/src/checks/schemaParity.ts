/**
 * C5 -- schema / migration parity proof (contract 5.5), fixed order:
 *   1. observation, evidence hash, strict payload, same tree
 *   2. schema.prisma blob, `prisma validate` exit 0, controller-owned config
 *   3. migration location (only prisma/migrations), id, SQL hash
 *   4. approval record binds this migration and is APPROVED and attested
 *   5. the migration creates the claimed table
 *   6. a Prisma model maps (@@map) to that table
 *   7. runtime persistence: at least one statement, every statement and every embedding-table reference is that table
 *   8. the migration's pipeline-binding CHECKs versus the admitted (model, revision, pipeline) triple
 *   9. one vector dimension everywhere
 *
 * Besides the dimension, vector column NAMES must agree between the migration, the Prisma model and the runtime
 * statements (contract 5.5: parity of "table, vector column(s), dimension").
 */
import { FAILURE, MIGRATIONS_LOCATION } from '../vocabulary';
import { hashJcs, tryHashJcs } from '../canonical';
import { validateSchemaDerivation, type SchemaDerivation, type Triple } from '../evidenceSchemas';
import { unwrapPayload, type StageContext } from './context';

const tripleKey = (t: Triple): string => JSON.stringify([t.model_id, t.model_revision, t.pipeline_version]);

export function checkSchemaParity(ctx: StageContext): string | undefined {
  const { manifest, policy, observations } = ctx;
  const claim = manifest.schema;

  // 1.
  const found = unwrapPayload(observations, 'schema');
  if (found.kind === 'absent') return FAILURE.manifest_unresolved_identity;
  if (found.kind === 'malformed') return FAILURE.evidence_schema_invalid;
  const payload = found.payload;
  const hash = tryHashJcs(payload);
  if (hash === undefined) return FAILURE.evidence_schema_invalid;
  if (hash !== claim.evidence_sha256) return FAILURE.manifest_hash_mismatch;
  if (!validateSchemaDerivation(payload)) return FAILURE.evidence_schema_invalid;
  const d: SchemaDerivation = payload;
  if (d.subject.tree_sha !== manifest.candidate.tree_sha) return FAILURE.tree_binding_mismatch;

  // 2.
  if (d.prisma_schema.blob_sha1 !== claim.prisma_schema_blob_sha1 || d.prisma_schema.validate_exit_code !== 0 || d.datasource.config_source !== 'CONTROLLER') {
    return FAILURE.schema_identity_mismatch;
  }
  // 3.
  if (d.migration.location !== MIGRATIONS_LOCATION || d.migration.id !== claim.migration_id || d.migration.sql_sha256 !== claim.migration_sql_sha256) {
    return FAILURE.schema_identity_mismatch;
  }
  // 4.
  const approval = d.approval;
  const approvalHash = hashJcs(approval.record);
  if (
    approvalHash !== approval.record_sha256 ||
    approvalHash !== claim.approval_sha256 ||
    approval.record.migration_id !== d.migration.id ||
    approval.record.migration_sql_sha256 !== d.migration.sql_sha256 ||
    approval.record.decision !== 'APPROVED' ||
    approval.attestation_verified !== true
  ) {
    return FAILURE.manifest_unresolved_identity;
  }
  // 5.
  const table = d.migration.tables.find((t) => t.table === claim.table);
  if (table === undefined) return FAILURE.schema_identity_mismatch;
  const migrationColumns = new Set(table.vector_columns.map((c) => c.column));
  if (migrationColumns.size === 0) return FAILURE.schema_identity_mismatch;
  // 6.
  const models = d.prisma_models.filter((m) => m.mapped_table === claim.table);
  if (models.length === 0) return FAILURE.schema_identity_mismatch;
  if (models.some((m) => m.vector_columns.some((c) => !migrationColumns.has(c.column)))) return FAILURE.schema_identity_mismatch;
  // 7.
  const statements = d.runtime_persistence.statements;
  if (statements.length === 0) return FAILURE.schema_identity_mismatch;
  if (statements.some((s) => s.table !== claim.table || s.vector_columns.some((c) => !migrationColumns.has(c.column)))) {
    return FAILURE.schema_identity_mismatch;
  }
  if (d.runtime_persistence.embedding_table_references.some((r) => r !== claim.table)) return FAILURE.schema_identity_mismatch;
  // 8.
  const admitted: Triple = {
    model_id: manifest.embedding.model_id,
    model_revision: manifest.embedding.model_revision,
    pipeline_version: manifest.embedding.pipeline_version,
  };
  const pinned = new Set(table.pipeline_binding_checks.flatMap((c) => c.triples.map(tripleKey)));
  if (!pinned.has(tripleKey(admitted))) return FAILURE.schema_identity_mismatch;
  if (policy.migration_check_binding === 'EXACT_ADMITTED' && pinned.size !== 1) return FAILURE.schema_identity_mismatch;
  // 9.
  const dimensions = new Set<number>([
    claim.vector_dimension,
    manifest.embedding.dimension,
    ...table.vector_columns.map((c) => c.dimension),
    ...table.dimension_checks.map((c) => c.dimension),
    ...models.flatMap((m) => m.vector_columns.map((c) => c.declared_dimension)),
    ...statements.flatMap((s) => s.vector_columns.map((c) => c.cast_dimension)),
  ]);
  if (dimensions.size !== 1) return FAILURE.embedding_dimension_mismatch;
  return undefined;
}
