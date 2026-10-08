/**
 * U51-CANONICAL-MANIFEST-CONTRACT-01 (R2) -- RED-only fixtures.
 *
 * Every value here is SYNTHETIC. Nothing in this file is a real model, revision, runtime, release or
 * guard identity, and nothing here selects, admits or recommends one. The values are high-entropy
 * (derived from labels) only so that they are not rejected as placeholders by the contract.
 *
 * Independence rule: this module must not import the (not yet existing) implementation. It builds
 * canonical bytes and hashes with the SAME primitives the repository already names as the only
 * identity path (RFC 8785 via `json-canonicalize`, UTF-8, SHA-256; see
 * packages/mps-compliance/src/canonical/sha256Canonical.ts), so a future implementation is checked
 * against an independent computation.
 */
import { createHash } from 'node:crypto';
import { canonicalize } from 'json-canonicalize';

export const sha256Hex = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');
export const sha1Hex = (data: string): string => createHash('sha1').update(data).digest('hex');
export const canonicalBytesOf = (value: unknown): Uint8Array => Buffer.from(canonicalize(value), 'utf8');
export const hashOf = (value: unknown): string => sha256Hex(canonicalBytesOf(value));

/** Synthetic identity helpers: stable, high-entropy, clearly derived from a label. */
export const syn40 = (label: string): string => sha1Hex(`u51-fixture:${label}`);
export const syn64 = (label: string): string => sha256Hex(`u51-fixture:${label}`);

export const GUARD_PATH = 'tests/unit/noGoogleRuntimeGuard.test.ts';
export const GUARD_TEST_FULL_NAME = 'no-google runtime guard active execution files do not import or call Google';
export const BLOCKER = 'BLOCKED_BY_LOCAL_GENERATION_RUNTIME';

export const TREE_A = syn40('tree-A');
export const TREE_B = syn40('tree-B');
export const COMMIT_A = syn40('commit-A');
export const GUARD_BLOB_ACCEPTED = syn40('guard-blob-accepted');
export const GUARD_BLOB_OTHER = syn40('guard-blob-other');
export const VERIFIER = { verifier_version: 'fixture-verifier-1', implementation_tree_sha1: syn40('verifier-implementation') };

export type Obj = Record<string, any>;

export interface World {
  manifest: Obj;
  policy: Obj;
  observations: Obj;
  verifier: Obj;
  /** adapter-asserted authenticity of the policy bytes (the core cannot verify signatures itself) */
  policy_authentication: Obj;
}

export const TABLE = 'fixture_embeddings_local_v1';

export const EMBEDDING_PIPELINE = {
  pipeline_key: 'fixture-embedding',
  model_id: 'fixture-org/fixture-embedding',
  model_revision: syn40('embedding-revision'),
  pipeline_version: 'fixture-st-dense-v1',
  dimension: 1024,
  normalization: 'l2',
  query_prefix: 'fixture-query: ',
  passage_prefix: 'fixture-passage: ',
  max_seq_length: 512,
  snapshot_manifest_sha256: syn64('embedding-snapshot'),
};

/** The generation runtime identity as LocalGenerationPort + a (future) registry would carry it. model_version is a free string. */
export const GENERATION_RUNTIME = {
  runtime_id: 'fixture-local-runtime-alpha',
  runtime_implementation_sha256: syn64('runtime-implementation'),
  runtime_config_sha256: syn64('runtime-config'),
  model_id: 'fixture-org/fixture-generation',
  model_version: 'fixture-model-2026.10',
  model_snapshot_manifest_sha256: syn64('generation-snapshot'),
  generation_contract_version: 'fixture-generation-contract-1',
};

const sortedStrings = (xs: string[]): string[] => [...xs].sort();

export const GUARD_ENTRY = {
  blob_sha1: GUARD_BLOB_ACCEPTED,
  command_sha256: syn64('guard-command'),
  scan_roots: sortedStrings(['.github/workflows', 'prompt_optimizer', 'scripts', 'server', 'services', 'src']),
  allow_patterns: sortedStrings(['\\.md$', '^docs/', '^governance/', '^public/cesium/', '^tests/unit/noGoogleRuntimeGuard\\.test\\.ts$']),
  rules: [
    { id: 'gcloud', applies_to: 'SCRIPT_FILES_ONLY' },
    { id: 'google-sdk-import', applies_to: 'ALL_FILES' },
    { id: 'googleapis-host', applies_to: 'ALL_FILES' },
    { id: 'gsutil', applies_to: 'SCRIPT_FILES_ONLY' },
  ],
  required_tests: [{ file: GUARD_PATH, full_name: GUARD_TEST_FULL_NAME }],
};

