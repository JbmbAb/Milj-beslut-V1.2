import { createHash, generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadVerifiedSourceRegistry } from '../src/SourceRegistry';

const REPO_ROOT = resolve(__dirname, '../../..');
const REGISTRY_PATH = join(REPO_ROOT, 'source-registry', 'national-registry.json');
const TRUST_SEED_PATH = join(REPO_ROOT, 'source-registry', 'trust', 'source-registry-trusted-keys.json');
const SUCCESSOR_KEY_ID = 'ed25519:source-registry-governor-2026-08-25';
const SUCCESSOR_PUBLIC_KEY_SHA256 = '233288a3492eb7a736602e208ce75db97d3c24d7d7f59c53e40899d24e741609';
const REGISTRY_SHA256 = '06828ad0d98bf842e75335ed4cdf25e58bb851a0ff44a226b58046252cb0e20b';

function sha256(bytes: string): string {
  return createHash('sha256').update(bytes, 'utf8').digest('hex');
}

describe('SOURCE-REGISTRY-PUBLIC-TRUST-SEED-01', () => {
  const saved = {
    trustedKeysFile: process.env.SOURCE_REGISTRY_TRUSTED_KEYS_FILE,
    registryPath: process.env.SOURCE_REGISTRY_ARTIFACT_PATH,
    privateKey: process.env.SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM,
    publicKey: process.env.SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM,
    signingKeyId: process.env.SOURCE_REGISTRY_SIGNING_KEY_ID,
  };

  afterEach(() => {
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore('SOURCE_REGISTRY_TRUSTED_KEYS_FILE', saved.trustedKeysFile);
    restore('SOURCE_REGISTRY_ARTIFACT_PATH', saved.registryPath);
    restore('SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM', saved.privateKey);
    restore('SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM', saved.publicKey);
    restore('SOURCE_REGISTRY_SIGNING_KEY_ID', saved.signingKeyId);
  });

  it('commits the exact successor public key and verifies the unchanged active registry without private material', async () => {
    const before = readFileSync(REGISTRY_PATH, 'utf8');
    expect(sha256(before)).toBe(REGISTRY_SHA256);
    const seed = JSON.parse(readFileSync(TRUST_SEED_PATH, 'utf8')) as Record<string, string>;
    expect(Object.keys(seed)).toEqual([SUCCESSOR_KEY_ID]);
    expect(sha256(seed[SUCCESSOR_KEY_ID]!)).toBe(SUCCESSOR_PUBLIC_KEY_SHA256);

    process.env.SOURCE_REGISTRY_TRUSTED_KEYS_FILE = TRUST_SEED_PATH;
    process.env.SOURCE_REGISTRY_ARTIFACT_PATH = REGISTRY_PATH;
    delete process.env.SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM;
    delete process.env.SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM;
    delete process.env.SOURCE_REGISTRY_SIGNING_KEY_ID;

    const registry = await loadVerifiedSourceRegistry();
    expect(registry.sources).toHaveLength(13);
    expect(readFileSync(REGISTRY_PATH, 'utf8')).toBe(before);
  });

  it('rejects trust aliasing: the correct key id with different public material cannot verify the registry', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'source-registry-wrong-trust-'));
    const wrongPem = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const wrongSeedPath = join(directory, 'trusted-keys.json');
    writeFileSync(wrongSeedPath, JSON.stringify({ [SUCCESSOR_KEY_ID]: wrongPem }, null, 2) + '\n', 'utf8');

    process.env.SOURCE_REGISTRY_TRUSTED_KEYS_FILE = wrongSeedPath;
    process.env.SOURCE_REGISTRY_ARTIFACT_PATH = REGISTRY_PATH;
    delete process.env.SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM;

    await expect(loadVerifiedSourceRegistry()).rejects.toThrow();
    expect(sha256(readFileSync(REGISTRY_PATH, 'utf8'))).toBe(REGISTRY_SHA256);
  });

  it('fresh verify-only process loads all 13 active entries with no private-key environment', () => {
    const sourceRegistryUrl = pathToFileURL(join(REPO_ROOT, 'packages', 'mps-data-governance', 'src', 'SourceRegistry.ts')).href;
    const program = [
      `import { loadVerifiedSourceRegistry } from ${JSON.stringify(sourceRegistryUrl)};`,
      'const registry = await loadVerifiedSourceRegistry();',
      "if (registry.sources.length !== 13) throw new Error('unexpected active source count');",
      "process.stdout.write('VERIFY_ONLY_13_OF_13');",
    ].join('\n');
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      SOURCE_REGISTRY_TRUSTED_KEYS_FILE: TRUST_SEED_PATH,
      SOURCE_REGISTRY_ARTIFACT_PATH: REGISTRY_PATH,
    };
    delete environment.SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM;
    delete environment.SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM;
    delete environment.SOURCE_REGISTRY_SIGNING_KEY_ID;

    const output = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', program], {
      cwd: REPO_ROOT,
      env: environment,
      encoding: 'utf8',
    });
    expect(output).toContain('VERIFY_ONLY_13_OF_13');
  });
});
