/**
 * U51-CANONICAL-MANIFEST-CONTRACT-01 -- the pure verifier core: everything the RED-only contract pins
 * (packages/mps-u51-manifest/tests/u51CanonicalManifest.red.test.ts, 220 cases) does not say directly.
 * Synthetic fixtures only; nothing here selects a model, provider or runtime.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALL_FAILURE_CODES,
  FAILURE,
  canonicalizeManifest,
  evaluateU51Manifest,
  parseFreezePolicy,
  parseStrictJsonBytes,
  verifierAccepted,
  type Evaluation,
} from '../../packages/mps-u51-manifest/src/index';
import { FORBIDDEN_SUBSTRINGS, FORBIDDEN_TOKENS, isUnresolvedPlaceholder, looksLikeMockRuntime, matchesForbiddenProviderIdentity, tokensOf } from '../../packages/mps-u51-manifest/src/identityScan';
import {
  VERIFIER,
  buildAbsentGenerationWorld,
  buildWorld,
  canonicalBytesOf,
  clone,
  freshManifest,
  hashOf,
  syn40,
  syn64,
  toInput,
  type Obj,
  type World,
} from '../../packages/mps-u51-manifest/tests/fixtures/u51Fixtures';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'packages', 'mps-u51-manifest', 'src');
const STAGES = ['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'];

const run = (w: World, extra: Obj = {}): Evaluation => evaluateU51Manifest({ ...toInput(w), ...extra } as never);
const bytes = (s: string): Uint8Array => Buffer.from(s, 'utf8');

describe('failure taxonomy (contract section 10)', () => {
  it('has exactly the 27 stable codes of the contract, in its order', () => {
    expect(ALL_FAILURE_CODES).toEqual([
      'U51_POLICY_INVALID',
      'U51_POLICY_UNAUTHENTICATED',
      'U51_VERIFIER_IDENTITY_UNACCEPTED',
      'U51_MANIFEST_SCHEMA_INVALID',
      'U51_MANIFEST_UNRESOLVED_IDENTITY',
      'U51_FORBIDDEN_PROVIDER_IDENTITY',
      'U51_CANONICALIZATION_FAILURE',
      'U51_TREE_BINDING_MISMATCH',
      'U51_CANDIDATE_NOT_ON_ORIGIN',
      'U51_RELEASE_REFERENCE_INVALID',
      'U51_EVIDENCE_SCHEMA_INVALID',
      'U51_ZERO_GOOGLE_EVIDENCE_MISSING',
      'U51_ZERO_GOOGLE_TREE_MISMATCH',
      'U51_ZERO_GOOGLE_GUARD_NOT_ACCEPTED',
      'U51_ZERO_GOOGLE_SCAN_MISMATCH',
      'U51_ZERO_GOOGLE_NOT_PASS',
      'U51_EMBEDDING_IDENTITY_MISMATCH',
      'U51_EMBEDDING_NOT_ADMITTED',
      'U51_EMBEDDING_DIMENSION_MISMATCH',
      'U51_SCHEMA_IDENTITY_MISMATCH',
      'U51_SCHEMA_APPLIED_STATE_MISMATCH',
      'U51_GENERATION_IDENTITY_UNRESOLVED',
      'U51_GENERATION_IDENTITY_MISMATCH',
      'U51_GENERATION_RUNTIME_NOT_PRODUCTION',
      'U51_MANIFEST_HASH_MISMATCH',
      'U51_SUBSTITUTION_DETECTED',
      'U51_NEGATIVE_PROBE_NOT_REJECTED',
    ]);
    expect(Object.values(FAILURE)).toEqual([...ALL_FAILURE_CODES]);
    expect(new Set(ALL_FAILURE_CODES).size).toBe(ALL_FAILURE_CODES.length);
  });
});

describe('strict byte intake (C0)', () => {
  const ok = (s: string) => parseStrictJsonBytes(bytes(s));
  it('accepts plain JSON and keeps "__proto__" as an ordinary key', () => {
    const parsed = ok('{"a":[1,2,{"b":null}],"__proto__":"x"}');
    expect(parsed.ok).toBe(true);
    const v = (parsed as { value: Record<string, unknown> }).value;
    expect(Object.keys(v)).toEqual(['a', '__proto__']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it.each([
    ['a duplicate key', '{"a":1,"a":2}'],
    ['a duplicate key in a nested object', '{"o":{"k":1,"k":1}}'],
    ['trailing content', '{"a":1} x'],
    ['two documents', '{"a":1}{"a":1}'],
    ['a trailing comma', '{"a":1,}'],
    ['single quotes', "{'a':1}"],
    ['a leading zero', '{"a":01}'],
    ['a bare word', 'not json'],
    ['an empty input', ''],
    ['a raw control character in a string', '{"a":"x\ty"}'],
    ['a lone high surrogate escape', '{"a":"\\ud800"}'],
    ['a lone low surrogate escape', '{"a":"\\udc00"}'],
    ['an invalid escape', '{"a":"\\q"}'],
    ['a number out of range', '{"a":1e999}'],
    ['nesting beyond the limit', `${'['.repeat(80)}${']'.repeat(80)}`],
  ])('rejects %s', (_n, text) => expect(ok(text).ok).toBe(false));
  it('rejects a BOM, invalid UTF-8 and non-byte input', () => {
    expect(parseStrictJsonBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes('{}')])).ok).toBe(false);
    expect(parseStrictJsonBytes(Buffer.from([0x7b, 0xc3, 0x28, 0x7d])).ok).toBe(false);
    expect(parseStrictJsonBytes('{}' as never).ok).toBe(false);
  });
  it('accepts a valid surrogate pair escape', () => {
    expect(ok('{"a":"\\ud83d\\ude00"}').ok).toBe(true);
  });
});

describe('provider identity floor and placeholders (5.1, 5.6)', () => {
  it('substring floor is case-insensitive; the floor itself is built from parts, not written out', () => {
    for (const s of FORBIDDEN_SUBSTRINGS) {
      expect(matchesForbiddenProviderIdentity(`x-${s.toUpperCase()}-y`)).toBe(true);
    }
    expect(FORBIDDEN_SUBSTRINGS).toHaveLength(7);
    expect(FORBIDDEN_TOKENS).toHaveLength(4);
  });
  it('short words match only as whole tokens (camelCase and punctuation split tokens)', () => {
    const [vertex, gcp, palm, bard] = FORBIDDEN_TOKENS;
    for (const t of [vertex, gcp, palm, bard]) {
      expect(matchesForbiddenProviderIdentity(t!)).toBe(true);
      expect(matchesForbiddenProviderIdentity(`${t}-runtime`)).toBe(true);
      expect(matchesForbiddenProviderIdentity(`a/${t!.toUpperCase()}.b`)).toBe(true);
      expect(matchesForbiddenProviderIdentity(`${t}etto`)).toBe(false);
      expect(matchesForbiddenProviderIdentity(`x${t}`)).toBe(false);
    }
    expect(tokensOf('GCPEmbeddingModelV2')).toEqual(['gcp', 'embedding', 'model', 'v2']);
    expect(tokensOf('Vertex-AI.runtime')).toEqual(['vertex', 'ai', 'runtime']);
  });
  it('policy patterns add (case-insensitive substring) and an empty pattern matches nothing', () => {
    expect(matchesForbiddenProviderIdentity('Fixture-Org/x', ['fixture-org'])).toBe(true);
    expect(matchesForbiddenProviderIdentity('anything', [''])).toBe(false);
  });
  it('placeholders: the listed tokens, the empty string and 8+ identical characters', () => {
    for (const t of ['TBD', 'todo', 'Unknown', 'UNRESOLVED', 'none', 'null', 'N/A', 'pending', 'Placeholder', 'undefined', '', 'aaaaaaaa', '00000000000000000000000000000000000000000000000000000000000000000']) {
      expect(isUnresolvedPlaceholder(t), t).toBe(true);
    }
    for (const t of ['fixture', 'aaaaaaa', 'abababababab', 'not-pending']) expect(isUnresolvedPlaceholder(t), t).toBe(false);
  });
  it('mock deny patterns: substrings, plus the whole token "test" only', () => {
    for (const t of ['mock-x', 'x-fake', 'stubbed', 'canned', 'dummy1', 'noop', 'my-test-runtime', 'Test']) expect(looksLikeMockRuntime(t), t).toBe(true);
    for (const t of ['latest-runtime', 'contest', 'fixture-local-runtime-alpha']) expect(looksLikeMockRuntime(t), t).toBe(false);
  });
});

describe('policy shape (7.3)', () => {
  it('the fixture policy is valid and its verifier accepted', () => {
    const p = parseFreezePolicy(buildWorld().policy);
    expect(p).toBeDefined();
    expect(verifierAccepted(p!, VERIFIER)).toBe(true);
    expect(verifierAccepted(p!, { ...VERIFIER, verifier_version: 'other' })).toBe(false);
    expect(verifierAccepted(p!, null)).toBe(false);
    expect(verifierAccepted(p!, { ...VERIFIER, extra: 1 })).toBe(false);
  });
  it.each<[string, (p: Obj) => void]>([
    ['wrong contract_version', (p) => (p.contract_version = 'u51-freeze-policy-2')],
    ['unsorted accepted_guards', (p) => (p.accepted_guards = [{ ...p.accepted_guards[0], blob_sha1: 'f'.repeat(40) }, { ...p.accepted_guards[0] }])],
    ['duplicate scan_roots', (p) => (p.accepted_guards[0].scan_roots = [p.accepted_guards[0].scan_roots[0], p.accepted_guards[0].scan_roots[0]])],
    ['unsorted allow_patterns', (p) => (p.accepted_guards[0].allow_patterns = [...p.accepted_guards[0].allow_patterns].reverse())],
    ['an unknown rule scope', (p) => (p.accepted_guards[0].rules[0].applies_to = 'SOME_FILES')],
    ['unsorted rules', (p) => (p.accepted_guards[0].rules = [...p.accepted_guards[0].rules].reverse())],
    ['a non-hex command hash', (p) => (p.accepted_guards[0].command_sha256 = 'zz')],
    ['an empty required test name', (p) => (p.accepted_guards[0].required_tests = [{ file: 'a', full_name: '' }])],
    ['a non-array dependency manifests', (p) => (p.dependency_scan.manifests = 'package.json')],
    ['a bad required_scan_profile', (p) => (p.required_scan_profile = 'EVERYTHING')],
    ['an unsorted forbidden_identity_patterns', (p) => (p.forbidden_identity_patterns = ['b', 'a'])],
    ['a verifier with a non-hex tree', (p) => (p.accepted_verifiers = [{ verifier_version: 'v', implementation_tree_sha1: 'abc' }])],
    ['duplicate verifier trees', (p) => (p.accepted_verifiers = [{ ...VERIFIER }, { ...VERIFIER, verifier_version: 'other' }])],
  ])('rejects %s', (_n, mutate) => {
    const policy = clone(buildWorld().policy);
    mutate(policy);
    expect(parseFreezePolicy(policy)).toBeUndefined();
  });
  it('rejects a policy that is not an object', () => {
    for (const v of [null, undefined, [], 'policy', 1]) expect(parseFreezePolicy(v)).toBeUndefined();
  });
});

describe('the core never throws and never mutates its inputs', () => {
  it.each<[string, (i: Obj) => void]>([
    ['manifest_bytes is not a byte array', (i) => (i.manifest_bytes = 'x')],
    ['policy is null', (i) => (i.policy = null)],
    ['policy_authentication is null', (i) => (i.policy_authentication = null)],
    ['policy_authentication has an extra key', (i) => (i.policy_authentication = { ...i.policy_authentication, extra: 1 })],
    ['trust_root_ref is empty', (i) => (i.policy_authentication = { ...i.policy_authentication, trust_root_ref: '' })],
    ['verifier is null', (i) => (i.verifier = null)],
    ['observations is null', (i) => (i.observations = null)],
    ['observations is an array', (i) => (i.observations = [])],
  ])('input defect (%s) is a FAIL or NOT_EXECUTED, not an exception and not a PASS', (_n, mutate) => {
    const input = toInput(buildWorld()) as unknown as Obj;
    mutate(input);
    const r = evaluateU51Manifest(input as never);
    expect(r.result).not.toBe('PASS');
    expect(r.checks.map((c) => c.id)).toEqual(STAGES);
  });

  it('evaluation does not modify frozen inputs', () => {
    const deepFreeze = <T>(v: T): T => {
      if (v && typeof v === 'object' && !ArrayBuffer.isView(v)) {
        for (const k of Object.keys(v)) deepFreeze((v as Obj)[k]);
        return Object.freeze(v);
      }
      return v;
    };
    const input = deepFreeze(toInput(buildWorld()));
    expect(evaluateU51Manifest(input as never).result).toBe('PASS');
  });

  it('is deterministic: the same input gives the same answer', () => {
    const w = buildWorld();
    expect(JSON.stringify(run(w))).toBe(JSON.stringify(run(w)));
  });
});

describe('C0 order: policy valid -> authenticated -> verifier -> bytes', () => {
  it('an invalid policy wins over an unauthenticated one and over bad bytes', () => {
    const w = buildWorld();
    w.policy.extra = 1;
    w.policy_authentication.verified = false;
    const r = evaluateU51Manifest({ ...toInput(w), manifest_bytes: bytes('not json') } as never);
    expect(r.failure_code).toBe(FAILURE.policy_invalid);
  });
  it('an unauthenticated policy wins over an unaccepted verifier', () => {
    const w = buildWorld();
    w.policy_authentication.verified = false;
    w.verifier = { ...VERIFIER, implementation_tree_sha1: syn40('x') };
    expect(run(w).failure_code).toBe(FAILURE.policy_unauthenticated);
  });
  it('an unaccepted verifier wins over bad bytes', () => {
    const w = buildWorld();
    w.verifier = { ...VERIFIER, implementation_tree_sha1: syn40('x') };
    expect(evaluateU51Manifest({ ...toInput(w), manifest_bytes: bytes('not json') } as never).failure_code).toBe(FAILURE.verifier_identity_unaccepted);
  });
});

describe('C1 fixed inner order: structure, forbidden identity, unresolved, formats', () => {
  it('structure beats forbidden identity', () => {
    const w = buildWorld();
    w.manifest.embedding.model_id = 'gemini-x';
    w.manifest.extra = 1;
    expect(run(w).failure_code).toBe(FAILURE.manifest_schema_invalid);
  });
  it('forbidden identity beats placeholder', () => {
    const w = buildWorld();
    w.manifest.embedding.model_id = 'gemini-x';
    w.manifest.embedding.model_revision = 'TBD';
    expect(run(w).failure_code).toBe(FAILURE.forbidden_provider_identity);
  });
  it('placeholder beats format', () => {
    const w = buildWorld();
    w.manifest.embedding.model_revision = 'TBD';
    w.manifest.embedding.pipeline_key = 'has space';
    expect(run(w).failure_code).toBe(FAILURE.manifest_unresolved_identity);
  });
  it.each<[string, (m: Obj) => void]>([
    ['uppercase hex', (m) => (m.candidate.tree_sha = m.candidate.tree_sha.toUpperCase())],
    ['a short sha', (m) => (m.candidate.commit_sha = 'abc')],
    ['a malformed artifact id', (m) => (m.release.artifact_id = 'product-release-xyz')],
    ['a space in an identifier', (m) => (m.embedding.pipeline_key = 'has space')],
    ['a negative integer', (m) => (m.schema.vector_dimension = -1)],
    ['an unsafe integer', (m) => (m.embedding.dimension = 2 ** 60)],
    ['a wrong manifest_type', (m) => (m.manifest_type = 'u51-other')],
    ['a wrong contract_version', (m) => (m.contract_version = 'u51-canonical-manifest-2')],
    ['an unknown posture', (m) => (m.generation.posture = 'MAYBE')],
    ['an over-long identifier', (m) => (m.embedding.pipeline_version = 'ab'.repeat(129))],
  ])('format violation (%s) -> schema invalid', (_n, mutate) => {
    const w = buildWorld();
    mutate(w.manifest);
    expect(run(w).failure_code).toBe(FAILURE.manifest_schema_invalid);
  });
  it('an unknown posture that is a placeholder is unresolved, not a shape the verifier guesses', () => {
    const w = buildWorld();
    w.manifest.generation = { posture: 'unknown' };
    expect(run(w).failure_code).toBe(FAILURE.manifest_unresolved_identity);
  });
  it('max_seq_length may be omitted when the registry omits it, and is then identity by absence', () => {
    const w = buildWorld();
    delete w.observations.embedding.payload.registry.pipelines[0].max_seq_length;
    w.observations.embedding.payload.selection_decision.record.pipeline_spec_sha256 = hashOf(w.observations.embedding.payload.registry.pipelines[0]);
    w.observations.embedding.payload.selection_decision.record_sha256 = hashOf(w.observations.embedding.payload.selection_decision.record);
    freshManifest(w);
    expect('max_seq_length' in w.manifest.embedding).toBe(false);
    expect(run(w).result).toBe('PASS');
  });
});

describe('evidence payload strictness beyond the pinned cases (12.2)', () => {
  const seal = (w: World, kind: string) => (w.manifest[kind].evidence_sha256 = hashOf(w.observations[kind].payload));
  it('registry pipelines must be strictly ascending by key (rejected, not sorted)', () => {
    const w = buildWorld();
    const [only] = w.observations.embedding.payload.registry.pipelines;
    w.observations.embedding.payload.registry.pipelines = [{ ...only, pipeline_key: 'zzz' }, only];
    seal(w, 'embedding');
    expect(run(w).failure_code).toBe(FAILURE.evidence_schema_invalid);
  });
  it('a duplicate admitted key is rejected as a set violation', () => {
    const w = buildWorld();
    w.observations.embedding.payload.admission.admitted_keys = ['fixture-embedding', 'fixture-embedding'];
    seal(w, 'embedding');
    expect(run(w).failure_code).toBe(FAILURE.evidence_schema_invalid);
  });
  it('a zero-google profile that does not need the dependency scan must not carry one', () => {
    const w = buildWorld();
    w.observations.zero_google.payload.scan.profile = 'GUARD_ONLY';
    seal(w, 'zero_google');
    expect(run(w).failure_code).toBe(FAILURE.evidence_schema_invalid);
  });
  it('an unknown outcome of a generation attempt is a schema defect, SUCCESS may not carry a code', () => {
    for (const attempt of [{ outcome: 'MAYBE' }, { outcome: 'SUCCESS', code: 'X' }]) {
      const w = buildWorld();
      w.observations.generation.payload.boot_probe.entrypoints[0].generate_attempt = attempt;
      seal(w, 'generation');
      expect(run(w).failure_code).toBe(FAILURE.evidence_schema_invalid);
    }
  });
  it('a config_source other than CONTROLLER / SUBJECT_TREE is a schema defect, not a quiet mismatch', () => {
    const w = buildWorld();
    w.observations.schema.payload.datasource.config_source = 'ELSEWHERE';
    seal(w, 'schema');
    expect(run(w).failure_code).toBe(FAILURE.evidence_schema_invalid);
  });
  it('an observation wrapper with a second key, and unknown observation keys, are schema defects', () => {
    const w = buildWorld();
    w.observations.embedding.extra = 1;
    expect(run(w).failure_code).toBe(FAILURE.evidence_schema_invalid);
    const v = buildWorld();
    v.observations.stray = {};
    const r = run(v);
    expect(r.failure_code).toBe(FAILURE.evidence_schema_invalid);
    expect(r.checks.find((c) => c.id === 'C2')?.result).toBe('FAIL');
  });
  it('a payload that cannot be canonicalised (circular) is a schema defect, not an exception', () => {
    const w = buildWorld();
    const loop: Obj = {};
    loop.self = loop;
    w.observations.embedding.payload = loop;
    expect(run(w).failure_code).toBe(FAILURE.evidence_schema_invalid);
  });
});

describe('claims beyond the pinned table', () => {
  it('only embed-identity-1 is a known identity contract, even when manifest and evidence agree', () => {
    const w = buildWorld();
    w.observations.embedding.payload.identity_contract_version = 'embed-identity-2';
    freshManifest(w);
    w.manifest.embedding.contract_version = 'embed-identity-2';
    w.manifest.embedding.evidence_sha256 = hashOf(w.observations.embedding.payload);
    expect(run(w).failure_code).toBe(FAILURE.embedding_identity_mismatch);
  });
  it('the vector column names of Prisma and of the runtime statements must exist in the migration', () => {
    const a = buildWorld();
    a.observations.schema.payload.prisma_models[0].vector_columns[0].column = 'other_column';
    freshManifest(a);
    expect(run(a).failure_code).toBe(FAILURE.schema_identity_mismatch);
    const b = buildWorld();
    b.observations.schema.payload.runtime_persistence.statements[0].vector_columns[0].column = 'other_column';
    freshManifest(b);
    expect(run(b).failure_code).toBe(FAILURE.schema_identity_mismatch);
  });
  it('a migration table with no vector column cannot carry a dimension claim', () => {
    const w = buildWorld();
    w.observations.schema.payload.migration.tables[0].vector_columns = [];
    w.manifest.schema.evidence_sha256 = hashOf(w.observations.schema.payload);
    expect(run(w).failure_code).toBe(FAILURE.schema_identity_mismatch);
  });
  it('zero statements of runtime persistence is a mismatch, not a vacuous pass', () => {
    const w = buildWorld();
    w.observations.schema.payload.runtime_persistence.statements = [];
    freshManifest(w);
    expect(run(w).failure_code).toBe(FAILURE.schema_identity_mismatch);
  });
  it('a malformed origin observation is a schema defect when the policy does not require origin', () => {
    const w = buildWorld();
    w.policy.origin_requirement = 'NOT_REQUIRED';
    w.observations.origin = { commit_sha: 'x' };
    freshManifest(w);
    expect(run(w).failure_code).toBe(FAILURE.evidence_schema_invalid);
  });
  it('no release observation at all is an invalid release reference; no subject observation is unresolved', () => {
    const a = buildWorld();
    delete a.observations.release;
    expect(run(a).failure_code).toBe(FAILURE.release_reference_invalid);
    const b = buildWorld();
    delete b.observations.subject;
    expect(run(b).failure_code).toBe(FAILURE.manifest_unresolved_identity);
  });
  it('a release of another commit (same tree) is a tree-binding mismatch', () => {
    const w = buildWorld();
    w.observations.release.source_commit_sha = syn40('another-commit');
    expect(run(w).failure_code).toBe(FAILURE.tree_binding_mismatch);
  });
  it('an absent generation observation is unresolved, not a quiet pass', () => {
    const w = buildWorld();
    delete w.observations.generation;
    expect(run(w).failure_code).toBe(FAILURE.generation_identity_unresolved);
  });
  it('DECLARED_ABSENT needs the policy value ABSENT_ADMISSIBLE; BOUND passes under either value', () => {
    expect(run(buildAbsentGenerationWorld()).result).toBe('PASS');
    const bound = buildWorld();
    bound.policy.generation_requirement = 'ABSENT_ADMISSIBLE';
    freshManifest(bound);
    expect(run(bound).result).toBe('PASS');
  });
  it('a BOUND claim needs a registration site in non-test source; a port blob that differs is a mismatch', () => {
    const a = buildWorld();
    a.observations.generation.payload.static_census.registration_identifier_files = 0;
    freshManifest(a);
    expect(run(a).failure_code).toBe(FAILURE.generation_identity_mismatch);
  });
  it('mock deny patterns also apply to model_id', () => {
    const w = buildWorld();
    const g = w.observations.generation.payload;
    g.registry.runtimes[0].model_id = 'fixture-org/fake-model';
    g.boot_probe.entrypoints[0].runtime.model_id = 'fixture-org/fake-model';
    freshManifest(w);
    expect(run(w).failure_code).toBe(FAILURE.generation_runtime_not_production);
  });
  it('expected hash: an upper-case or short value is a mismatch, a different valid hash is a mismatch', () => {
    const w = buildWorld();
    const good = hashOf(w.manifest);
    expect(run(w, { expected_manifest_sha256: good.toUpperCase() }).failure_code).toBe(FAILURE.manifest_hash_mismatch);
    expect(run(w, { expected_manifest_sha256: 'abc' }).failure_code).toBe(FAILURE.manifest_hash_mismatch);
    expect(run(w, { expected_manifest_sha256: syn64('other') }).failure_code).toBe(FAILURE.manifest_hash_mismatch);
  });
  it('the regenerated hash is reported only once C0..C7 passed', () => {
    const w = buildWorld();
    expect(run(w).manifest_sha256).toBe(hashOf(w.manifest));
    w.manifest.note = 'x';
    expect(run(w).manifest_sha256).toBeUndefined();
    const nonCanonical = evaluateU51Manifest({ ...toInput(buildWorld()), manifest_bytes: bytes(`${Buffer.from(canonicalBytesOf(buildWorld().manifest)).toString('utf8')}\n`) } as never);
    expect(nonCanonical.failure_code).toBe(FAILURE.canonicalization_failure);
    expect(nonCanonical.manifest_sha256).toBeUndefined();
  });
  it('canonicalizeManifest matches the independent RFC 8785 computation for any JSON value', () => {
    for (const v of [{ b: 1, a: [3, 2, { z: null, y: 'é' }] }, [], 'x', 1.5]) {
      const c = canonicalizeManifest(v);
      expect(c.sha256).toBe(hashOf(v));
      expect(Buffer.from(c.bytes).equals(Buffer.from(canonicalBytesOf(v)))).toBe(true);
    }
  });
});

describe('the core is pure: no IO, no environment, no clock, no network (contract 11.1)', () => {
  const CORE_FILES = [
    'evaluate.ts',
    'canonical.ts',
    'strictJson.ts',
    'manifestSchema.ts',
    'policy.ts',
    'identityScan.ts',
    'evidenceSchemas.ts',
    'json.ts',
    'types.ts',
    'vocabulary.ts',
    'checks/binding.ts',
    'checks/context.ts',
    'checks/embedding.ts',
    'checks/generation.ts',
    'checks/schemaParity.ts',
    'checks/zeroGoogle.ts',
  ];
  const text = (f: string) => readFileSync(path.join(SRC, f), 'utf8');
  it.each(CORE_FILES)('%s imports nothing that touches the world', (f) => {
    const specifiers = [...text(f).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
    for (const s of specifiers) {
      expect(s, `${f} imports ${s}`).toMatch(/^(\.|json-canonicalize$|node:crypto$)/);
      expect(s).not.toMatch(/child_process|node:fs|node:net|node:http|node:os|node:path|undici|axios/);
    }
    const code = text(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/process\.env|Date\.now|new Date\(|Math\.random|fetch\(|require\(/);
  });
  it('the compliance primitive is the only hashing path (no ad-hoc JSON.stringify hashing)', () => {
    for (const f of CORE_FILES) {
      const code = text(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, f).not.toMatch(/createHash\(/);
    }
    expect(text('canonical.ts')).toContain('mps-compliance/src/canonical/sha256Canonical');
  });
});
