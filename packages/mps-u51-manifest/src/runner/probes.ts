/**
 * C9 -- negative / substitution probes (contract 11.2, matrix of section 8).
 *
 * The runner re-runs the PURE core on in-memory mutations of the very inputs of a core PASS and requires each
 * mutation to FAIL with the exact code at the exact stage, with every earlier check PASS and every later check
 * NOT_EXECUTED. A probe that does not reject is a verifier defect: `negative_probe_not_rejected`.
 *
 * Probes the matrix lists but that need an adapter or a live runtime (attack 18, post-freeze substitution) are not
 * here; they are covered by the runner's path refusal and are not mutations of core inputs.
 */
import { canonicalizeManifest, hashJcs } from '../canonical';
import { evaluateU51Manifest } from '../evaluate';
import { isRecord, type Rec } from '../json';
import type { EvaluateInput, Evaluation } from '../types';
import { CORE_STAGES, FAILURE, GENERATION_FAIL_CLOSED_STATUS, type CoreStageId } from '../vocabulary';
import { FORBIDDEN_SUBSTRINGS } from '../identityScan';

/** The mutable working copy of a core input. */
export interface Work {
  manifest: Rec;
  policy: Rec;
  policyAuthentication: Rec;
  verifier: Rec;
  observations: Rec;
  /** 'AUTO' = the hash of the mutated manifest (so C8 never interferes); undefined = no hash supplied */
  expected: 'AUTO' | string | undefined;
  /** raw manifest bytes, when a probe attacks the byte form */
  bytes?: Uint8Array;
}

export type Expectation = { readonly code: string; readonly stage: CoreStageId } | { readonly notExecutedAt: CoreStageId };

export interface Probe {
  readonly id: string;
  /** row of the substitution matrix, contract section 8 */
  readonly matrix_row: string;
  readonly expect: Expectation;
  /** conditional probes: false = not applicable to this baseline (listed, never counted as rejected) */
  readonly applies?: (w: Work) => boolean;
  /** throws NotApplicable when the structure the mutation needs is missing */
  readonly mutate: (w: Work) => void;
}

class NotApplicable extends Error {}

const jsonClone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function get(root: unknown, path: string): any {
  let cur: any = root;
  for (const key of path.split('.')) {
    if (cur === undefined || cur === null) throw new NotApplicable(`missing ${path}`);
    cur = cur[key];
  }
  if (cur === undefined) throw new NotApplicable(`missing ${path}`);
  return cur;
}

function set(root: unknown, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  const parent = keys.length > 0 ? get(root, keys.join('.')) : root;
  if (parent === undefined || parent === null || !(last in (parent as object))) throw new NotApplicable(`missing ${path}`);
  (parent as any)[last] = value;
}

const flipHex = (h: string): string => `${h.slice(0, -1)}${h.endsWith('a') ? 'b' : 'a'}`;

const payload = (w: Work, kind: string): any => get(w.observations, `${kind}.payload`);
const reseal = (w: Work, kind: string): void => {
  (w.manifest as any)[kind].evidence_sha256 = hashJcs(payload(w, kind));
};
const claimedTable = (w: Work): any => {
  const table = (get(payload(w, 'schema'), 'migration.tables') as any[]).find((t) => t.table === get(w.manifest, 'schema.table'));
  if (table === undefined) throw new NotApplicable('claimed table not in migration');
  return table;
};
const bound = (w: Work): boolean => isRecord(w.manifest.generation) && w.manifest.generation.posture === 'BOUND';
const absent = (w: Work): boolean => isRecord(w.manifest.generation) && w.manifest.generation.posture === 'DECLARED_ABSENT';
const originRequired = (w: Work): boolean => w.policy.origin_requirement === 'REQUIRED';

const at = (code: string, stage: CoreStageId): Expectation => ({ code, stage });
const F = FAILURE;

