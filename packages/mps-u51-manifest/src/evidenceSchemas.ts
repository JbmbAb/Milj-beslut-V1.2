/**
 * Strict derivation payloads (contract 12.2): closed keys, fixed kinds, exact `contract_version`, set-like arrays
 * strictly ascending (rejected, never silently sorted). A payload failing any rule is `evidence_schema_invalid`.
 *
 * The types describe what the validators have established; they are not a second source of truth.
 */
import {
  EMBEDDING_DERIVATION_VERSION,
  GENERATION_DERIVATION_VERSION,
  RULE_SCOPES,
  SCAN_PROFILES,
  SCHEMA_DERIVATION_VERSION,
  ZERO_GOOGLE_EVIDENCE_VERSION,
} from './vocabulary';
import {
  HEX40,
  HEX64,
  compareBytewise,
  hasExactKeys,
  isHex40,
  isHex64,
  isNonEmptyString,
  isNonNegativeInt,
  isRecord,
  isSafeInt,
  strictlyAscending,
  type Rec,
} from './json';

const rec = (v: unknown, required: readonly string[], optional: readonly string[] = []): v is Rec => isRecord(v) && hasExactKeys(v, required, optional);
const arrayOf = (v: unknown, each: (x: unknown) => boolean): v is unknown[] => Array.isArray(v) && v.every(each);
const sortedStrings = (v: unknown): v is string[] => arrayOf(v, isNonEmptyString) && strictlyAscending(v as string[], (s) => s);
const str = (v: unknown): v is string => typeof v === 'string';
const oneOf = (allowed: readonly string[], v: unknown): boolean => typeof v === 'string' && allowed.includes(v);

// ---------------------------------------------------------------- zero-google (6.3)

export interface FileSetDigest {
  readonly claimed_digest_sha256: string;
  readonly derived_digest_sha256: string;
  readonly count: number;
}
export interface ZeroGooglePresent {
  readonly contract_version: string;
  readonly subject: { readonly commit_sha: string; readonly tree_sha: string };
  readonly guard_state: 'PRESENT';
  readonly guard: { readonly path: string; readonly blob_sha1_in_tree: string; readonly blob_sha1_executed: string };
  readonly scan: {
    readonly profile: string;
    readonly roots: readonly string[];
    readonly allow_patterns_sha256: string;
    readonly executed_rules: readonly { readonly id: string; readonly applies_to: string }[];
    readonly candidate_files: FileSetDigest;
    readonly scanned_files: FileSetDigest;
  };
  readonly dependency_scan?: {
    readonly manifests: readonly { readonly path: string; readonly blob_sha1: string }[];
    readonly forbidden_patterns_sha256: string;
    readonly claimed_digest_sha256: string;
    readonly derived_digest_sha256: string;
    readonly hits_count: number;
  };
  readonly execution: {
    readonly command_sha256: string;
    readonly executed_tests: readonly { readonly file: string; readonly full_name: string; readonly status: string }[];
    readonly worktree_clean: boolean;
    readonly exit_code: number;
  };
}
export interface ZeroGoogleNoGuard {
  readonly contract_version: string;
  readonly subject: { readonly commit_sha: string; readonly tree_sha: string };
  readonly guard_state: 'NO_GUARD_PRESENT_IN_SUBJECT_TREE';
}
export type ZeroGoogleEvidence = ZeroGooglePresent | ZeroGoogleNoGuard;

const validFileSet = (v: unknown): boolean =>
  rec(v, ['claimed_digest_sha256', 'derived_digest_sha256', 'count']) &&
  isHex64(v.claimed_digest_sha256) &&
  isHex64(v.derived_digest_sha256) &&
  isNonNegativeInt(v.count);

const validSubject = (v: unknown): boolean => rec(v, ['commit_sha', 'tree_sha']) && isHex40(v.commit_sha) && isHex40(v.tree_sha);