const DEP_MANIFESTS = ['package-lock.json', 'package.json'];
const DEP_FORBIDDEN = ['fixture-forbidden-package'];

/** A fully consistent world: the implementation, once it exists, MUST evaluate it to core PASS. */
export function buildWorld(): World {
  const pipelineSpecHash = hashOf(EMBEDDING_PIPELINE);
  const selectionRecord = { pipeline_key: EMBEDDING_PIPELINE.pipeline_key, pipeline_spec_sha256: pipelineSpecHash, decision: 'SELECTED' };
  const approvalRecord = { migration_id: '29990101000000_fixture_embedding_local_v1', migration_sql_sha256: syn64('migration-sql'), decision: 'APPROVED' };
  const triple = { model_id: EMBEDDING_PIPELINE.model_id, model_revision: EMBEDDING_PIPELINE.model_revision, pipeline_version: EMBEDDING_PIPELINE.pipeline_version };

  const observations: Obj = {
    subject: { commit_sha: COMMIT_A, commit_tree_sha: TREE_A },
    origin: { commit_sha: COMMIT_A, reachable: true, remote_identity_sha256: syn64('origin-remote') },
    release: {
      verified: true,
      artifact_id: 'product-release-0123456789abcdef01234567',
      contract_version: 'product-release-v3',
      release_hash_sha256: syn64('release-hash'),
      source_commit_sha: COMMIT_A,
      source_tree_sha: TREE_A,
    },
    zero_google: {
      payload: {
        contract_version: 'u51-zero-google-evidence-1',
        subject: { commit_sha: COMMIT_A, tree_sha: TREE_A },
        guard_state: 'PRESENT',
        guard: { path: GUARD_PATH, blob_sha1_in_tree: GUARD_BLOB_ACCEPTED, blob_sha1_executed: GUARD_BLOB_ACCEPTED },
        scan: {
          profile: 'GUARD_PLUS_DEPENDENCY_MANIFESTS',
          roots: [...GUARD_ENTRY.scan_roots],
          allow_patterns_sha256: hashOf(GUARD_ENTRY.allow_patterns),
          executed_rules: GUARD_ENTRY.rules.map((r) => ({ ...r })),
          candidate_files: { claimed_digest_sha256: syn64('candidate-files'), derived_digest_sha256: syn64('candidate-files'), count: 1500 },
          scanned_files: { claimed_digest_sha256: syn64('scanned-files'), derived_digest_sha256: syn64('scanned-files'), count: 1234 },
        },
        dependency_scan: {
          manifests: DEP_MANIFESTS.map((p) => ({ path: p, blob_sha1: syn40(`dep-${p}`) })),
          forbidden_patterns_sha256: hashOf(DEP_FORBIDDEN),
          claimed_digest_sha256: syn64('dep-manifests'),
          derived_digest_sha256: syn64('dep-manifests'),
          hits_count: 0,
        },
        execution: {
          command_sha256: GUARD_ENTRY.command_sha256,
          executed_tests: [{ file: GUARD_PATH, full_name: GUARD_TEST_FULL_NAME, status: 'passed' }],
          worktree_clean: true,
          exit_code: 0,
        },
      },
    },
    embedding: {
      payload: {
        contract_version: 'u51-embedding-derivation-1',
        subject: { tree_sha: TREE_A },
        identity_contract_version: 'embed-identity-1',
        registry: { source_blob_sha1: syn40('registry-source'), pipelines: [{ ...EMBEDDING_PIPELINE }] },
        admission: { source_blob_sha1: syn40('admission-source'), admitted_keys: ['fixture-embedding'] },
        selection_decision: { record: selectionRecord, record_sha256: hashOf(selectionRecord), attestation_verified: true },
      },
    },
    schema: {
      payload: {
        contract_version: 'u51-schema-derivation-1',
        subject: { tree_sha: TREE_A },
        datasource: { config_source: 'CONTROLLER', config_sha256: syn64('controller-prisma-config'), env_profile_sha256: syn64('validate-env-profile') },
        prisma_schema: { blob_sha1: syn40('prisma-schema-blob'), validate_exit_code: 0 },
        prisma_models: [{ name: 'FixtureEmbedding', mapped_table: TABLE, vector_columns: [{ column: 'embedding_vector', declared_dimension: 1024 }] }],
        migration: {
          id: approvalRecord.migration_id,
          location: 'prisma/migrations',
          sql_sha256: approvalRecord.migration_sql_sha256,
          tables: [
            {
              table: TABLE,
              vector_columns: [{ column: 'embedding_vector', dimension: 1024 }],
              dimension_checks: [{ name: 'fix_dimension_chk', dimension: 1024 }],
              pipeline_binding_checks: [{ name: 'fix_pipeline_chk', triples: [{ ...triple }] }],
            },
          ],
        },
        runtime_persistence: {
          statements: [
            { kind: 'INSERT', table: TABLE, source_blob_sha1: syn40('persistence-source'), vector_columns: [{ column: 'embedding_vector', cast_dimension: 1024 }] },
            { kind: 'SELECT', table: TABLE, source_blob_sha1: syn40('search-source'), vector_columns: [{ column: 'embedding_vector', cast_dimension: 1024 }] },
          ],
          embedding_table_references: [TABLE],
        },
        approval: { record: approvalRecord, record_sha256: hashOf(approvalRecord), attestation_verified: true },
      },
    },
    generation: {
      payload: {
        contract_version: 'u51-generation-derivation-1',
        subject: { tree_sha: TREE_A },
        port: { source_blob_sha1: syn40('generation-port-source') },
        registry: { runtimes: [{ ...GENERATION_RUNTIME }] },
        static_census: { registration_identifier_files: 1, nonliteral_dynamic_imports: 0, test_registration_files: 2 },
        entrypoint_set: { claimed_sha256: syn64('entrypoints'), derived_sha256: syn64('entrypoints') },
        boot_probe: {
          entrypoints: [
            { entry_id: 'web', node_env: 'production', registered_after_boot: true, runtime: { ...GENERATION_RUNTIME }, generate_attempt: { outcome: 'SUCCESS' } },
            { entry_id: 'worker-lu', node_env: 'production', registered_after_boot: false, generate_attempt: { outcome: 'FAIL_CLOSED', code: BLOCKER } },
          ],
        },
      },
    },
  };

  const policy: Obj = {
    contract_version: 'u51-freeze-policy-1',
    accepted_guards: [{ ...GUARD_ENTRY }],
    required_scan_profile: 'GUARD_PLUS_DEPENDENCY_MANIFESTS',
    dependency_scan: { manifests: [...DEP_MANIFESTS], forbidden_package_patterns: [...DEP_FORBIDDEN] },
    generation_requirement: 'BOUND_REQUIRED',
    migration_check_binding: 'EXACT_ADMITTED',
    origin_requirement: 'REQUIRED',
    accepted_release_contract_versions: ['product-release-v3'],
    forbidden_identity_patterns: [],
    accepted_verifiers: [{ ...VERIFIER }],
  };

  const world: World = {
    manifest: {},
    policy,
    observations,
    verifier: { ...VERIFIER },
    policy_authentication: { policy_sha256: '', verified: true, trust_root_ref: 'fixture-trust-root' },
  };
  freshManifest(world);
  return world;
}