/** Insert into a bytewise-sorted array of strings keeping it strictly ascending. */
const insertSorted = (xs: string[], x: string): void => {
  xs.push(x);
  xs.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
};

export const PROBES: readonly Probe[] = [
  // ------------------------------------------------------------------ C0
  { id: 'policy-unauthenticated', matrix_row: '25', expect: at(F.policy_unauthenticated, 'C0'), mutate: (w) => set(w.policyAuthentication, 'verified', false) },
  {
    id: 'policy-substituted-after-authentication',
    matrix_row: '25',
    expect: at(F.policy_unauthenticated, 'C0'),
    mutate: (w) => (w.policy.forbidden_identity_patterns = [...(get(w.policy, 'forbidden_identity_patterns') as string[]), 'zzz-substituted'].sort()),
  },
  { id: 'policy-malformed', matrix_row: '25', expect: at(F.policy_invalid, 'C0'), mutate: (w) => (w.policy.unexpected_key = 1) },
  {
    id: 'verifier-not-accepted',
    matrix_row: '25',
    expect: at(F.verifier_identity_unaccepted, 'C0'),
    mutate: (w) => set(w.verifier, 'implementation_tree_sha1', flipHex(get(w.verifier, 'implementation_tree_sha1'))),
  },
  { id: 'duplicate-key', matrix_row: '11', expect: at(F.canonicalization_failure, 'C0'), mutate: (w) => (w.bytes = Buffer.from(Buffer.from(canonicalizeManifest(w.manifest).bytes).toString('utf8').replace('{', '{"manifest_type":"x",'), 'utf8')) },
  { id: 'byte-order-mark', matrix_row: '11', expect: at(F.canonicalization_failure, 'C0'), mutate: (w) => (w.bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(canonicalizeManifest(w.manifest).bytes)])) },

  // ------------------------------------------------------------------ C1
  { id: 'unknown-extra-field', matrix_row: '12', expect: at(F.manifest_schema_invalid, 'C1'), mutate: (w) => (w.manifest.note = 'free text') },
  {
    id: 'homoglyph-identifier',
    matrix_row: '28',
    expect: at(F.manifest_schema_invalid, 'C1'),
    mutate: (w) => set(w.manifest, 'embedding.pipeline_key', `p${String.fromCharCode(0x043e)}${String.fromCharCode(0x043e)}l-key`),
  },
  {
    id: 'forbidden-provider-identity',
    matrix_row: '7',
    expect: at(F.forbidden_provider_identity, 'C1'),
    mutate: (w) => set(w.manifest, 'embedding.model_id', `${FORBIDDEN_SUBSTRINGS[1]}-embedding-001`),
  },
  { id: 'placeholder-identity', matrix_row: '7', expect: at(F.manifest_unresolved_identity, 'C1'), mutate: (w) => set(w.manifest, 'embedding.model_id', 'TBD') },

  // ------------------------------------------------------------------ C2
  { id: 'candidate-tree-differs-from-commit', matrix_row: '10', expect: at(F.tree_binding_mismatch, 'C2'), mutate: (w) => set(w.observations, 'subject.commit_tree_sha', flipHex(get(w.observations, 'subject.commit_tree_sha'))) },
  { id: 'release-hash-differs', matrix_row: '10', expect: at(F.release_reference_invalid, 'C2'), mutate: (w) => set(w.observations, 'release.release_hash_sha256', flipHex(get(w.observations, 'release.release_hash_sha256'))) },
  { id: 'release-not-verified', matrix_row: '10', expect: at(F.release_reference_invalid, 'C2'), mutate: (w) => set(w.observations, 'release.verified', false) },
  { id: 'release-of-another-tree', matrix_row: '10', expect: at(F.tree_binding_mismatch, 'C2'), mutate: (w) => set(w.observations, 'release.source_tree_sha', flipHex(get(w.observations, 'release.source_tree_sha'))) },
  { id: 'candidate-not-on-origin', matrix_row: '26', expect: at(F.candidate_not_on_origin, 'C2'), applies: originRequired, mutate: (w) => set(w.observations, 'origin.reachable', false) },

  // ------------------------------------------------------------------ C3
  { id: 'zero-google-of-another-tree', matrix_row: '1', expect: at(F.zero_google_tree_mismatch, 'C3'), mutate: (w) => { set(payload(w, 'zero_google'), 'subject.tree_sha', flipHex(get(payload(w, 'zero_google'), 'subject.tree_sha'))); reseal(w, 'zero_google'); } },
  { id: 'zero-google-evidence-missing', matrix_row: '6', expect: at(F.zero_google_evidence_missing, 'C3'), mutate: (w) => { get(w.observations, 'zero_google'); delete w.observations.zero_google; } },
  {
    id: 'zero-google-no-guard-in-tree',
    matrix_row: '6',
    expect: at(F.zero_google_guard_not_accepted, 'C3'),
    mutate: (w) => {
      const p = payload(w, 'zero_google');
      w.observations.zero_google = { payload: { contract_version: p.contract_version, subject: p.subject, guard_state: 'NO_GUARD_PRESENT_IN_SUBJECT_TREE' } };
      reseal(w, 'zero_google');
    },
  },
  { id: 'zero-google-guard-blob-not-accepted', matrix_row: '14', expect: at(F.zero_google_guard_not_accepted, 'C3'), mutate: (w) => { const p = payload(w, 'zero_google'); const other = flipHex(get(p, 'guard.blob_sha1_in_tree')); p.guard.blob_sha1_in_tree = other; p.guard.blob_sha1_executed = other; reseal(w, 'zero_google'); } },
  { id: 'zero-google-executed-is-not-committed', matrix_row: '14', expect: at(F.zero_google_guard_not_accepted, 'C3'), mutate: (w) => { const p = payload(w, 'zero_google'); p.guard.blob_sha1_executed = flipHex(get(p, 'guard.blob_sha1_executed')); reseal(w, 'zero_google'); } },
  { id: 'zero-google-wrong-command', matrix_row: '14', expect: at(F.zero_google_guard_not_accepted, 'C3'), mutate: (w) => { const p = payload(w, 'zero_google'); p.execution.command_sha256 = flipHex(get(p, 'execution.command_sha256')); reseal(w, 'zero_google'); } },
  {
    id: 'zero-google-weaker-rule-coverage',
    matrix_row: '14',
    expect: at(F.zero_google_scan_mismatch, 'C3'),
    mutate: (w) => {
      const p = payload(w, 'zero_google');
      const rule = get(p, 'scan.executed_rules.0');
      rule.applies_to = rule.applies_to === 'ALL_FILES' ? 'SCRIPT_FILES_ONLY' : 'ALL_FILES';
      reseal(w, 'zero_google');
    },
  },
  { id: 'zero-google-scanned-fileset-digest', matrix_row: '14', expect: at(F.zero_google_scan_mismatch, 'C3'), mutate: (w) => { const p = payload(w, 'zero_google'); p.scan.scanned_files.claimed_digest_sha256 = flipHex(get(p, 'scan.scanned_files.claimed_digest_sha256')); reseal(w, 'zero_google'); } },
  { id: 'zero-google-dirty-worktree', matrix_row: '15', expect: at(F.zero_google_not_pass, 'C3'), mutate: (w) => { const p = payload(w, 'zero_google'); get(p, 'execution.worktree_clean'); p.execution.worktree_clean = false; reseal(w, 'zero_google'); } },
  { id: 'zero-google-guard-test-skipped', matrix_row: '15', expect: at(F.zero_google_not_pass, 'C3'), mutate: (w) => { const p = payload(w, 'zero_google'); get(p, 'execution.executed_tests.0').status = 'skipped'; reseal(w, 'zero_google'); } },
  { id: 'zero-google-no-test-executed', matrix_row: '15', expect: at(F.zero_google_not_pass, 'C3'), mutate: (w) => { const p = payload(w, 'zero_google'); get(p, 'execution.executed_tests'); p.execution.executed_tests = []; reseal(w, 'zero_google'); } },
  { id: 'zero-google-swapped-evidence', matrix_row: '17', expect: at(F.manifest_hash_mismatch, 'C3'), mutate: (w) => { const p = payload(w, 'zero_google'); p.scan.scanned_files.count = get(p, 'scan.scanned_files.count') + 1; } },
  { id: 'zero-google-extra-key', matrix_row: '27', expect: at(F.evidence_schema_invalid, 'C3'), mutate: (w) => { payload(w, 'zero_google').note = 'x'; reseal(w, 'zero_google'); } },

  // ------------------------------------------------------------------ C4
  { id: 'embedding-registry-hash-of-another-revision', matrix_row: '2', expect: at(F.embedding_identity_mismatch, 'C4'), mutate: (w) => set(w.manifest, 'embedding.registry_sha256', flipHex(get(w.manifest, 'embedding.registry_sha256'))) },
  { id: 'embedding-revision-substituted', matrix_row: '3', expect: at(F.embedding_identity_mismatch, 'C4'), mutate: (w) => set(w.manifest, 'embedding.model_revision', flipHex(get(w.manifest, 'embedding.model_revision'))) },
  { id: 'embedding-dimension-claim', matrix_row: '4', expect: at(F.embedding_dimension_mismatch, 'C4'), mutate: (w) => set(w.manifest, 'embedding.dimension', get(w.manifest, 'embedding.dimension') + 1) },
  {
    id: 'embedding-query-format-changed',
    matrix_row: '19',
    expect: at(F.embedding_identity_mismatch, 'C4'),
    mutate: (w) => {
      const p = payload(w, 'embedding');
      const entry = (get(p, 'registry.pipelines') as any[]).find((e) => e.pipeline_key === get(w.manifest, 'embedding.pipeline_key'));
      if (entry === undefined) throw new NotApplicable('pipeline entry not in registry');
      entry.query_prefix = `${entry.query_prefix}x`;
      reseal(w, 'embedding');
    },
  },
  {
    id: 'embedding-max-seq-length-presence',
    matrix_row: '19',
    expect: at(F.embedding_identity_mismatch, 'C4'),
    applies: (w) => isRecord(w.manifest.embedding) && w.manifest.embedding.max_seq_length !== undefined,
    mutate: (w) => delete (get(w.manifest, 'embedding') as Rec).max_seq_length,
  },
  { id: 'embedding-admission-empty', matrix_row: '16', expect: at(F.embedding_not_admitted, 'C4'), mutate: (w) => { const p = payload(w, 'embedding'); p.admission.admitted_keys = []; set(w.manifest, 'embedding.admission_sha256', hashJcs([])); reseal(w, 'embedding'); } },
  { id: 'embedding-selection-claim', matrix_row: '16', expect: at(F.manifest_unresolved_identity, 'C4'), mutate: (w) => set(w.manifest, 'embedding.selection_decision_sha256', flipHex(get(w.manifest, 'embedding.selection_decision_sha256'))) },
  { id: 'embedding-evidence-of-another-tree', matrix_row: '1', expect: at(F.tree_binding_mismatch, 'C4'), mutate: (w) => { const p = payload(w, 'embedding'); p.subject.tree_sha = flipHex(get(p, 'subject.tree_sha')); reseal(w, 'embedding'); } },
  { id: 'embedding-wrong-contract-version', matrix_row: '27', expect: at(F.evidence_schema_invalid, 'C4'), mutate: (w) => { payload(w, 'embedding').contract_version = 'u51-embedding-derivation-0'; reseal(w, 'embedding'); } },

  // ------------------------------------------------------------------ C5
  { id: 'schema-dimension-in-migration', matrix_row: '5', expect: at(F.embedding_dimension_mismatch, 'C5'), mutate: (w) => { const t = claimedTable(w); t.vector_columns[0].dimension = t.vector_columns[0].dimension + 1; reseal(w, 'schema'); } },
  { id: 'schema-runtime-cast-dimension', matrix_row: '5', expect: at(F.embedding_dimension_mismatch, 'C5'), mutate: (w) => { const s = payload(w, 'schema'); get(s, 'runtime_persistence.statements.0.vector_columns.0').cast_dimension += 1; reseal(w, 'schema'); } },
  { id: 'schema-prisma-model-missing', matrix_row: '13', expect: at(F.schema_identity_mismatch, 'C5'), mutate: (w) => { const s = payload(w, 'schema'); get(s, 'prisma_models'); s.prisma_models = []; reseal(w, 'schema'); } },
  { id: 'schema-map-differs', matrix_row: '13', expect: at(F.schema_identity_mismatch, 'C5'), mutate: (w) => { const s = payload(w, 'schema'); get(s, 'prisma_models.0').mapped_table = `${get(s, 'prisma_models.0.mapped_table')}_other`; reseal(w, 'schema'); } },
  { id: 'schema-prisma-validate-failed', matrix_row: '13', expect: at(F.schema_identity_mismatch, 'C5'), mutate: (w) => { const s = payload(w, 'schema'); get(s, 'prisma_schema.validate_exit_code'); s.prisma_schema.validate_exit_code = 1; reseal(w, 'schema'); } },
  {
    id: 'schema-legacy-embedding-table-referenced',
    matrix_row: '20',
    expect: at(F.schema_identity_mismatch, 'C5'),
    mutate: (w) => { const s = payload(w, 'schema'); insertSorted(get(s, 'runtime_persistence.embedding_table_references'), 'legacy_embeddings_3072'); reseal(w, 'schema'); },
  },
  { id: 'schema-migration-only-a-proposal', matrix_row: '21', expect: at(F.schema_identity_mismatch, 'C5'), mutate: (w) => { const s = payload(w, 'schema'); get(s, 'migration.location'); s.migration.location = 'proposal'; reseal(w, 'schema'); } },
  {
    id: 'schema-check-pins-another-revision',
    matrix_row: '21',
    expect: at(F.schema_identity_mismatch, 'C5'),
    mutate: (w) => { const t = claimedTable(w); const triple = get(t, 'pipeline_binding_checks.0.triples.0'); triple.model_revision = flipHex(triple.model_revision); reseal(w, 'schema'); },
  },
  { id: 'schema-prisma-config-of-the-subject', matrix_row: '22', expect: at(F.schema_identity_mismatch, 'C5'), mutate: (w) => { const s = payload(w, 'schema'); get(s, 'datasource.config_source'); s.datasource.config_source = 'SUBJECT_TREE'; reseal(w, 'schema'); } },
  { id: 'schema-approval-not-attested', matrix_row: '21', expect: at(F.manifest_unresolved_identity, 'C5'), mutate: (w) => { const s = payload(w, 'schema'); get(s, 'approval.attestation_verified'); s.approval.attestation_verified = false; reseal(w, 'schema'); } },
  { id: 'schema-evidence-of-another-tree', matrix_row: '1', expect: at(F.tree_binding_mismatch, 'C5'), mutate: (w) => { const s = payload(w, 'schema'); s.subject.tree_sha = flipHex(get(s, 'subject.tree_sha')); reseal(w, 'schema'); } },
  { id: 'schema-wrong-contract-version', matrix_row: '27', expect: at(F.evidence_schema_invalid, 'C5'), mutate: (w) => { payload(w, 'schema').contract_version = 'u51-schema-derivation-0'; reseal(w, 'schema'); } },

  // ------------------------------------------------------------------ C6
  { id: 'generation-evidence-of-another-tree', matrix_row: '1', expect: at(F.tree_binding_mismatch, 'C6'), mutate: (w) => { const g = payload(w, 'generation'); g.subject.tree_sha = flipHex(get(g, 'subject.tree_sha')); reseal(w, 'generation'); } },
  { id: 'generation-wrong-contract-version', matrix_row: '27', expect: at(F.evidence_schema_invalid, 'C6'), mutate: (w) => { payload(w, 'generation').contract_version = 'u51-generation-derivation-0'; reseal(w, 'generation'); } },
  { id: 'generation-non-production-profile', matrix_row: '23', expect: at(F.generation_identity_mismatch, 'C6'), mutate: (w) => { const g = payload(w, 'generation'); get(g, 'boot_probe.entrypoints.0').node_env = 'development'; reseal(w, 'generation'); } },
  { id: 'generation-partial-entrypoint-set', matrix_row: '23', expect: at(F.generation_identity_mismatch, 'C6'), mutate: (w) => { const g = payload(w, 'generation'); g.entrypoint_set.claimed_sha256 = flipHex(get(g, 'entrypoint_set.claimed_sha256')); reseal(w, 'generation'); } },
  { id: 'generation-nonliteral-dynamic-import', matrix_row: '23', expect: at(F.generation_identity_mismatch, 'C6'), mutate: (w) => { const g = payload(w, 'generation'); get(g, 'static_census.nonliteral_dynamic_imports'); g.static_census.nonliteral_dynamic_imports = 1; reseal(w, 'generation'); } },
  {
    id: 'absent-but-an-entrypoint-registered',
    matrix_row: '23',
    expect: at(F.generation_identity_mismatch, 'C6'),
    applies: absent,
    mutate: (w) => {
      const g = payload(w, 'generation');
      const first = get(g, 'boot_probe.entrypoints.0');
      first.registered_after_boot = true;
      first.runtime = { runtime_id: 'probe-runtime', runtime_implementation_sha256: '1'.repeat(64), runtime_config_sha256: '2'.repeat(64), model_id: 'probe-model', model_version: 'probe-v', model_snapshot_manifest_sha256: '3'.repeat(64), generation_contract_version: 'probe-contract' };
      reseal(w, 'generation');
    },
  },
  {
    id: 'absent-but-an-attempt-succeeded',
    matrix_row: '23',
    expect: at(F.generation_identity_mismatch, 'C6'),
    applies: absent,
    mutate: (w) => { const g = payload(w, 'generation'); get(g, 'boot_probe.entrypoints.0').generate_attempt = { outcome: 'SUCCESS' }; reseal(w, 'generation'); },
  },
  {
    id: 'absent-but-another-error-than-the-fail-closed-status',
    matrix_row: '23',
    expect: at(F.generation_identity_mismatch, 'C6'),
    applies: absent,
    mutate: (w) => { const g = payload(w, 'generation'); get(g, 'boot_probe.entrypoints.0').generate_attempt = { outcome: 'FAIL_CLOSED', code: `${GENERATION_FAIL_CLOSED_STATUS}_X` }; reseal(w, 'generation'); },
  },
  {
    id: 'absent-but-a-registration-identifier-in-source',
    matrix_row: '23',
    expect: at(F.generation_identity_mismatch, 'C6'),
    applies: absent,
    mutate: (w) => { const g = payload(w, 'generation'); get(g, 'static_census.registration_identifier_files'); g.static_census.registration_identifier_files = 1; reseal(w, 'generation'); },
  },
  {
    id: 'bound-runtime-differs-from-the-booted-one',
    matrix_row: '24',
    expect: at(F.generation_identity_mismatch, 'C6'),
    applies: bound,
    mutate: (w) => { const g = payload(w, 'generation'); const e = (get(g, 'boot_probe.entrypoints') as any[]).find((x) => x.registered_after_boot); if (e === undefined) throw new NotApplicable('no registered entrypoint'); e.runtime.model_version = `${e.runtime.model_version}-other`; reseal(w, 'generation'); },
  },
  { id: 'bound-claim-differs-from-the-booted-runtime', matrix_row: '24', expect: at(F.generation_identity_mismatch, 'C6'), applies: bound, mutate: (w) => set(w.manifest, 'generation.runtime_config_sha256', flipHex(get(w.manifest, 'generation.runtime_config_sha256'))) },
  {
    id: 'bound-mock-named-runtime',
    matrix_row: '9',
    expect: at(F.generation_runtime_not_production, 'C6'),
    applies: bound,
    mutate: (w) => {
      const claimed = get(w.manifest, 'generation.runtime_id') as string;
      const renamed = `mock-${claimed}`;
      set(w.manifest, 'generation.runtime_id', renamed);
      const g = payload(w, 'generation');
      for (const e of get(g, 'boot_probe.entrypoints') as any[]) if (e.registered_after_boot && e.runtime.runtime_id === claimed) e.runtime.runtime_id = renamed;
      const registry = get(g, 'registry.runtimes') as any[];
      for (const r of registry) if (r.runtime_id === claimed) r.runtime_id = renamed;
      registry.sort((a, b) => Buffer.compare(Buffer.from(a.runtime_id), Buffer.from(b.runtime_id)));
      reseal(w, 'generation');
    },
  },
  {
    id: 'bound-runtime-registry-empty',
    matrix_row: '24',
    expect: at(F.generation_identity_unresolved, 'C6'),
    applies: bound,
    mutate: (w) => { const g = payload(w, 'generation'); get(g, 'registry.runtimes'); g.registry.runtimes = []; reseal(w, 'generation'); },
  },

  // ------------------------------------------------------------------ C7 / C8
  { id: 'non-canonical-bytes-trailing-newline', matrix_row: '11', expect: at(F.canonicalization_failure, 'C7'), mutate: (w) => (w.bytes = Buffer.concat([Buffer.from(canonicalizeManifest(w.manifest).bytes), Buffer.from('\n')])) },
  {
    id: 'non-canonical-bytes-key-order',
    matrix_row: '11',
    expect: at(F.canonicalization_failure, 'C7'),
    mutate: (w) => {
      const reversed = (v: unknown): unknown => (Array.isArray(v) ? v.map(reversed) : isRecord(v) ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reversed(v[k])])) : v);
      w.bytes = Buffer.from(JSON.stringify(reversed(w.manifest)), 'utf8');
    },
  },
  { id: 'expected-hash-differs', matrix_row: '8', expect: at(F.manifest_hash_mismatch, 'C8'), mutate: (w) => (w.expected = flipHex(canonicalizeManifest(w.manifest).sha256)) },
  { id: 'expected-hash-not-supplied', matrix_row: '29', expect: { notExecutedAt: 'C8' }, mutate: (w) => (w.expected = undefined) },
];