export function validateZeroGoogleEvidence(p: unknown): p is ZeroGoogleEvidence {
  if (!isRecord(p)) return false;
  if (p.contract_version !== ZERO_GOOGLE_EVIDENCE_VERSION) return false;
  if (p.guard_state === 'NO_GUARD_PRESENT_IN_SUBJECT_TREE') {
    return hasExactKeys(p, ['contract_version', 'subject', 'guard_state']) && validSubject(p.subject);
  }
  if (p.guard_state !== 'PRESENT') return false;
  const scan = p.scan;
  const profileKnown = isRecord(scan) && oneOf(SCAN_PROFILES, scan.profile);
  const wantsDependencies = isRecord(scan) && scan.profile === 'GUARD_PLUS_DEPENDENCY_MANIFESTS';
  // the dependency_scan key is present iff the profile requires it
  if (!hasExactKeys(p, ['contract_version', 'subject', 'guard_state', 'guard', 'scan', 'execution'], wantsDependencies ? ['dependency_scan'] : [])) return false;
  if (wantsDependencies && !('dependency_scan' in p)) return false;
  if (!validSubject(p.subject)) return false;
  const g = p.guard;
  if (!(rec(g, ['path', 'blob_sha1_in_tree', 'blob_sha1_executed']) && isNonEmptyString(g.path) && isHex40(g.blob_sha1_in_tree) && isHex40(g.blob_sha1_executed))) return false;
  if (!(profileKnown && rec(scan, ['profile', 'roots', 'allow_patterns_sha256', 'executed_rules', 'candidate_files', 'scanned_files']))) return false;
  if (!sortedStrings(scan.roots) || !isHex64(scan.allow_patterns_sha256)) return false;
  const rules = scan.executed_rules;
  if (!arrayOf(rules, (r) => rec(r, ['id', 'applies_to']) && isNonEmptyString(r.id) && oneOf(RULE_SCOPES, r.applies_to))) return false;
  if (!strictlyAscending(rules as Rec[], (r) => r.id as string)) return false;
  if (!validFileSet(scan.candidate_files) || !validFileSet(scan.scanned_files)) return false;
  if (wantsDependencies) {
    const d = p.dependency_scan;
    if (!rec(d, ['manifests', 'forbidden_patterns_sha256', 'claimed_digest_sha256', 'derived_digest_sha256', 'hits_count'])) return false;
    if (!arrayOf(d.manifests, (m) => rec(m, ['path', 'blob_sha1']) && isNonEmptyString(m.path) && isHex40(m.blob_sha1))) return false;
    if (!strictlyAscending(d.manifests as Rec[], (m) => m.path as string)) return false;
    if (!isHex64(d.forbidden_patterns_sha256) || !isHex64(d.claimed_digest_sha256) || !isHex64(d.derived_digest_sha256) || !isNonNegativeInt(d.hits_count)) return false;
  }
  const e = p.execution;
  if (!rec(e, ['command_sha256', 'executed_tests', 'worktree_clean', 'exit_code'])) return false;
  if (!isHex64(e.command_sha256) || typeof e.worktree_clean !== 'boolean' || !isSafeInt(e.exit_code)) return false;
  return arrayOf(e.executed_tests, (t) => rec(t, ['file', 'full_name', 'status']) && isNonEmptyString(t.file) && isNonEmptyString(t.full_name) && isNonEmptyString(t.status));
}

// ---------------------------------------------------------------- embedding (5.4)

export interface RegistryEntry {
  readonly pipeline_key: string;
  readonly model_id: string;
  readonly model_revision: string;
  readonly pipeline_version: string;
  readonly dimension: number;
  readonly normalization: string;
  readonly query_prefix: string;
  readonly passage_prefix: string;
  readonly max_seq_length?: number;
  readonly snapshot_manifest_sha256: string;
}
export interface EmbeddingDerivation {
  readonly contract_version: string;
  readonly subject: { readonly tree_sha: string };
  readonly identity_contract_version: string;
  readonly registry: { readonly source_blob_sha1: string; readonly pipelines: readonly RegistryEntry[] };
  readonly admission: { readonly source_blob_sha1: string; readonly admitted_keys: readonly string[] };
  readonly selection_decision: {
    readonly record: { readonly pipeline_key: string; readonly pipeline_spec_sha256: string; readonly decision: string };
    readonly record_sha256: string;
    readonly attestation_verified: boolean;
  };
}

