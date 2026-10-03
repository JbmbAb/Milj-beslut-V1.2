// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sha256ContentHash } from '@miljobeslut/mps-compliance/src/canonical/sha256Canonical';
import {
  CONFIGURED_EXECUTION_ATTESTATION_KEY_ID,
  DEFAULT_DEV_EXECUTION_ATTESTATION_KEY_ID,
  DEFAULT_DEV_EXECUTION_ATTESTATION_SECRET,
  EXECUTION_ATTESTATION_HMAC_SECRET_ENV,
  EXECUTION_ATTESTATION_SECRET_MIN_LENGTH,
  InMemoryArtifactRepository,
  REJECT_EXECUTION_ATTESTATION_SECRET_INVALID,
  SecurityRuntime,
  createConfiguredExecutionAttestationSigner,
  createDefaultDevExecutionAttestationSigner,
  describeExecutionAttestationSecret,
} from '@miljobeslut/mps-runtime';
import { LU_EXECUTION_PRINCIPAL_ID } from '@miljobeslut/mps-lu';
import { runLuAssessmentViaKernel } from '../../packages/mps-lu/src/execution/LuExecutionKernelClient';
import type { SpatialEvidenceArtifact } from '../../packages/mps-lu/src/artifacts/SpatialEvidenceArtifact';
import { SPATIAL_STACK_V1 } from '../../packages/mps-lu/src/artifacts/SpatialEngineFingerprint';
import {
  ExecutionAttestationSecretError,
  REJECT_EXECUTION_ATTESTATION_DEFAULT_SECRET_OUTSIDE_DEV,
  assertExecutionAttestationSecretAtStartup,
} from '../../server/modules/release/executionAttestationStartupGate';

