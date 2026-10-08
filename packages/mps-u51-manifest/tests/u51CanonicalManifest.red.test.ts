/**
 * U51-CANONICAL-MANIFEST-CONTRACT-01 (R2) -- RED-ONLY contract pins.
 *
 * STATUS: every test outside the group "fixture self-check" is EXPECTED TO FAIL until the verifier
 * core (packages/mps-u51-manifest/src/index.ts) exists. It fails with the single, stable reason
 * `U51_CONTRACT_NOT_IMPLEMENTED`; a different failure reason is a defect in these tests.
 *
 * What this file is NOT: it is not a proof, not a verification, and it never produces a GREEN
 * U51 result. It cannot freeze a manifest. A core PASS is NOT "FREEZE_ELIGIBLE": that needs the
 * runner's C9 (negative probes) and C10 (evidence emission). The only tests that can pass today are
 * in the group "fixture self-check (NOT a U51 result)"; they check the fixtures against the
 * repository's own canonical-hash primitives and say nothing about U51.
 *
 * Run (not part of default discovery):
 *   npx vitest run --config packages/mps-u51-manifest/vitest.red.config.mjs
 *
 * Normative text: docs/architecture/U51-CANONICAL-MANIFEST-CONTRACT-01.md (section numbers in titles).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BLOCKER,
  GENERATION_RUNTIME,
  GOLDEN_BASE_MANIFEST_SHA256,
  GUARD_BLOB_ACCEPTED,
  GUARD_BLOB_OTHER,
  GUARD_ENTRY,
  GUARD_PATH,
  GUARD_TEST_FULL_NAME,
  TABLE,
  TREE_B,
  VERIFIER,
  buildAbsentGenerationWorld,
  buildWorld,
  canonicalBytesOf,
  clone,
  freshManifest,
  hashOf,
  sha256Hex,
  syn40,
  syn64,
  toInput,
  type EvaluateInput,
  type Obj,
  type World,
} from './fixtures/u51Fixtures';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IMPLEMENTATION = path.resolve(HERE, '../src/index.ts');
const STAGES = ['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'];

interface Check {
  id: string;
  result: 'PASS' | 'FAIL' | 'NOT_EXECUTED';
  code?: string;
}
interface Evaluation {
  result: 'PASS' | 'FAIL' | 'NOT_EXECUTED';
  failure_code?: string;
  manifest_sha256?: string;
  checks: Check[];
}
interface Implementation {
  evaluateU51Manifest(input: EvaluateInput): Evaluation;
  canonicalizeManifest(value: unknown): { bytes: Uint8Array; sha256: string };
}

async function loadImplementation(): Promise<Implementation> {
  if (!fs.existsSync(IMPLEMENTATION)) {
    throw new Error(`U51_CONTRACT_NOT_IMPLEMENTED: ${path.relative(process.cwd(), IMPLEMENTATION)} does not exist`);
  }
  return (await import(/* @vite-ignore */ pathToFileURL(IMPLEMENTATION).href)) as Implementation;
}

async function evaluate(world: World, extra: Partial<EvaluateInput> = {}): Promise<Evaluation> {
  const impl = await loadImplementation();
  return impl.evaluateU51Manifest({ ...toInput(world), ...extra });
}

async function evaluateBytes(world: World, bytes: Uint8Array): Promise<Evaluation> {
  const impl = await loadImplementation();
  return impl.evaluateU51Manifest({ ...toInput(world), manifest_bytes: bytes });
}

/**
 * The contract (fail-fast): the first failing check wins. Every check BEFORE the failing stage must have PASSED
 * (so the case really reaches the intended stage and is not rejected earlier for another reason), the failing
 * stage reports the exact code, and every later check is NOT_EXECUTED.
 */
function expectRejected(r: Evaluation, code: string, stage: string): void {
  expect(r.result).toBe('FAIL');
  expect(r.failure_code).toBe(code);
  expect(r.checks.map((c) => c.id)).toEqual(STAGES);
  const idx = STAGES.indexOf(stage);
  r.checks.forEach((c, i) => {
    if (i < idx) expect(c.result, `check ${c.id} must PASS before ${stage}`).toBe('PASS');
    else if (i === idx) {
      expect(c.result).toBe('FAIL');
      expect(c.code).toBe(code);
    } else expect(c.result, `check ${c.id} must be NOT_EXECUTED after ${stage}`).toBe('NOT_EXECUTED');
  });
}

/** A comparison that could not be made is NOT_EXECUTED and can never be reported as PASS (sec 7.2, 11.1). */
function expectNotExecutedAt(r: Evaluation, stage: string): void {
  expect(r.result).toBe('NOT_EXECUTED');
  expect(r.failure_code).toBeUndefined();
  const idx = STAGES.indexOf(stage);
  r.checks.forEach((c, i) => expect(c.result).toBe(i < idx ? 'PASS' : 'NOT_EXECUTED'));
}

/** Re-derives every manifest claim (and the policy hash) from the mutated inputs, so only the intended defect remains. */
function rebind(world: World): World {
  freshManifest(world);
  return world;
}

function setPipeline(w: World, patch: Obj): World {
  const e = w.observations.embedding.payload;
  const entry: Obj = { ...e.registry.pipelines[0], ...patch };
  for (const k of Object.keys(patch)) if (patch[k] === undefined) delete entry[k];
  e.registry.pipelines = [entry];
  const record = { pipeline_key: entry.pipeline_key, pipeline_spec_sha256: hashOf(entry), decision: 'SELECTED' };
  e.selection_decision = { record, record_sha256: hashOf(record), attestation_verified: true };
  e.admission.admitted_keys = [entry.pipeline_key];
  w.observations.schema.payload.migration.tables[0].pipeline_binding_checks = [
    { name: 'fix_pipeline_chk', triples: [{ model_id: entry.model_id, model_revision: entry.model_revision, pipeline_version: entry.pipeline_version }] },
  ];
  return rebind(w);
}

function setRuntime(w: World, patch: Obj): World {
  const g = w.observations.generation.payload;
  const rt = { ...GENERATION_RUNTIME, ...patch };
  g.registry = { runtimes: [rt] };
  for (const e of g.boot_probe.entrypoints) if (e.registered_after_boot) e.runtime = { ...rt };
  return rebind(w);
}

/** After a rebind, force the manifest to keep claiming DECLARED_ABSENT (rebind would derive BOUND from a registering probe). */
function claimAbsent(w: World): World {
  w.manifest.generation = { posture: 'DECLARED_ABSENT', evidence_sha256: hashOf(w.observations.generation.payload) };
  return w;
}

/** After a rebind, keep the manifest's ORIGINAL bound-runtime claim (rebind would follow the mutated probe). */
function keepOriginalBoundClaim(w: World, original: Obj): World {
  w.manifest.generation = { ...original, evidence_sha256: hashOf(w.observations.generation.payload) };
  return w;
}

function setPath(obj: Obj, dotted: string, value: unknown): void {
  const keys = dotted.split('.');
  let cur = obj;
  for (const k of keys.slice(0, -1)) cur = cur[k];
  cur[keys[keys.length - 1]] = value;
}

const textOf = (w: World): string => Buffer.from(canonicalBytesOf(w.manifest)).toString('utf8');
const bytesOf = (s: string): Uint8Array => Buffer.from(s, 'utf8');
function reverseKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reverseKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as Obj)
        .reverse()
        .map((k) => [k, reverseKeys((v as Obj)[k])]),
    );
  }
  return v;
}

const zg = (w: World): Obj => w.observations.zero_google.payload;
const sch = (w: World): Obj => w.observations.schema.payload;
const gen = (w: World): Obj => w.observations.generation.payload;
const emb = (w: World): Obj => w.observations.embedding.payload;