const validRegistryEntry = (e: unknown): boolean =>
  rec(e, ['pipeline_key', 'model_id', 'model_revision', 'pipeline_version', 'dimension', 'normalization', 'query_prefix', 'passage_prefix', 'snapshot_manifest_sha256'], ['max_seq_length']) &&
  isNonEmptyString(e.pipeline_key) &&
  isNonEmptyString(e.model_id) &&
  isHex40(e.model_revision) &&
  isNonEmptyString(e.pipeline_version) &&
  isNonNegativeInt(e.dimension) &&
  isNonEmptyString(e.normalization) &&
  str(e.query_prefix) &&
  str(e.passage_prefix) &&
  isHex64(e.snapshot_manifest_sha256) &&
  (e.max_seq_length === undefined || isNonNegativeInt(e.max_seq_length)) &&
  !('max_seq_length' in e && e.max_seq_length === undefined);

export function validateEmbeddingDerivation(p: unknown): p is EmbeddingDerivation {
  if (!rec(p, ['contract_version', 'subject', 'identity_contract_version', 'registry', 'admission', 'selection_decision'])) return false;
  if (p.contract_version !== EMBEDDING_DERIVATION_VERSION) return false;
  if (!(rec(p.subject, ['tree_sha']) && isHex40(p.subject.tree_sha))) return false;
  if (!isNonEmptyString(p.identity_contract_version)) return false;
  const r = p.registry;
  if (!(rec(r, ['source_blob_sha1', 'pipelines']) && isHex40(r.source_blob_sha1) && arrayOf(r.pipelines, validRegistryEntry))) return false;
  if (!strictlyAscending(r.pipelines as Rec[], (e) => e.pipeline_key as string)) return false;
  const a = p.admission;
  if (!(rec(a, ['source_blob_sha1', 'admitted_keys']) && isHex40(a.source_blob_sha1) && sortedStrings(a.admitted_keys))) return false;
  const s = p.selection_decision;
  if (!rec(s, ['record', 'record_sha256', 'attestation_verified'])) return false;
  if (!isHex64(s.record_sha256) || typeof s.attestation_verified !== 'boolean') return false;
  const rc = s.record;
  return rec(rc, ['pipeline_key', 'pipeline_spec_sha256', 'decision']) && isNonEmptyString(rc.pipeline_key) && isHex64(rc.pipeline_spec_sha256) && isNonEmptyString(rc.decision);
}

// ---------------------------------------------------------------- schema / migration parity (5.5)

export interface VectorColumn {
  readonly column: string;
  readonly dimension: number;
}
export interface Triple {
  readonly model_id: string;
  readonly model_revision: string;
  readonly pipeline_version: string;
}
export interface SchemaDerivation {
  readonly contract_version: string;
  readonly subject: { readonly tree_sha: string };
  readonly datasource: { readonly config_source: string; readonly config_sha256: string; readonly env_profile_sha256: string };
  readonly prisma_schema: { readonly blob_sha1: string; readonly validate_exit_code: number };
  readonly prisma_models: readonly {
    readonly name: string;
    readonly mapped_table: string;
    readonly vector_columns: readonly { readonly column: string; readonly declared_dimension: number }[];
  }[];
  readonly migration: {
    readonly id: string;
    readonly location: string;
    readonly sql_sha256: string;
    readonly tables: readonly {
      readonly table: string;
      readonly vector_columns: readonly VectorColumn[];
      readonly dimension_checks: readonly { readonly name: string; readonly dimension: number }[];
      readonly pipeline_binding_checks: readonly { readonly name: string; readonly triples: readonly Triple[] }[];
    }[];
  };
  readonly runtime_persistence: {
    readonly statements: readonly {
      readonly kind: string;
      readonly table: string;
      readonly source_blob_sha1: string;
      readonly vector_columns: readonly { readonly column: string; readonly cast_dimension: number }[];
    }[];
    readonly embedding_table_references: readonly string[];
  };
  readonly approval: {
    readonly record: { readonly migration_id: string; readonly migration_sql_sha256: string; readonly decision: string };
    readonly record_sha256: string;
    readonly attestation_verified: boolean;
  };
}

const sortedBy = (xs: unknown, key: string): boolean => strictlyAscending(xs as Rec[], (x) => x[key] as string);
const tripleKey = (t: Rec): string => [t.model_id, t.model_revision, t.pipeline_version].join('\u0000');

