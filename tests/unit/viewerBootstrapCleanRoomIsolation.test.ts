import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { InMemoryArtifactRepository } from '../../packages/mps-runtime/src/repository/InMemoryArtifactRepository';
import { MimersIntegration } from '../../packages/mps-runtime/src/mimers/MimersIntegration';
import { sha256ContentHash } from '../../packages/mps-compliance/src/canonical/sha256Canonical';
import { verifyViewerIdentityArtifact, verifyViewerIdentityIssuerArtifact } from '../../server/modules/localization/viewerIdentityAuthority';
import { verifyProductViewerCapability, verifyViewerCapabilityIssuerArtifact } from '../../server/modules/localization/productViewerCapabilityAuthority';
import { ProjectContextBindingProvider } from '../../server/modules/localization/projectContextBindingRuntime';
import { __resetViewerIdentityVerifierForTests } from '../../server/security/viewerIdentityVerifier';
import { __resetViewerCapabilityVerifierForTests } from '../../server/security/viewerCapabilityVerifier';
import {
  assertKeyPairTargetEmpty,
  bootstrapViewerAuthority,
  cleanRoomViewerBootstrapInput,
  cleanRoomMimersEnvironment,
  legacyViewerBootstrapInput,
  type ViewerBootstrapInput,
} from '../../scripts/ops/bootstrap-viewer-authority-persistent';

const roots: string[] = [];
const originalEnv = {
  identityKeyId: process.env.VIEWER_IDENTITY_ISSUER_KEY_ID,
  identityPublic: process.env.VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM,
  identityPrivate: process.env.VIEWER_IDENTITY_ISSUER_PRIVATE_KEY_PEM,
  capabilityKeyId: process.env.VIEWER_CAPABILITY_ISSUER_KEY_ID,
  capabilityPublic: process.env.VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM,
  capabilityPrivate: process.env.VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM,
};

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'viewer-bootstrap-clean-room-'));
  roots.push(value);
  return value;
}

function input(secretsDir: string): ViewerBootstrapInput {
  return {
    secretsDir,
    projectId: 'clean-room-project',
    contextBindingRef: { artifact_id: 'clean-room-binding', artifact_type: 'project_context_binding' },
    releaseRef: { artifact_id: 'clean-room-release', artifact_type: 'product_release_manifest' },
    releaseHash: 'a'.repeat(64),
    ownerAuthorityRef: { artifact_id: 'clean-room-owner-authority', artifact_type: 'owner_authority_attestation' },
    validFrom: '2026-08-25T00:00:00.000Z',
    validUntil: '2027-08-25T00:00:00.000Z',
  };
}

function keyPaths(secretsDir: string, family: string) {
  const directory = join(secretsDir, family);
  return { privatePath: join(directory, 'private.pem'), publicPath: join(directory, 'public.pem') };
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
  restore('VIEWER_IDENTITY_ISSUER_KEY_ID', originalEnv.identityKeyId);
  restore('VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM', originalEnv.identityPublic);
  restore('VIEWER_IDENTITY_ISSUER_PRIVATE_KEY_PEM', originalEnv.identityPrivate);
  restore('VIEWER_CAPABILITY_ISSUER_KEY_ID', originalEnv.capabilityKeyId);
  restore('VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM', originalEnv.capabilityPublic);
  restore('VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM', originalEnv.capabilityPrivate);
  __resetViewerIdentityVerifierForTests();
  __resetViewerCapabilityVerifierForTests();
});

