/**
 * PRODUCT-LU-CESIUM-LOCALIZATION-DRAWING-01 — proof matrix for the new user-facing save/read
 * path (saveUserLocalizationGeometry / getCurrentLocalizationGeometryForProject).
 *
 * These functions are the ONLY server boundary that turns a browser click into a governed
 * LocalizationGeometryArtifact -- everything proven here is about that narrow, authority-bearing
 * contract, not about Cesium rendering (covered separately, out of unit-test scope).
 */
vi.mock('../../server/security/projectAccess', () => ({
  assertProjectAccess: vi.fn(async (user: { id: string }, projectId: string) => {
    if (!ALLOWED.has(`${user.id}:${projectId}`)) {
      throw new Error('REJECT_PROJECT_ACCESS: not a member');
    }
  }),
}));
const ALLOWED = new Set<string>();

// The geometry-supersession worker (executeGeometrySupersessionProvisioning) unconditionally
// calls MimersIntegration.create() itself -- unlike the service-layer functions under test, which
// always accept an explicit artifactRepository override. Redirect it to whatever InMemoryArtifactRepository
// the current test is using, via a shared mutable box the test sets before running the worker.
const mimersRepoBox: { repo: unknown } = { repo: null };
vi.mock('@miljobeslut/mps-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@miljobeslut/mps-runtime')>();
  return { ...actual, MimersIntegration: { create: async () => ({ artifactRepository: mimersRepoBox.repo, rebuildIndex: async () => ({ rebuilt: 0, skipped: 0 }) }) } };
});

// executeGeometrySupersessionProvisioning looks up the requester via a real prisma.user.findUnique
// call to re-verify organisation membership -- this test file's users are plain AuthUser objects,
// never real DB rows, so fake just enough of the client for that one lookup.
vi.mock('../../server/db/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where: { id } }: { where: { id: string } }) => ({
        id,
        organisationId: 'org-drawing-proof',
        bankidId: `bankid-${id}`,
        role: 'CONSULTANT',
        identityEnvironment: 'TEST',
      })),
    },
  },
}));