export function validateSchemaDerivation(p: unknown): p is SchemaDerivation {
  if (!rec(p, ['contract_version', 'subject', 'datasource', 'prisma_schema', 'prisma_models', 'migration', 'runtime_persistence', 'approval'])) return false;
  if (p.contract_version !== SCHEMA_DERIVATION_VERSION) return false;
  if (!(rec(p.subject, ['tree_sha']) && isHex40(p.subject.tree_sha))) return false;
  const d = p.datasource;
  if (!(rec(d, ['config_source', 'config_sha256', 'env_profile_sha256']) && oneOf(['CONTROLLER', 'SUBJECT_TREE'], d.config_source) && isHex64(d.config_sha256) && isHex64(d.env_profile_sha256))) return false;
  const ps = p.prisma_schema;
  if (!(rec(ps, ['blob_sha1', 'validate_exit_code']) && isHex40(ps.blob_sha1) && isSafeInt(ps.validate_exit_code))) return false;
  const models = p.prisma_models;
  if (
    !arrayOf(
      models,
      (m) =>
        rec(m, ['name', 'mapped_table', 'vector_columns']) &&
        isNonEmptyString(m.name) &&
        isNonEmptyString(m.mapped_table) &&
        arrayOf(m.vector_columns, (c) => rec(c, ['column', 'declared_dimension']) && isNonEmptyString(c.column) && isNonNegativeInt(c.declared_dimension)) &&
        sortedBy(m.vector_columns, 'column'),
    ) ||
    !sortedBy(models, 'name')
  ) {
    return false;
  }
  const m = p.migration;
  if (!(rec(m, ['id', 'location', 'sql_sha256', 'tables']) && isNonEmptyString(m.id) && isNonEmptyString(m.location) && isHex64(m.sql_sha256))) return false;
  const tablesOk = arrayOf(
    m.tables,
    (t) =>
      rec(t, ['table', 'vector_columns', 'dimension_checks', 'pipeline_binding_checks']) &&
      isNonEmptyString(t.table) &&
      arrayOf(t.vector_columns, (c) => rec(c, ['column', 'dimension']) && isNonEmptyString(c.column) && isNonNegativeInt(c.dimension)) &&
      sortedBy(t.vector_columns, 'column') &&
      arrayOf(t.dimension_checks, (c) => rec(c, ['name', 'dimension']) && isNonEmptyString(c.name) && isNonNegativeInt(c.dimension)) &&
      sortedBy(t.dimension_checks, 'name') &&
      arrayOf(
        t.pipeline_binding_checks,
        (c) =>
          rec(c, ['name', 'triples']) &&
          isNonEmptyString(c.name) &&
          arrayOf(c.triples, (x) => rec(x, ['model_id', 'model_revision', 'pipeline_version']) && isNonEmptyString(x.model_id) && isNonEmptyString(x.model_revision) && isNonEmptyString(x.pipeline_version)) &&
          strictlyAscending(c.triples as Rec[], tripleKey),
      ) &&
      sortedBy(t.pipeline_binding_checks, 'name'),
  );
  if (!tablesOk || !sortedBy(m.tables, 'table')) return false;
  const rp = p.runtime_persistence;
  if (!rec(rp, ['statements', 'embedding_table_references'])) return false;
  const statementsOk = arrayOf(
    rp.statements,
    (s) =>
      rec(s, ['kind', 'table', 'source_blob_sha1', 'vector_columns']) &&
      isNonEmptyString(s.kind) &&
      isNonEmptyString(s.table) &&
      isHex40(s.source_blob_sha1) &&
      arrayOf(s.vector_columns, (c) => rec(c, ['column', 'cast_dimension']) && isNonEmptyString(c.column) && isNonNegativeInt(c.cast_dimension)),
  );
  if (!statementsOk || !sortedStrings(rp.embedding_table_references)) return false;
  const a = p.approval;
  if (!(rec(a, ['record', 'record_sha256', 'attestation_verified']) && isHex64(a.record_sha256) && typeof a.attestation_verified === 'boolean')) return false;
  const rc = a.record;
  return rec(rc, ['migration_id', 'migration_sql_sha256', 'decision']) && isNonEmptyString(rc.migration_id) && isHex64(rc.migration_sql_sha256) && isNonEmptyString(rc.decision);
}

// ---------------------------------------------------------------- generation (5.3)

export const RUNTIME_IDENTITY_FIELDS = [
  'runtime_id',
  'runtime_implementation_sha256',
  'runtime_config_sha256',
  'model_id',
  'model_version',
  'model_snapshot_manifest_sha256',
  'generation_contract_version',
] as const;

