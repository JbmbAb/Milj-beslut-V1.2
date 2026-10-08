/**
 * C1 -- strict manifest schema (contract 3.2, 3.4, 5.1, 5.6).
 *
 * Fixed order inside C1: (a) structure and value kinds; (b) forbidden provider identity; (c) unresolved /
 * placeholder; (d) formats. Closed keys everywhere; no null, array, float or boolean; absence of an identity is
 * expressed only through `posture` (and the omission of `max_seq_length`).
 */
import { HEX40, HEX64, IDENTIFIER, hasExactKeys, hasOwn, isRecord, isSafeInt, type Rec } from './json';
import { isUnresolvedPlaceholder, matchesForbiddenProviderIdentity } from './identityScan';
import { FAILURE, MANIFEST_CONTRACT_VERSION, MANIFEST_TYPE } from './vocabulary';

type Kind = 'string' | 'int';
interface Leaf {
  readonly kind: Kind;
  readonly format: (v: unknown) => boolean;
}

const str = (format: (v: string) => boolean): Leaf => ({ kind: 'string', format: (v) => typeof v === 'string' && format(v) });
const int = (): Leaf => ({ kind: 'int', format: (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 });

const hex40 = str((v) => HEX40.test(v));
const hex64 = str((v) => HEX64.test(v));
const ident = str((v) => IDENTIFIER.test(v));
const exactly = (expected: string): Leaf => str((v) => v === expected);
const artifactId = str((v) => /^product-release-[0-9a-f]{24}$/.test(v));

interface ObjectSpec {
  readonly required: Readonly<Record<string, Leaf>>;
  readonly optional?: Readonly<Record<string, Leaf>>;
}

const BLOCKS: Readonly<Record<string, ObjectSpec>> = {
  candidate: { required: { commit_sha: hex40, tree_sha: hex40 } },
  release: { required: { artifact_id: artifactId, contract_version: ident, release_hash_sha256: hex64 } },
  zero_google: { required: { evidence_sha256: hex64 } },
  embedding: {
    required: {
      contract_version: ident,
      pipeline_key: ident,
      model_id: ident,
      model_revision: hex40,
      pipeline_version: ident,
      dimension: int(),
      normalization: ident,
      query_prefix_sha256: hex64,
      passage_prefix_sha256: hex64,
      pipeline_spec_sha256: hex64,
      snapshot_manifest_sha256: hex64,
      registry_sha256: hex64,
      admission_sha256: hex64,
      selection_decision_sha256: hex64,
      evidence_sha256: hex64,
    },
    optional: { max_seq_length: int() },
  },
  schema: {
    required: {
      prisma_schema_blob_sha1: hex40,
      migration_id: ident,
      migration_sql_sha256: hex64,
      table: ident,
      vector_dimension: int(),
      approval_sha256: hex64,
      evidence_sha256: hex64,
    },
  },
};

const POSTURE_BOUND = 'BOUND';
const POSTURE_ABSENT = 'DECLARED_ABSENT';

const GENERATION_BOUND: ObjectSpec = {
  required: {
    posture: exactly(POSTURE_BOUND),
    runtime_id: ident,
    runtime_implementation_sha256: hex64,
    runtime_config_sha256: hex64,
    model_id: ident,
    model_version: ident,
    model_snapshot_manifest_sha256: hex64,
    generation_contract_version: ident,
    port_source_blob_sha1: hex40,
    evidence_sha256: hex64,
  },
};
const GENERATION_ABSENT: ObjectSpec = { required: { posture: exactly(POSTURE_ABSENT), evidence_sha256: hex64 } };
/** Posture present but not one of the two values: shape cannot be chosen; every field must still be a plain value. */
const GENERATION_UNDETERMINED: ObjectSpec = {
  required: { posture: exactly(POSTURE_BOUND) },
  optional: { ...GENERATION_BOUND.required },
};

interface FoundLeaf {
  readonly value: unknown;
  readonly leaf: Leaf;
}

const specOf = (spec: ObjectSpec): Record<string, Leaf> => ({ ...spec.required, ...(spec.optional ?? {}) });

function collect(value: unknown, spec: ObjectSpec, found: FoundLeaf[]): boolean {
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, Object.keys(spec.required), Object.keys(spec.optional ?? {}))) return false;
  const all = specOf(spec);
  for (const key of Object.keys(value)) {
    const leaf = all[key]!;
    const v = value[key];
    if (leaf.kind === 'string' ? typeof v !== 'string' : !isSafeInt(v)) return false;
    found.push({ value: v, leaf });
  }
  return true;
}

export interface ManifestSchemaPass {
  readonly ok: true;
  readonly manifest: Rec;
}
export interface ManifestSchemaFail {
  readonly ok: false;
  readonly code: string;
}

export function validateManifestSchema(parsed: unknown, extraForbiddenPatterns: readonly string[]): ManifestSchemaPass | ManifestSchemaFail {
  const fail = (code: string): ManifestSchemaFail => ({ ok: false, code });
  const found: FoundLeaf[] = [];

  // (a) structure and value kinds
  if (!isRecord(parsed)) return fail(FAILURE.manifest_schema_invalid);
  const topKeys = ['manifest_type', 'contract_version', ...Object.keys(BLOCKS), 'generation'];
  if (!hasExactKeys(parsed, topKeys)) return fail(FAILURE.manifest_schema_invalid);
  if (typeof parsed.manifest_type !== 'string' || typeof parsed.contract_version !== 'string') return fail(FAILURE.manifest_schema_invalid);
  found.push({ value: parsed.manifest_type, leaf: exactly(MANIFEST_TYPE) }, { value: parsed.contract_version, leaf: exactly(MANIFEST_CONTRACT_VERSION) });
  for (const [name, spec] of Object.entries(BLOCKS)) {
    if (!collect(parsed[name], spec, found)) return fail(FAILURE.manifest_schema_invalid);
  }
  const generation = parsed.generation;
  if (!isRecord(generation) || !hasOwn(generation, 'posture') || typeof generation.posture !== 'string') {
    return fail(FAILURE.manifest_schema_invalid);
  }
  const generationSpec =
    generation.posture === POSTURE_BOUND ? GENERATION_BOUND : generation.posture === POSTURE_ABSENT ? GENERATION_ABSENT : GENERATION_UNDETERMINED;
  if (!collect(generation, generationSpec, found)) return fail(FAILURE.manifest_schema_invalid);

  // (b) forbidden provider identity -- every manifest string
  for (const f of found) {
    if (typeof f.value === 'string' && matchesForbiddenProviderIdentity(f.value, extraForbiddenPatterns)) {
      return fail(FAILURE.forbidden_provider_identity);
    }
  }
  // (c) unresolved / placeholder
  for (const f of found) {
    if (typeof f.value === 'string' && isUnresolvedPlaceholder(f.value)) return fail(FAILURE.manifest_unresolved_identity);
  }
  // (d) formats (hex lengths, identifier charset = ASCII only, constants, non-negative integers)
  for (const f of found) {
    if (!f.leaf.format(f.value)) return fail(FAILURE.manifest_schema_invalid);
  }
  return { ok: true, manifest: parsed };
}
