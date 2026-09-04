import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { assertAllTargetsEmpty, createKeypair, keypairPaths } from '../../server/security/ceremonyKeypairBootstrap';
import { ceremonyTargets } from '../../scripts/ops/bootstrap-ceremony-keypairs-v1';
import { getGovernanceVerificationProvider, __resetGovernanceSigningProviderForTests } from '../../server/security/governanceSigningKey';
import { getProductReleaseIssuerVerifier } from '../../server/security/productReleaseIssuerKey';
import { getProjectContextBindingIssuerVerifier } from '../../server/security/projectContextBindingIssuerKey';

const roots: string[] = [];
const targets = [
  { family: 'admin-role-issuer', keyId: 'ed25519:product-admin-role-issuer-v1' },
  { family: 'governance-signing', keyId: 'ed25519:governance-promotion-v1' },
  { family: 'legal-corpus-materialization-signing', keyId: 'ed25519:legal-corpus-materialization-v1' },
] as const;
function root() { const value = mkdtempSync(join(tmpdir(), 'ceremony-v1-')); roots.push(value); return value; }
afterEach(() => roots.splice(0).forEach((value) => rmSync(value, { recursive: true, force: true })));

describe('CEREMONY-KEYPAIR-KERNEL-VERIFY-BOUNDARIES-01', () => {
  it.each(targets)('B1/B7 creates a usable %s pair', async (target) => {
    const pair = createKeypair(root(), target); const provider = new LocalPemSigningKeyProvider(pair.keyId, pair.privatePem, pair.publicPem);
    const bytes = new TextEncoder().encode(target.family); await expect(provider.verify(bytes, await provider.sign(bytes))).resolves.toBe(true);
  });
  it.each(targets)('B2/B5 denies complete existing %s bytes unchanged', (target) => {
    const dir = root(); createKeypair(dir, target); const paths = keypairPaths(dir, target.family); const before = [readFileSync(paths.privatePath), readFileSync(paths.publicPath)];
    expect(() => createKeypair(dir, target)).toThrow('ALREADY_PROVISIONED'); expect([readFileSync(paths.privatePath), readFileSync(paths.publicPath)]).toEqual(before);
  });
  it.each(['private.pem', 'public.pem'] as const)('B3/B4 denies partial state', (present) => {
    const dir = root(); const target = targets[0]; const paths = keypairPaths(dir, target.family); mkdirSync(paths.directory, { recursive: true }); writeFileSync(join(paths.directory, present), 'sentinel');
    expect(() => createKeypair(dir, target)).toThrow('INCONSISTENT_KEY_STATE'); expect(readFileSync(join(paths.directory, present), 'utf8')).toBe('sentinel');
  });
  it('preflights all families before any write', () => {
    const dir = root(); createKeypair(dir, targets[1]); expect(() => assertAllTargetsEmpty(dir, targets)).toThrow('ALREADY_PROVISIONED'); expect(existsSync(keypairPaths(dir, targets[0].family).privatePath)).toBe(false);
  });
  it('keeps Product Release and Project Context key ids configuration-driven', () => {
    const resolved = ceremonyTargets({ PRODUCT_RELEASE_ISSUER_KEY_ID: 'release-key', PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID: 'context-key' });
    expect(resolved).toContainEqual({ family: 'product-release-issuer', keyId: 'release-key' });
    expect(resolved).toContainEqual({ family: 'project-context-binding-issuer', keyId: 'context-key' });
    expect(() => ceremonyTargets({})).toThrow('PRODUCT_RELEASE_ISSUER_KEY_ID');
  });
  it('builds Governance verification from public trust only', async () => {
    const pair = createKeypair(root(), targets[1]);
    __resetGovernanceSigningProviderForTests();
    const verifier = getGovernanceVerificationProvider({ GOVERNANCE_SIGNING_PUBLIC_KEY_PEM: pair.publicPem });
    const signer = new LocalPemSigningKeyProvider(pair.keyId, pair.privatePem, pair.publicPem);
    const bytes = new TextEncoder().encode('public-only-governance');
    await expect(verifier.verify(bytes, await signer.sign(bytes))).resolves.toBe(true);
    __resetGovernanceSigningProviderForTests();
  });
  it('verifies all A-family signatures with public trust only and rejects a wrong key', async () => {
    const pairs = Object.fromEntries(([
      ['admin', { family: 'admin-role-issuer', keyId: 'ed25519:product-admin-role-issuer-v1' }],
      ['governance', { family: 'governance-signing', keyId: 'ed25519:governance-promotion-v1' }],
      ['legal', { family: 'legal-corpus-materialization-signing', keyId: 'ed25519:legal-corpus-materialization-v1' }],
      ['release', { family: 'product-release-issuer', keyId: 'release-key' }],
      ['context', { family: 'project-context-binding-issuer', keyId: 'context-key' }],
    ] as const).map(([name, target]) => [name, createKeypair(root(), target)]));
    const bytes = new TextEncoder().encode('A-public-only');
    const governanceVerifier = getGovernanceVerificationProvider({ GOVERNANCE_SIGNING_PUBLIC_KEY_PEM: pairs.governance.publicPem });
    await expect(governanceVerifier.verify(bytes, await new LocalPemSigningKeyProvider(pairs.governance.keyId, pairs.governance.privatePem, pairs.governance.publicPem).sign(bytes))).resolves.toBe(true);
    const releaseVerifier = getProductReleaseIssuerVerifier({ PRODUCT_RELEASE_ISSUER_KEY_ID: pairs.release.keyId, PRODUCT_RELEASE_ISSUER_PUBLIC_KEY_PEM: pairs.release.publicPem });
    const contextVerifier = getProjectContextBindingIssuerVerifier({ PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID: pairs.context.keyId, PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM: pairs.context.publicPem });
    await expect(releaseVerifier.verify(bytes, await new LocalPemSigningKeyProvider(pairs.release.keyId, pairs.release.privatePem, pairs.release.publicPem).sign(bytes))).resolves.toBe(true);
    await expect(contextVerifier.verify(bytes, await new LocalPemSigningKeyProvider(pairs.context.keyId, pairs.context.privatePem, pairs.context.publicPem).sign(bytes))).resolves.toBe(true);
  });
});
