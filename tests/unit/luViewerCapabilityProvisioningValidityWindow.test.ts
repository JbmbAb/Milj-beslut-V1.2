/**
 * PROJECT-CONTEXT-BINDING-V2-PRODUCER-ADOPTION-01 Phase A.1 -- ViewerCapability validity-window
 * proofs. Mirrors the established pattern for this exact class of module
 * (tests/unit/luExecutionIdentityV3ProvisioningProofs.test.ts / luGeometrySupersessionProvisioningProofs.test.ts):
 * mock MimersIntegration.create, the Prisma singleton, and node:child_process (the fresh-verifier
 * subprocess), then exercise the REAL executor logic against a real in-memory CAS.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mimersCreate, userFindUniqueMock, assertProjectAccessMock, resolveCurrentReleaseMock, resolveCurrentViewerIdentityMock, spawnMock, resetFakeBindingIndex } = vi.hoisted(() => ({
  mimersCreate: vi.fn(),
  userFindUniqueMock: vi.fn(),
  assertProjectAccessMock: vi.fn(),
  resolveCurrentReleaseMock: vi.fn(),
  resolveCurrentViewerIdentityMock: vi.fn(),
  spawnMock: vi.fn(),
  resetFakeBindingIndex: vi.fn(),
}));

vi.mock('@miljobeslut/mps-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@miljobeslut/mps-runtime')>();
  return { ...actual, MimersIntegration: { create: mimersCreate } };
});
vi.mock('../../server/db/prisma', () => ({
  prisma: { user: { findUnique: userFindUniqueMock } },
}));
vi.mock('../../server/security/projectAccess', () => ({
  assertProjectAccess: assertProjectAccessMock,
}));
vi.mock('../../server/modules/release/productReleaseRuntime', () => ({
  resolveCanonicalProductRelease: resolveCurrentReleaseMock,
}));
vi.mock('../../src/application/resolveCurrentViewerIdentity', () => ({
  resolveCurrentViewerIdentity: resolveCurrentViewerIdentityMock,
}));
vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  default: { spawn: spawnMock },
}));
vi.mock('../../server/repositories/projectContextBindingRepository', () => {
  type BindingRow = { binding_artifact_id: string; project_context_artifact_id: string; project_context_artifact_type: string };
  let bindingsByProject = new Map<string, BindingRow[]>();
  resetFakeBindingIndex.mockImplementation(() => { bindingsByProject = new Map(); });
  class FakeProjectContextBindingIndex {
    async register(binding: { artifact_id: string; payload: { project_id: string; project_context_ref: { artifact_id: string; artifact_type: string } } }) {
      const rows = bindingsByProject.get(binding.payload.project_id) ?? [];
      if (!rows.some((r) => r.binding_artifact_id === binding.artifact_id)) {
        rows.push({ binding_artifact_id: binding.artifact_id, project_context_artifact_id: binding.payload.project_context_ref.artifact_id, project_context_artifact_type: binding.payload.project_context_ref.artifact_type });
        bindingsByProject.set(binding.payload.project_id, rows);
      }
    }
    async resolve(projectId: string, ref: { artifact_id: string; artifact_type: string }) {
      const rows = (bindingsByProject.get(projectId) ?? []).filter((r) => r.project_context_artifact_id === ref.artifact_id && r.project_context_artifact_type === ref.artifact_type);
      if (rows.length !== 1) throw new Error('REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE');
      return rows[0]!.binding_artifact_id;
    }
    async listBindingRefs(projectId: string) { return (bindingsByProject.get(projectId) ?? []).map((r) => ({ artifact_id: r.binding_artifact_id, artifact_type: 'project_context_binding' })); }
    async listSupersessionRefs() { return []; }
    async findProjectContextRef(projectId: string) {
      const rows = bindingsByProject.get(projectId) ?? [];
      if (rows.length !== 1) throw new Error('REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE');
      return { artifact_id: rows[0]!.project_context_artifact_id, artifact_type: rows[0]!.project_context_artifact_type };
    }
  }
  return { PrismaProjectContextBindingIndex: FakeProjectContextBindingIndex };
});

import { InMemoryArtifactRepository } from '@miljobeslut/mps-runtime';
import { LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import {
  createProjectContextBindingArtifactV2,
  createProjectContextBindingIssuerArtifact,
  createViewerIdentityIssuerArtifact,
  createViewerIdentityArtifact,
} from '@miljobeslut/mps-lu';
import { attestProjectContextBindingArtifact } from '../../server/modules/localization/projectContextBindingAuthority';
import { attestViewerIdentityIssuerArtifact, attestViewerIdentityArtifact } from '../../server/modules/localization/viewerIdentityAuthority';
import { PrismaProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';
import { executeViewerCapabilityProvisioning } from '../../server/modules/localization/luViewerCapabilityProvisioning';
import { __resetViewerCapabilitySigningProviderForTests } from '../../server/security/viewerCapabilitySigningKey';
import { __resetViewerCapabilityVerifierForTests } from '../../server/security/viewerCapabilityVerifier';
import { __resetViewerIdentityVerifierForTests } from '../../server/security/viewerIdentityVerifier';

const PROJECT_ID = 'project-viewer-capability-validity-window';
const RELEASE_ID = 'product-release-validity-window';
const RELEASE_HASH = 'a'.repeat(64);

describe('PROJECT-CONTEXT-BINDING-V2-PRODUCER-ADOPTION-01 Phase A.1 -- ViewerCapability validity window', () => {
  let repo: InMemoryArtifactRepository;
  let currentBindingId: string;
  let viewerIdentityId: string;

  beforeEach(async () => {
    resetFakeBindingIndex();
    repo = new InMemoryArtifactRepository();
    mimersCreate.mockResolvedValue({ artifactRepository: repo });
    userFindUniqueMock.mockResolvedValue({ id: 'user-1', organisationId: 'org-1', bankidId: 'bankid-1', role: 'CONSULTANT', identityEnvironment: 'TEST' });
    assertProjectAccessMock.mockResolvedValue(undefined);
    resolveCurrentReleaseMock.mockResolvedValue({ artifact_id: RELEASE_ID, artifact_type: 'product_release_manifest', release_hash: { algorithm: 'sha256', value: RELEASE_HASH } });
    // The spawned fresh-verify subprocess is mocked to "succeed" immediately -- only the 'exit'
    // handler is ever invoked, with code 0; 'error' is registered but never fired.
    spawnMock.mockImplementation(() => {
      const child = {
        once: (event: string, cb: (code: number) => void) => {
          if (event === 'exit') setTimeout(() => cb(0), 0);
        },
      };
      return child as never;
    });

    // Real release manifest -- verifyViewerIdentityArtifact resolves this from CAS for real.
    await repo.put({
      artifact_id: RELEASE_ID,
      content_hash: { algorithm: 'sha256', value: 'irrelevant-for-this-proof' },
      body: { artifact_id: RELEASE_ID, artifact_type: 'product_release_manifest', release_hash: { value: RELEASE_HASH } },
    });

    const key = LocalPemSigningKeyProvider.generate('ed25519:viewer-capability-validity-window');
    process.env.VIEWER_CAPABILITY_ISSUER_KEY_ID = key.provider.keyId;
    process.env.VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM = key.privateKey;
    process.env.VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM = key.publicKey;
    __resetViewerCapabilitySigningProviderForTests(null);
    __resetViewerCapabilityVerifierForTests(null);
    __resetViewerIdentityVerifierForTests(null);

    const viewerIdentityKey = LocalPemSigningKeyProvider.generate('ed25519:viewer-identity-validity-window');
    process.env.VIEWER_IDENTITY_ISSUER_KEY_ID = viewerIdentityKey.provider.keyId;
    process.env.VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM = viewerIdentityKey.publicKey;

    const bareViewerIdentityIssuer = createViewerIdentityIssuerArtifact({
      issuer_key_id: viewerIdentityKey.provider.keyId,
      owner_authority_ref: { artifact_id: 'owner-authority-validity-window', artifact_type: 'owner_authority_attestation' },
    });
    const viewerIdentityIssuer = { ...bareViewerIdentityIssuer, attestation: await attestViewerIdentityIssuerArtifact({ issuer: bareViewerIdentityIssuer, signing: viewerIdentityKey.provider }) };
    await repo.put({ artifact_id: viewerIdentityIssuer.artifact_id, content_hash: viewerIdentityIssuer.content_hash, body: viewerIdentityIssuer });

    const bareViewerIdentity = createViewerIdentityArtifact({
      runtime_component: 'canonical LU ViewerKernel / localization viewer runtime',
      product_release_ref: { artifact_id: RELEASE_ID, artifact_type: 'product_release_manifest' },
      product_release_hash: RELEASE_HASH,
      issuer_ref: { artifact_id: viewerIdentityIssuer.artifact_id, artifact_type: viewerIdentityIssuer.artifact_type },
      issuer_key_id: viewerIdentityKey.provider.keyId,
    });
    const viewerIdentity = { ...bareViewerIdentity, attestation: await attestViewerIdentityArtifact({ identity: bareViewerIdentity, issuer: viewerIdentityIssuer, signing: viewerIdentityKey.provider }) };
    await repo.put({ artifact_id: viewerIdentity.artifact_id, content_hash: viewerIdentity.content_hash, body: viewerIdentity });
    viewerIdentityId = viewerIdentity.artifact_id;
    resolveCurrentViewerIdentityMock.mockResolvedValue({ viewerIdentityRef: { artifact_id: viewerIdentityId, artifact_type: 'viewer_identity' } });

    // Real V2 binding, real issuer, real installVerifiedProductLuContext-style registration.
    const pcbKey = LocalPemSigningKeyProvider.generate('ed25519:pcb-issuer-validity-window');
    process.env.PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID = pcbKey.provider.keyId;
    process.env.PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM = pcbKey.publicKey;
    const issuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: pcbKey.provider.keyId, issuer_version: 'project-context-binding-issuer-v2' });
    await repo.put({ artifact_id: issuer.artifact_id, content_hash: issuer.content_hash, body: issuer });

    const bareBinding = createProjectContextBindingArtifactV2({
      project_id: PROJECT_ID,
      project_context_ref: { artifact_id: 'lu_project_context-vw', artifact_type: 'LU_PROJECT_CONTEXT' },
      project_property_binding_ref: { artifact_id: 'project-property-binding-vw', artifact_type: 'project_property_binding' },
      binding_version: 'project-context-binding-v2',
      authority_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
    });
    const binding = { ...bareBinding, attestation: await attestProjectContextBindingArtifact({ artifact: bareBinding, issuer, signing: pcbKey.provider }) };
    await repo.put({ artifact_id: binding.artifact_id, content_hash: binding.content_hash, body: binding });
    await new PrismaProjectContextBindingIndex().register(binding as never);
    currentBindingId = binding.artifact_id;
  });

  afterEach(() => {
    vi.clearAllMocks();
    __resetViewerCapabilitySigningProviderForTests(null);
    __resetViewerCapabilityVerifierForTests(null);
    __resetViewerIdentityVerifierForTests(null);
  });

  function baseInput(validFrom: Date, validUntil: Date) {
    return {
      projectId: PROJECT_ID,
      contextBindingArtifactId: currentBindingId,
      releaseArtifactId: RELEASE_ID,
      viewerIdentityArtifactId: viewerIdentityId,
      requestedByUserId: 'user-1',
      capabilityValidFrom: validFrom,
      capabilityValidUntil: validUntil,
    };
  }

  it('INVARIANT 1: the same request (same pinned window) retried three times always mints/reuses the exact same capability identity', async () => {
    const validFrom = new Date('2026-01-01T00:00:00.000Z');
    const validUntil = new Date('2027-01-01T00:00:00.000Z');

    const first = await executeViewerCapabilityProvisioning(baseInput(validFrom, validUntil));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await executeViewerCapabilityProvisioning(baseInput(validFrom, validUntil));
    const third = await executeViewerCapabilityProvisioning(baseInput(validFrom, validUntil));
    expect(second.ok && second.capabilityArtifactId).toBe(first.capabilityArtifactId);
    expect(third.ok && third.capabilityArtifactId).toBe(first.capabilityArtifactId);
    if (second.ok) expect(second.reused).toBe(true);
    if (third.ok) expect(third.reused).toBe(true);
  });

  it('INVARIANT 3: reconciliation after a simulated crash finds and reuses the already-minted capability rather than re-signing', async () => {
    const validFrom = new Date('2026-02-01T00:00:00.000Z');
    const validUntil = new Date('2027-02-01T00:00:00.000Z');
    const first = await executeViewerCapabilityProvisioning(baseInput(validFrom, validUntil));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Simulate a worker crash-and-retry: identical inputs, fresh call.
    const retry = await executeViewerCapabilityProvisioning(baseInput(validFrom, validUntil));
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.reused).toBe(true);
    expect(retry.capabilityArtifactId).toBe(first.capabilityArtifactId);
  });

  it('INVARIANT 4: a DIFFERENT (freshly pinned) validity window for the same subject mints a genuinely distinct capability -- the old one is never mutated to extend validity', async () => {
    const windowA = { from: new Date('2026-03-01T00:00:00.000Z'), until: new Date('2027-03-01T00:00:00.000Z') };
    const windowB = { from: new Date('2026-04-01T00:00:00.000Z'), until: new Date('2027-04-01T00:00:00.000Z') };

    const first = await executeViewerCapabilityProvisioning(baseInput(windowA.from, windowA.until));
    expect(first.ok).toBe(true);
    const second = await executeViewerCapabilityProvisioning(baseInput(windowB.from, windowB.until));
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.capabilityArtifactId).not.toBe(second.capabilityArtifactId);

    // The FIRST capability's own stored validity window is untouched by the second mint.
    const firstArtifact = await repo.resolve<{ payload: { valid_from: string; valid_until: string } }>({ artifact_id: first.capabilityArtifactId, artifact_type: 'viewer_capability' });
    expect(firstArtifact.payload.valid_from).toBe(windowA.from.toISOString());
    expect(firstArtifact.payload.valid_until).toBe(windowA.until.toISOString());
  });
});
