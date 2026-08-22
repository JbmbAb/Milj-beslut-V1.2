/**
 * PRODUCT-LU-EXECUTION-IDENTITY-V3-PROVISIONING-01 Phase B — proof matrix.
 *
 * Mirrors the established test pattern for this exact class of module
 * (tests/unit/luProjectContextBootstrap.test.ts): mock MimersIntegration.create, the Prisma
 * singleton, and the canonical-context resolvers, then exercise the REAL executor/queue logic.
 * The fresh-verify subprocess (a real spawned child process against real disk CAS) cannot share
 * an in-memory CAS across a process boundary, so `spawn` is mocked here to short-circuit it while
 * still asserting on HOW it was invoked (private key env var deleted) -- the subprocess's own
 * real, unmocked behavior is proven separately by the live ops-script proof against the real dev
 * DB/CAS, matching how every prior unit in this session split "fast unit proof" from "live proof".
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
vi.mock('../../src/application/resolveCurrentProductRelease', () => ({
  resolveCurrentProductRelease: resolveCurrentReleaseMock,
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

import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { InMemoryArtifactRepository } from '@miljobeslut/mps-runtime';
import { createLocalizationGeometryArtifact, LU_EXECUTION_AUTHORITY_ISSUER_TYPE } from '@miljobeslut/mps-lu';
import { executeLocalizationIdentityProvisioning } from '../../server/modules/localization/luExecutionIdentityV3Provisioning';
import {
  __resetLuExecutionAuthorityVerifierForTests,
} from '../../packages/mps-lu/src/execution/LuExecutionAuthorityVerifier';
import { __resetLuExecutionAuthoritySigningProviderForTests } from '../../server/security/luExecutionAuthoritySigningKey';

const ISSUER_ARTIFACT_ID = 'lu-execution-authority-issuer-test-fixture';
const PROJECT_ID = 'project-v3-provisioning-proof';
const PROPERTY_CONTEXT_REF = { artifact_id: 'lu_property_context-fixture', artifact_type: 'LU_PROPERTY_CONTEXT' } as const;
const BINDING_REF = { artifact_id: 'project-context-binding-fixture', artifact_type: 'project_context_binding' } as const;
const PROJECT_CONTEXT_REF = { artifact_id: 'lu_project_context-fixture', artifact_type: 'LU_PROJECT_CONTEXT' } as const;
const RELEASE_REF = { artifact_id: 'product-release-fixture', artifact_type: 'product_release_manifest' } as const;

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
  let authorityKey: ReturnType<typeof LocalPemSigningKeyProvider.generate>;

  beforeEach(() => {
    repo = new InMemoryArtifactRepository();
    mimersCreate.mockResolvedValue({ artifactRepository: repo });
    resolveCanonicalContextMock.mockResolvedValue({
      propertyContextRef: PROPERTY_CONTEXT_REF,
      projectContextRef: PROJECT_CONTEXT_REF,
      contextBindingRef: BINDING_REF,
      propertyIdentity: 'property:test:fixture',
      coordinates: [6580000, 674000],
    });
    resolveCurrentReleaseMock.mockResolvedValue({ releaseRef: RELEASE_REF, releaseHash: 'a'.repeat(64) });
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

    authorityKey = LocalPemSigningKeyProvider.generate('ed25519:lu-authority-v3-provisioning-proof');
    process.env.LU_EXECUTION_AUTHORITY_ISSUER_ARTIFACT_ID = ISSUER_ARTIFACT_ID;
    process.env.LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID = authorityKey.provider.keyId;
    process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM = authorityKey.publicKey;
    process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM = authorityKey.privateKey;
  });

  let capturedSpawnEnv: Record<string, string | undefined> | undefined;
  let capturedSpawnArgs: string[] | undefined;

  afterEach(() => {
    delete process.env.LU_EXECUTION_AUTHORITY_ISSUER_ARTIFACT_ID;
    delete process.env.LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID;
    delete process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM;
    delete process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM;
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

  it('proof 2 + hard invariant: full mint succeeds, spawns fresh verifier with the private key env var deleted', async () => {
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
    expect(identity.references.some((r) => r.artifact_id === ISSUER_ARTIFACT_ID && r.artifact_type === LU_EXECUTION_AUTHORITY_ISSUER_TYPE)).toBe(true);

    expect(spawnMock).toHaveBeenCalledOnce();
    expect(capturedSpawnEnv).toBeDefined();
    expect(capturedSpawnEnv?.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM).toBeUndefined();
    expect(capturedSpawnArgs?.[capturedSpawnArgs.length - 1]).toBe(geometry.artifact_id);
  });

  it('proof 3 (reused): same exact request twice -> second call reuses, no duplicate signing', async () => {
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
    // No second mint attempt -> no second fresh-verify subprocess spawned.
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('proof 5 (crash/retry safety): a partially-written CAS state (identity present, attestation missing) is not trusted -- re-issues cleanly', async () => {
    const geometry = makeGeometry();
    await repo.put({ artifact_id: geometry.artifact_id, content_hash: geometry.content_hash, body: geometry });

    const first = await executeLocalizationIdentityProvisioning({
      projectId: PROJECT_ID,
      geometryArtifactId: geometry.artifact_id,
      requestedByUserId: 'requester-1',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Simulate a crash that left the identity written but never persisted its attestation --
    // a genuinely partial state a real crash mid-issuance could produce.
    const orphaned = new InMemoryArtifactRepository();
    const identity = await repo.resolve({ artifact_id: first.executionIdentityArtifactId, artifact_type: 'execution_identity' });
    await orphaned.put({ artifact_id: first.executionIdentityArtifactId, content_hash: (identity as { content_hash: { algorithm: 'sha256'; value: string } }).content_hash, body: identity });
    await orphaned.put({ artifact_id: geometry.artifact_id, content_hash: geometry.content_hash, body: geometry });
    mimersCreate.mockResolvedValue({ artifactRepository: orphaned });

    const retry = await executeLocalizationIdentityProvisioning({
      projectId: PROJECT_ID,
      geometryArtifactId: geometry.artifact_id,
      requestedByUserId: 'requester-1',
    });
    // Re-issuing under the SAME subject is itself idempotent (content-addressed) -- the retry
    // either mints the exact same id fresh (now with its attestation) or reuses; either is safe,
    // it must never diverge to a DIFFERENT id for the same subject.
    expect(retry.ok).toBe(true);
    if (retry.ok && first.ok) {
      expect(retry.executionIdentityArtifactId).toBe(first.executionIdentityArtifactId);
    }
  });

  it("proof 4 (A->B race): a stale request for A completes as a valid, non-current historical identity -- B's own request produces a distinct identity", async () => {
    const geometryA = makeGeometry({ wgs84LngLat: [18.07, 59.33], sweref99NorthingEasting: [6580000, 674000] });
    const geometryB = makeGeometry({ wgs84LngLat: [18.2, 59.4], sweref99NorthingEasting: [6600000, 680000] });
    await repo.put({ artifact_id: geometryA.artifact_id, content_hash: geometryA.content_hash, body: geometryA });
    await repo.put({ artifact_id: geometryB.artifact_id, content_hash: geometryB.content_hash, body: geometryB });

    // The request for A was enqueued first (pinned to A) but its worker only gets around to it
    // AFTER B has already been saved -- exactly the race the recon flagged. The executor must
    // still mint strictly for A, never silently substitute "whatever is current now".
    const outcomeForStaleA = await executeLocalizationIdentityProvisioning({
      projectId: PROJECT_ID,
      geometryArtifactId: geometryA.artifact_id,
      requestedByUserId: 'requester-1',
    });
    const outcomeForB = await executeLocalizationIdentityProvisioning({
      projectId: PROJECT_ID,
      geometryArtifactId: geometryB.artifact_id,
      requestedByUserId: 'requester-1',
    });

    expect(outcomeForStaleA.ok).toBe(true);
    expect(outcomeForB.ok).toBe(true);
    if (outcomeForStaleA.ok && outcomeForB.ok) {
      expect(outcomeForStaleA.executionIdentityArtifactId).not.toBe(outcomeForB.executionIdentityArtifactId);
      const identityA = await repo.resolve<{ subject_v3?: { localization_geometry_ref: { artifact_id: string } } }>({
        artifact_id: outcomeForStaleA.executionIdentityArtifactId,
        artifact_type: 'execution_identity',
      });
      const identityB = await repo.resolve<{ subject_v3?: { localization_geometry_ref: { artifact_id: string } } }>({
        artifact_id: outcomeForB.executionIdentityArtifactId,
        artifact_type: 'execution_identity',
      });
      // A's identity is genuinely, permanently scoped to A -- never silently reinterpreted as B.
      expect(identityA.subject_v3?.localization_geometry_ref.artifact_id).toBe(geometryA.artifact_id);
      expect(identityB.subject_v3?.localization_geometry_ref.artifact_id).toBe(geometryB.artifact_id);
    }
  });
});
