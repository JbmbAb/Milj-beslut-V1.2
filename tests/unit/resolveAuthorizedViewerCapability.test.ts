import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * PRODUCT-LU-VIEWER-CAPABILITY-WIRING-01 PHASE B.
 *
 * assertProjectMembership hits a real Postgres table (server/repositories/projectAccessRepository.ts).
 * Mocked here so USER AUTHORIZATION is exercised as a real, controllable pass/fail gate without a
 * live database -- exactly the boundary this unit is proving, not something to skip.
 */
let membershipAllowed = true;
vi.mock('../../server/repositories/projectAccessRepository', () => ({
  assertProjectMembership: vi.fn(async () => {
    if (!membershipAllowed) throw new Error('REJECT_PROJECT_MEMBERSHIP: not a member');
  }),
}));

import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import type { ArtifactReference } from '@miljobeslut/mps-compliance/src/artifacts/ArtifactReference';
import {
  createProjectContextBindingArtifact,
  createProjectContextBindingSupersessionArtifact,
  createProjectContextBindingIssuerArtifact,
  createProjectContextBindingSupersessionIssuerArtifact,
  createProductViewerCapabilityArtifact,
  createViewerCapabilityIssuerArtifact,
  createViewerIdentityArtifact,
  createViewerIdentityIssuerArtifact,
} from '@miljobeslut/mps-lu';
import {
  installOwnerIssuedProjectContextBinding,
  installOwnerIssuedProjectContextBindingSupersession,
} from '../../server/modules/localization/installProjectContextBinding';
import { ProjectContextBindingProvider } from '../../server/modules/localization/projectContextBindingRuntime';
import { attestProjectContextBindingArtifact } from '../../server/modules/localization/projectContextBindingAuthority';
import {
  attestProjectContextBindingSupersessionArtifact,
  attestProjectContextBindingSupersessionIssuerArtifact,
} from '../../server/modules/localization/projectContextBindingSupersessionAuthority';
import { __resetProjectContextBindingSupersessionVerifierForTests } from '../../server/security/projectContextBindingSupersessionVerifier';
import {
  attestProductViewerCapability,
  attestViewerCapabilityIssuerArtifact,
} from '../../server/modules/localization/productViewerCapabilityAuthority';
import {
  attestViewerIdentityArtifact,
  attestViewerIdentityIssuerArtifact,
} from '../../server/modules/localization/viewerIdentityAuthority';
import type { ProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';
import { resolveAuthorizedViewerCapability } from '../../server/modules/localization/resolveAuthorizedViewerCapability';
import type { LocalizationViewerRuntimeConfig } from '../../server/modules/localization/createLocalizationViewerRuntime';
import type { AuthUser } from '../../server/security/types';

class MemoryRepository {
  readonly values = new Map<string, unknown>();
  async put(artifact: { artifact_id: string; body: unknown }): Promise<void> {
    this.values.set(artifact.artifact_id, artifact.body);
  }
  async resolve<T>(reference: ArtifactReference): Promise<T> {
    const value = this.values.get(reference.artifact_id);
    if (!value) throw new Error(`not found: ${reference.artifact_id}`);
    return value as T;
  }
}

class MemoryBindingIndex implements ProjectContextBindingIndex {
  private readonly byProjectAndContext = new Map<string, string>();
  private readonly bindingsByProject = new Map<string, ArtifactReference[]>();
  private readonly supersessionsByProject = new Map<string, ArtifactReference[]>();
  private key(projectId: string, context: ArtifactReference): string {
    return `${projectId}:${context.artifact_type}:${context.artifact_id}`;
  }
  async register(binding: ReturnType<typeof createProjectContextBindingArtifact>): Promise<void> {
    const key = this.key(binding.payload.project_id, binding.payload.project_context_ref);
    const existing = this.byProjectAndContext.get(key);
    if (existing && existing !== binding.artifact_id) throw new Error('binding collision');
    this.byProjectAndContext.set(key, binding.artifact_id);
    const list = this.bindingsByProject.get(binding.payload.project_id) ?? [];
    if (!list.some((r) => r.artifact_id === binding.artifact_id)) {
      list.push({ artifact_id: binding.artifact_id, artifact_type: binding.artifact_type });
      this.bindingsByProject.set(binding.payload.project_id, list);
    }
  }
  async resolve(projectId: string, context: ArtifactReference): Promise<string> {
    const bindingId = this.byProjectAndContext.get(this.key(projectId, context));
    if (!bindingId) throw new Error('no binding');
    return bindingId;
  }
  async registerSupersession(supersession: ReturnType<typeof createProjectContextBindingSupersessionArtifact>): Promise<void> {
    const list = this.supersessionsByProject.get(supersession.payload.project_id) ?? [];
    if (!list.some((r) => r.artifact_id === supersession.artifact_id)) {
      list.push({ artifact_id: supersession.artifact_id, artifact_type: supersession.artifact_type });
      this.supersessionsByProject.set(supersession.payload.project_id, list);
    }
  }
  async listBindingRefs(projectId: string): Promise<readonly ArtifactReference[]> {
    return this.bindingsByProject.get(projectId) ?? [];
  }
  async listSupersessionRefs(projectId: string): Promise<readonly ArtifactReference[]> {
    return this.supersessionsByProject.get(projectId) ?? [];
  }
}

const PROJECT_ID = 'project-viewer-authz';
const OTHER_PROJECT_ID = 'project-viewer-authz-other';
const contextOld = { artifact_id: 'lu-context-authz-old', artifact_type: 'LU_PROJECT_CONTEXT' } as const;
const contextNew = { artifact_id: 'lu-context-authz-new', artifact_type: 'LU_PROJECT_CONTEXT' } as const;
const propertyBinding = { artifact_id: 'project-property-binding-viewer-authz', artifact_type: 'project_property_binding' } as const;

const pcbIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:pcb-issuer-viewer-authz-test');
const pcbVerification = new LocalPemVerificationKeyProvider(pcbIssuerKey.provider.keyId, pcbIssuerKey.publicKey);
const pcbIssuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: pcbIssuerKey.provider.keyId, issuer_version: 'project-context-binding-issuer-v2' });
const pcbAuthority = { artifact_id: pcbIssuer.artifact_id, artifact_type: pcbIssuer.artifact_type } as const;
const pcbSupersessionIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:pcb-supersession-issuer-viewer-authz-test');

const vcIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:vc-issuer-viewer-authz-test');
const OWNER_AUTHORITY_REF = { artifact_id: 'owner-authority-viewer-authz-test', artifact_type: 'owner_authority_attestation' } as const;
const viIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:vi-issuer-viewer-authz-test');

const RELEASE_REF = { artifact_id: 'product-release-viewer-authz', artifact_type: 'product_release' } as const;
const OTHER_RELEASE_REF = { artifact_id: 'product-release-viewer-authz-other', artifact_type: 'product_release' } as const;
const RELEASE_HASH = 'e'.repeat(64);
const OTHER_RELEASE_HASH = 'f'.repeat(64);
const NOW = new Date('2026-08-21T12:00:00.000Z');

const AUTH_USER: AuthUser = { id: 'user-authz-test', organisationId: 'org-authz-test', bankidId: 'bankid:authz-test', role: 'CONSULTANT' };

async function setup() {
  const repository = new MemoryRepository();
  const index = new MemoryBindingIndex();
  await repository.put({ artifact_id: pcbIssuer.artifact_id, body: pcbIssuer });

  process.env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_KEY_ID = pcbSupersessionIssuerKey.provider.keyId;
  process.env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM = pcbSupersessionIssuerKey.publicKey;
  __resetProjectContextBindingSupersessionVerifierForTests(null);
  const pcbSupersessionIssuerUnsigned = createProjectContextBindingSupersessionIssuerArtifact({
    issuer_key_id: pcbSupersessionIssuerKey.provider.keyId,
    owner_authority_ref: pcbAuthority,
  });
  const pcbSupersessionIssuer = {
    ...pcbSupersessionIssuerUnsigned,
    attestation: await attestProjectContextBindingSupersessionIssuerArtifact({ issuer: pcbSupersessionIssuerUnsigned, signing: pcbSupersessionIssuerKey.provider }),
  };
  const pcbSupersessionAuthority = { artifact_id: pcbSupersessionIssuer.artifact_id, artifact_type: pcbSupersessionIssuer.artifact_type } as const;
  await repository.put({ artifact_id: pcbSupersessionIssuer.artifact_id, body: pcbSupersessionIssuer });

  const oldBindingUnsigned = createProjectContextBindingArtifact({
    project_id: PROJECT_ID, project_context_ref: contextOld, project_property_binding_ref: propertyBinding,
    binding_version: 'project-context-binding-v2', authority_ref: pcbAuthority, created_at: '2026-08-20T00:00:00.000Z',
  });
  const oldBinding = { ...oldBindingUnsigned, attestation: await attestProjectContextBindingArtifact({ artifact: oldBindingUnsigned, issuer: pcbIssuer, signing: pcbIssuerKey.provider }) };
  await installOwnerIssuedProjectContextBinding({ artifactRepository: repository, index, binding: oldBinding, verification: pcbVerification });

  const newBindingUnsigned = createProjectContextBindingArtifact({
    project_id: PROJECT_ID, project_context_ref: contextNew, project_property_binding_ref: propertyBinding,
    binding_version: 'project-context-binding-v2', authority_ref: pcbAuthority, created_at: '2026-08-21T00:00:00.000Z',
  });
  const newBinding = { ...newBindingUnsigned, attestation: await attestProjectContextBindingArtifact({ artifact: newBindingUnsigned, issuer: pcbIssuer, signing: pcbIssuerKey.provider }) };
  await installOwnerIssuedProjectContextBinding({ artifactRepository: repository, index, binding: newBinding, verification: pcbVerification });

  const supersessionUnsigned = createProjectContextBindingSupersessionArtifact({
    contract_version: 'PROJECT_CONTEXT_BINDING_SUPERSESSION_V1', project_id: PROJECT_ID,
    superseded_binding_ref: { artifact_id: oldBinding.artifact_id, artifact_type: oldBinding.artifact_type },
    successor_binding_ref: { artifact_id: newBinding.artifact_id, artifact_type: newBinding.artifact_type },
    reason_code: 'TEST_SUPERSESSION', issuer_ref: pcbSupersessionAuthority, issuer_key_id: pcbSupersessionIssuerKey.provider.keyId,
    issued_at: '2026-08-21T00:01:00.000Z',
  });
  const supersession = { ...supersessionUnsigned, attestation: await attestProjectContextBindingSupersessionArtifact({ artifact: supersessionUnsigned, issuer: pcbSupersessionIssuer, signing: pcbSupersessionIssuerKey.provider }) };
  await installOwnerIssuedProjectContextBindingSupersession({ artifactRepository: repository, index, supersession, verification: pcbVerification });

  const vcIssuerUnsigned = createViewerCapabilityIssuerArtifact({ issuer_key_id: vcIssuerKey.provider.keyId, owner_authority_ref: OWNER_AUTHORITY_REF });
  const vcIssuer = { ...vcIssuerUnsigned, attestation: await attestViewerCapabilityIssuerArtifact({ issuer: vcIssuerUnsigned, signing: vcIssuerKey.provider }) };
  await repository.put({ artifact_id: vcIssuer.artifact_id, body: vcIssuer });

  const viIssuerUnsigned = createViewerIdentityIssuerArtifact({ issuer_key_id: viIssuerKey.provider.keyId, owner_authority_ref: OWNER_AUTHORITY_REF });
  const viIssuer = { ...viIssuerUnsigned, attestation: await attestViewerIdentityIssuerArtifact({ issuer: viIssuerUnsigned, signing: viIssuerKey.provider }) };
  await repository.put({ artifact_id: viIssuer.artifact_id, body: viIssuer });
  const viUnsigned = createViewerIdentityArtifact({
    runtime_component: 'viewer-capability-authz-test', product_release_ref: RELEASE_REF, product_release_hash: RELEASE_HASH,
    issuer_ref: { artifact_id: viIssuer.artifact_id, artifact_type: viIssuer.artifact_type }, issuer_key_id: viIssuerKey.provider.keyId,
  });
  const vi = { ...viUnsigned, attestation: await attestViewerIdentityArtifact({ identity: viUnsigned, issuer: viIssuer, signing: viIssuerKey.provider }) };
  await repository.put({ artifact_id: vi.artifact_id, body: vi });
  const viewerIdentityRef = { artifact_id: vi.artifact_id, artifact_type: vi.artifact_type };

  await repository.put({
    artifact_id: RELEASE_REF.artifact_id,
    body: { artifact_id: RELEASE_REF.artifact_id, artifact_type: RELEASE_REF.artifact_type, content_hash: { algorithm: 'sha256', value: 'release-content-hash' }, references: [], payload: {}, release_hash: { algorithm: 'sha256', value: RELEASE_HASH } },
  });
  await repository.put({
    artifact_id: OTHER_RELEASE_REF.artifact_id,
    body: { artifact_id: OTHER_RELEASE_REF.artifact_id, artifact_type: OTHER_RELEASE_REF.artifact_type, content_hash: { algorithm: 'sha256', value: 'other-release-content-hash' }, references: [], payload: {}, release_hash: { algorithm: 'sha256', value: OTHER_RELEASE_HASH } },
  });

  async function buildCapability(bindingRef: ArtifactReference, overrides: { projectId?: string; releaseRef?: ArtifactReference; releaseHash?: string } = {}) {
    const unsigned = createProductViewerCapabilityArtifact({
      issuer_key_id: vcIssuerKey.provider.keyId,
      issuer_ref: { artifact_id: vcIssuer.artifact_id, artifact_type: vcIssuer.artifact_type },
      subject_project_id: overrides.projectId ?? PROJECT_ID,
      project_context_binding_ref: bindingRef,
      viewer_identity_ref: viewerIdentityRef,
      product_release_ref: overrides.releaseRef ?? RELEASE_REF,
      product_release_hash: overrides.releaseHash ?? RELEASE_HASH,
      valid_from: '2026-01-01T00:00:00.000Z',
      valid_until: '2027-01-01T00:00:00.000Z',
    });
    const attestation = await attestProductViewerCapability({ capability: unsigned, issuer: vcIssuer, signing: vcIssuerKey.provider });
    const capability = { ...unsigned, attestation };
    await repository.put({ artifact_id: capability.artifact_id, body: capability });
    return capability;
  }

  function configFor(capabilityArtifactId: string, bindingRef: ArtifactReference, overrides: { projectId?: string; releaseRef?: ArtifactReference; releaseHash?: string } = {}): LocalizationViewerRuntimeConfig {
    return {
      capabilityArtifactId,
      expectedProjectId: overrides.projectId ?? PROJECT_ID,
      expectedContextBindingId: bindingRef.artifact_id,
      expectedViewerIdentityId: viewerIdentityRef.artifact_id,
      expectedReleaseId: (overrides.releaseRef ?? RELEASE_REF).artifact_id,
      expectedReleaseHash: overrides.releaseHash ?? RELEASE_HASH,
    };
  }

  return {
    repository, index,
    oldBindingRef: { artifact_id: oldBinding.artifact_id, artifact_type: oldBinding.artifact_type },
    newBindingRef: { artifact_id: newBinding.artifact_id, artifact_type: newBinding.artifact_type },
    viewerIdentityRef,
    buildCapability,
    configFor,
    currentBindingProvider: () => new ProjectContextBindingProvider(repository, index, pcbVerification),
  };
}