/** Builds the core input from a (mutated) working copy. */
export function toCoreInput(w: Work): EvaluateInput {
  const canonical = canonicalizeManifest(w.manifest);
  const expected = w.expected === 'AUTO' ? canonical.sha256 : w.expected;
  return {
    manifest_bytes: w.bytes ?? canonical.bytes,
    policy: w.policy,
    policy_authentication: w.policyAuthentication,
    verifier: w.verifier,
    observations: w.observations,
    ...(expected !== undefined ? { expected_manifest_sha256: expected } : {}),
  };
}

export function workFrom(input: EvaluateInput, parsedManifest: Rec): Work {
  const authentication = jsonClone(input.policy_authentication) as Rec;
  return {
    manifest: jsonClone(parsedManifest),
    policy: jsonClone(input.policy) as Rec,
    policyAuthentication: authentication,
    verifier: jsonClone(input.verifier) as Rec,
    observations: jsonClone(input.observations) as Rec,
    expected: 'AUTO',
  };
}

/** Why an evaluation does NOT satisfy the expectation, or undefined when it does (earlier PASS, exact stage, later NOT_EXECUTED). */
export function deviationFrom(ev: Evaluation, expect: Expectation): string | undefined {
  const ids = ev.checks.map((c) => c.id);
  if (ids.length !== CORE_STAGES.length || ids.some((id, i) => id !== CORE_STAGES[i])) return 'unexpected check sequence';
  if ('notExecutedAt' in expect) {
    const idx = CORE_STAGES.indexOf(expect.notExecutedAt);
    if (ev.result !== 'NOT_EXECUTED' || ev.failure_code !== undefined) return `expected NOT_EXECUTED, got ${ev.result}`;
    return ev.checks.every((c, i) => c.result === (i < idx ? 'PASS' : 'NOT_EXECUTED')) ? undefined : 'checks around the NOT_EXECUTED stage deviate';
  }
  if (ev.result !== 'FAIL' || ev.failure_code !== expect.code) return `expected FAIL ${expect.code}, got ${ev.result}${ev.failure_code ? ` ${ev.failure_code}` : ''}`;
  const idx = CORE_STAGES.indexOf(expect.stage);
  for (let i = 0; i < ev.checks.length; i += 1) {
    const c = ev.checks[i]!;
    if (i < idx && c.result !== 'PASS') return `${c.id} was ${c.result} before the intended stage ${expect.stage}`;
    if (i === idx && (c.result !== 'FAIL' || c.code !== expect.code)) return `${c.id} did not fail with ${expect.code}`;
    if (i > idx && c.result !== 'NOT_EXECUTED') return `${c.id} was ${c.result} after the failing stage`;
  }
  return undefined;
}

