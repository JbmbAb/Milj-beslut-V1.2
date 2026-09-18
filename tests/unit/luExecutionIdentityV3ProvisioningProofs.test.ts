/**
 * PRODUCT-LU-EXECUTION-IDENTITY-V3-PROVISIONING-01 Phase B + AUTHORITY-04E proof matrix.
 *
 * The provisioning worker now has two issuer-side responsibilities: issue/reconcile the V3
 * ExecutionIdentity and issue/reconcile the exact-attempt ticket for the CURRENT root-signed LU
 * issuer lifecycle. The fresh-verifier child still receives no private signing key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mimersCreate, resolveCanonicalContextMock, resolveCurrentReleaseMock, userFindUniqueMock, assertProjectAccessMock, spawnMock } = vi.hoisted(() => ({
  mimersCreate: vi.fn(),
  resolveCanonicalContextMock: vi.fn(),
  resolveCurrentReleaseMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  assertProjectAccessMock: vi.fn(),
  spawnMock: vi.fn(),
}));

vi.mock('@miljobeslut/mps-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@miljobeslut/mps-runtime')>();
  return { ...actual, MimersIntegration: { create: mimersCreate } };
});
vi.mock('../../src/application/resolveCanonicalProjectContext', () => ({
  resolveCanonicalProjectContext: resolveCanonicalContextMock,
}));
vi.mock('../../server/modules/release/productReleaseRuntime', () => ({
  resolveCanonicalProductRelease: resolveCurrentReleaseMock,
}));
vi.mock('../../server/db/prisma', () => ({
  prisma: { user: { findUnique: userFindUniqueMock } },
}));
vi.mock('../../server/security/projectAccess', () => ({
  assertProjectAccess: assertProjectAccessMock,
}));
vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  default: { spawn: spawnMock },
}));

import { LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { InMemoryArtifactRepository } from '@miljobeslut/mps-runtime';
import {
  LU_EXECUTION_AUTHORITY_ISSUER_TYPE,
  attestLuExecutionAuthorityIssuer,
  attestLuExecutionAuthorityLifecycle,
  attestLuExecutionAuthorityRoot,
  createLocalizationGeometryArtifact,
  createLuExecutionAuthorityIssuerArtifact,
  createLuExecutionAuthorityLifecycleArtifact,
  createLuExecutionAuthorityRootArtifact,
  type LuExecutionAuthorityIssuerArtifact,
  type LuExecutionAuthorityLifecycleArtifact,
  type LuExecutionAuthorityRootArtifact,
} from '@miljobeslut/mps-lu';
import { executeLocalizationIdentityProvisioning } from '../../server/modules/localization/luExecutionIdentityV3Provisioning';
import {
  __resetLuExecutionAuthorityVerifierForTests,
} from '../../packages/mps-lu/src/execution/LuExecutionAuthorityVerifier';
import { __resetLuExecutionAuthoritySigningProviderForTests } from '../../server/security/luExecutionAuthoritySigningKey';

const PROJECT_ID = 'project-v3-provisioning-proof';
const PROPERTY_CONTEXT_REF = { artifact_id: 'lu_property_context-fixture', artifact_type: 'LU_PROPERTY_CONTEXT' } as const;
const BINDING_REF = { artifact_id: 'project-context-binding-fixture', artifact_type: 'project_context_binding' } as const;
const PROJECT_CONTEXT_REF = { artifact_id: 'lu_project_context-fixture', artifact_type: 'LU_PROJECT_CONTEXT' } as const;
const RELEASE_REF = { artifact_id: 'product-release-fixture', artifact_type: 'product_release_manifest' } as const;

function ref(artifact: { readonly artifact_id: string; readonly artifact_type: string }) {
  return { artifact_id: artifact.artifact_id, artifact_type: artifact.artifact_type };
}

function makeGeometry(overrides?: Partial<Parameters<typeof createLocalizationGeometryArtifact>[0]>) {
  return createLocalizationGeometryArtifact({
    project_id: PROJECT_ID,
    property_context_ref: PROPERTY_CONTEXT_REF,
    wgs84LngLat: [18.07, 59.33],
    sweref99NorthingEasting: [6580000, 674000],
    provenance: 'user_defined',
    label: 'Test point',
    created_by: 'requester-1',
    ...overrides,
  });
}

describe('PRODUCT-LU-EXECUTION-IDENTITY-V3-PROVISIONING-01 — executor proof matrix', () => {
  let repo: InMemoryArtifactRepository;
  let rootKey: ReturnType<typeof LocalPemSigningKeyProvider.generate>;
  let authorityKey: ReturnType<typeof LocalPemSigningKeyProvider.generate>;
  let rootArtifact: LuExecutionAuthorityRootArtifact;
  let issuerArtifact: LuExecutionAuthorityIssuerArtifact;
  let lifecycleArtifact: LuExecutionAuthorityLifecycleArtifact;
  let capturedSpawnEnv: Record<string, string | undefined> | undefined;
  let capturedSpawnArgs: string[] | undefined;

  beforeEach(async () => {
    repo = new InMemoryArtifactRepository();
    mimersCreate.mockResolvedValue({ artifactRepository: repo });
    resolveCanonicalContextMock.mockResolvedValue({
      propertyContextRef: PROPERTY_CONTEXT_REF,
      projectContextRef: PROJECT_CONTEXT_REF,
      contextBindingRef: BINDING_REF,
      propertyIdentity: 'property:test:fixture',
      coordinates: [6580000, 674000],
    });
    resolveCurrentReleaseMock.mockResolvedValue({ ...RELEASE_REF, release_hash: { algorithm: 'sha256', value: 'a'.repeat(64) } });
    userFindUniqueMock.mockResolvedValue({
      id: 'requester-1',
      organisationId: 'org-1',
      bankidId: 'bankid-requester-1',
      role: 'CONSULTANT',
      identityEnvironment: 'LEGACY',
    });
    assertProjectAccessMock.mockResolvedValue(undefined);
    spawnMock.mockReset();
    spawnMock.mockImplementation((_cmd: string, _args: string[], opts: { env?: Record<string, string | undefined> }) => {
      capturedSpawnEnv = opts.env;
      capturedSpawnArgs = _args;
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      return {
        once: (event: string, cb: (...args: unknown[]) => void) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(cb);
          if (event === 'exit') setTimeout(() => cb(0), 0);
        },
      };
    });

    rootKey = LocalPemSigningKeyProvider.generate('ed25519:lu-root-v3-provisioning-proof');
    authorityKey = LocalPemSigningKeyProvider.generate('ed25519:lu-authority-v3-provisioning-proof');
    process.env.LU_EXECUTION_AUTHORITY_ROOT_KEY_ID = rootKey.provider.keyId;
    process.env.LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM = rootKey.publicKey;
    process.env.LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID = authorityKey.provider.keyId;
    process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM = authorityKey.publicKey;
    process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM = authorityKey.privateKey;
    __resetLuExecutionAuthorityVerifierForTests(null);
    __resetLuExecutionAuthoritySigningProviderForTests(null);

    const bareRoot = createLuExecutionAuthorityRootArtifact({
      root_key_id: rootKey.provider.keyId,
      public_key_fingerprint: 'root-fingerprint-provisioning-proof',
    });
    rootArtifact = {
      ...bareRoot,
      attestation: await attestLuExecutionAuthorityRoot({
        root: bareRoot,
        signing: rootKey.provider,
      }),
    };
    const bareIssuer = createLuExecutionAuthorityIssuerArtifact({
      issuer_key_id: authorityKey.provider.keyId,
      public_key_fingerprint: 'issuer-fingerprint-provisioning-proof',
      root_ref: ref(rootArtifact),
    });
    issuerArtifact = {
      ...bareIssuer,
      attestation: await attestLuExecutionAuthorityIssuer({
        issuer: bareIssuer,
        root: rootArtifact,
        signing: rootKey.provider,
      }),
    };
    const bareLifecycle = createLuExecutionAuthorityLifecycleArtifact({
      root: rootArtifact,
      issuer: issuerArtifact,
      valid_from: '2020-01-01T00:00:00.000Z',
      valid_until: '2035-01-01T00:00:00.000Z',
    });
    lifecycleArtifact = {
      ...bareLifecycle,
      attestation: await attestLuExecutionAuthorityLifecycle({
        lifecycle: bareLifecycle,
        root: rootArtifact,
        signing: rootKey.provider,
      }),
    };
    await repo.put({ artifact_id: rootArtifact.artifact_id, content_hash: rootArtifact.content_hash, body: rootArtifact });
    await repo.put({ artifact_id: issuerArtifact.artifact_id, content_hash: issuerArtifact.content_hash, body: issuerArtifact });
    await repo.put({ artifact_id: lifecycleArtifact.artifact_id, content_hash: lifecycleArtifact.content_hash, body: lifecycleArtifact });
    process.env.LU_EXECUTION_AUTHORITY_ISSUER_ARTIFACT_ID = issuerArtifact.artifact_id;
    process.env.LU_EXECUTION_AUTHORITY_LIFECYCLE_ID = lifecycleArtifact.artifact_id;
  });

  afterEach(() => {
    delete process.env.LU_EXECUTION_AUTHORITY_ISSUER_ARTIFACT_ID;
    delete process.env.LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID;
    delete process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM;
    delete process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM;
    delete process.env.LU_EXECUTION_AUTHORITY_ROOT_KEY_ID;
    delete process.env.LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM;
    delete process.env.LU_EXECUTION_AUTHORITY_LIFECYCLE_ID;
    __resetLuExecutionAuthorityVerifierForTests(null);
    __resetLuExecutionAuthoritySigningProviderForTests(null);
    capturedSpawnEnv = undefined;
    capturedSpawnArgs = undefined;
  });

  it('proof 10: requester with no real project access -> fail closed, never touches CAS', async () => {
    assertProjectAccessMock.mockRejectedValue(new Error('not a member'));
    const geometry = makeGeometry();
    await repo.put({ artifact_id: geometry.artifact_id, content_hash: geometry.content_hash, body: geometry });

    const outcome = await executeLocalizationIdentityProvisioning({
      projectId: PROJECT_ID,
      geometryArtifactId: geometry.artifact_id,
      requestedByUserId: 'requester-1',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failureCode).toBe('REQUESTER_NOT_AUTHORIZED');
    expect(mimersCreate).not.toHaveBeenCalled();
  });

  it('proof 9a: missing pinned geometry -> fail closed', async () => {
    const outcome = await executeLocalizationIdentityProvisioning({
      projectId: PROJECT_ID,
      geometryArtifactId: 'localization-geometry-never-persisted',
      requestedByUserId: 'requester-1',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failureCode).toBe('GEOMETRY_UNAVAILABLE_OR_TAMPERED');
  });

  it('proof 9b: tampered pinned geometry -> fail closed', async () => {
    const geometry = makeGeometry();
    const tampered = { ...geometry, payload: { ...geometry.payload, label: 'tampered after the fact' } };
    await repo.put({ artifact_id: geometry.artifact_id, content_hash: geometry.content_hash, body: tampered });

    const outcome = await executeLocalizationIdentityProvisioning({
      projectId: PROJECT_ID,
      geometryArtifactId: geometry.artifact_id,
      requestedByUserId: 'requester-1',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failureCode).toBe('GEOMETRY_UNAVAILABLE_OR_TAMPERED');
  });

  it('proof 9c: geometry belongs to a different project -> fail closed', async () => {
    const geometry = makeGeometry({ project_id: 'some-other-project' });
    await repo.put({ artifact_id: geometry.artifact_id, content_hash: geometry.content_hash, body: geometry });

    const outcome = await executeLocalizationIdentityProvisioning({
      projectId: PROJECT_ID,
      geometryArtifactId: geometry.artifact_id,
      requestedByUserId: 'requester-1',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failureCode).toBe('GEOMETRY_PROJECT_MISMATCH');
  });

  it('proof 9d: geometry bound to a different property context -> fail closed', async () => {
    const geometry = makeGeometry({ property_context_ref: { artifact_id: 'lu_property_context-WRONG', artifact_type: 'LU_PROPERTY_CONTEXT' } });
    await repo.put({ artifact_id: geometry.artifact_id, content_hash: geometry.content_hash, body: geometry });

    const outcome = await executeLocalizationIdentityProvisioning({
      projectId: PROJECT_ID,
      geometryArtifactId: geometry.artifact_id,
      requestedByUserId: 'requester-1',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failureCode).toBe('GEOMETRY_PROPERTY_MISMATCH');
  });

  it('proof 2 + hard invariant: full mint succeeds and fresh verifier gets no private key', async () => {
    const geometry = makeGeometry();
    await repo.put({ artifact_id: geometry.artifact_id, content_hash: geometry.content_hash, body: geometry });

    const outcome = await executeLocalizationIdentityProvisioning({
      projectId: PROJECT_ID,
      geometryArtifactId: geometry.artifact_id,
      requestedByUserId: 'requester-1',
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reused).toBe(false);
    expect(outcome.executionIdentityArtifactId).toMatch(/^lu-identity-v3-/);

    const identity = await repo.resolve<{ artifact_id: string; references: readonly { artifact_id: string; artifact_type: string }[] }>({
      artifact_id: outcome.executionIdentityArtifactId,
      artifact_type: 'execution_identity',
    });
    expect(identity.references.some((r) => r.artifact_id === issuerArtifact.artifact_id && r.artifact_type === LU_EXECUTION_AUTHORITY_ISSUER_TYPE)).toBe(true);

    expect(spawnMock).toHaveBeenCalledOnce();
    expect(capturedSpawnEnv).toBeDefined();
    expect(capturedSpawnEnv?.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM).toBeUndefined();
    expect(capturedSpawnArgs?.[capturedSpawnArgs.length - 1]).toBe(geometry.artifact_id);
  });

  it('proof 3 (reused): same exact request reuses identity and lifecycle-bound ticket', async () => {
    const geometry = makeGeometry();
    await repo.put({ artifact_id: geometry.artifact_id, content_hash: geometry.content_hash, body: geometry });

    const first = await executeLocalizationIdentityProvisioning({
      projectId: PROJECT_ID,
      geometryArtifactId: geometry.artifact_id,
      requestedByUserId: 'requester-1',
    });
    expect(first.ok).toBe(true);
    spawnMock.mockClear();

    const second = await executeLocalizationIdentityProvisioning({
      projectId: PROJECT_ID,
      geometryArtifactId: geometry.artifact_id,
      requestedByUserId: 'requester-1',
    });
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.executionIdentityArtifactId).toBe(first.executionIdentityArtifactId);
      expect(second.reused).toBe(true);
    }
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('proof 5: partial CAS identity without attestation is not trusted and retry re-issues cleanly', async () => {
    const geometry = makeGeometry();
    await repo.put({ artifact_id: geometry.artifact_id, content_hash: geometry.content_hash, body: geometry });

    const first = await executeLocalizationIdentityProvisioning({
      projectId: PROJECT_ID,
      geometryArtifactId: geometry.artifact_id,
      requestedByUserId: 'requester-1',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const orphaned = new InMemoryArtifactRepository();
    const identity = await repo.resolve({ artifact_id: first.executionIdentityArtifactId, artifact_type: 'execution_identity' });
    await orphaned.put({ artifact_id: rootArtifact.artifact_id, content_hash: rootArtifact.content_hash, body: rootArtifact });
    await orphaned.put({ artifact_id: issuerArtifact.artifact_id, content_hash: issuerArtifact.content_hash, body: issuerArtifact });
    await orphaned.put({ artifact_id: lifecycleArtifact.artifact_id, content_hash: lifecycleArtifact.content_hash, body: lifecycleArtifact });
    await orphaned.put({ artifact_id: first.executionIdentityArtifactId, content_hash: (identity as { content_hash: { algorithm: 'sha256'; value: string } }).content_hash, body: identity });
    await orphaned.put({ artifact_id: geometry.artifact_id, content_hash: geometry.content_hash, body: geometry });
    mimersCreate.mockResolvedValue({ artifactRepository: orphaned });

    const retry = await executeLocalizationIdentityProvisioning({
      projectId: PROJECT_ID,
      geometryArtifactId: geometry.artifact_id,
      requestedByUserId: 'requester-1',
    });
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.executionIdentityArtifactId).toBe(first.executionIdentityArtifactId);
  });

  it("proof 4 (A->B race): A and B get distinct identities/tickets under one current lifecycle", async () => {
    const geometryA = makeGeometry({ wgs84LngLat: [18.07, 59.33], sweref99NorthingEasting: [6580000, 674000] });
    const geometryB = makeGeometry({ wgs84LngLat: [18.2, 59.4], sweref99NorthingEasting: [6600000, 680000] });
    await repo.put({ artifact_id: geometryA.artifact_id, content_hash: geometryA.content_hash, body: geometryA });
    await repo.put({ artifact_id: geometryB.artifact_id, content_hash: geometryB.content_hash, body: geometryB });

    const outcomeForA = await executeLocalizationIdentityProvisioning({
      projectId: PROJECT_ID,
      geometryArtifactId: geometryA.artifact_id,
      requestedByUserId: 'requester-1',
    });
    const outcomeForB = await executeLocalizationIdentityProvisioning({
      projectId: PROJECT_ID,
      geometryArtifactId: geometryB.artifact_id,
      requestedByUserId: 'requester-1',
    });

    expect(outcomeForA.ok).toBe(true);
    expect(outcomeForB.ok).toBe(true);
    if (outcomeForA.ok && outcomeForB.ok) {
      expect(outcomeForA.executionIdentityArtifactId).not.toBe(outcomeForB.executionIdentityArtifactId);
      const identityA = await repo.resolve<{ subject_v3?: { localization_geometry_ref: { artifact_id: string } } }>({
        artifact_id: outcomeForA.executionIdentityArtifactId,
        artifact_type: 'execution_identity',
      });
      const identityB = await repo.resolve<{ subject_v3?: { localization_geometry_ref: { artifact_id: string } } }>({
        artifact_id: outcomeForB.executionIdentityArtifactId,
        artifact_type: 'execution_identity',
      });
      expect(identityA.subject_v3?.localization_geometry_ref.artifact_id).toBe(geometryA.artifact_id);
      expect(identityB.subject_v3?.localization_geometry_ref.artifact_id).toBe(geometryB.artifact_id);
    }
  });
});