export interface RuntimeIdentity {
  readonly runtime_id: string;
  readonly runtime_implementation_sha256: string;
  readonly runtime_config_sha256: string;
  readonly model_id: string;
  readonly model_version: string;
  readonly model_snapshot_manifest_sha256: string;
  readonly generation_contract_version: string;
}
export interface BootEntrypoint {
  readonly entry_id: string;
  readonly node_env: string;
  readonly registered_after_boot: boolean;
  readonly runtime?: RuntimeIdentity;
  readonly generate_attempt: { readonly outcome: string; readonly code?: string };
}
export interface GenerationDerivation {
  readonly contract_version: string;
  readonly subject: { readonly tree_sha: string };
  readonly port: { readonly source_blob_sha1: string };
  readonly registry: { readonly runtimes: readonly RuntimeIdentity[] };
  readonly static_census: { readonly registration_identifier_files: number; readonly nonliteral_dynamic_imports: number; readonly test_registration_files: number };
  readonly entrypoint_set: { readonly claimed_sha256: string; readonly derived_sha256: string };
  readonly boot_probe: { readonly entrypoints: readonly BootEntrypoint[] };
}

const OUTCOMES = ['SUCCESS', 'FAIL_CLOSED', 'OTHER_ERROR'] as const;

const validRuntimeIdentity = (r: unknown): boolean =>
  rec(r, RUNTIME_IDENTITY_FIELDS) &&
  isNonEmptyString(r.runtime_id) &&
  isHex64(r.runtime_implementation_sha256) &&
  isHex64(r.runtime_config_sha256) &&
  isNonEmptyString(r.model_id) &&
  isNonEmptyString(r.model_version) &&
  isHex64(r.model_snapshot_manifest_sha256) &&
  isNonEmptyString(r.generation_contract_version);

const validEntrypoint = (e: unknown): boolean => {
  if (!isRecord(e)) return false;
  if (!hasExactKeys(e, ['entry_id', 'node_env', 'registered_after_boot', 'generate_attempt'], ['runtime'])) return false;
  if (!isNonEmptyString(e.entry_id) || !isNonEmptyString(e.node_env) || typeof e.registered_after_boot !== 'boolean') return false;
  // the registered runtime identity is present iff the entrypoint registered a runtime after boot
  if (e.registered_after_boot !== ('runtime' in e)) return false;
  if (e.registered_after_boot && !validRuntimeIdentity(e.runtime)) return false;
  const a = e.generate_attempt;
  if (!isRecord(a) || !hasExactKeys(a, ['outcome'], ['code']) || !oneOf(OUTCOMES, a.outcome)) return false;
  if ('code' in a) return a.outcome !== 'SUCCESS' && isNonEmptyString(a.code);
  return true;
};

export function validateGenerationDerivation(p: unknown): p is GenerationDerivation {
  if (!rec(p, ['contract_version', 'subject', 'port', 'registry', 'static_census', 'entrypoint_set', 'boot_probe'])) return false;
  if (p.contract_version !== GENERATION_DERIVATION_VERSION) return false;
  if (!(rec(p.subject, ['tree_sha']) && isHex40(p.subject.tree_sha))) return false;
  if (!(rec(p.port, ['source_blob_sha1']) && isHex40(p.port.source_blob_sha1))) return false;
  const reg = p.registry;
  if (!(rec(reg, ['runtimes']) && arrayOf(reg.runtimes, validRuntimeIdentity) && sortedBy(reg.runtimes, 'runtime_id'))) return false;
  const c = p.static_census;
  if (!(rec(c, ['registration_identifier_files', 'nonliteral_dynamic_imports', 'test_registration_files']) && isNonNegativeInt(c.registration_identifier_files) && isNonNegativeInt(c.nonliteral_dynamic_imports) && isNonNegativeInt(c.test_registration_files))) return false;
  const es = p.entrypoint_set;
  if (!(rec(es, ['claimed_sha256', 'derived_sha256']) && isHex64(es.claimed_sha256) && isHex64(es.derived_sha256))) return false;
  const probe = p.boot_probe;
  return rec(probe, ['entrypoints']) && arrayOf(probe.entrypoints, validEntrypoint) && sortedBy(probe.entrypoints, 'entry_id');
}

export { HEX40, HEX64, compareBytewise };
