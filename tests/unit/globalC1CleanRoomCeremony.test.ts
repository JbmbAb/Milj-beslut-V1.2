import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { MimersIntegration, resetMimersCasCacheForTests } from '@miljobeslut/mps-runtime';
import { sha256ContentHash } from '../../packages/mps-compliance/src/canonical/sha256Canonical';
import { keypairPaths } from '../../server/security/ceremonyKeypairBootstrap';
import { verifyLuExecutionAuthorityCeremony } from '../../server/security/luExecutionAuthorityBootstrapCeremony';
import { verifyViewerIdentityArtifact } from '../../server/modules/localization/viewerIdentityAuthority';
import { verifyProductViewerCapability } from '../../server/modules/localization/productViewerCapabilityAuthority';
import { __resetViewerIdentityVerifierForTests } from '../../server/security/viewerIdentityVerifier';
import { __resetViewerCapabilityVerifierForTests } from '../../server/security/viewerCapabilityVerifier';
import { loadVerifiedSourceRegistry, createSourceRegistryTrustedKeyring } from '../../packages/mps-data-governance/src/SourceRegistry';
import { bootstrapGlobalC1CleanRoom } from '../../scripts/ops/global-c1-clean-room-ceremony-v1';

const REPO_ROOT = resolve(__dirname, '../..');
const roots: string[] = [];
const viewerEnvironment = {
  identityKeyId: process.env.VIEWER_IDENTITY_ISSUER_KEY_ID,
  identityPublicKey: process.env.VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM,
  capabilityKeyId: process.env.VIEWER_CAPABILITY_ISSUER_KEY_ID,
  capabilityPublicKey: process.env.VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM,
};

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function fileHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function input(secretsRoot: string, mimersRoot: string) {
  return {
    secretsRoot,
    mimersRoot,
    productReleaseIssuerKeyId: 'ed25519:c1-product-release-issuer',
    projectContextBindingIssuerKeyId: 'ed25519:c1-project-context-binding-issuer',
    luRootKeyId: 'ed25519:c1-lu-root',
    luIssuerKeyId: 'ed25519:c1-lu-issuer',
    viewer: {
      secretsDir: secretsRoot,
      projectId: 'c1-clean-room-project',
      contextBindingRef: { artifact_id: 'c1-current-binding', artifact_type: 'project_context_binding' },
      releaseRef: { artifact_id: 'c1-release', artifact_type: 'product_release_manifest' },
      releaseHash: 'c'.repeat(64),
      ownerAuthorityRef: { artifact_id: 'c1-owner-authority', artifact_type: 'owner_authority_attestation' },
      validFrom: '2026-08-26T00:00:00.000Z',
      validUntil: '2027-08-26T00:00:00.000Z',
    },
    sourceRegistryPath: join(REPO_ROOT, 'source-registry', 'national-registry.json'),
    sourceRegistryTrustedKeysPath: join(REPO_ROOT, 'source-registry', 'trust', 'source-registry-trusted-keys.json'),
  };
}

afterEach(() => {
  resetMimersCasCacheForTests();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  restoreEnvironment('VIEWER_IDENTITY_ISSUER_KEY_ID', viewerEnvironment.identityKeyId);
  restoreEnvironment('VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM', viewerEnvironment.identityPublicKey);
  restoreEnvironment('VIEWER_CAPABILITY_ISSUER_KEY_ID', viewerEnvironment.capabilityKeyId);
  restoreEnvironment('VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM', viewerEnvironment.capabilityPublicKey);
  __resetViewerIdentityVerifierForTests();
  __resetViewerCapabilityVerifierForTests();
});