describe('U51 contract (RED-only) -- expected to fail until the verifier core exists', () => {
  describe('R0 positive controls (sec 11.1): a core PASS is NOT FREEZE_ELIGIBLE (that needs runner C9 + C10)', () => {
    it('a fully consistent BOUND world is a core PASS: checks C0..C8 all PASS, hash reported', async () => {
      const r = await evaluate(buildWorld());
      expect(r.result).toBe('PASS');
      expect(r.failure_code).toBeUndefined();
      expect(r.checks.map((c) => c.id)).toEqual(STAGES);
      expect(r.checks.every((c) => c.result === 'PASS')).toBe(true);
      expect(r.manifest_sha256).toMatch(/^[0-9a-f]{64}$/);
    });
    it('a fully consistent DECLARED_ABSENT world under an ABSENT_ADMISSIBLE policy is a core PASS', async () => {
      expect((await evaluate(buildAbsentGenerationWorld())).result).toBe('PASS');
    });
    it('identifiers that merely contain a vendor-ish substring are not false positives (token-bounded, sec 5.6)', async () => {
      const w = setPipeline(buildWorld(), { model_id: 'fixture-org/palmetto-embedding-gcpcompat-vertexshader' });
      expect((await evaluate(w)).result).toBe('PASS');
    });
  });

  describe('F6 / sec 7.2, 11.1: NOT_EXECUTED semantics', () => {
    it('no expected manifest hash supplied: C8 is NOT_EXECUTED and the result is NOT_EXECUTED, never PASS', async () => {
      const r = await evaluate(buildWorld(), { expected_manifest_sha256: undefined });
      expectNotExecutedAt(r, 'C8');
      expect(r.manifest_sha256).toMatch(/^[0-9a-f]{64}$/);
    });
    it('expected hash differs from the regenerated hash -> U51_MANIFEST_HASH_MISMATCH at C8', async () => {
      expectRejected(await evaluate(buildWorld(), { expected_manifest_sha256: syn64('another-manifest') }), 'U51_MANIFEST_HASH_MISMATCH', 'C8');
    });
  });

  describe('F7 / sec 7.3, 7.5, 11.4: policy and verifier trust', () => {
    it.each<[string, (p: Obj) => void]>([
      ['unknown policy key', (p) => (p.extra = 1)],
      ['unsorted accepted_verifiers', (p) => (p.accepted_verifiers = [{ verifier_version: 'zz', implementation_tree_sha1: 'f'.repeat(40) }, { ...VERIFIER }])],
      ['duplicate accepted_release_contract_versions', (p) => (p.accepted_release_contract_versions = ['product-release-v3', 'product-release-v3'])],
      ['invalid generation_requirement enum', (p) => (p.generation_requirement = 'MAYBE')],
      ['missing origin_requirement', (p) => delete p.origin_requirement],
      ['extra key inside an accepted guard entry', (p) => (p.accepted_guards[0].note = 'free text')],
      ['invalid migration_check_binding enum', (p) => (p.migration_check_binding = 'ANY')],
    ])('malformed policy (%s) -> U51_POLICY_INVALID at C0', async (_name, mutate) => {
      const w = buildWorld();
      mutate(w.policy);
      expectRejected(await evaluate(w), 'U51_POLICY_INVALID', 'C0');
    });
    it('policy not authenticated by the trust root -> U51_POLICY_UNAUTHENTICATED at C0', async () => {
      const w = buildWorld();
      w.policy_authentication.verified = false;
      expectRejected(await evaluate(w), 'U51_POLICY_UNAUTHENTICATED', 'C0');
    });
    it('policy substituted after it was authenticated (hash differs) -> U51_POLICY_UNAUTHENTICATED at C0', async () => {
      const w = buildWorld();
      w.policy.forbidden_identity_patterns = ['weakened'];
      expectRejected(await evaluate(w), 'U51_POLICY_UNAUTHENTICATED', 'C0');
    });
    it('verifier implementation not in the accepted set -> U51_VERIFIER_IDENTITY_UNACCEPTED at C0', async () => {
      const w = buildWorld();
      w.verifier = { ...VERIFIER, implementation_tree_sha1: syn40('another-verifier') };
      expectRejected(await evaluate(w), 'U51_VERIFIER_IDENTITY_UNACCEPTED', 'C0');
    });
    it('same verifier_version but another implementation tree -> U51_VERIFIER_IDENTITY_UNACCEPTED at C0', async () => {
      const w = buildWorld();
      w.verifier = { verifier_version: VERIFIER.verifier_version, implementation_tree_sha1: syn40('lookalike') };
      expectRejected(await evaluate(w), 'U51_VERIFIER_IDENTITY_UNACCEPTED', 'C0');
    });
    it('an empty accepted-verifier set accepts nobody -> U51_VERIFIER_IDENTITY_UNACCEPTED at C0', async () => {
      const w = buildWorld();
      w.policy.accepted_verifiers = [];
      expectRejected(await evaluate(rebind(w)), 'U51_VERIFIER_IDENTITY_UNACCEPTED', 'C0');
    });
    it('extra forbidden identity patterns in the policy are applied on top of the floor -> U51_FORBIDDEN_PROVIDER_IDENTITY at C1', async () => {
      const w = buildWorld();
      w.policy.forbidden_identity_patterns = ['fixture-org'];
      expectRejected(await evaluate(rebind(w)), 'U51_FORBIDDEN_PROVIDER_IDENTITY', 'C1');
    });
    it('an empty accepted-guard set accepts no guard, so nothing can freeze -> U51_ZERO_GOOGLE_GUARD_NOT_ACCEPTED at C3', async () => {
      const w = buildWorld();
      w.policy.accepted_guards = [];
      expectRejected(await evaluate(rebind(w)), 'U51_ZERO_GOOGLE_GUARD_NOT_ACCEPTED', 'C3');
    });
  });

  describe('sec 7.3 origin reachability is a policy-defined precondition (OD-16)', () => {
    it('required and the commit is not reachable on origin -> U51_CANDIDATE_NOT_ON_ORIGIN at C2', async () => {
      const w = buildWorld();
      w.observations.origin.reachable = false;
      expectRejected(await evaluate(w), 'U51_CANDIDATE_NOT_ON_ORIGIN', 'C2');
    });
    it('required and the origin observation names another commit -> U51_CANDIDATE_NOT_ON_ORIGIN at C2', async () => {
      const w = buildWorld();
      w.observations.origin.commit_sha = syn40('some-other-commit');
      expectRejected(await evaluate(w), 'U51_CANDIDATE_NOT_ON_ORIGIN', 'C2');
    });
    it('required and no origin observation -> U51_CANDIDATE_NOT_ON_ORIGIN at C2', async () => {
      const w = buildWorld();
      delete w.observations.origin;
      expectRejected(await evaluate(w), 'U51_CANDIDATE_NOT_ON_ORIGIN', 'C2');
    });
    it('NOT_REQUIRED by the owner policy: an unreachable commit does not block (the observation is only recorded)', async () => {
      const w = buildWorld();
      w.policy.origin_requirement = 'NOT_REQUIRED';
      w.observations.origin.reachable = false;
      expect((await evaluate(rebind(w))).result).toBe('PASS');
    });
  });

  describe('R1 unresolved embedding -> freeze rejected (sec 5.2, 7.4)', () => {
    it('empty production admission -> U51_EMBEDDING_NOT_ADMITTED at C4', async () => {
      const w = buildWorld();
      emb(w).admission.admitted_keys = [];
      expectRejected(await evaluate(rebind(w)), 'U51_EMBEDDING_NOT_ADMITTED', 'C4');
    });
    it('more than one admitted key (admission is exactly the selected winner) -> U51_EMBEDDING_NOT_ADMITTED at C4', async () => {
      const w = buildWorld();
      emb(w).admission.admitted_keys = ['fixture-embedding', 'fixture-embedding-b'];
      expectRejected(await evaluate(rebind(w)), 'U51_EMBEDDING_NOT_ADMITTED', 'C4');
    });
    it('embedding block missing from the manifest -> U51_MANIFEST_SCHEMA_INVALID at C1', async () => {
      const w = buildWorld();
      delete w.manifest.embedding;
      expectRejected(await evaluate(w), 'U51_MANIFEST_SCHEMA_INVALID', 'C1');
    });
    it('placeholder identity ("TBD") -> U51_MANIFEST_UNRESOLVED_IDENTITY at C1', async () => {
      const w = buildWorld();
      w.manifest.embedding.model_revision = 'TBD';
      expectRejected(await evaluate(w), 'U51_MANIFEST_UNRESOLVED_IDENTITY', 'C1');
    });
    it('filler hex (64 x "a") -> U51_MANIFEST_UNRESOLVED_IDENTITY at C1', async () => {
      const w = buildWorld();
      w.manifest.embedding.registry_sha256 = 'a'.repeat(64);
      expectRejected(await evaluate(w), 'U51_MANIFEST_UNRESOLVED_IDENTITY', 'C1');
    });
    it('no embedding observation at all -> U51_MANIFEST_UNRESOLVED_IDENTITY at C4', async () => {
      const w = buildWorld();
      delete w.observations.embedding;
      expectRejected(await evaluate(w), 'U51_MANIFEST_UNRESOLVED_IDENTITY', 'C4');
    });
    it.each<[string, (w: World) => void]>([
      ['selection record binds another pipeline spec', (w) => (emb(w).selection_decision.record.pipeline_spec_sha256 = syn64('another-spec'))],
      ['selection record binds another pipeline key', (w) => (emb(w).selection_decision.record.pipeline_key = 'fixture-embedding-b')],
      ['selection record decision is not SELECTED', (w) => (emb(w).selection_decision.record.decision = 'REJECTED')],
      ['selection attestation not verified (adapter-asserted)', (w) => (emb(w).selection_decision.attestation_verified = false)],
    ])('an unresolved or non-binding selection decision (%s) -> U51_MANIFEST_UNRESOLVED_IDENTITY at C4', async (_n, mutate) => {
      const w = buildWorld();
      mutate(w);
      emb(w).selection_decision.record_sha256 = hashOf(emb(w).selection_decision.record);
      expectRejected(await evaluate(rebind(w)), 'U51_MANIFEST_UNRESOLVED_IDENTITY', 'C4');
    });
    it('selection record bytes that do not hash to record_sha256 (tampered) -> U51_MANIFEST_UNRESOLVED_IDENTITY at C4', async () => {
      const w = buildWorld();
      emb(w).selection_decision.record_sha256 = syn64('tampered');
      expectRejected(await evaluate(rebind(w)), 'U51_MANIFEST_UNRESOLVED_IDENTITY', 'C4');
    });
  });

  describe('R2 / F5 zero-google evidence (sec 6, 8)', () => {
    it('evidence of tree B bound to a manifest of tree A -> U51_ZERO_GOOGLE_TREE_MISMATCH at C3', async () => {
      const w = buildWorld();
      zg(w).subject.tree_sha = TREE_B;
      expectRejected(await evaluate(rebind(w)), 'U51_ZERO_GOOGLE_TREE_MISMATCH', 'C3');
    });
    it('no zero-google evidence -> U51_ZERO_GOOGLE_EVIDENCE_MISSING at C3', async () => {
      const w = buildWorld();
      delete w.observations.zero_google;
      expectRejected(await evaluate(w), 'U51_ZERO_GOOGLE_EVIDENCE_MISSING', 'C3');
    });
    it('NO_GUARD_PRESENT_IN_SUBJECT_TREE (a tree that predates the guard) is a legitimate record but never acceptable -> U51_ZERO_GOOGLE_GUARD_NOT_ACCEPTED at C3', async () => {
      const w = buildWorld();
      w.observations.zero_google.payload = {
        contract_version: 'u51-zero-google-evidence-1',
        subject: { ...zg(w).subject },
        guard_state: 'NO_GUARD_PRESENT_IN_SUBJECT_TREE',
      };
      expectRejected(await evaluate(rebind(w)), 'U51_ZERO_GOOGLE_GUARD_NOT_ACCEPTED', 'C3');
    });
    it('guard blob not in the owner-accepted set (a modified / weakened guard) -> U51_ZERO_GOOGLE_GUARD_NOT_ACCEPTED at C3', async () => {
      const w = buildWorld();
      zg(w).guard.blob_sha1_in_tree = GUARD_BLOB_OTHER;
      zg(w).guard.blob_sha1_executed = GUARD_BLOB_OTHER;
      expectRejected(await evaluate(rebind(w)), 'U51_ZERO_GOOGLE_GUARD_NOT_ACCEPTED', 'C3');
    });
    it('guard executed is not the guard committed in the tree -> U51_ZERO_GOOGLE_GUARD_NOT_ACCEPTED at C3', async () => {
      const w = buildWorld();
      zg(w).guard.blob_sha1_executed = GUARD_BLOB_OTHER;
      expectRejected(await evaluate(rebind(w)), 'U51_ZERO_GOOGLE_GUARD_NOT_ACCEPTED', 'C3');
    });
    it('guard reported under another path -> U51_ZERO_GOOGLE_GUARD_NOT_ACCEPTED at C3', async () => {
      const w = buildWorld();
      zg(w).guard.path = 'tests/unit/someOtherGuard.test.ts';
      expectRejected(await evaluate(rebind(w)), 'U51_ZERO_GOOGLE_GUARD_NOT_ACCEPTED', 'C3');
    });
    it('test command / config identity differs from the accepted invocation -> U51_ZERO_GOOGLE_GUARD_NOT_ACCEPTED at C3', async () => {
      const w = buildWorld();
      zg(w).execution.command_sha256 = syn64('a-filtered-or-reconfigured-command');
      expectRejected(await evaluate(rebind(w)), 'U51_ZERO_GOOGLE_GUARD_NOT_ACCEPTED', 'C3');
    });
    it('the weaker later guard (f7065463 semantics) presented against a policy that accepts only the stronger guard blob -> U51_ZERO_GOOGLE_GUARD_NOT_ACCEPTED at C3', async () => {
      const w = buildWorld();
      w.policy.accepted_guards = [{ ...GUARD_ENTRY, blob_sha1: syn40('strong-guard-blob'), rules: GUARD_ENTRY.rules.map((r) => ({ ...r, applies_to: 'ALL_FILES' })) }];
      expectRejected(await evaluate(rebind(w)), 'U51_ZERO_GOOGLE_GUARD_NOT_ACCEPTED', 'C3');
    });
    it('the accepted blob executed with weakened rule coverage (gcloud/gsutil limited to scripts) while the entry says ALL_FILES -> U51_ZERO_GOOGLE_SCAN_MISMATCH at C3', async () => {
      const w = buildWorld();
      w.policy.accepted_guards = [{ ...GUARD_ENTRY, rules: GUARD_ENTRY.rules.map((r) => ({ ...r, applies_to: 'ALL_FILES' })) }];
      expectRejected(await evaluate(rebind(w)), 'U51_ZERO_GOOGLE_SCAN_MISMATCH', 'C3');
    });
    it.each<[string, (w: World) => void]>([
      ['scan profile below the policy requirement (GUARD_ONLY)', (w) => { zg(w).scan.profile = 'GUARD_ONLY'; delete zg(w).dependency_scan; }],
      ['scan roots differ from the accepted entry', (w) => (zg(w).scan.roots = zg(w).scan.roots.slice(1))],
      ['allow/exclusion patterns hash differs', (w) => (zg(w).scan.allow_patterns_sha256 = syn64('other-allow-patterns'))],
      ['executed rule set is missing a rule', (w) => (zg(w).scan.executed_rules = zg(w).scan.executed_rules.slice(1))],
      ['candidate fileset (before exclusions): claimed != derived', (w) => (zg(w).scan.candidate_files.claimed_digest_sha256 = syn64('x'))],
      ['scanned fileset (after exclusions): claimed != derived', (w) => (zg(w).scan.scanned_files.claimed_digest_sha256 = syn64('x'))],
      ['dependency manifest set differs from the policy', (w) => (zg(w).dependency_scan.manifests = zg(w).dependency_scan.manifests.slice(1))],
      ['dependency scan used other forbidden-package patterns', (w) => (zg(w).dependency_scan.forbidden_patterns_sha256 = syn64('other-patterns'))],
      ['dependency scan: claimed != derived digest', (w) => (zg(w).dependency_scan.claimed_digest_sha256 = syn64('x'))],
    ])('profile / scan substitution (%s) -> U51_ZERO_GOOGLE_SCAN_MISMATCH at C3', async (_n, mutate) => {
      const w = buildWorld();
      mutate(w);
      expectRejected(await evaluate(rebind(w)), 'U51_ZERO_GOOGLE_SCAN_MISMATCH', 'C3');
    });
    it.each<[string, (w: World) => void]>([
      ['dirty worktree', (w) => (zg(w).execution.worktree_clean = false)],
      ['non-zero exit code', (w) => (zg(w).execution.exit_code = 1)],
      ['the guard test failed', (w) => (zg(w).execution.executed_tests[0].status = 'failed')],
      ['the guard test was skipped', (w) => (zg(w).execution.executed_tests[0].status = 'skipped')],
      ['no test executed at all', (w) => (zg(w).execution.executed_tests = [])],
      ['another test ran instead of the guard (a test count >= 1 is not enough)', (w) => (zg(w).execution.executed_tests = [{ file: GUARD_PATH, full_name: 'something else entirely', status: 'passed' }])],
      ['the right title in the wrong file', (w) => (zg(w).execution.executed_tests = [{ file: 'tests/unit/other.test.ts', full_name: GUARD_TEST_FULL_NAME, status: 'passed' }])],
      ['an extra test ran next to the guard', (w) => zg(w).execution.executed_tests.push({ file: GUARD_PATH, full_name: 'extra', status: 'passed' })],
      ['dependency scan found a forbidden package', (w) => (zg(w).dependency_scan.hits_count = 1)],
    ])('never a PASS (%s) -> U51_ZERO_GOOGLE_NOT_PASS at C3', async (_n, mutate) => {
      const w = buildWorld();
      mutate(w);
      expectRejected(await evaluate(rebind(w)), 'U51_ZERO_GOOGLE_NOT_PASS', 'C3');
    });
  });

  describe('R3 Google / Gemini / Vertex identity -> rejected (sec 5.6, 8)', () => {
    it.each<[string, string]>([
      ['embedding.model_id', 'gemini-embedding-001'],
      ['generation.runtime_id', 'vertex-ai-runtime'],
      ['generation.model_id', 'GOOGLE/some-model'],
      ['generation.model_id', 'x-Gemini-y'],
      ['generation.model_id', 'VertexAI'],
      ['generation.model_id', 'googleapis-client'],
      ['generation.generation_contract_version', 'palm-contract-1'],
      ['generation.model_version', 'bard-2026'],
      ['embedding.pipeline_key', 'gcp-embedding'],
    ])('forbidden provider identity in %s = "%s" -> U51_FORBIDDEN_PROVIDER_IDENTITY at C1', async (field, value) => {
      const w = buildWorld();
      setPath(w.manifest, field, value);
      expectRejected(await evaluate(w), 'U51_FORBIDDEN_PROVIDER_IDENTITY', 'C1');
    });
  });

  describe('R4 dimension parity across every source (sec 5.5)', () => {
    it('manifest embedding dimension differs from the registry pipeline -> U51_EMBEDDING_DIMENSION_MISMATCH at C4', async () => {
      const w = buildWorld();
      w.manifest.embedding.dimension = 768;
      expectRejected(await evaluate(w), 'U51_EMBEDDING_DIMENSION_MISMATCH', 'C4');
    });
    it.each<[string, (w: World) => void]>([
      ['migration vector column (and so the manifest schema dimension) is 3072', (w) => (sch(w).migration.tables[0].vector_columns[0].dimension = 3072)],
      ['migration dimension CHECK is 768', (w) => (sch(w).migration.tables[0].dimension_checks[0].dimension = 768)],
      ['Prisma schema declares another vector dimension', (w) => (sch(w).prisma_models[0].vector_columns[0].declared_dimension = 3072)],
      ['runtime SQL casts to another dimension', (w) => (sch(w).runtime_persistence.statements[1].vector_columns[0].cast_dimension = 3072)],
    ])('dimension disagreement (%s) -> U51_EMBEDDING_DIMENSION_MISMATCH at C5', async (_n, mutate) => {
      const w = buildWorld();
      mutate(w);
      expectRejected(await evaluate(rebind(w)), 'U51_EMBEDDING_DIMENSION_MISMATCH', 'C5');
    });
  });

  describe('F1 schema / migration parity proof (sec 5.5)', () => {
    it('Prisma validates but no model maps to the table the migration creates -> U51_SCHEMA_IDENTITY_MISMATCH at C5', async () => {
      const w = buildWorld();
      sch(w).prisma_models = [];
      expectRejected(await evaluate(rebind(w)), 'U51_SCHEMA_IDENTITY_MISMATCH', 'C5');
    });
    it('@@map / table name differs between the Prisma model and the migration SQL -> U51_SCHEMA_IDENTITY_MISMATCH at C5', async () => {
      const w = buildWorld();
      sch(w).prisma_models[0].mapped_table = 'fixture_embeddings_other';
      expectRejected(await evaluate(rebind(w)), 'U51_SCHEMA_IDENTITY_MISMATCH', 'C5');
    });
    it('runtime persistence targets a table the approved migration does not create -> U51_SCHEMA_IDENTITY_MISMATCH at C5', async () => {
      const w = buildWorld();
      sch(w).runtime_persistence.statements[0].table = 'fixture_embeddings_unapproved';
      sch(w).runtime_persistence.embedding_table_references = [TABLE, 'fixture_embeddings_unapproved'];
      expectRejected(await evaluate(rebind(w)), 'U51_SCHEMA_IDENTITY_MISMATCH', 'C5');
    });
    it('non-test source still references a second (legacy) embedding table -> U51_SCHEMA_IDENTITY_MISMATCH at C5', async () => {
      const w = buildWorld();
      sch(w).runtime_persistence.embedding_table_references = [TABLE, 'legacy_embeddings_3072'];
      expectRejected(await evaluate(rebind(w)), 'U51_SCHEMA_IDENTITY_MISMATCH', 'C5');
    });
    it('the migration does not create the table the manifest claims -> U51_SCHEMA_IDENTITY_MISMATCH at C5', async () => {
      const w = buildWorld();
      sch(w).migration.tables[0].table = 'fixture_embeddings_renamed';
      rebind(w);
      w.manifest.schema.table = TABLE; // the manifest keeps claiming the original table
      expectRejected(await evaluate(w), 'U51_SCHEMA_IDENTITY_MISMATCH', 'C5');
    });
    it('the migration CHECK pins a different model revision than the production admission -> U51_SCHEMA_IDENTITY_MISMATCH at C5', async () => {
      const w = buildWorld();
      sch(w).migration.tables[0].pipeline_binding_checks[0].triples[0].model_revision = syn40('other-revision');
      expectRejected(await evaluate(rebind(w)), 'U51_SCHEMA_IDENTITY_MISMATCH', 'C5');
    });
    it('no pipeline-binding CHECK at all -> U51_SCHEMA_IDENTITY_MISMATCH at C5', async () => {
      const w = buildWorld();
      sch(w).migration.tables[0].pipeline_binding_checks = [];
      expectRejected(await evaluate(rebind(w)), 'U51_SCHEMA_IDENTITY_MISMATCH', 'C5');
    });
    it('EXACT_ADMITTED: a CHECK that also admits an unadmitted pipeline is rejected', async () => {
      const w = buildWorld();
      sch(w).migration.tables[0].pipeline_binding_checks[0].triples.push({ model_id: 'fixture-org/other', model_revision: syn40('other'), pipeline_version: 'other-v1' });
      expectRejected(await evaluate(rebind(w)), 'U51_SCHEMA_IDENTITY_MISMATCH', 'C5');
    });
    it('CONTAINS_ADMITTED (an owner policy choice, OD-13): the same wider CHECK is accepted', async () => {
      const w = buildWorld();
      w.policy.migration_check_binding = 'CONTAINS_ADMITTED';
      sch(w).migration.tables[0].pipeline_binding_checks[0].triples.push({ model_id: 'fixture-org/other', model_revision: syn40('other'), pipeline_version: 'other-v1' });
      expect((await evaluate(rebind(w))).result).toBe('PASS');
    });
    it('the migration exists only as a proposal (not under prisma/migrations) -> U51_SCHEMA_IDENTITY_MISMATCH at C5', async () => {
      const w = buildWorld();
      sch(w).migration.location = 'proposal';
      expectRejected(await evaluate(rebind(w)), 'U51_SCHEMA_IDENTITY_MISMATCH', 'C5');
    });
    it('prisma validate fails on the bound schema.prisma blob -> U51_SCHEMA_IDENTITY_MISMATCH at C5', async () => {
      const w = buildWorld();
      sch(w).prisma_schema.validate_exit_code = 1;
      expectRejected(await evaluate(rebind(w)), 'U51_SCHEMA_IDENTITY_MISMATCH', 'C5');
    });
    it("validation ran with the SUBJECT tree's prisma config (executable code) instead of the controller's -> U51_SCHEMA_IDENTITY_MISMATCH at C5", async () => {
      const w = buildWorld();
      sch(w).datasource.config_source = 'SUBJECT_TREE';
      expectRejected(await evaluate(rebind(w)), 'U51_SCHEMA_IDENTITY_MISMATCH', 'C5');
    });
    it.each<[string, (w: World) => void]>([
      ['approval record binds another migration', (w) => (sch(w).approval.record.migration_id = '29990101000009_other')],
      ['approval record binds another SQL hash', (w) => (sch(w).approval.record.migration_sql_sha256 = syn64('other-sql'))],
      ['approval decision is not APPROVED', (w) => (sch(w).approval.record.decision = 'PROPOSED')],
      ['approval attestation not verified (adapter-asserted)', (w) => (sch(w).approval.attestation_verified = false)],
    ])('an unresolved or non-binding migration approval (%s) -> U51_MANIFEST_UNRESOLVED_IDENTITY at C5', async (_n, mutate) => {
      const w = buildWorld();
      mutate(w);
      sch(w).approval.record_sha256 = hashOf(sch(w).approval.record);
      expectRejected(await evaluate(rebind(w)), 'U51_MANIFEST_UNRESOLVED_IDENTITY', 'C5');
    });
  });

  describe('R5 / F2 embedding identity binds every vector-relevant field (sec 5.4)', () => {
    it('model id right, revision substituted -> U51_EMBEDDING_IDENTITY_MISMATCH at C4', async () => {
      const w = buildWorld();
      w.manifest.embedding.model_revision = syn40('another-revision');
      expectRejected(await evaluate(w), 'U51_EMBEDDING_IDENTITY_MISMATCH', 'C4');
    });
    it('registry hash from another revision of the registry -> U51_EMBEDDING_IDENTITY_MISMATCH at C4', async () => {
      const w = buildWorld();
      w.manifest.embedding.registry_sha256 = syn64('registry-from-another-revision');
      expectRejected(await evaluate(w), 'U51_EMBEDDING_IDENTITY_MISMATCH', 'C4');
    });
    it.each<[string, string, unknown]>([
      ['normalization', 'normalization', 'cosine'],
      ['query prefix / query format', 'query_prefix', 'other-query: '],
      ['passage prefix / passage format', 'passage_prefix', 'other-passage: '],
      ['max_seq_length', 'max_seq_length', 256],
    ])('the registry entry changed (%s) while the manifest still carries the old claims -> U51_EMBEDDING_IDENTITY_MISMATCH at C4', async (_n, field, value) => {
      const w = buildWorld();
      const old = clone(w.manifest.embedding);
      setPipeline(w, { [field]: value }); // registry, selection record, evidence and registry hash all follow the new definition ...
      const m = w.manifest.embedding; // ... but the frozen claims about the pipeline definition are the old ones
      m.pipeline_spec_sha256 = old.pipeline_spec_sha256;
      m.normalization = old.normalization;
      m.query_prefix_sha256 = old.query_prefix_sha256;
      m.passage_prefix_sha256 = old.passage_prefix_sha256;
      m.max_seq_length = old.max_seq_length;
      expectRejected(await evaluate(w), 'U51_EMBEDDING_IDENTITY_MISMATCH', 'C4');
    });
    it('max_seq_length presence is identity: the registry has it, the manifest omits it -> U51_EMBEDDING_IDENTITY_MISMATCH at C4', async () => {
      const w = buildWorld();
      delete w.manifest.embedding.max_seq_length;
      expectRejected(await evaluate(w), 'U51_EMBEDDING_IDENTITY_MISMATCH', 'C4');
    });
    it('a change of query/document format cannot keep the same U51 identity even with an unchanged pipeline_version', async () => {
      const a = await evaluate(buildWorld());
      const bWorld = setPipeline(buildWorld(), { query_prefix: 'a-different-query-format: ' });
      const b = await evaluate(bWorld);
      expect(a.result).toBe('PASS');
      expect(b.result).toBe('PASS');
      expect(bWorld.manifest.embedding.pipeline_version).toBe(buildWorld().manifest.embedding.pipeline_version);
      expect(b.manifest_sha256).not.toBe(a.manifest_sha256);
    });
    it.each<[string, Obj]>([
      ['normalization', { normalization: 'none' }],
      ['passage prefix', { passage_prefix: 'x: ' }],
      ['max_seq_length', { max_seq_length: 128 }],
      ['snapshot manifest', { snapshot_manifest_sha256: syn64('other-snapshot') }],
    ])('every vector-relevant field (%s) is part of the identity: changing it changes the manifest hash', async (_n, patch) => {
      const a = await evaluate(buildWorld());
      const b = await evaluate(setPipeline(buildWorld(), patch));
      expect(b.manifest_sha256).not.toBe(a.manifest_sha256);
    });
    it('the migration CHECK follows the admitted revision: a new revision passes only if the CHECK moved with it', async () => {
      const w = setPipeline(buildWorld(), { model_revision: syn40('new-revision') });
      expect((await evaluate(w)).result).toBe('PASS');
      sch(w).migration.tables[0].pipeline_binding_checks[0].triples[0].model_revision = syn40('old-revision');
      expectRejected(await evaluate(rebind(w)), 'U51_SCHEMA_IDENTITY_MISMATCH', 'C5');
    });
  });

  describe('R6 same inputs twice -> same canonical hash (sec 4)', () => {
    it('is deterministic, equals the pinned golden vector, and evaluation reports the same hash', async () => {
      const impl = await loadImplementation();
      const w = buildWorld();
      const a = impl.canonicalizeManifest(clone(w.manifest));
      const b = impl.canonicalizeManifest(clone(w.manifest));
      expect(a.sha256).toBe(b.sha256);
      expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
      expect(a.sha256).toBe(GOLDEN_BASE_MANIFEST_SHA256);
      expect((await evaluate(w)).manifest_sha256).toBe(GOLDEN_BASE_MANIFEST_SHA256);
    });
  });

  describe('R7 canonicalization: key order is not semantics; non-canonical bytes are never accepted (sec 4, 8 attack 11)', () => {
    it('object-key reordering yields the same canonical bytes and hash', async () => {
      const impl = await loadImplementation();
      const w = buildWorld();
      expect(impl.canonicalizeManifest(reverseKeys(w.manifest)).sha256).toBe(impl.canonicalizeManifest(w.manifest).sha256);
    });
    it('a stored manifest whose bytes are not canonical (reordered, pretty-printed, trailing newline) -> U51_CANONICALIZATION_FAILURE at C7', async () => {
      const w = buildWorld();
      expectRejected(await evaluateBytes(w, bytesOf(JSON.stringify(reverseKeys(w.manifest)))), 'U51_CANONICALIZATION_FAILURE', 'C7');
      expectRejected(await evaluateBytes(w, bytesOf(JSON.stringify(w.manifest, null, 2))), 'U51_CANONICALIZATION_FAILURE', 'C7');
      expectRejected(await evaluateBytes(w, bytesOf(`${textOf(w)}\n`)), 'U51_CANONICALIZATION_FAILURE', 'C7');
    });
    it('same semantics through a unicode escape or a number spelling is still non-canonical bytes -> C7', async () => {
      const w = buildWorld();
      expectRejected(await evaluateBytes(w, bytesOf(textOf(w).replace('"manifest_type"', '"manifest\\u005ftype"'))), 'U51_CANONICALIZATION_FAILURE', 'C7');
      expectRejected(await evaluateBytes(w, bytesOf(textOf(w).replace('"dimension":1024', '"dimension":1024.0'))), 'U51_CANONICALIZATION_FAILURE', 'C7');
    });
    it('a duplicate key (last-wins ambiguity), a BOM or non-JSON bytes -> U51_CANONICALIZATION_FAILURE at C0', async () => {
      const w = buildWorld();
      expectRejected(await evaluateBytes(w, bytesOf(textOf(w).replace('{', '{"manifest_type":"x",'))), 'U51_CANONICALIZATION_FAILURE', 'C0');
      expectRejected(await evaluateBytes(w, bytesOf(`${String.fromCharCode(0xfeff)}${textOf(w)}`)), 'U51_CANONICALIZATION_FAILURE', 'C0');
      expectRejected(await evaluateBytes(w, bytesOf('not json')), 'U51_CANONICALIZATION_FAILURE', 'C0');
    });
    it('non-ASCII identifier characters (homoglyph / zero-width variants that slip past the forbidden-pattern scan; JCS alone does not normalise them) -> U51_MANIFEST_SCHEMA_INVALID at C1', async () => {
      const homoglyph = buildWorld();
      homoglyph.manifest.generation.model_id = ['g', String.fromCharCode(0x043e), String.fromCharCode(0x043e), 'gle-model'].join(''); // Cyrillic small o (U+043E) twice
      expectRejected(await evaluate(homoglyph), 'U51_MANIFEST_SCHEMA_INVALID', 'C1');
      const zeroWidth = buildWorld();
      zeroWidth.manifest.generation.model_id = ['goo', String.fromCharCode(0x200b), 'gle-model'].join(''); // zero-width space (U+200B)
      expectRejected(await evaluate(zeroWidth), 'U51_MANIFEST_SCHEMA_INVALID', 'C1');
    });
  });

  describe('R8 strict schema: extra / null / array / wrong-typed normative fields -> rejected (sec 3.4)', () => {
    it('unknown top-level field -> U51_MANIFEST_SCHEMA_INVALID at C1', async () => {
      const w = buildWorld();
      w.manifest.note = 'free text';
      expectRejected(await evaluate(w), 'U51_MANIFEST_SCHEMA_INVALID', 'C1');
    });
    it('unknown nested field -> U51_MANIFEST_SCHEMA_INVALID at C1', async () => {
      const w = buildWorld();
      w.manifest.embedding.provider = 'whatever';
      expectRejected(await evaluate(w), 'U51_MANIFEST_SCHEMA_INVALID', 'C1');
    });
    it.each<[string, (m: Obj) => void]>([
      ['timestamp', (m) => (m.issued_at = '2026-10-07T00:00:00Z')],
      ['status', (m) => (m.status = 'FROZEN')],
      ['self-hash', (m) => (m.manifest_sha256 = syn64('self'))],
      ['null value', (m) => (m.release.release_hash_sha256 = null)],
      ['array value', (m) => (m.candidate.tree_sha = [m.candidate.tree_sha])],
      ['float', (m) => (m.embedding.dimension = 1024.5)],
      ['string where an integer is required', (m) => (m.schema.vector_dimension = '1024')],
      ['boolean', (m) => (m.embedding.normalization = true)],
    ])('forbidden field class (%s) -> U51_MANIFEST_SCHEMA_INVALID at C1', async (_n, mutate) => {
      const w = buildWorld();
      mutate(w.manifest);
      expectRejected(await evaluate(w), 'U51_MANIFEST_SCHEMA_INVALID', 'C1');
    });
  });

  describe('R9 generation posture is explicit, never null (sec 5.2, 5.3)', () => {
    it('posture missing -> U51_MANIFEST_SCHEMA_INVALID at C1', async () => {
      const w = buildWorld();
      delete w.manifest.generation.posture;
      expectRejected(await evaluate(w), 'U51_MANIFEST_SCHEMA_INVALID', 'C1');
    });
    it('generation null -> U51_MANIFEST_SCHEMA_INVALID at C1', async () => {
      const w = buildWorld();
      w.manifest.generation = null;
      expectRejected(await evaluate(w), 'U51_MANIFEST_SCHEMA_INVALID', 'C1');
    });
    it('DECLARED_ABSENT while the policy requires a bound runtime -> U51_GENERATION_IDENTITY_UNRESOLVED at C6', async () => {
      const w = buildAbsentGenerationWorld();
      w.policy.generation_requirement = 'BOUND_REQUIRED';
      expectRejected(await evaluate(rebind(w)), 'U51_GENERATION_IDENTITY_UNRESOLVED', 'C6');
    });
    it('DECLARED_ABSENT carrying bound-runtime fields is malformed -> U51_MANIFEST_SCHEMA_INVALID at C1', async () => {
      const w = buildAbsentGenerationWorld();
      w.manifest.generation.runtime_id = 'fixture-local-runtime-alpha';
      expectRejected(await evaluate(w), 'U51_MANIFEST_SCHEMA_INVALID', 'C1');
    });
  });

  describe('F3 DECLARED_ABSENT is proved by booting the real production composition roots (sec 5.3)', () => {
    it.each<[string, (w: World) => void]>([
      ['an entrypoint registered a runtime after boot', (w) => (gen(w).boot_probe.entrypoints[0] = { entry_id: 'web', node_env: 'production', registered_after_boot: true, runtime: { ...GENERATION_RUNTIME }, generate_attempt: { outcome: 'SUCCESS' } })],
      ['an entrypoint reports a registered runtime although its generation attempt failed closed', (w) => (gen(w).boot_probe.entrypoints[0] = { entry_id: 'web', node_env: 'production', registered_after_boot: true, runtime: { ...GENERATION_RUNTIME }, generate_attempt: { outcome: 'FAIL_CLOSED', code: BLOCKER } })],
      ['a generation attempt succeeded', (w) => (gen(w).boot_probe.entrypoints[0].generate_attempt = { outcome: 'SUCCESS' })],
      ['a generation attempt failed with another error than the fail-closed status', (w) => (gen(w).boot_probe.entrypoints[0].generate_attempt = { outcome: 'OTHER_ERROR', code: 'ECONNREFUSED' })],
      ['a fail-closed outcome carries the wrong status code', (w) => (gen(w).boot_probe.entrypoints[0].generate_attempt = { outcome: 'FAIL_CLOSED', code: 'SOMETHING_ELSE' })],
      ['an entrypoint was booted outside the production profile', (w) => (gen(w).boot_probe.entrypoints[0].node_env = 'test')],
      ['no entrypoint was booted (an empty probe proves nothing)', (w) => (gen(w).boot_probe.entrypoints = [])],
      ['the booted entrypoint set differs from the composition entrypoint set', (w) => (gen(w).entrypoint_set.claimed_sha256 = syn64('a-subset-of-entrypoints'))],
      ['a non-test source file still contains the registration identifier', (w) => (gen(w).static_census.registration_identifier_files = 1)],
      ['a non-literal dynamic import of the generation module exists (an unobservable registration path)', (w) => (gen(w).static_census.nonliteral_dynamic_imports = 1)],
    ])('absence is not accepted when %s -> U51_GENERATION_IDENTITY_MISMATCH at C6', async (_n, mutate) => {
      const w = buildAbsentGenerationWorld();
      mutate(w);
      expectRejected(await evaluate(claimAbsent(rebind(w))), 'U51_GENERATION_IDENTITY_MISMATCH', 'C6');
    });
    it('test/mock registrations are not counted and cannot hide or fake production registration (test_registration_files is audit-only)', async () => {
      const w = buildAbsentGenerationWorld();
      gen(w).static_census.test_registration_files = 7;
      expect((await evaluate(rebind(w))).result).toBe('PASS');
    });
  });

  describe('R10 / F4 BOUND generation identity (sec 5.3)', () => {
    it.each<string>(['mock-local-runtime', 'test-runtime', 'fake-llm', 'stub-generation', 'canned-answers'])(
      'mock-named runtime "%s", even when a (hostile) registry lists it -> U51_GENERATION_RUNTIME_NOT_PRODUCTION at C6',
      async (runtime_id) => {
        expectRejected(await evaluate(setRuntime(buildWorld(), { runtime_id })), 'U51_GENERATION_RUNTIME_NOT_PRODUCTION', 'C6');
      },
    );
    it('a bound runtime and an empty (non-existent) runtime registry -> U51_GENERATION_IDENTITY_UNRESOLVED at C6', async () => {
      const w = buildWorld();
      gen(w).registry.runtimes = [];
      expectRejected(await evaluate(rebind(w)), 'U51_GENERATION_IDENTITY_UNRESOLVED', 'C6');
    });
    it('a bound runtime not in a non-empty closed registry -> U51_GENERATION_IDENTITY_MISMATCH at C6', async () => {
      const w = buildWorld();
      gen(w).registry.runtimes = [{ ...GENERATION_RUNTIME, runtime_id: 'fixture-local-runtime-beta' }];
      expectRejected(await evaluate(rebind(w)), 'U51_GENERATION_IDENTITY_MISMATCH', 'C6');
    });
    it.each(Object.keys(GENERATION_RUNTIME))(
      'the booted entrypoint runs another runtime than the manifest binds (field %s) -> U51_GENERATION_IDENTITY_MISMATCH at C6',
      async (field) => {
        const original = clone(buildWorld().manifest.generation);
        const w = buildWorld();
        const probed = gen(w).boot_probe.entrypoints[0].runtime;
        probed[field] = field.endsWith('_sha256') ? syn64('other') : `${probed[field]}-other`;
        expectRejected(await evaluate(keepOriginalBoundClaim(rebind(w), original)), 'U51_GENERATION_IDENTITY_MISMATCH', 'C6');
      },
    );
    it('a BOUND claim while no entrypoint registered a runtime after boot -> U51_GENERATION_IDENTITY_MISMATCH at C6', async () => {
      const original = clone(buildWorld().manifest.generation);
      const w = buildWorld();
      gen(w).boot_probe.entrypoints = gen(w).boot_probe.entrypoints.map((e: Obj) => ({ entry_id: e.entry_id, node_env: 'production', registered_after_boot: false, generate_attempt: { outcome: 'FAIL_CLOSED', code: BLOCKER } }));
      expectRejected(await evaluate(keepOriginalBoundClaim(rebind(w), original)), 'U51_GENERATION_IDENTITY_MISMATCH', 'C6');
    });
    it('a non-registering entrypoint that is not fail-closed -> U51_GENERATION_IDENTITY_MISMATCH at C6', async () => {
      const w = buildWorld();
      gen(w).boot_probe.entrypoints[1].generate_attempt = { outcome: 'OTHER_ERROR', code: 'EBOOM' };
      expectRejected(await evaluate(rebind(w)), 'U51_GENERATION_IDENTITY_MISMATCH', 'C6');
    });
    it('model_version is a free string as LocalGenerationPort defines it (no 40-hex requirement)', async () => {
      expect((await evaluate(setRuntime(buildWorld(), { model_version: 'any.free-form_version/2026' }))).result).toBe('PASS');
    });
    it.each<Obj>([{ runtime_implementation_sha256: syn64('i') }, { runtime_config_sha256: syn64('c') }, { model_snapshot_manifest_sha256: syn64('s') }, { generation_contract_version: 'fixture-generation-contract-2' }])(
      'runtime implementation / config / model snapshot / contract version are identity (changing %o changes the manifest hash)',
      async (patch) => {
        const base = (await evaluate(buildWorld())).manifest_sha256;
        expect((await evaluate(setRuntime(buildWorld(), patch))).manifest_sha256).not.toBe(base);
      },
    );
  });

  describe('R11 release reference and composition substitution (sec 9, 8 attack 10)', () => {
    it('release resolved by artifact id carries a different release hash -> U51_RELEASE_REFERENCE_INVALID at C2', async () => {
      const w = buildWorld();
      w.observations.release.release_hash_sha256 = syn64('release-hash-of-another-composition');
      expectRejected(await evaluate(w), 'U51_RELEASE_REFERENCE_INVALID', 'C2');
    });
    it('release not verified -> U51_RELEASE_REFERENCE_INVALID at C2', async () => {
      const w = buildWorld();
      w.observations.release.verified = false;
      expectRejected(await evaluate(w), 'U51_RELEASE_REFERENCE_INVALID', 'C2');
    });
    it('release of a contract version the policy does not accept -> U51_RELEASE_REFERENCE_INVALID at C2', async () => {
      const w = buildWorld();
      w.manifest.release.contract_version = 'product-release-v2';
      w.observations.release.contract_version = 'product-release-v2';
      expectRejected(await evaluate(w), 'U51_RELEASE_REFERENCE_INVALID', 'C2');
    });
    it('a valid release of another tree -> U51_TREE_BINDING_MISMATCH at C2', async () => {
      const w = buildWorld();
      w.observations.release.source_tree_sha = TREE_B;
      expectRejected(await evaluate(w), 'U51_TREE_BINDING_MISMATCH', 'C2');
    });
    it('a commit whose tree is not the manifest tree -> U51_TREE_BINDING_MISMATCH at C2', async () => {
      const w = buildWorld();
      w.observations.subject.commit_tree_sha = TREE_B;
      expectRejected(await evaluate(w), 'U51_TREE_BINDING_MISMATCH', 'C2');
    });
  });

  describe('R13 substitution after freeze and evidence swaps (sec 8 attacks 8, 17)', () => {
    it('manifest bytes that no longer hash to the frozen manifest hash -> U51_MANIFEST_HASH_MISMATCH at C8', async () => {
      const w = buildWorld();
      const frozen = hashOf(w.manifest);
      setRuntime(w, { model_version: 'swapped-after-freeze' });
      expectRejected(await evaluate(w, { expected_manifest_sha256: frozen }), 'U51_MANIFEST_HASH_MISMATCH', 'C8');
    });
    it('a different, otherwise valid evidence record swapped in for the referenced one -> U51_MANIFEST_HASH_MISMATCH at its stage', async () => {
      const w = buildWorld();
      zg(w).scan.scanned_files.count = 99999;
      expectRejected(await evaluate(w), 'U51_MANIFEST_HASH_MISMATCH', 'C3');
    });
  });

  describe('evidence payloads are strict (sec 12.2): U51_EVIDENCE_SCHEMA_INVALID', () => {
    const cases: Array<[string, string, string, (p: Obj) => void]> = [
      ['zero_google', 'C3', 'unknown top-level key', (p) => (p.note = 'x')],
      ['zero_google', 'C3', 'unknown nested key', (p) => (p.execution.hostname = 'x')],
      ['zero_google', 'C3', 'wrong contract_version', (p) => (p.contract_version = 'u51-zero-google-evidence-9')],
      ['zero_google', 'C3', 'profile says dependency scan but it is missing', (p) => delete p.dependency_scan],
      ['embedding', 'C4', 'unknown key', (p) => (p.extra = 1)],
      ['embedding', 'C4', 'wrong contract_version', (p) => (p.contract_version = 'u51-embedding-derivation-9')],
      ['embedding', 'C4', 'registry entry with an unknown key', (p) => (p.registry.pipelines[0].extra = 1)],
      ['schema', 'C5', 'unknown key', (p) => (p.extra = 1)],
      ['schema', 'C5', 'wrong contract_version', (p) => (p.contract_version = 'u51-schema-derivation-9')],
      ['schema', 'C5', 'missing runtime_persistence', (p) => delete p.runtime_persistence],
      ['generation', 'C6', 'unknown key', (p) => (p.extra = 1)],
      ['generation', 'C6', 'wrong contract_version', (p) => (p.contract_version = 'u51-generation-derivation-9')],
      ['generation', 'C6', 'registered entrypoint without its runtime', (p) => delete p.boot_probe.entrypoints[0].runtime],
    ];
    it.each(cases)('%s payload (%s) -> U51_EVIDENCE_SCHEMA_INVALID', async (kind, stage, _what, mutate) => {
      const w = buildWorld();
      mutate(w.observations[kind].payload);
      w.manifest[kind].evidence_sha256 = hashOf(w.observations[kind].payload); // re-seal only the hash reference; nothing else is rebuilt
      expectRejected(await evaluate(w), 'U51_EVIDENCE_SCHEMA_INVALID', stage);
    });
    it.each<[string, string]>([
      ['embedding', 'C4'],
      ['schema', 'C5'],
      ['generation', 'C6'],
    ])('same-tree binding: %s evidence of another tree -> U51_TREE_BINDING_MISMATCH at %s', async (kind, stage) => {
      const w = buildWorld();
      w.observations[kind].payload.subject.tree_sha = TREE_B;
      expectRejected(await evaluate(rebind(w)), 'U51_TREE_BINDING_MISMATCH', stage);
    });
  });

  describe('claim-vs-observation: every manifest claim is compared with what the evidence derives (sec 3.5)', () => {
    const SID = 'U51_SCHEMA_IDENTITY_MISMATCH';
    const EID = 'U51_EMBEDDING_IDENTITY_MISMATCH';
    const GID = 'U51_GENERATION_IDENTITY_MISMATCH';
    const HASH = 'U51_MANIFEST_HASH_MISMATCH';
    const cases: Array<[string, unknown, string, string]> = [
      ['candidate.commit_sha', syn40('other-commit'), 'U51_TREE_BINDING_MISMATCH', 'C2'],
      ['candidate.tree_sha', syn40('other-tree'), 'U51_TREE_BINDING_MISMATCH', 'C2'],
      ['release.artifact_id', 'product-release-fedcba9876543210fedcba98', 'U51_RELEASE_REFERENCE_INVALID', 'C2'],
      ['release.release_hash_sha256', syn64('x'), 'U51_RELEASE_REFERENCE_INVALID', 'C2'],
      ['zero_google.evidence_sha256', syn64('x'), HASH, 'C3'],
      ['embedding.contract_version', 'embed-identity-2', EID, 'C4'],
      ['embedding.pipeline_key', 'fixture-embedding-other', EID, 'C4'],
      ['embedding.model_id', 'fixture-org/other-embedding', EID, 'C4'],
      ['embedding.model_revision', syn40('x'), EID, 'C4'],
      ['embedding.pipeline_version', 'fixture-st-dense-v2', EID, 'C4'],
      ['embedding.normalization', 'cosine', EID, 'C4'],
      ['embedding.query_prefix_sha256', syn64('x'), EID, 'C4'],
      ['embedding.passage_prefix_sha256', syn64('x'), EID, 'C4'],
      ['embedding.max_seq_length', 256, EID, 'C4'],
      ['embedding.pipeline_spec_sha256', syn64('x'), EID, 'C4'],
      ['embedding.snapshot_manifest_sha256', syn64('x'), EID, 'C4'],
      ['embedding.registry_sha256', syn64('x'), EID, 'C4'],
      ['embedding.admission_sha256', syn64('x'), EID, 'C4'],
      ['embedding.dimension', 768, 'U51_EMBEDDING_DIMENSION_MISMATCH', 'C4'],
      ['embedding.selection_decision_sha256', syn64('x'), 'U51_MANIFEST_UNRESOLVED_IDENTITY', 'C4'],
      ['embedding.evidence_sha256', syn64('x'), HASH, 'C4'],
      ['schema.prisma_schema_blob_sha1', syn40('x'), SID, 'C5'],
      ['schema.migration_id', '29990101000001_other', SID, 'C5'],
      ['schema.migration_sql_sha256', syn64('x'), SID, 'C5'],
      ['schema.table', 'fixture_embeddings_other', SID, 'C5'],
      ['schema.vector_dimension', 3072, 'U51_EMBEDDING_DIMENSION_MISMATCH', 'C5'],
      ['schema.approval_sha256', syn64('x'), 'U51_MANIFEST_UNRESOLVED_IDENTITY', 'C5'],
      ['schema.evidence_sha256', syn64('x'), HASH, 'C5'],
      ['generation.runtime_id', 'fixture-local-runtime-beta', GID, 'C6'],
      ['generation.runtime_implementation_sha256', syn64('x'), GID, 'C6'],
      ['generation.runtime_config_sha256', syn64('x'), GID, 'C6'],
      ['generation.model_id', 'fixture-org/other-generation', GID, 'C6'],
      ['generation.model_version', 'other-version', GID, 'C6'],
      ['generation.model_snapshot_manifest_sha256', syn64('x'), GID, 'C6'],
      ['generation.generation_contract_version', 'other-contract-1', GID, 'C6'],
      ['generation.port_source_blob_sha1', syn40('x'), GID, 'C6'],
      ['generation.evidence_sha256', syn64('x'), HASH, 'C6'],
    ];
    it.each(cases)('claim %s altered in the manifest only is rejected', async (field, value, code, stage) => {
      const w = buildWorld();
      setPath(w.manifest, field, value);
      expectRejected(await evaluate(w), code, stage);
    });
  });
});