/**
 * W-U42 (U42a, point 4) -- the HMAC default secret is fail-closed outside an explicit development/test process.
 *
 * Owner (2026-10-03 night (5), BINDING): "product runtime outside explicit dev must NOT be able to start with
 * `mps-execution-platform-default-dev-secret`. Replay may keep the name 'reproducibility check' but NOTHING may claim
 * authenticity verification before a real attestation authority exists." T1 §3.4 (A0): refuse the start without a
 * signer/key configuration; the default only in an explicit test/dev process.
 *
 * Mechanism (minimal, removable when A2 brings the asymmetric execution signer):
 *  - the literal lives in ONE place (mps-runtime ExecutionAttestationSecret.ts); SecurityRuntime's default signer is
 *    that dev signer;
 *  - MPS_EXECUTION_ATTESTATION_HMAC_SECRET configures the process's own HMAC secret (>= 32 chars, never the default
 *    literal); the LU kernel client hands that signer to SecurityRuntime, so a configured process never signs with
 *    the built-in secret;
 *  - the web process refuses to START (gate before anything listens) when the secret is absent outside an explicit
 *    development/test process, or invalid anywhere.
 * Nothing here claims authenticity: an outcome attestation stays a self-attestation of the producing process.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const VALID_SECRET = 'u42-test-execution-attestation-secret-0123456789abcdef';

function walkSources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walkSources(full, out);
    } else if (/\.(ts|mts|mjs|cjs|js)$/.test(entry.name) && !/\.test\.(ts|mts)$/.test(entry.name) && !/\.red\.test\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const ENV_KEYS = [EXECUTION_ATTESTATION_HMAC_SECRET_ENV, 'MPS_LU_BOOTSTRAP_ADMIT', 'NODE_ENV', 'APP_ENV'] as const;
const saved = new Map<string, string | undefined>();
beforeEach(() => {
  for (const key of ENV_KEYS) saved.set(key, process.env[key]);
  delete process.env[EXECUTION_ATTESTATION_HMAC_SECRET_ENV];
});
afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('the development secret lives in one place and the runtime default is that signer', () => {
  it('pins the names', () => {
    expect(DEFAULT_DEV_EXECUTION_ATTESTATION_SECRET).toBe('mps-execution-platform-default-dev-secret');
    expect(DEFAULT_DEV_EXECUTION_ATTESTATION_KEY_ID).toBe('hmac-execution-dev-v1');
    expect(EXECUTION_ATTESTATION_HMAC_SECRET_ENV).toBe('MPS_EXECUTION_ATTESTATION_HMAC_SECRET');
    expect(CONFIGURED_EXECUTION_ATTESTATION_KEY_ID).toBe('hmac-execution-configured-v1');
    expect(EXECUTION_ATTESTATION_SECRET_MIN_LENGTH).toBe(32);
  });

  it('SecurityRuntime without a signer attests with the dev signer (key id and signature)', () => {
    const security = SecurityRuntime.create({ bootstrapAdmit: true });
    security.bindPrincipal('actor-u42');
    const hash = sha256ContentHash({ u42: 1 });
    const attestation = security.attestOutcome(hash);
    expect(attestation.key_id).toBe(DEFAULT_DEV_EXECUTION_ATTESTATION_KEY_ID);
    expect(createDefaultDevExecutionAttestationSigner().verify(`actor-u42:${hash.algorithm}:${hash.value}`, attestation.signature)).toBe(true);
  });

  it('the literal appears in exactly one non-test source file across the runtime, the LU package and the server', () => {
    const roots = ['packages/mps-runtime/src', 'packages/mps-lu/src', 'server', 'scripts/release'].map((r) => path.join(REPO_ROOT, r));
    const hits = roots.flatMap(walkSources).filter((file) => fs.readFileSync(file, 'utf8').includes(DEFAULT_DEV_EXECUTION_ATTESTATION_SECRET));
    expect(hits.map((f) => path.relative(REPO_ROOT, f).split(path.sep).join('/'))).toEqual(['packages/mps-runtime/src/security/ExecutionAttestationSecret.ts']);
  });
});

describe('the configured execution-attestation signer', () => {
  it('absent -> null (the caller decides whether the default may be used)', () => {
    expect(createConfiguredExecutionAttestationSigner({})).toBeNull();
    expect(createConfiguredExecutionAttestationSigner({ OTHER: 'x' })).toBeNull();
    expect(describeExecutionAttestationSecret({})).toEqual({ state: 'absent' });
  });

  it('configured -> an HMAC signer under its own key id, distinct from the dev signer, round-tripping', () => {
    const signer = createConfiguredExecutionAttestationSigner({ [EXECUTION_ATTESTATION_HMAC_SECRET_ENV]: VALID_SECRET })!;
    expect(signer).not.toBeNull();
    expect(signer.key_id).toBe(CONFIGURED_EXECUTION_ATTESTATION_KEY_ID);
    const signature = signer.sign('p:sha256:abc');
    expect(signature).toMatch(/^[a-f0-9]{64}$/);
    expect(signer.verify('p:sha256:abc', signature)).toBe(true);
    expect(createDefaultDevExecutionAttestationSigner().verify('p:sha256:abc', signature)).toBe(false);
    expect(describeExecutionAttestationSecret({ [EXECUTION_ATTESTATION_HMAC_SECRET_ENV]: VALID_SECRET })).toEqual({ state: 'configured' });
  });

  it.each([
    ['the default literal', DEFAULT_DEV_EXECUTION_ATTESTATION_SECRET],
    ['too short (31)', 'a'.repeat(31)],
    ['empty (set counts as set)', ''],
    ['blank', '   '],
    ['padded default literal', ` ${DEFAULT_DEV_EXECUTION_ATTESTATION_SECRET} `],
  ])('invalid: %s -> REJECT_EXECUTION_ATTESTATION_SECRET_INVALID, the value never in the message', (_label, value) => {
    const env = { [EXECUTION_ATTESTATION_HMAC_SECRET_ENV]: value };
    expect(describeExecutionAttestationSecret(env)).toMatchObject({ state: 'invalid' });
    let thrown: unknown = null;
    try {
      createConfiguredExecutionAttestationSigner(env);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as { code?: string }).code).toBe(REJECT_EXECUTION_ATTESTATION_SECRET_INVALID);
    if (value.trim()) expect((thrown as Error).message).not.toContain(value.trim());
    expect((thrown as Error).message).toContain(EXECUTION_ATTESTATION_HMAC_SECRET_ENV);
  });
});

describe('the start-up gate: product runtime outside explicit dev/test never starts on the default secret', () => {
  it.each([
    ['production, both set', { NODE_ENV: 'production', APP_ENV: 'production' }],
    ['development with APP_ENV unset (the worktree runtime)', { NODE_ENV: 'development' }],
    ['development with APP_ENV empty', { NODE_ENV: 'development', APP_ENV: '' }],
    ['test with APP_ENV unset', { NODE_ENV: 'test' }],
    ['staging', { NODE_ENV: 'production', APP_ENV: 'staging' }],
    ['nothing set', {}],
    ['APP_ENV development without NODE_ENV', { APP_ENV: 'development' }],
  ])('%s without a configured secret -> refuses (REJECT_EXECUTION_ATTESTATION_DEFAULT_SECRET_OUTSIDE_DEV)', (_label, env) => {
    let thrown: unknown = null;
    try {
      assertExecutionAttestationSecretAtStartup(env, 'web');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ExecutionAttestationSecretError);
    expect((thrown as ExecutionAttestationSecretError).code).toBe(REJECT_EXECUTION_ATTESTATION_DEFAULT_SECRET_OUTSIDE_DEV);
    const message = (thrown as Error).message;
    expect(message).toContain(EXECUTION_ATTESTATION_HMAC_SECRET_ENV);
    expect(message).not.toContain(DEFAULT_DEV_EXECUTION_ATTESTATION_SECRET);
    expect(message).not.toMatch(/authentic|äkthet|verifierad|tamper/i);
  });

  it.each([
    ['explicit development', { NODE_ENV: 'development', APP_ENV: 'development' }],
    ['explicit test', { NODE_ENV: 'test', APP_ENV: 'test' }],
    ['explicit ci', { NODE_ENV: 'test', APP_ENV: 'ci' }],
  ])('%s without a configured secret -> the dev signer is allowed, and said so', (_label, env) => {
    expect(assertExecutionAttestationSecretAtStartup(env, 'web')).toEqual({ signer: 'default-dev', key_id: DEFAULT_DEV_EXECUTION_ATTESTATION_KEY_ID });
  });

  it.each([
    ['production', { NODE_ENV: 'production', APP_ENV: 'production' }],
    ['worktree development', { NODE_ENV: 'development' }],
    ['explicit development (configured wins over the default)', { NODE_ENV: 'development', APP_ENV: 'development' }],
  ])('%s with a configured secret -> the configured signer', (_label, env) => {
    expect(assertExecutionAttestationSecretAtStartup({ ...env, [EXECUTION_ATTESTATION_HMAC_SECRET_ENV]: VALID_SECRET }, 'web')).toEqual({
      signer: 'configured',
      key_id: CONFIGURED_EXECUTION_ATTESTATION_KEY_ID,
    });
  });

  it('an invalid configured secret refuses everywhere, also in an explicit development process', () => {
    for (const env of [{ NODE_ENV: 'development', APP_ENV: 'development' }, { NODE_ENV: 'production', APP_ENV: 'production' }, { NODE_ENV: 'test', APP_ENV: 'test' }]) {
      for (const value of [DEFAULT_DEV_EXECUTION_ATTESTATION_SECRET, 'short', '']) {
        let thrown: unknown = null;
        try {
          assertExecutionAttestationSecretAtStartup({ ...env, [EXECUTION_ATTESTATION_HMAC_SECRET_ENV]: value }, 'web');
        } catch (error) {
          thrown = error;
        }
        expect(thrown, `${JSON.stringify(env)} value ${JSON.stringify(value)}`).toBeInstanceOf(ExecutionAttestationSecretError);
        expect((thrown as ExecutionAttestationSecretError).code).toBe(REJECT_EXECUTION_ATTESTATION_SECRET_INVALID);
      }
    }
  });
});

describe('the LU kernel client signs outcome attestations with the configured signer', () => {
  function spatialEvidence(id: string): SpatialEvidenceArtifact {
    return {
      artifact_id: id,
      artifact_type: 'SPATIAL_EVIDENCE',
      content_hash: { algorithm: 'sha256', value: `hash-${id}` },
      references: [{ artifact_id: 'prop-u42', artifact_type: 'PROPERTY' }],
      payload: {
        result_semantics: {
          kind: 'EXISTENCE_WITHIN_DISTANCE',
          query: { subject_ref: { artifact_id: 'prop-u42', artifact_type: 'PROPERTY' }, srid: 3006, distance_meters: 100 },
          result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
        },
        property_ref: { artifact_id: 'prop-u42', artifact_type: 'PROPERTY' },
        geometry: null,
        srid: 3006,
        operation: { algorithm: 'spatial.dwithin_existence', engine: 'PostGIS', engine_fingerprint: SPATIAL_STACK_V1 },
        layer_ref: { layer_id: 'water', version_hash: '2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc', layer_version: 'v1' },
        source_metadata: { provider: 'SGU', dataset: 'water', dataset_version: '2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc', retrieved_at: '2026-10-03T00:00:00.000Z' },
        query_context: {
          query_id: 'q-u42',
          query_type: 'SPATIAL_DWITHIN',
          parameters: { property_ref: { artifact_id: 'prop-u42', artifact_type: 'PROPERTY' }, search_distance_meters: 100 },
        },
      },
    } as unknown as SpatialEvidenceArtifact;
  }

  async function run(seed: string) {
    // bootstrap admission is the explicit opt-in of the general engine (no issued identity in this hermetic run)
    process.env.MPS_LU_BOOTSTRAP_ADMIT = '1';
    return runLuAssessmentViaKernel({
      site_id: `site-u42-${seed}`,
      deterministic_seed: `seed:u42:${seed}`,
      evidence: [spatialEvidence(`spatial-${seed}`)],
      artifact_repository: new InMemoryArtifactRepository(),
    });
  }

  it('without a configured secret the attestation carries the dev key id (unchanged behaviour for tests and explicit dev)', async () => {
    const result = await run('dev');
    expect(result.admitted).toBe(true);
    expect(result.attestation?.key_id).toBe(DEFAULT_DEV_EXECUTION_ATTESTATION_KEY_ID);
  });

  it('with a configured secret the attestation is signed under the configured key id and verifies with that secret only', async () => {
    process.env[EXECUTION_ATTESTATION_HMAC_SECRET_ENV] = VALID_SECRET;
    const result = await run('configured');
    expect(result.admitted).toBe(true);
    const attestation = result.attestation!;
    expect(attestation.key_id).toBe(CONFIGURED_EXECUTION_ATTESTATION_KEY_ID);
    const payload = `${LU_EXECUTION_PRINCIPAL_ID}:${attestation.outcome_hash.algorithm}:${attestation.outcome_hash.value}`;
    expect(attestation.principal_id).toBe(LU_EXECUTION_PRINCIPAL_ID);
    expect(createConfiguredExecutionAttestationSigner(process.env)!.verify(payload, attestation.signature)).toBe(true);
    expect(createDefaultDevExecutionAttestationSigner().verify(payload, attestation.signature)).toBe(false);
  });

  it('with an invalid configured secret the run refuses before signing (fail-closed in the client too)', async () => {
    process.env[EXECUTION_ATTESTATION_HMAC_SECRET_ENV] = DEFAULT_DEV_EXECUTION_ATTESTATION_SECRET;
    await expect(run('invalid')).rejects.toMatchObject({ code: REJECT_EXECUTION_ATTESTATION_SECRET_INVALID });
  });
});

describe('source pins: where the gate sits and that no other process signs', () => {
  it('server/index.ts runs the gate for the web role inside the non-test block, before the database sanity check and the listen', () => {
    const src = read('server/index.ts');
    const block = src.indexOf("if (process.env.NODE_ENV !== 'test') {");
    const gate = src.indexOf("assertExecutionAttestationSecretAtStartup(process.env, 'web')");
    expect(block).toBeGreaterThan(0);
    expect(gate, 'the gate is called with the web role').toBeGreaterThan(block);
    expect(gate).toBeLessThan(src.indexOf('async function verifyDatabaseSanity'));
    expect(gate).toBeLessThan(src.indexOf('server.listen('));
    expect(src, 'a refusal stops the process').toMatch(/assertExecutionAttestationSecretAtStartup[\s\S]*?catch[\s\S]*?process\.exit\(1\)/);
  });

  it('the LU kernel client hands the configured signer to SecurityRuntime (and nothing else constructs one in the server)', () => {
    const client = read('packages/mps-lu/src/execution/LuExecutionKernelClient.ts');
    expect(client).toMatch(/SecurityRuntime\.create\(\{[\s\S]*?signer: createConfiguredExecutionAttestationSigner\(process\.env\) \?\? undefined/);
    const serverSources = ['server', 'src/application'].map((r) => path.join(REPO_ROOT, r)).flatMap(walkSources);
    const constructing = serverSources.filter((f) => /SecurityRuntime\.create\(/.test(fs.readFileSync(f, 'utf8')));
    expect(constructing, 'only the LU kernel client constructs SecurityRuntime; the workers never sign').toEqual([]);
  });

  it('no name or text in the new surface claims authenticity verification', () => {
    for (const rel of ['packages/mps-runtime/src/security/ExecutionAttestationSecret.ts', 'server/modules/release/executionAttestationStartupGate.ts']) {
      expect(read(rel), rel).not.toMatch(/authentic|äkthet|verifierad|tamper|manipulationss/i);
    }
  });
});