/** (Re)builds the manifest and the policy authentication so that every claim equals what the observations derive. */
export function freshManifest(world: World): void {
  const o = world.observations;
  const emb = o.embedding?.payload;
  const pipeline = emb?.registry?.pipelines?.[0] ?? EMBEDDING_PIPELINE;
  const gen = o.generation?.payload;
  const probed = gen?.boot_probe?.entrypoints?.find((e: Obj) => e.registered_after_boot === true);
  const bound = probed !== undefined;
  const embedding: Obj = {
    contract_version: 'embed-identity-1',
    pipeline_key: pipeline.pipeline_key,
    model_id: pipeline.model_id,
    model_revision: pipeline.model_revision,
    pipeline_version: pipeline.pipeline_version,
    dimension: pipeline.dimension,
    normalization: pipeline.normalization,
    query_prefix_sha256: sha256Hex(pipeline.query_prefix),
    passage_prefix_sha256: sha256Hex(pipeline.passage_prefix),
    pipeline_spec_sha256: hashOf(pipeline),
    snapshot_manifest_sha256: pipeline.snapshot_manifest_sha256,
    registry_sha256: hashOf(emb.registry.pipelines),
    admission_sha256: hashOf(emb.admission.admitted_keys),
    selection_decision_sha256: emb.selection_decision.record_sha256,
    evidence_sha256: hashOf(emb),
  };
  if (pipeline.max_seq_length !== undefined) embedding.max_seq_length = pipeline.max_seq_length;
  world.manifest = {
    manifest_type: 'u51-canonical-manifest',
    contract_version: 'u51-canonical-manifest-1',
    candidate: { commit_sha: COMMIT_A, tree_sha: TREE_A },
    release: { artifact_id: o.release.artifact_id, contract_version: 'product-release-v3', release_hash_sha256: o.release.release_hash_sha256 },
    zero_google: { evidence_sha256: hashOf(o.zero_google.payload) },
    embedding,
    schema: {
      prisma_schema_blob_sha1: o.schema.payload.prisma_schema.blob_sha1,
      migration_id: o.schema.payload.migration.id,
      migration_sql_sha256: o.schema.payload.migration.sql_sha256,
      table: o.schema.payload.migration.tables[0].table,
      vector_dimension: o.schema.payload.migration.tables[0].vector_columns[0].dimension,
      approval_sha256: o.schema.payload.approval.record_sha256,
      evidence_sha256: hashOf(o.schema.payload),
    },
    generation: bound
      ? {
          posture: 'BOUND',
          runtime_id: probed.runtime.runtime_id,
          runtime_implementation_sha256: probed.runtime.runtime_implementation_sha256,
          runtime_config_sha256: probed.runtime.runtime_config_sha256,
          model_id: probed.runtime.model_id,
          model_version: probed.runtime.model_version,
          model_snapshot_manifest_sha256: probed.runtime.model_snapshot_manifest_sha256,
          generation_contract_version: probed.runtime.generation_contract_version,
          port_source_blob_sha1: gen.port.source_blob_sha1,
          evidence_sha256: hashOf(gen),
        }
      : { posture: 'DECLARED_ABSENT', evidence_sha256: hashOf(gen) },
  };
  world.policy_authentication = { ...world.policy_authentication, policy_sha256: hashOf(world.policy) };
}

