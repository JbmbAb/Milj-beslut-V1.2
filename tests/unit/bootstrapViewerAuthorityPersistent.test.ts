import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import {
  assertBootstrapExecute,
  assertKeyPairTargetEmpty,
  generateAndPersistKeyPair,
} from '../../scripts/ops/bootstrap-viewer-authority-persistent';

const roots: string[] = [];

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'viewer-authority-bootstrap-'));
  roots.push(value);
  return value;
}

function keyPaths(secretsDir: string, name: string) {
  const dir = join(secretsDir, name);
  return { dir, privatePath: join(dir, 'private.pem'), publicPath: join(dir, 'public.pem') };
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe('VIEWER-AUTHORITY-BOOTSTRAP-OVERWRITE-GUARD-01', () => {
  it('V1: creates a usable Viewer Capability key pair only when its target is empty', async () => {
    const secretsDir = root();
    const name = 'viewer-capability-issuer-v1';
    const { privatePath, publicPath } = keyPaths(secretsDir, name);

    const pair = generateAndPersistKeyPair(name, 'ed25519:viewer-capability-issuer-v1', secretsDir);
    const provider = new LocalPemSigningKeyProvider(pair.keyId, pair.privatePem, pair.publicPem);
    const message = new TextEncoder().encode('viewer-authority-bootstrap-key-usability');
    const signature = await provider.sign(message);

    expect(existsSync(privatePath)).toBe(true);
    expect(existsSync(publicPath)).toBe(true);
    await expect(provider.verify(message, signature)).resolves.toBe(true);
  });

  it.each([
    ['viewer-capability-issuer-v1', 'ed25519:viewer-capability-issuer-v1'],
    ['viewer-identity-issuer-v1', 'ed25519:viewer-identity-issuer-v1'],
  ])('V2/V3: refuses a complete existing %s pair without changing either byte', (name, keyId) => {
    const secretsDir = root();
    const paths = keyPaths(secretsDir, name);
    generateAndPersistKeyPair(name, keyId, secretsDir);
    const beforePrivate = readFileSync(paths.privatePath, 'utf8');
    const beforePublic = readFileSync(paths.publicPath, 'utf8');

    expect(() => generateAndPersistKeyPair(name, keyId, secretsDir))
      .toThrow('REJECT_VIEWER_AUTHORITY_BOOTSTRAP_ALREADY_PROVISIONED');
    expect(readFileSync(paths.privatePath, 'utf8')).toBe(beforePrivate);
    expect(readFileSync(paths.publicPath, 'utf8')).toBe(beforePublic);
  });

  it.each([
    ['private', 'private.pem', 'public.pem'],
    ['public', 'public.pem', 'private.pem'],
  ])('V4/V5: refuses a %s-only partial pair without changing it', (_kind, existingName, missingName) => {
    const secretsDir = root();
    const name = 'viewer-capability-issuer-v1';
    const { dir } = keyPaths(secretsDir, name);
    mkdirSync(dir, { recursive: true });
    const existingPath = join(dir, existingName);
    const missingPath = join(dir, missingName);
    writeFileSync(existingPath, 'sentinel-existing-key-byte');

    expect(() => generateAndPersistKeyPair(name, 'ed25519:viewer-capability-issuer-v1', secretsDir))
      .toThrow('REJECT_VIEWER_AUTHORITY_BOOTSTRAP_INCONSISTENT_KEY_STATE');
    expect(readFileSync(existingPath, 'utf8')).toBe('sentinel-existing-key-byte');
    expect(existsSync(missingPath)).toBe(false);
  });

  it('V6: successful bootstrap followed by a second invocation denies rather than rotates', () => {
    const secretsDir = root();
    const name = 'viewer-identity-issuer-v1';
    const paths = keyPaths(secretsDir, name);
    generateAndPersistKeyPair(name, 'ed25519:viewer-identity-issuer-v1', secretsDir);
    const firstPrivate = readFileSync(paths.privatePath, 'utf8');

    expect(() => generateAndPersistKeyPair(name, 'ed25519:viewer-identity-issuer-v1', secretsDir))
      .toThrow('REJECT_VIEWER_AUTHORITY_BOOTSTRAP_ALREADY_PROVISIONED');
    expect(readFileSync(paths.privatePath, 'utf8')).toBe(firstPrivate);
  });

  it('V7: dry-run gate refuses before any target path is created', () => {
    const secretsDir = root();

    expect(() => assertBootstrapExecute(['node', 'bootstrap-viewer-authority-persistent.ts']))
      .toThrow('refusing to write without --execute');
    expect(existsSync(join(secretsDir, 'viewer-capability-issuer-v1'))).toBe(false);
    expect(existsSync(join(secretsDir, 'viewer-identity-issuer-v1'))).toBe(false);
  });

  it('preflights both viewer trust roots before bootstrap may begin writing either family', () => {
    const secretsDir = root();
    generateAndPersistKeyPair('viewer-capability-issuer-v1', 'ed25519:viewer-capability-issuer-v1', secretsDir);

    expect(() => {
      assertKeyPairTargetEmpty('viewer-identity-issuer-v1', secretsDir);
      assertKeyPairTargetEmpty('viewer-capability-issuer-v1', secretsDir);
    }).toThrow('REJECT_VIEWER_AUTHORITY_BOOTSTRAP_ALREADY_PROVISIONED');
    expect(existsSync(join(secretsDir, 'viewer-identity-issuer-v1'))).toBe(false);
  });
});
