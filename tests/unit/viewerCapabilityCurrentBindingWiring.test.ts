import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import type { ArtifactReference } from '@miljobeslut/mps-compliance/src/artifacts/ArtifactReference';
import {
  createProjectContextBindingArtifact,
  createProjectContextBindingSupersessionArtifact,
  createProjectContextBindingIssuerArtifact,
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
import {
  attestProjectContextBindingArtifact,
  attestProjectContextBindingSupersessionArtifact,
} from '../../server/modules/localization/projectContextBindingAuthority';
import {
  attestProductViewerCapability,
  attestViewerCapabilityIssuerArtifact,
  verifyProductViewerCapability,
} from '../../server/modules/localization/productViewerCapabilityAuthority';
import {
  attestViewerIdentityArtifact,
  attestViewerIdentityIssuerArtifact,
} from '../../server/modules/localization/viewerIdentityAuthority';
import type { ProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';

/**
 * VIEWER-CAPABILITY-CURRENT-BINDING-WIRING-01.
 *
 * Proves verifyProductViewerCapability's new currency check with a REAL
 * ProjectContextBindingProvider over a real binding + supersession graph -- not a stub. A
 * capability minted against a binding that is later superseded must be rejected, even though it
 * still matches every OTHER check (issuer trust, signature, temporal window, and even the
 * caller-configured `bindingId` expectation, since a stale caller config could still name the old
 * binding).
 */

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

const PROJECT_ID = 'project-viewer-currency';
const contextOld = { artifact_id: 'lu-context-old', artifact_type: 'LU_PROJECT_CONTEXT' } as const;
const contextNew = { artifact_id: 'lu-context-new', artifact_type: 'LU_PROJECT_CONTEXT' } as const;
const propertyBinding = { artifact_id: 'project-property-binding-viewer-currency', artifact_type: 'project_property_binding' } as const;

const pcbIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:pcb-issuer-viewer-currency-test');
const pcbVerification = new LocalPemVerificationKeyProvider(pcbIssuerKey.provider.keyId, pcbIssuerKey.publicKey);
const pcbIssuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: pcbIssuerKey.provider.keyId, issuer_version: 'project-context-binding-issuer-v2' });
const pcbAuthority = { artifact_id: pcbIssuer.artifact_id, artifact_type: pcbIssuer.artifact_type } as const;

const vcIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:vc-issuer-viewer-currency-test');
const vcVerification = new LocalPemVerificationKeyProvider(vcIssuerKey.provider.keyId, vcIssuerKey.publicKey);
const OWNER_AUTHORITY_REF = { artifact_id: 'owner-authority-viewer-currency-test', artifact_type: 'owner_authority_attestation' } as const;

const viIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:vi-issuer-viewer-currency-test');

const RELEASE_REF = { artifact_id: 'product-release-viewer-currency', artifact_type: 'product_release' } as const;
const RELEASE_HASH = 'c'.repeat(64);
const NOW = new Date('2026-08-21T12:00:00.000Z');

async function setup() {
  const repository = new MemoryRepository();
  const index = new MemoryBindingIndex();
  await repository.put({ artifact_id: pcbIssuer.artifact_id, body: pcbIssuer });

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
    reason_code: 'TEST_SUPERSESSION', issuer_ref: pcbAuthority, issuer_key_id: pcbIssuerKey.provider.keyId,
    issued_at: '2026-08-21T00:01:00.000Z',
  });
  const supersession = { ...supersessionUnsigned, attestation: await attestProjectContextBindingSupersessionArtifact({ artifact: supersessionUnsigned, issuer: pcbIssuer, signing: pcbIssuerKey.provider }) };
  await installOwnerIssuedProjectContextBindingSupersession({ artifactRepository: repository, index, supersession, verification: pcbVerification });

  // Real ViewerIdentity, real release, real ViewerCapability issuer -- everything downstream of
  // the binding graph is real too, so the ONLY thing under test is the currency check.
  const vcIssuerUnsigned = createViewerCapabilityIssuerArtifact({ issuer_key_id: vcIssuerKey.provider.keyId, owner_authority_ref: OWNER_AUTHORITY_REF });
  const vcIssuer = { ...vcIssuerUnsigned, attestation: await attestViewerCapabilityIssuerArtifact({ issuer: vcIssuerUnsigned, signing: vcIssuerKey.provider }) };
  await repository.put({ artifact_id: vcIssuer.artifact_id, body: vcIssuer });

  const viIssuerUnsigned = createViewerIdentityIssuerArtifact({ issuer_key_id: viIssuerKey.provider.keyId, owner_authority_ref: OWNER_AUTHORITY_REF });
  const viIssuer = { ...viIssuerUnsigned, attestation: await attestViewerIdentityIssuerArtifact({ issuer: viIssuerUnsigned, signing: viIssuerKey.provider }) };
  await repository.put({ artifact_id: viIssuer.artifact_id, body: viIssuer });
  const viUnsigned = createViewerIdentityArtifact({
    runtime_component: 'viewer-capability-currency-test', product_release_ref: RELEASE_REF, product_release_hash: RELEASE_HASH,
    issuer_ref: { artifact_id: viIssuer.artifact_id, artifact_type: viIssuer.artifact_type }, issuer_key_id: viIssuerKey.provider.keyId,
  });
  const vi = { ...viUnsigned, attestation: await attestViewerIdentityArtifact({ identity: viUnsigned, issuer: viIssuer, signing: viIssuerKey.provider }) };
  await repository.put({ artifact_id: vi.artifact_id, body: vi });
  const viewerIdentityRef = { artifact_id: vi.artifact_id, artifact_type: vi.artifact_type };

  await repository.put({
    artifact_id: RELEASE_REF.artifact_id,
    body: { artifact_id: RELEASE_REF.artifact_id, artifact_type: RELEASE_REF.artifact_type, content_hash: { algorithm: 'sha256', value: 'release-content-hash' }, references: [], payload: {}, release_hash: { algorithm: 'sha256', value: RELEASE_HASH } },
  });

  async function buildCapability(bindingRef: ArtifactReference, projectId: string = PROJECT_ID) {
    const unsigned = createProductViewerCapabilityArtifact({
      issuer_key_id: vcIssuerKey.provider.keyId,
      issuer_ref: { artifact_id: vcIssuer.artifact_id, artifact_type: vcIssuer.artifact_type },
      subject_project_id: projectId,
      project_context_binding_ref: bindingRef,
      viewer_identity_ref: viewerIdentityRef,
      product_release_ref: RELEASE_REF,
      product_release_hash: RELEASE_HASH,
      valid_from: '2026-01-01T00:00:00.000Z',
      valid_until: '2027-01-01T00:00:00.000Z',
    });
    const attestation = await attestProductViewerCapability({ capability: unsigned, issuer: vcIssuer, signing: vcIssuerKey.provider });
    return { ...unsigned, attestation };
  }

  return {
    repository,
    index,
    oldBindingRef: { artifact_id: oldBinding.artifact_id, artifact_type: oldBinding.artifact_type },
    newBindingRef: { artifact_id: newBinding.artifact_id, artifact_type: newBinding.artifact_type },
    viewerIdentityRef,
    buildCapability,
  };
}