export type ProbeOutcome =
  | { readonly probe: string; readonly matrix_row: string; readonly outcome: 'REJECTED' }
  | { readonly probe: string; readonly matrix_row: string; readonly outcome: 'NOT_APPLICABLE'; readonly why: string }
  | { readonly probe: string; readonly matrix_row: string; readonly outcome: 'SURVIVED'; readonly why: string };

export interface ProbeReport {
  readonly outcomes: readonly ProbeOutcome[];
  readonly rejected: number;
  readonly not_rejected: number;
  readonly not_applicable: number;
}

/**
 * Runs every probe on a fresh copy of the PASS inputs. `evaluate` is injectable so the harness itself can be tested
 * against a deliberately broken core (a probe harness that cannot fail would prove nothing).
 */
export function runNegativeProbes(
  input: EvaluateInput,
  parsedManifest: Rec,
  evaluate: (i: EvaluateInput) => Evaluation = evaluateU51Manifest,
  probes: readonly Probe[] = PROBES,
): ProbeReport {
  const outcomes: ProbeOutcome[] = [];
  for (const probe of probes) {
    const base = workFrom(input, parsedManifest);
    if (probe.applies !== undefined && !probe.applies(base)) {
      outcomes.push({ probe: probe.id, matrix_row: probe.matrix_row, outcome: 'NOT_APPLICABLE', why: 'not applicable to this posture / policy' });
      continue;
    }
    const work = workFrom(input, parsedManifest);
    try {
      probe.mutate(work);
    } catch (error) {
      if (error instanceof NotApplicable) {
        outcomes.push({ probe: probe.id, matrix_row: probe.matrix_row, outcome: 'SURVIVED', why: `the mutation could not be applied: ${error.message}` });
        continue;
      }
      throw error;
    }
    const deviation = deviationFrom(evaluate(toCoreInput(work)), probe.expect);
    outcomes.push(deviation === undefined ? { probe: probe.id, matrix_row: probe.matrix_row, outcome: 'REJECTED' } : { probe: probe.id, matrix_row: probe.matrix_row, outcome: 'SURVIVED', why: deviation });
  }
  return {
    outcomes,
    rejected: outcomes.filter((o) => o.outcome === 'REJECTED').length,
    not_rejected: outcomes.filter((o) => o.outcome === 'SURVIVED').length,
    not_applicable: outcomes.filter((o) => o.outcome === 'NOT_APPLICABLE').length,
  };
}

