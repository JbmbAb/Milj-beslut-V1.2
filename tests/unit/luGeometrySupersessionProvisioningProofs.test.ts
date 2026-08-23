/**
 * LU-PROJECTION-RECONCILIATION-AND-TOTAL-ORDER-V1 Phase B — geometry-supersession worker proofs.
 *
 * Mirrors the established pattern for this exact class of module
 * (tests/unit/luExecutionIdentityV3ProvisioningProofs.test.ts): mock MimersIntegration.create and
 * the Prisma singleton, then exercise the REAL executor logic (reconciliation-first minting,
 * currentness gate, signing/verification) against a real in-memory CAS.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mimersCreate, userFindUniqueMock, assertProjectAccessMock } = vi.hoisted(() => ({
  mimersCreate: vi.fn(),
  userFindUniqueMock: vi.fn(),
  assertProjectAccessMock: vi.fn(),
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
const { resetGeometryFakeRows, resetSupersessionFakeRows } = vi.hoisted(() => ({
  resetGeometryFakeRows: vi.fn(),
  resetSupersessionFakeRows: vi.fn(),
}));

vi.mock('../../server/repositories/localizationGeometryProjectionRepository', () => {
  type Row = { projectId: string; geometryArtifactId: string; propertyContextRefId: string; propertyContextRefType: string; createdAt: Date };
  let rows: Row[] = [];
  resetGeometryFakeRows.mockImplementation(() => { rows = []; });
  class FakeLocalizationGeometryProjectionIndex {
    async register(row: { projectId: string; geometryArtifactId: string; propertyContextRef: { artifact_id: string; artifact_type: string } }) {
      if (rows.some((r) => r.projectId === row.projectId && r.geometryArtifactId === row.geometryArtifactId)) return;
      rows.push({ projectId: row.projectId, geometryArtifactId: row.geometryArtifactId, propertyContextRefId: row.propertyContextRef.artifact_id, propertyContextRefType: row.propertyContextRef.artifact_type, createdAt: new Date(Date.now() + rows.length) });
    }
    async listForProject(projectId: string) {
      return rows.filter((r) => r.projectId === projectId).map((r) => ({ ...r }));
    }
  }
  return { PrismaLocalizationGeometryProjectionIndex: FakeLocalizationGeometryProjectionIndex };
});
vi.mock('../../server/repositories/localizationGeometrySupersessionRepository', () => {
  type Row = { projectId: string; supersessionArtifactId: string; predecessorGeometryArtifactId: string; successorGeometryArtifactId: string; createdAt: Date };
  let rows: Row[] = [];
  resetSupersessionFakeRows.mockImplementation(() => { rows = []; });
  class FakeLocalizationGeometrySupersessionIndex {
    async register(row: { projectId: string; supersessionArtifactId: string; predecessorGeometryArtifactId: string; successorGeometryArtifactId: string }) {
      if (rows.some((r) => r.projectId === row.projectId && r.supersessionArtifactId === row.supersessionArtifactId)) return;
      rows.push({ ...row, createdAt: new Date(Date.now() + rows.length) });
    }
    async listForProject(projectId: string) {
      return rows.filter((r) => r.projectId === projectId).map((r) => ({ ...r }));
    }
  }
  return { PrismaLocalizationGeometrySupersessionIndex: FakeLocalizationGeometrySupersessionIndex };
});

import { LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { InMemoryArtifactRepository } from '@miljobeslut/mps-runtime';
import { createLocalizationGeometryArtifact } from '@miljobeslut/mps-lu';
import { executeGeometrySupersessionProvisioning } from '../../server/modules/localization/luGeometrySupersessionProvisioning';
import { resolveCurrentLocalizationGeometry } from '../../server/modules/localization/localizationGeometryProjection';
import { PrismaLocalizationGeometryProjectionIndex } from '../../server/repositories/localizationGeometryProjectionRepository';
import { PrismaLocalizationGeometrySupersessionIndex } from '../../server/repositories/localizationGeometrySupersessionRepository';
import { __resetLocalizationGeometrySupersessionSigningProviderForTests } from '../../server/security/localizationGeometrySupersessionSigningKey';
import { __resetLocalizationGeometrySupersessionVerifierForTests } from '../../server/security/localizationGeometrySupersessionVerifier';

const PROJECT_ID = 'project-geometry-supersession-worker-proof';
const PROPERTY_CONTEXT_REF = { artifact_id: 'lu_property_context-fixture', artifact_type: 'LU_PROPERTY_CONTEXT' } as const;

function makeGeometry(label: string, lng: number, lat: number) {
  return createLocalizationGeometryArtifact({
    project_id: PROJECT_ID,
    property_context_ref: PROPERTY_CONTEXT_REF,
    wgs84LngLat: [lng, lat],
    sweref99NorthingEasting: [6580000 + lng * 1000, 674000 + lat * 1000],
    provenance: 'user_defined',
    label,
    created_by: 'test-user',
  });
}

describe('LU-PROJECTION-RECONCILIATION-AND-TOTAL-ORDER-V1 — geometry supersession worker proofs', () => {
  let repo: InMemoryArtifactRepository;

  beforeEach(() => {
    resetGeometryFakeRows();
    resetSupersessionFakeRows();
    repo = new InMemoryArtifactRepository();
    mimersCreate.mockResolvedValue({ artifactRepository: repo });
    userFindUniqueMock.mockResolvedValue({ id: 'user-1', organisationId: 'org-1', bankidId: 'bankid-1', role: 'CONSULTANT', identityEnvironment: 'TEST' });
    assertProjectAccessMock.mockResolvedValue(undefined);

    const key = LocalPemSigningKeyProvider.generate('ed25519:geometry-supersession-worker-proof');
    process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_KEY_ID = key.provider.keyId;
    process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PRIVATE_KEY_PEM = key.privateKey;
    process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM = key.publicKey;
    __resetLocalizationGeometrySupersessionSigningProviderForTests(null);
    __resetLocalizationGeometrySupersessionVerifierForTests(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
    __resetLocalizationGeometrySupersessionSigningProviderForTests(null);
    __resetLocalizationGeometrySupersessionVerifierForTests(null);
  });

  async function put(geometry: ReturnType<typeof makeGeometry>) {
    await repo.put({ artifact_id: geometry.artifact_id, content_hash: geometry.content_hash, body: geometry });
  }
  async function registerRoot(geometry: ReturnType<typeof makeGeometry>) {
    await new PrismaLocalizationGeometryProjectionIndex().register({
      projectId: PROJECT_ID,
      geometryArtifactId: geometry.artifact_id,
      propertyContextRef: PROPERTY_CONTEXT_REF,
    });
  }

  it('proof: predecessor still current -> signs, verifies, registers the successor+edge together, current flips to successor', async () => {
    const a = makeGeometry('A', 18.0, 59.0);
    await put(a);
    await registerRoot(a);

    const b = makeGeometry('B', 18.1, 59.1);
    await put(b);

    const outcome = await executeGeometrySupersessionProvisioning({
      requestId: 'req-1',
      requestCreatedAt: new Date('2026-08-23T00:00:00Z'),
      projectId: PROJECT_ID,
      predecessorGeometryArtifactId: a.artifact_id,
      successorGeometryArtifactId: b.artifact_id,
      requestedByUserId: 'user-1',
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reused).toBe(false);
    expect(outcome.supersessionArtifactId).toBeTruthy();

    const current = await resolveCurrentLocalizationGeometry({ projectId: PROJECT_ID, artifactRepository: repo });
    expect(current.geometryArtifactId).toBe(b.artifact_id);
  });

  it('proof: retry of the exact same request is reconciliation-first -- reuses the already-minted edge, never re-signs, never diverges', async () => {
    const a = makeGeometry('A', 18.0, 59.0);
    await put(a);
    await registerRoot(a);
    const b = makeGeometry('B', 18.1, 59.1);
    await put(b);

    const request = {
      requestId: 'req-1',
      requestCreatedAt: new Date('2026-08-23T00:00:00Z'),
      projectId: PROJECT_ID,
      predecessorGeometryArtifactId: a.artifact_id,
      successorGeometryArtifactId: b.artifact_id,
      requestedByUserId: 'user-1',
    };

    const first = await executeGeometrySupersessionProvisioning(request);
    expect(first.ok && !first.reused).toBe(true);

    // Simulate a crash-and-retry of the SAME request (identical requestCreatedAt -> identical
    // deterministic issued_at -> identical content-addressed supersession artifact_id).
    const retry = await executeGeometrySupersessionProvisioning(request);
    expect(retry.ok).toBe(true);
    if (!retry.ok || !first.ok) return;
    expect(retry.reused).toBe(true);
    expect(retry.supersessionArtifactId).toBe(first.supersessionArtifactId);
  });

  it('proof: pinned predecessor no longer current -> SUPERSEDED, never mutated into a different pair, current stays where it actually is', async () => {
    const a = makeGeometry('A', 18.0, 59.0);
    await put(a);
    await registerRoot(a);
    const b = makeGeometry('B', 18.1, 59.1);
    await put(b);
    // A -> B already happened for real.
    const first = await executeGeometrySupersessionProvisioning({
      requestId: 'req-1', requestCreatedAt: new Date('2026-08-23T00:00:00Z'), projectId: PROJECT_ID,
      predecessorGeometryArtifactId: a.artifact_id, successorGeometryArtifactId: b.artifact_id, requestedByUserId: 'user-1',
    });
    expect(first.ok).toBe(true);

    // A stale request, still pinned to the now-superseded predecessor A, targeting a third point C.
    const c = makeGeometry('C', 18.2, 59.2);
    await put(c);
    const stale = await executeGeometrySupersessionProvisioning({
      requestId: 'req-2', requestCreatedAt: new Date('2026-08-23T00:01:00Z'), projectId: PROJECT_ID,
      predecessorGeometryArtifactId: a.artifact_id, successorGeometryArtifactId: c.artifact_id, requestedByUserId: 'user-1',
    });

    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.superseded).toBe(true);

    // Current must still be B -- the stale request must never have created any edge at all.
    const current = await resolveCurrentLocalizationGeometry({ projectId: PROJECT_ID, artifactRepository: repo });
    expect(current.geometryArtifactId).toBe(b.artifact_id);
  });

  it('proof: rapid A->B and A->C race -- never silently rewritten into A->B->C; either both land as a detected fork (fail closed on read) or the loser is cleanly SUPERSEDED', async () => {
    const a = makeGeometry('A', 18.0, 59.0);
    await put(a);
    await registerRoot(a);
    const b = makeGeometry('B', 18.1, 59.1);
    const c = makeGeometry('C', 18.2, 59.2);
    await put(b);
    await put(c);

    const [resultAB, resultAC] = await Promise.all([
      executeGeometrySupersessionProvisioning({
        requestId: 'req-ab', requestCreatedAt: new Date('2026-08-23T00:00:00Z'), projectId: PROJECT_ID,
        predecessorGeometryArtifactId: a.artifact_id, successorGeometryArtifactId: b.artifact_id, requestedByUserId: 'user-1',
      }),
      executeGeometrySupersessionProvisioning({
        requestId: 'req-ac', requestCreatedAt: new Date('2026-08-23T00:00:01Z'), projectId: PROJECT_ID,
        predecessorGeometryArtifactId: a.artifact_id, successorGeometryArtifactId: c.artifact_id, requestedByUserId: 'user-1',
      }),
    ]);

    // Neither request could ever have used the OTHER's successor as ITS OWN predecessor -- both
    // requests carry their EXACT pinned predecessor (A) from enqueue time, so "A->B->C" (B becoming
    // C's predecessor) is structurally impossible regardless of processing order or outcome here.
    if (resultAC.ok) expect((resultAC as { supersessionArtifactId?: string }).supersessionArtifactId ?? '').not.toContain('->' + b.artifact_id);

    const bothSucceeded = resultAB.ok && resultAC.ok;
    if (bothSucceeded) {
      // Both observed A as current before either committed -- a genuine fork now exists in CAS.
      // The read side must fail closed rather than arbitrarily pick one.
      await expect(resolveCurrentLocalizationGeometry({ projectId: PROJECT_ID, artifactRepository: repo })).rejects.toThrow(
        'AMBIGUOUS_CURRENT_GEOMETRY',
      );
    } else {
      // One serialized ahead of the other -- the loser must be cleanly SUPERSEDED (not FAILED,
      // not a divergent edge), and current must resolve to exactly the winner's successor.
      const loser = resultAB.ok ? resultAC : resultAB;
      const winner = resultAB.ok ? b : c;
      expect(loser.ok).toBe(false);
      if (!loser.ok) expect(loser.superseded).toBe(true);
      const current = await resolveCurrentLocalizationGeometry({ projectId: PROJECT_ID, artifactRepository: repo });
      expect(current.geometryArtifactId).toBe(winner.artifact_id);
    }
  });
});