describe('VIEWER-CAPABILITY-CURRENT-BINDING-WIRING-01', () => {
  beforeEach(() => {
    process.env.VIEWER_IDENTITY_ISSUER_KEY_ID = viIssuerKey.provider.keyId;
    process.env.VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM = viIssuerKey.publicKey;
  });
  afterEach(() => {
    delete process.env.VIEWER_IDENTITY_ISSUER_KEY_ID;
    delete process.env.VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM;
  });

  it('capability bound to the CURRENT head -> ACCEPT', async () => {
    const s = await setup();
    const capability = await s.buildCapability(s.newBindingRef);
    await expect(
      verifyProductViewerCapability({
        capability,
        repository: s.repository,
        verification: vcVerification,
        projectId: PROJECT_ID,
        bindingId: s.newBindingRef.artifact_id,
        viewerIdentityId: s.viewerIdentityRef.artifact_id,
        releaseId: RELEASE_REF.artifact_id,
        releaseHash: RELEASE_HASH,
        now: NOW,
        currentBindingProvider: new ProjectContextBindingProvider(s.repository, s.index, pcbVerification),
      }),
    ).resolves.toBeUndefined();
  });

  it('capability bound to a SUPERSEDED binding -> DENY, even though it still matches the caller-configured bindingId', async () => {
    const s = await setup();
    const capability = await s.buildCapability(s.oldBindingRef);
    await expect(
      verifyProductViewerCapability({
        capability,
        repository: s.repository,
        verification: vcVerification,
        projectId: PROJECT_ID,
        // The caller's OWN expectation is stale too -- still names the old binding. Proves the
        // currency check is independent of (and stricter than) the caller-supplied bindingId.
        bindingId: s.oldBindingRef.artifact_id,
        viewerIdentityId: s.viewerIdentityRef.artifact_id,
        releaseId: RELEASE_REF.artifact_id,
        releaseHash: RELEASE_HASH,
        now: NOW,
        currentBindingProvider: new ProjectContextBindingProvider(s.repository, s.index, pcbVerification),
      }),
    ).rejects.toThrow('REJECT_VIEWER_CAPABILITY_CONTEXT_BINDING_SUPERSEDED');
  });

  it('project with no bindings at all -> current-binding resolution fails closed', async () => {
    const s = await setup();
    const emptyProjectId = 'project-viewer-currency-empty';
    const capability = await s.buildCapability(s.newBindingRef, emptyProjectId);
    await expect(
      verifyProductViewerCapability({
        capability,
        repository: s.repository,
        verification: vcVerification,
        projectId: emptyProjectId,
        bindingId: s.newBindingRef.artifact_id,
        viewerIdentityId: s.viewerIdentityRef.artifact_id,
        releaseId: RELEASE_REF.artifact_id,
        releaseHash: RELEASE_HASH,
        now: NOW,
        currentBindingProvider: new ProjectContextBindingProvider(s.repository, s.index, pcbVerification),
      }),
    ).rejects.toThrow('REJECT_VIEWER_CAPABILITY_CURRENT_BINDING_UNAVAILABLE');
  });
});