describe('PRODUCT-LU-VIEWER-CAPABILITY-WIRING-01 PHASE B', () => {
  beforeEach(() => {
    membershipAllowed = true;
    process.env.VIEWER_IDENTITY_ISSUER_KEY_ID = viIssuerKey.provider.keyId;
    process.env.VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM = viIssuerKey.publicKey;
    process.env.VIEWER_CAPABILITY_ISSUER_KEY_ID = vcIssuerKey.provider.keyId;
    process.env.VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM = vcIssuerKey.publicKey;
  });
  afterEach(() => {
    delete process.env.VIEWER_IDENTITY_ISSUER_KEY_ID;
    delete process.env.VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM;
    delete process.env.VIEWER_CAPABILITY_ISSUER_KEY_ID;
    delete process.env.VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM;
  });

  it('authorized user + current project + current valid capability -> ACCEPT', async () => {
    const s = await setup();
    const capability = await s.buildCapability(s.newBindingRef);
    const runtime = await resolveAuthorizedViewerCapability({
      authUser: AUTH_USER,
      projectId: PROJECT_ID,
      artifactRepository: s.repository,
      config: s.configFor(capability.artifact_id, s.newBindingRef),
      now: () => NOW,
      currentBindingProvider: s.currentBindingProvider(),
    });
    expect(runtime.capability.artifact_id).toBe(capability.artifact_id);
    expect(runtime.viewer).toBeDefined();
  });

  it('authorized user + no installed capability -> DENY', async () => {
    const s = await setup();
    await expect(
      resolveAuthorizedViewerCapability({
        authUser: AUTH_USER,
        projectId: PROJECT_ID,
        artifactRepository: s.repository,
        config: s.configFor('viewer-capability-never-installed', s.newBindingRef),
        now: () => NOW,
        currentBindingProvider: s.currentBindingProvider(),
      }),
    ).rejects.toThrow('REJECT_LU_VIEWER_CAPABILITY_UNAVAILABLE');
  });

  it('authorized user + capability for superseded binding -> DENY', async () => {
    const s = await setup();
    const capability = await s.buildCapability(s.oldBindingRef);
    await expect(
      resolveAuthorizedViewerCapability({
        authUser: AUTH_USER,
        projectId: PROJECT_ID,
        artifactRepository: s.repository,
        config: s.configFor(capability.artifact_id, s.oldBindingRef),
        now: () => NOW,
        currentBindingProvider: s.currentBindingProvider(),
      }),
    ).rejects.toThrow('REJECT_VIEWER_CAPABILITY_CONTEXT_BINDING_SUPERSEDED');
  });

  it('authorized user + wrong project capability (static config names a different project than the request) -> DENY', async () => {
    const s = await setup();
    const capability = await s.buildCapability(s.newBindingRef);
    await expect(
      resolveAuthorizedViewerCapability({
        authUser: AUTH_USER,
        projectId: OTHER_PROJECT_ID,
        artifactRepository: s.repository,
        config: s.configFor(capability.artifact_id, s.newBindingRef),
        now: () => NOW,
        currentBindingProvider: s.currentBindingProvider(),
      }),
    ).rejects.toThrow('REJECT_VIEWER_CAPABILITY_WRONG_PROJECT_CONFIG');
  });

  it('authorized user + wrong release -> DENY', async () => {
    const s = await setup();
    const capability = await s.buildCapability(s.newBindingRef, { releaseRef: OTHER_RELEASE_REF, releaseHash: OTHER_RELEASE_HASH });
    await expect(
      resolveAuthorizedViewerCapability({
        authUser: AUTH_USER,
        projectId: PROJECT_ID,
        artifactRepository: s.repository,
        config: s.configFor(capability.artifact_id, s.newBindingRef),
        now: () => NOW,
        currentBindingProvider: s.currentBindingProvider(),
      }),
    ).rejects.toThrow('REJECT_VIEWER_CAPABILITY_RELEASE_REF');
  });

  it('authorized user + wrong ViewerIdentity -> DENY', async () => {
    const s = await setup();
    const capability = await s.buildCapability(s.newBindingRef);
    const config = { ...s.configFor(capability.artifact_id, s.newBindingRef), expectedViewerIdentityId: 'viewer-identity-not-this-one' };
    await expect(
      resolveAuthorizedViewerCapability({
        authUser: AUTH_USER,
        projectId: PROJECT_ID,
        artifactRepository: s.repository,
        config,
        now: () => NOW,
        currentBindingProvider: s.currentBindingProvider(),
      }),
    ).rejects.toThrow('REJECT_VIEWER_CAPABILITY_VIEWER_IDENTITY');
  });

  it('unauthorized user + otherwise valid capability -> DENY at project authorization (before any capability resolution)', async () => {
    const s = await setup();
    const capability = await s.buildCapability(s.newBindingRef);
    membershipAllowed = false;
    await expect(
      resolveAuthorizedViewerCapability({
        authUser: AUTH_USER,
        projectId: PROJECT_ID,
        artifactRepository: s.repository,
        config: s.configFor(capability.artifact_id, s.newBindingRef),
        now: () => NOW,
        currentBindingProvider: s.currentBindingProvider(),
      }),
    ).rejects.toThrow('REJECT_PROJECT_MEMBERSHIP');
  });

  it('tampered capability -> DENY', async () => {
    const s = await setup();
    const capability = await s.buildCapability(s.newBindingRef);
    const tampered = { ...capability, payload: { ...capability.payload, subject_project_id: 'some-other-project-entirely' } };
    await s.repository.put({ artifact_id: tampered.artifact_id, body: tampered });
    await expect(
      resolveAuthorizedViewerCapability({
        authUser: AUTH_USER,
        projectId: PROJECT_ID,
        artifactRepository: s.repository,
        config: s.configFor(capability.artifact_id, s.newBindingRef),
        now: () => NOW,
        currentBindingProvider: s.currentBindingProvider(),
      }),
    ).rejects.toThrow('REJECT_PRODUCT_VIEWER_CAPABILITY');
  });

  it('new current binding + old capability -> DENY', async () => {
    const s = await setup();
    const oldCapability = await s.buildCapability(s.oldBindingRef);
    await expect(
      resolveAuthorizedViewerCapability({
        authUser: AUTH_USER,
        projectId: PROJECT_ID,
        artifactRepository: s.repository,
        config: s.configFor(oldCapability.artifact_id, s.oldBindingRef),
        now: () => NOW,
        currentBindingProvider: s.currentBindingProvider(),
      }),
    ).rejects.toThrow('REJECT_VIEWER_CAPABILITY_CONTEXT_BINDING_SUPERSEDED');
  });

  it('new current binding + newly owner-issued/installed capability -> ACCEPT', async () => {
    const s = await setup();
    const newCapability = await s.buildCapability(s.newBindingRef);
    const runtime = await resolveAuthorizedViewerCapability({
      authUser: AUTH_USER,
      projectId: PROJECT_ID,
      artifactRepository: s.repository,
      config: s.configFor(newCapability.artifact_id, s.newBindingRef),
      now: () => NOW,
      currentBindingProvider: s.currentBindingProvider(),
    });
    expect(runtime.capability.artifact_id).toBe(newCapability.artifact_id);
  });

  it('missing/stale capability path never touches the signing module', async () => {
    const s = await setup();
    await expect(
      resolveAuthorizedViewerCapability({
        authUser: AUTH_USER,
        projectId: PROJECT_ID,
        artifactRepository: s.repository,
        config: s.configFor('viewer-capability-never-installed', s.newBindingRef),
        now: () => NOW,
        currentBindingProvider: s.currentBindingProvider(),
      }),
    ).rejects.toThrow();

    const source = readFileSync(
      path.resolve(here, '../../server/modules/localization/resolveAuthorizedViewerCapability.ts'),
      'utf8',
    );
    expect(source).not.toContain('viewerCapabilitySigningKey');
    expect(source).not.toContain('SigningKeyProvider');
    expect(process.env.VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM).toBeUndefined();
  });
});