describe('GLOBAL-C1-CLEAN-ROOM-CEREMONY-PROOF-01', () => {
  it('composes C, A, B and Viewer into an isolated clean-room and rejects a second execution without byte changes', async () => {
    const secretsRoot = temporaryRoot('global-c1-secrets-');
    const mimersRoot = temporaryRoot('global-c1-mimers-');
    const args = input(secretsRoot, mimersRoot);
    const registryBefore = fileHash(args.sourceRegistryPath);
    const result = await bootstrapGlobalC1CleanRoom(args);

    expect(result.sourceRegistryEntries).toBe(13);
    expect(result.viewer.capability.payload.subject_project_id).toBe(args.viewer.projectId);
    expect(result.viewer.capability.payload.project_context_binding_ref).toEqual(args.viewer.contextBindingRef);
    expect(existsSync(join(secretsRoot, 'legal-corpus-signing'))).toBe(false);

    const families = [
      'admin-role-issuer',
      'governance-signing',
      'legal-corpus-materialization-signing',
      'product-release-issuer',
      'project-context-binding-issuer',
      'lu-execution-authority-root',
      'lu-execution-authority-issuer',
      'viewer-identity-issuer-v1',
      'viewer-capability-issuer-v1',
    ];
    const hashes = families.flatMap((family) => {
      const paths = keypairPaths(secretsRoot, family);
      expect(existsSync(paths.privatePath)).toBe(true);
      expect(existsSync(paths.publicPath)).toBe(true);
      return [fileHash(paths.privatePath), fileHash(paths.publicPath)];
    });

    await expect(bootstrapGlobalC1CleanRoom(args)).rejects.toThrow('REJECT_CEREMONY_ALREADY_PROVISIONED');
    expect(families.flatMap((family) => {
      const paths = keypairPaths(secretsRoot, family);
      return [fileHash(paths.privatePath), fileHash(paths.publicPath)];
    })).toEqual(hashes);
    expect(fileHash(args.sourceRegistryPath)).toBe(registryBefore);

    const rootPublicPem = readFileSync(keypairPaths(secretsRoot, 'lu-execution-authority-root').publicPath, 'utf8');
    const issuerPublicPem = readFileSync(keypairPaths(secretsRoot, 'lu-execution-authority-issuer').publicPath, 'utf8');
    const viewerIdentityPublicPem = readFileSync(keypairPaths(secretsRoot, 'viewer-identity-issuer-v1').publicPath, 'utf8');
    const viewerCapabilityPublicPem = readFileSync(keypairPaths(secretsRoot, 'viewer-capability-issuer-v1').publicPath, 'utf8');
    for (const family of [
      'lu-execution-authority-root',
      'lu-execution-authority-issuer',
      'viewer-identity-issuer-v1',
      'viewer-capability-issuer-v1',
    ]) rmSync(keypairPaths(secretsRoot, family).privatePath);
    resetMimersCasCacheForTests();
    const publicOnlyMimers = await MimersIntegration.create({
      env: { ...process.env, MIMERS_ROOT: mimersRoot, MIMERS_REQUIRED: '1' },
      forceMimers: true,
    });
    await expect(verifyLuExecutionAuthorityCeremony({
      issuerRef: { artifact_id: result.b.issuer.artifact_id, artifact_type: result.b.issuer.artifact_type },
      repository: publicOnlyMimers.artifactRepository,
      rootPublicPem,
      issuerPublicPem,
      keyIds: { rootKeyId: args.luRootKeyId, issuerKeyId: args.luIssuerKeyId },
    })).resolves.toEqual(result.b.issuer);
    expect(new LocalPemVerificationKeyProvider(args.luIssuerKeyId, issuerPublicPem).keyId).toBe(args.luIssuerKeyId);
    const releaseBody = { release_hash: { value: args.viewer.releaseHash } };
    await publicOnlyMimers.artifactRepository.put({
      artifact_id: args.viewer.releaseRef.artifact_id,
      content_hash: sha256ContentHash(releaseBody),
      body: releaseBody,
    });
    await expect(verifyViewerIdentityArtifact({
      identityRef: { artifact_id: result.viewer.identity.artifact_id, artifact_type: result.viewer.identity.artifact_type },
      repository: publicOnlyMimers.artifactRepository,
      verification: new LocalPemVerificationKeyProvider(result.viewer.identityIssuer.payload.issuer_key_id, viewerIdentityPublicPem),
      releaseId: args.viewer.releaseRef.artifact_id,
      releaseHash: args.viewer.releaseHash,
    })).resolves.toEqual(result.viewer.identity);
    process.env.VIEWER_IDENTITY_ISSUER_KEY_ID = result.viewer.identityIssuer.payload.issuer_key_id;
    process.env.VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM = viewerIdentityPublicPem;
    process.env.VIEWER_CAPABILITY_ISSUER_KEY_ID = result.viewer.capabilityIssuer.payload.issuer_key_id;
    process.env.VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM = viewerCapabilityPublicPem;
    __resetViewerIdentityVerifierForTests();
    __resetViewerCapabilityVerifierForTests();
    await expect(verifyProductViewerCapability({
      capability: result.viewer.capability,
      repository: publicOnlyMimers.artifactRepository,
      verification: new LocalPemVerificationKeyProvider(result.viewer.capabilityIssuer.payload.issuer_key_id, viewerCapabilityPublicPem),
      projectId: args.viewer.projectId,
      bindingId: args.viewer.contextBindingRef.artifact_id,
      viewerIdentityId: result.viewer.identity.artifact_id,
      releaseId: args.viewer.releaseRef.artifact_id,
      releaseHash: args.viewer.releaseHash,
      now: new Date('2026-08-26T00:00:00.000Z'),
      currentBindingProvider: { resolveCurrent: async () => ({ artifact_id: args.viewer.contextBindingRef.artifact_id }) } as any,
    })).resolves.toBeUndefined();
    const seed = JSON.parse(readFileSync(args.sourceRegistryTrustedKeysPath, 'utf8')) as Record<string, string>;
    await expect(loadVerifiedSourceRegistry({
      registryPath: args.sourceRegistryPath,
      trustedKeyring: createSourceRegistryTrustedKeyring(new Map(Object.entries(seed))),
    })).resolves.toMatchObject({ sources: expect.any(Array) });
  });

  it('rejects an invalid public-trust seed before creating any private key material', async () => {
    const secretsRoot = temporaryRoot('global-c1-secrets-');
    const args = input(secretsRoot, temporaryRoot('global-c1-mimers-'));
    args.sourceRegistryTrustedKeysPath = join(REPO_ROOT, 'source-registry', 'national-registry.json');

    await expect(bootstrapGlobalC1CleanRoom(args)).rejects.toThrow();
    expect(existsSync(join(secretsRoot, 'admin-role-issuer'))).toBe(false);
    expect(existsSync(join(secretsRoot, 'lu-execution-authority-root'))).toBe(false);
    expect(existsSync(join(secretsRoot, 'viewer-identity-issuer-v1'))).toBe(false);
  });
});