vi.mock('../../server/repositories/localizationGeometrySupersessionRepository', () => {
  type Row = { projectId: string; supersessionArtifactId: string; predecessorGeometryArtifactId: string; successorGeometryArtifactId: string; createdAt: Date };
  const rows: Row[] = [];
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

vi.mock('../../server/modules/localization/localizationGeometrySupersessionQueue', () => {
  type Status = 'PENDING' | 'LEASED' | 'COMPLETED' | 'FAILED' | 'SUPERSEDED';
  type Rec = {
    id: string; projectId: string; predecessorGeometryArtifactId: string; successorGeometryArtifactId: string;
    requestedByUserId: string; status: Status; supersessionArtifactId: string | null;
    failureCode: string | null; failureDetail: string | null; createdAt: Date; leasedAt: Date | null;
    leaseExpiresAt: Date | null; completedAt: Date | null; failedAt: Date | null;
  };
  const rows: Rec[] = [];
  let counter = 0;
  return {
    enqueueLocalizationGeometrySupersessionRequest: vi.fn(async (input: { projectId: string; predecessorGeometryArtifactId: string; successorGeometryArtifactId: string; requestedByUserId: string }) => {
      const rec: Rec = {
        id: `fake-supersession-req-${++counter}`, projectId: input.projectId,
        predecessorGeometryArtifactId: input.predecessorGeometryArtifactId, successorGeometryArtifactId: input.successorGeometryArtifactId,
        requestedByUserId: input.requestedByUserId, status: 'PENDING', supersessionArtifactId: null,
        failureCode: null, failureDetail: null, createdAt: new Date(Date.now() + rows.length),
        leasedAt: null, leaseExpiresAt: null, completedAt: null, failedAt: null,
      };
      rows.push(rec);
      return rec;
    }),
    ensureLocalizationGeometrySupersessionRequested: vi.fn(async (input: { projectId: string; predecessorGeometryArtifactId: string; successorGeometryArtifactId: string; requestedByUserId: string }) => {
      const existing = rows.find((r) => r.projectId === input.projectId && r.predecessorGeometryArtifactId === input.predecessorGeometryArtifactId && r.successorGeometryArtifactId === input.successorGeometryArtifactId);
      if (existing && existing.status !== 'FAILED') return existing;
      const rec: Rec = {
        id: `fake-supersession-req-${++counter}`, projectId: input.projectId,
        predecessorGeometryArtifactId: input.predecessorGeometryArtifactId, successorGeometryArtifactId: input.successorGeometryArtifactId,
        requestedByUserId: input.requestedByUserId, status: 'PENDING', supersessionArtifactId: null,
        failureCode: null, failureDetail: null, createdAt: new Date(Date.now() + rows.length),
        leasedAt: null, leaseExpiresAt: null, completedAt: null, failedAt: null,
      };
      rows.push(rec);
      return rec;
    }),
    leaseOnePendingLocalizationGeometrySupersessionRequest: vi.fn(async () => {
      const candidate = rows.find((r) => r.status === 'PENDING');
      if (!candidate) return null;
      candidate.status = 'LEASED';
      candidate.leasedAt = new Date();
      return candidate;
    }),
    markLocalizationGeometrySupersessionCompleted: vi.fn(async (id: string, supersessionArtifactId: string) => {
      const row = rows.find((r) => r.id === id);
      if (row) { row.status = 'COMPLETED'; row.supersessionArtifactId = supersessionArtifactId; row.completedAt = new Date(); }
    }),
    markLocalizationGeometrySupersessionFailed: vi.fn(async (id: string, failureCode: string, failureDetail: string) => {
      const row = rows.find((r) => r.id === id);
      if (row) { row.status = 'FAILED'; row.failureCode = failureCode; row.failureDetail = failureDetail; row.failedAt = new Date(); }
    }),
    markLocalizationGeometrySupersessionSuperseded: vi.fn(async (id: string, detail: string) => {
      const row = rows.find((r) => r.id === id);
      if (row) { row.status = 'SUPERSEDED'; row.failureCode = 'PREDECESSOR_NO_LONGER_CURRENT'; row.failureDetail = detail; row.failedAt = new Date(); }
    }),
    getSupersessionRequestStatusForSubject: vi.fn(async (projectId: string, predecessorGeometryArtifactId: string, successorGeometryArtifactId: string) =>
      rows.find((r) => r.projectId === projectId && r.predecessorGeometryArtifactId === predecessorGeometryArtifactId && r.successorGeometryArtifactId === successorGeometryArtifactId) ?? null,
    ),
    getLatestSupersessionRequestForProject: vi.fn(async (projectId: string) => [...rows].reverse().find((r) => r.projectId === projectId) ?? null),
  };
});

vi.mock('../../server/repositories/projectContextBindingRepository', () => {
  type BindingRow = { binding_artifact_id: string; project_context_artifact_id: string; project_context_artifact_type: string };
  const bindingsByProject = new Map<string, BindingRow[]>();

  class FakeProjectContextBindingIndex {
    async register(binding: { artifact_id: string; payload: { project_id: string; project_context_ref: { artifact_id: string; artifact_type: string } } }) {
      const rows = bindingsByProject.get(binding.payload.project_id) ?? [];
      if (!rows.some((r) => r.binding_artifact_id === binding.artifact_id)) {
        rows.push({
          binding_artifact_id: binding.artifact_id,
          project_context_artifact_id: binding.payload.project_context_ref.artifact_id,
          project_context_artifact_type: binding.payload.project_context_ref.artifact_type,
        });
        bindingsByProject.set(binding.payload.project_id, rows);
      }
    }
    async registerSupersession() {}
    async resolve(projectId: string, projectContextRef: { artifact_id: string; artifact_type: string }) {
      const rows = (bindingsByProject.get(projectId) ?? []).filter(
        (r) => r.project_context_artifact_id === projectContextRef.artifact_id && r.project_context_artifact_type === projectContextRef.artifact_type,
      );
      if (rows.length !== 1) throw new Error('REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE');
      return rows[0]!.binding_artifact_id;
    }
    async listBindingRefs(projectId: string) {
      return (bindingsByProject.get(projectId) ?? []).map((r) => ({ artifact_id: r.binding_artifact_id, artifact_type: 'project_context_binding' }));
    }
    async listSupersessionRefs() {
      return [];
    }
    async findProjectContextRef(projectId: string) {
      const rows = bindingsByProject.get(projectId) ?? [];
      if (rows.length !== 1) throw new Error('REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE');
      return { artifact_id: rows[0]!.project_context_artifact_id, artifact_type: rows[0]!.project_context_artifact_type };
    }
  }
  return { PrismaProjectContextBindingIndex: FakeProjectContextBindingIndex };
});

vi.mock('../../server/repositories/localizationGeometryProjectionRepository', () => {
  type Row = { projectId: string; geometryArtifactId: string; propertyContextRefId: string; propertyContextRefType: string; createdAt: Date };
  const rows: Row[] = [];
  class FakeLocalizationGeometryProjectionIndex {
    async register(row: { projectId: string; geometryArtifactId: string; propertyContextRef: { artifact_id: string; artifact_type: string } }) {
      if (rows.some((r) => r.projectId === row.projectId && r.geometryArtifactId === row.geometryArtifactId)) return;
      rows.push({
        projectId: row.projectId,
        geometryArtifactId: row.geometryArtifactId,
        propertyContextRefId: row.propertyContextRef.artifact_id,
        propertyContextRefType: row.propertyContextRef.artifact_type,
        createdAt: new Date(Date.now() + rows.length),
      });
    }
    async listForProject(projectId: string) {
      return rows.filter((r) => r.projectId === projectId).map((r) => ({ ...r }));
    }
  }
  return { PrismaLocalizationGeometryProjectionIndex: FakeLocalizationGeometryProjectionIndex };
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryArtifactRepository } from '@miljobeslut/mps-runtime';
import {
  createCanonicalPropertyGeometryArtifact,
  createPropertyLookupObservationArtifact,
  createProjectPropertyBindingArtifact,
  createProjectContextBindingArtifact,
  createProjectContextBindingIssuerArtifact,
  createProductLuPropertyContextArtifact,
  createProductLuProjectContextArtifact,
  quantizeToLocalizationGeometryGrid,
} from '@miljobeslut/mps-lu';
import { LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import {
  saveUserLocalizationGeometry,
  getCurrentLocalizationGeometryForProject,
} from '../../server/modules/localization/localizationGeometryService';
import { processGeometrySupersessionProvisioningRequestsOnce } from '../../server/services/luGeometrySupersessionProvisioningWorker';
import { PrismaProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';
import { installVerifiedProductLuContext, attestProjectContextBindingArtifact } from '../../server/modules/localization/projectContextBindingAuthority';
import type { LocalizationSpatialRuntime } from '../../server/modules/localization/createLocalizationSpatialRuntime';
import type { AuthUser } from '../../server/security/types';

const ISSUER_KEY_ID = 'ed25519:pcb-issuer-drawing-proofs';
const issuerKey = LocalPemSigningKeyProvider.generate(ISSUER_KEY_ID);
const geometrySupersessionIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:geometry-supersession-issuer-drawing-proofs');
process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_KEY_ID = geometrySupersessionIssuerKey.provider.keyId;
process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PRIVATE_KEY_PEM = geometrySupersessionIssuerKey.privateKey;
process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM = geometrySupersessionIssuerKey.publicKey;
const PROPERTY_CENTROID_SWEREF: readonly [number, number] = [6580000, 674000];

// Deterministic, trivially-invertible affine transform standing in for the real PostGIS
// ST_Transform round-trip -- proves "the server applies A transform, and applies it
// consistently", not the specific geodesy (that's proven live against real PostGIS separately).
function fakeWgs84ToSweref99(lat: number, lng: number): readonly [number, number] {
  return [Math.round((lat + 1000) * 100000), Math.round((lng + 1000) * 100000)];
}
function fakeSweref99ToWgs84(northing: number, easting: number): readonly [number, number] {
  return [northing / 100000 - 1000, easting / 100000 - 1000];
}

function makeSpatialRuntime(repo: InMemoryArtifactRepository): LocalizationSpatialRuntime {
  return {
    artifactRepository: repo,
    resolveSpatialProvider: () => ({ query: vi.fn().mockResolvedValue([]) }),
    wgs84ToSweref99: async (lat, lng) => fakeWgs84ToSweref99(lat, lng),
    sweref99ToWgs84: async (n, e) => fakeSweref99ToWgs84(n, e),
    close: async () => undefined,
  };
}

async function provisionRealProject(args: { repo: InMemoryArtifactRepository; issuer: ReturnType<typeof createProjectContextBindingIssuerArtifact>; projectId: string }) {
  const geometry = createCanonicalPropertyGeometryArtifact({ geometry: { type: 'Polygon', coordinates: [[[14, 61], [14.1, 61], [14, 61.1], [14, 61]]] } });
  const observation = createPropertyLookupObservationArtifact({
    property_identity: `property:test:${args.projectId}`,
    property_designation: 'DRAWING PROOF 1:1',
    source_key: args.projectId,
    source_dataset: 'test-source',
    source_updated_at: '2026-08-23T00:00:00.000Z',
    municipality: 'TESTKOMMUN',
    geometry_ref: { artifact_id: geometry.artifact_id, artifact_type: geometry.artifact_type },
  });
  const propertyBindingUnsigned = createProjectPropertyBindingArtifact({
    project_id: args.projectId,
    property_identity: observation.payload.property_identity,
    property_designation: 'DRAWING PROOF 1:1',
    geometry_ref: { artifact_id: geometry.artifact_id, artifact_type: geometry.artifact_type },
    source_refs: [{ artifact_id: observation.artifact_id, artifact_type: observation.artifact_type }],
    resolver_id: 'test-resolver',
    resolver_version: 'v1',
    contract_version: 'project-property-binding-v1',
  });
  const propertyBinding = { ...propertyBindingUnsigned, attestation: await attestProjectContextBindingArtifact({ artifact: propertyBindingUnsigned, issuer: args.issuer, signing: issuerKey.provider }) };
  const propertyBindingRef = { artifact_id: propertyBinding.artifact_id, artifact_type: propertyBinding.artifact_type };
  const propertyContext = createProductLuPropertyContextArtifact({
    property_identity: observation.payload.property_identity,
    property_ref: 'DRAWING PROOF 1:1',
    official_name: 'DRAWING PROOF 1:1',
    geometry_ref: { artifact_id: geometry.artifact_id, artifact_type: geometry.artifact_type },
    municipality: 'TESTKOMMUN',
    coordinates: PROPERTY_CENTROID_SWEREF,
    project_property_binding_ref: propertyBindingRef,
  });
  const projectContext = createProductLuProjectContextArtifact({
    project_id: args.projectId,
    project_name: 'DRAWING PROOF',
    description: 'PRODUCT-LU-CESIUM-LOCALIZATION-DRAWING-01 proof',
    created_by: 'test-owner',
    property_context_ref: { artifact_id: propertyContext.artifact_id, artifact_type: propertyContext.artifact_type },
    project_property_binding_ref: propertyBindingRef,
  });
  const contextBindingUnsigned = createProjectContextBindingArtifact({
    project_id: args.projectId,
    project_context_ref: { artifact_id: projectContext.artifact_id, artifact_type: projectContext.artifact_type },
    project_property_binding_ref: propertyBindingRef,
    binding_version: 'project-context-binding-v2',
    authority_ref: { artifact_id: args.issuer.artifact_id, artifact_type: args.issuer.artifact_type },
    created_at: '2026-08-23T00:00:00.000Z',
  });
  const contextBinding = { ...contextBindingUnsigned, attestation: await attestProjectContextBindingArtifact({ artifact: contextBindingUnsigned, issuer: args.issuer, signing: issuerKey.provider }) };
  const verification = new (await import('@miljobeslut/mimers-brunn-core')).LocalPemVerificationKeyProvider(args.issuer.payload.issuer_key_id, issuerKey.publicKey);
  await installVerifiedProductLuContext({
    artifactRepository: args.repo,
    index: new PrismaProjectContextBindingIndex(),
    issuer: args.issuer,
    verification,
    geometryArtifact: geometry,
    propertyObservation: observation,
    propertyBinding,
    propertyContext,
    projectContext,
    contextBinding,
  });
  return { propertyContextRef: { artifact_id: propertyContext.artifact_id, artifact_type: propertyContext.artifact_type } };
}

function makeUser(id: string): AuthUser {
  return { id, organisationId: 'org-drawing-proof', bankidId: `bankid-${id}`, role: 'CONSULTANT' };
}

describe('PRODUCT-LU-CESIUM-LOCALIZATION-DRAWING-01 — save/read proof matrix', () => {
  beforeEach(() => {
    process.env.PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID = issuerKey.provider.keyId;
    process.env.PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM = issuerKey.publicKey;
  });
  afterEach(() => {
    delete process.env.PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID;
    delete process.env.PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM;
  });

  it('proof: unauthorized user -> DENY', async () => {
    const repo = new InMemoryArtifactRepository();
    const issuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: issuerKey.provider.keyId, issuer_version: 'project-context-binding-issuer-v2' });
    const projectId = 'project-drawing-deny';
    await provisionRealProject({ repo, issuer, projectId });
    ALLOWED.clear(); // nobody is a member

    const owner = makeUser('owner-1');
    const result = await saveUserLocalizationGeometry({
      authUser: owner,
      projectId,
      input: { geometry_type: 'POINT', coordinates: [18.07, 59.33], srid: 4326 },
      artifactRepository: repo,
      spatialRuntime: makeSpatialRuntime(repo),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it('proof: unsupported geometry type -> DENY for V1', async () => {
    const repo = new InMemoryArtifactRepository();
    const issuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: issuerKey.provider.keyId, issuer_version: 'project-context-binding-issuer-v2' });
    const projectId = 'project-drawing-unsupported-type';
    await provisionRealProject({ repo, issuer, projectId });
    const owner = makeUser('owner-2');
    ALLOWED.add(`${owner.id}:${projectId}`);

    const result = await saveUserLocalizationGeometry({
      authUser: owner,
      projectId,
      input: { geometry_type: 'POLYGON', coordinates: [18.07, 59.33], srid: 4326 },
      artifactRepository: repo,
      spatialRuntime: makeSpatialRuntime(repo),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/REJECT_LOCALIZATION_GEOMETRY_UNSUPPORTED_TYPE/);
    }
  });

  it('proof: invalid SRID -> DENY', async () => {
    const repo = new InMemoryArtifactRepository();
    const issuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: issuerKey.provider.keyId, issuer_version: 'project-context-binding-issuer-v2' });
    const projectId = 'project-drawing-bad-srid';
    await provisionRealProject({ repo, issuer, projectId });
    const owner = makeUser('owner-3');
    ALLOWED.add(`${owner.id}:${projectId}`);

    const result = await saveUserLocalizationGeometry({
      authUser: owner,
      projectId,
      input: { geometry_type: 'POINT', coordinates: [18.07, 59.33], srid: 3006 },
      artifactRepository: repo,
      spatialRuntime: makeSpatialRuntime(repo),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/REJECT_LOCALIZATION_GEOMETRY_UNSUPPORTED_SRID/);
    }
  });

  it('proof: invalid coordinate -> DENY', async () => {
    const repo = new InMemoryArtifactRepository();
    const issuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: issuerKey.provider.keyId, issuer_version: 'project-context-binding-issuer-v2' });
    const projectId = 'project-drawing-bad-coords';
    await provisionRealProject({ repo, issuer, projectId });
    const owner = makeUser('owner-4');
    ALLOWED.add(`${owner.id}:${projectId}`);

    const result = await saveUserLocalizationGeometry({
      authUser: owner,
      projectId,
      input: { geometry_type: 'POINT', coordinates: [999, 59.33], srid: 4326 },
      artifactRepository: repo,
      spatialRuntime: makeSpatialRuntime(repo),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('proof: GET before any save -> transitional derived_from_property_boundary state', async () => {
    const repo = new InMemoryArtifactRepository();
    const issuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: issuerKey.provider.keyId, issuer_version: 'project-context-binding-issuer-v2' });
    const projectId = 'project-drawing-transitional';
    await provisionRealProject({ repo, issuer, projectId });
    const owner = makeUser('owner-5');
    ALLOWED.add(`${owner.id}:${projectId}`);

    const result = await getCurrentLocalizationGeometryForProject({
      authUser: owner,
      projectId,
      artifactRepository: repo,
      spatialRuntime: makeSpatialRuntime(repo),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.provenance).toBe('derived_from_property_boundary');
  });

  it('proof: coordinate contract -- WGS84 input -> deterministic transform -> persisted SWEREF -> read-back same location', async () => {
    const repo = new InMemoryArtifactRepository();
    const issuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: issuerKey.provider.keyId, issuer_version: 'project-context-binding-issuer-v2' });
    const projectId = 'project-drawing-coord-contract';
    await provisionRealProject({ repo, issuer, projectId });
    const owner = makeUser('owner-6');
    ALLOWED.add(`${owner.id}:${projectId}`);

    const clickLng = 18.0735;
    const clickLat = 59.3251;
    const saveResult = await saveUserLocalizationGeometry({
      authUser: owner,
      projectId,
      input: { geometry_type: 'POINT', coordinates: [clickLng, clickLat], srid: 4326 },
      artifactRepository: repo,
      spatialRuntime: makeSpatialRuntime(repo),
    });
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) return;

    const stored = await repo.resolve<{ payload: { coordinates: readonly [number, number]; srid: number } }>({
      artifact_id: saveResult.data.artifact_id,
      artifact_type: 'localization_geometry',
    });
    // LOCALIZATION-GEOMETRY-CANONICALIZATION-V2: the raw transform is quantized to the canonical
    // 0.1m grid before persistence -- the stored SWEREF pair is the CANONICAL point, not the raw
    // (floating-point-noisy) transform output.
    const rawSweref = fakeWgs84ToSweref99(clickLat, clickLng);
    const expectedCanonicalSweref = [
      quantizeToLocalizationGeometryGrid(rawSweref[0]),
      quantizeToLocalizationGeometryGrid(rawSweref[1]),
    ];
    expect(stored.payload.coordinates).toEqual(expectedCanonicalSweref);
    expect(stored.payload.srid).toBe(3006);

    // Read-back: the same real-world location, round-tripped from the canonical (quantized) point.
    const [readLat, readLng] = fakeSweref99ToWgs84(stored.payload.coordinates[0], stored.payload.coordinates[1]);
    expect(readLat).toBeCloseTo(clickLat, 6);
    expect(readLng).toBeCloseTo(clickLng, 6);

    // And the GET response gives back the WGS84 representation DERIVED from the canonical SWEREF
    // point -- close to the original click (well within the 0.1m grid), but not necessarily
    // byte-identical, since it is now a derived canonical value rather than an echo of raw input.
    expect(saveResult.data.wgs84LngLat[0]).toBeCloseTo(clickLng, 6);
    expect(saveResult.data.wgs84LngLat[1]).toBeCloseTo(clickLat, 6);
  });

  it('proof: same exact point saved again -> idempotent identity, no divergent state', async () => {
    const repo = new InMemoryArtifactRepository();
    const issuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: issuerKey.provider.keyId, issuer_version: 'project-context-binding-issuer-v2' });
    const projectId = 'project-drawing-idempotent';
    await provisionRealProject({ repo, issuer, projectId });
    const owner = makeUser('owner-7');
    ALLOWED.add(`${owner.id}:${projectId}`);
    const spatialRuntime = makeSpatialRuntime(repo);

    const first = await saveUserLocalizationGeometry({
      authUser: owner,
      projectId,
      input: { geometry_type: 'POINT', coordinates: [18.07, 59.33], srid: 4326 },
      artifactRepository: repo,
      spatialRuntime,
    });
    const second = await saveUserLocalizationGeometry({
      authUser: owner,
      projectId,
      input: { geometry_type: 'POINT', coordinates: [18.07, 59.33], srid: 4326 },
      artifactRepository: repo,
      spatialRuntime,
    });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.data.artifact_id).toBe(first.data.artifact_id);
    }

    const current = await getCurrentLocalizationGeometryForProject({ authUser: owner, projectId, artifactRepository: repo, spatialRuntime });
    expect(current.ok).toBe(true);
    if (current.ok && first.ok) expect(current.data.artifact_id).toBe(first.data.artifact_id);
  });

  it('proof: move point A -> B -- new artifact, B current, A historical, refresh reloads B', async () => {
    const repo = new InMemoryArtifactRepository();
    const issuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: issuerKey.provider.keyId, issuer_version: 'project-context-binding-issuer-v2' });
    const projectId = 'project-drawing-move';
    await provisionRealProject({ repo, issuer, projectId });
    const owner = makeUser('owner-8');
    ALLOWED.add(`${owner.id}:${projectId}`);
    const spatialRuntime = makeSpatialRuntime(repo);

    const a = await saveUserLocalizationGeometry({
      authUser: owner,
      projectId,
      input: { geometry_type: 'POINT', coordinates: [18.07, 59.33], srid: 4326 },
      artifactRepository: repo,
      spatialRuntime,
    });
    expect(a.ok).toBe(true);

    const b = await saveUserLocalizationGeometry({
      authUser: owner,
      projectId,
      input: { geometry_type: 'POINT', coordinates: [18.20, 59.40], srid: 4326 },
      artifactRepository: repo,
      spatialRuntime,
    });
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.data.artifact_id).not.toBe(a.data.artifact_id);
    // LU-PROJECTION-RECONCILIATION-AND-TOTAL-ORDER-V1: saving B enqueues the transition but does
    // NOT itself make B current -- that requires the worker to verify A is still the actual
    // current head and sign the A->B edge. Web-only save is not the currentness authority.
    expect(b.data.supersessionStatus).toBe('PENDING');
    const stillA = await getCurrentLocalizationGeometryForProject({ authUser: owner, projectId, artifactRepository: repo, spatialRuntime });
    expect(stillA.ok).toBe(true);
    if (stillA.ok) expect(stillA.data.artifact_id).toBe(a.data.artifact_id);

    // Run the standalone worker (never the web process) to actually verify+sign the transition.
    mimersRepoBox.repo = repo;
    const processed = await processGeometrySupersessionProvisioningRequestsOnce();
    expect(processed).toBe(1);

    // "Refresh": a completely fresh GET call, simulating reload/re-login, must resolve to B.
    const reloaded = await getCurrentLocalizationGeometryForProject({ authUser: owner, projectId, artifactRepository: repo, spatialRuntime });
    expect(reloaded.ok).toBe(true);
    if (reloaded.ok) {
      expect(reloaded.data.artifact_id).toBe(b.data.artifact_id);
      expect(reloaded.data.artifact_id).not.toBe(a.data.artifact_id);
      expect(reloaded.data.provenance).toBe('user_defined');
    }

    // A remains readable by exact ref (historical, immutable) even though it is no longer current.
    const historicalA = await repo.resolve<{ artifact_id: string }>({ artifact_id: a.data.artifact_id, artifact_type: 'localization_geometry' });
    expect(historicalA.artifact_id).toBe(a.data.artifact_id);
  });
});