describe('fixture self-check (NOT a U51 result; says nothing about the contract being implemented)', () => {
  it('the golden vector equals an independent RFC 8785 + SHA-256 computation of the base manifest', () => {
    expect(hashOf(buildWorld().manifest)).toBe(GOLDEN_BASE_MANIFEST_SHA256);
  });
  it('canonical hashing ignores object key order (so R7 pins the implementation, not the fixture)', () => {
    const w = buildWorld();
    expect(hashOf(reverseKeys(w.manifest))).toBe(hashOf(w.manifest));
  });
  it('the base world is internally consistent: every evidence hash the manifest claims is the hash of its payload', () => {
    const w = buildWorld();
    expect(w.manifest.zero_google.evidence_sha256).toBe(hashOf(zg(w)));
    expect(w.manifest.embedding.evidence_sha256).toBe(hashOf(emb(w)));
    expect(w.manifest.schema.evidence_sha256).toBe(hashOf(sch(w)));
    expect(w.manifest.generation.evidence_sha256).toBe(hashOf(gen(w)));
    expect(w.policy_authentication.policy_sha256).toBe(hashOf(w.policy));
    expect(w.manifest.embedding.query_prefix_sha256).toBe(sha256Hex('fixture-query: '));
  });
  it('the accepted-guard entry and the zero-google evidence describe the same guard configuration', () => {
    const w = buildWorld();
    expect(zg(w).guard.blob_sha1_in_tree).toBe(GUARD_BLOB_ACCEPTED);
    expect(zg(w).scan.allow_patterns_sha256).toBe(hashOf(GUARD_ENTRY.allow_patterns));
    expect(zg(w).execution.command_sha256).toBe(GUARD_ENTRY.command_sha256);
  });
});