/** The world where U51 declares no generation (admissible only if the policy says so and the boot probe shows absence). */
export function buildAbsentGenerationWorld(): World {
  const w = buildWorld();
  const g = w.observations.generation.payload;
  g.registry = { runtimes: [] };
  g.static_census = { registration_identifier_files: 0, nonliteral_dynamic_imports: 0, test_registration_files: 2 };
  g.boot_probe.entrypoints = [
    { entry_id: 'web', node_env: 'production', registered_after_boot: false, generate_attempt: { outcome: 'FAIL_CLOSED', code: BLOCKER } },
    { entry_id: 'worker-lu', node_env: 'production', registered_after_boot: false, generate_attempt: { outcome: 'FAIL_CLOSED', code: BLOCKER } },
  ];
  w.policy.generation_requirement = 'ABSENT_ADMISSIBLE';
  freshManifest(w);
  return w;
}

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export interface EvaluateInput {
  manifest_bytes: Uint8Array;
  policy: Obj;
  policy_authentication: Obj;
  verifier: Obj;
  observations: Obj;
  expected_manifest_sha256?: string;
}

/** The input a caller supplies. `expected_manifest_sha256` is the hash the submitter/owner reviewed; it is part of a complete input. */
export function toInput(world: World): EvaluateInput {
  return {
    manifest_bytes: canonicalBytesOf(world.manifest),
    policy: world.policy,
    policy_authentication: world.policy_authentication,
    verifier: world.verifier,
    observations: world.observations,
    expected_manifest_sha256: hashOf(world.manifest),
  };
}

/** Golden vector: the canonical SHA-256 of buildWorld().manifest. Pinned so an implementation cannot drift silently. */
export const GOLDEN_BASE_MANIFEST_SHA256 = 'f17f9b3fd4502ea94578a93d2cc061188bec8baaccfe47f6d8474feba1f316d1';