describe('VIEWER-BOOTSTRAP-CLEAN-ROOM-ISOLATION-01', () => {
  it('V1/V3/V7: writes only explicit clean-room secrets and mints real artifacts into the supplied repository', async () => {
    const secretsDir = root();
    const mimersRoot = root();
    const liveSecretsRoot = root();
    const liveSentinel = join(liveSecretsRoot, 'sentinel.txt');
    writeFileSync(liveSentinel, 'live-secrets-must-remain-untouched');
    const mimers = await MimersIntegration.create({
      env: { ...process.env, MIMERS_ROOT: mimersRoot, MIMERS_REQUIRED: '1' },
      forceMimers: true,
    });
    const result = await bootstrapViewerAuthority({ input: input(secretsDir), artifactRepository: mimers.artifactRepository });
    await mimers.rebuildIndex();

    for (const family of ['viewer-identity-issuer-v1', 'viewer-capability-issuer-v1']) {
      expect(existsSync(keyPaths(secretsDir, family).privatePath)).toBe(true);
      expect(existsSync(keyPaths(secretsDir, family).publicPath)).toBe(true);
    }
    expect(mimers.isMimersBacked).toBe(true);
    await expect(mimers.artifactRepository.resolve({ artifact_id: result.identity.artifact_id, artifact_type: result.identity.artifact_type })).resolves.toEqual(result.identity);
    await expect(mimers.artifactRepository.resolve({ artifact_id: result.capability.artifact_id, artifact_type: result.capability.artifact_type })).resolves.toEqual(result.capability);
    expect(result.capability.payload.subject_project_id).toBe('clean-room-project');
    expect(result.capability.payload.project_context_binding_ref.artifact_id).toBe('clean-room-binding');
    expect(readFileSync(liveSentinel, 'utf8')).toBe('live-secrets-must-remain-untouched');
  });

  it('V2: retains the existing default legacy input when clean-room flags are absent', () => {
    const legacy = legacyViewerBootstrapInput(new Date('2026-08-25T00:00:00.000Z'));
    expect(legacy.secretsDir).toBe('C:/Users/jimmy/.mimers/secrets');
    expect(legacy.projectId).toBe('cmt2m7bdj0000h0f7uj4jykis');
    expect(legacy.contextBindingRef.artifact_id).toBe('project-context-binding-32f1ff68cf89421ac4b75d86');
  });

  it('V4/V10: clean-room mode requires explicit refs and never falls back to fixed ORSA inputs', () => {
    const secretsDir = root();
    expect(() => cleanRoomViewerBootstrapInput([
      'node', 'bootstrap', '--secrets-root', secretsDir,
      '--valid-from', '2026-08-25T00:00:00.000Z',
      '--valid-until', '2027-08-25T00:00:00.000Z',
    ])).toThrow('--project-id is required');
    expect(existsSync(join(secretsDir, 'viewer-identity-issuer-v1'))).toBe(false);
  });

  it('V4: clean-room mode requires an explicit Mimer runtime root before bootstrap may run', () => {
    expect(() => cleanRoomMimersEnvironment(['node', 'bootstrap']))
      .toThrow('--mimers-root is required');
  });

  it('V5: a second clean-room execute denies and preserves both keypair bytes', async () => {
    const secretsDir = root();
    const repo = new InMemoryArtifactRepository();
    await bootstrapViewerAuthority({ input: input(secretsDir), artifactRepository: repo });
    const before = ['viewer-identity-issuer-v1', 'viewer-capability-issuer-v1'].flatMap((family) => {
      const paths = keyPaths(secretsDir, family);
      return [readFileSync(paths.privatePath, 'utf8'), readFileSync(paths.publicPath, 'utf8')];
    });

    await expect(bootstrapViewerAuthority({ input: input(secretsDir), artifactRepository: repo }))
      .rejects.toThrow('REJECT_VIEWER_AUTHORITY_BOOTSTRAP_ALREADY_PROVISIONED');

    const after = ['viewer-identity-issuer-v1', 'viewer-capability-issuer-v1'].flatMap((family) => {
      const paths = keyPaths(secretsDir, family);
      return [readFileSync(paths.privatePath, 'utf8'), readFileSync(paths.publicPath, 'utf8')];
    });
    expect(after).toEqual(before);
  });

  it('V6: a partial keypair remains rejected without creating its missing mate', () => {
    const secretsDir = root();
    const paths = keyPaths(secretsDir, 'viewer-identity-issuer-v1');
    mkdirSync(join(secretsDir, 'viewer-identity-issuer-v1'), { recursive: true });
    writeFileSync(paths.privatePath, 'sentinel-private');

    expect(() => assertKeyPairTargetEmpty('viewer-identity-issuer-v1', secretsDir))
      .toThrow('REJECT_VIEWER_AUTHORITY_BOOTSTRAP_INCONSISTENT_KEY_STATE');
    expect(readFileSync(paths.privatePath, 'utf8')).toBe('sentinel-private');
    expect(existsSync(paths.publicPath)).toBe(false);
  });

  it('V8/V9: public-only verification succeeds after isolated private keys are removed', async () => {
    const secretsDir = root();
    const repo = new InMemoryArtifactRepository();
    const cleanInput = input(secretsDir);
    const releaseBody = { release_hash: { value: cleanInput.releaseHash } };
    await repo.put({
      artifact_id: cleanInput.releaseRef.artifact_id,
      content_hash: sha256ContentHash(releaseBody),
      body: releaseBody,
    });
    const result = await bootstrapViewerAuthority({ input: cleanInput, artifactRepository: repo });
    const identityPaths = keyPaths(secretsDir, 'viewer-identity-issuer-v1');
    const capabilityPaths = keyPaths(secretsDir, 'viewer-capability-issuer-v1');
    const identityPublic = readFileSync(identityPaths.publicPath, 'utf8');
    const capabilityPublic = readFileSync(capabilityPaths.publicPath, 'utf8');
    rmSync(identityPaths.privatePath);
    rmSync(capabilityPaths.privatePath);

    delete process.env.VIEWER_IDENTITY_ISSUER_PRIVATE_KEY_PEM;
    delete process.env.VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM;
    process.env.VIEWER_IDENTITY_ISSUER_KEY_ID = result.identityIssuer.payload.issuer_key_id;
    process.env.VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM = identityPublic;
    process.env.VIEWER_CAPABILITY_ISSUER_KEY_ID = result.capabilityIssuer.payload.issuer_key_id;
    process.env.VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM = capabilityPublic;
    const identityVerifier = new LocalPemVerificationKeyProvider(result.identityIssuer.payload.issuer_key_id, identityPublic);
    const capabilityVerifier = new LocalPemVerificationKeyProvider(result.capabilityIssuer.payload.issuer_key_id, capabilityPublic);

    await expect(verifyViewerIdentityIssuerArtifact({ issuer: result.identityIssuer, verification: identityVerifier })).resolves.toBeUndefined();
    await expect(verifyViewerIdentityArtifact({
      identityRef: { artifact_id: result.identity.artifact_id, artifact_type: result.identity.artifact_type },
      repository: repo,
      verification: identityVerifier,
      releaseId: cleanInput.releaseRef.artifact_id,
      releaseHash: cleanInput.releaseHash,
    })).resolves.toEqual(result.identity);
    await expect(verifyViewerCapabilityIssuerArtifact({ issuer: result.capabilityIssuer, verification: capabilityVerifier })).resolves.toBeUndefined();
    await expect(verifyProductViewerCapability({
      capability: result.capability,
      repository: repo,
      verification: capabilityVerifier,
      projectId: cleanInput.projectId,
      bindingId: cleanInput.contextBindingRef.artifact_id,
      viewerIdentityId: result.identity.artifact_id,
      releaseId: cleanInput.releaseRef.artifact_id,
      releaseHash: cleanInput.releaseHash,
      now: new Date('2026-08-26T00:00:00.000Z'),
      currentBindingProvider: {
        resolveCurrent: async () => ({ artifact_id: cleanInput.contextBindingRef.artifact_id }),
      } as unknown as ProjectContextBindingProvider,
    })).resolves.toBeUndefined();
    expect(existsSync(identityPaths.privatePath)).toBe(false);
    expect(existsSync(capabilityPaths.privatePath)).toBe(false);
  });
});
