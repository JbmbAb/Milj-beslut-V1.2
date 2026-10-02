/**
 * DEMO M1a -- owner decision D9(a) (2026-10-02): the localization geometry centroid may be DERIVED
 * ONLY when currentness resolution reports NOT_FOUND (no geometry yet). Every other currentness
 * error class fails closed: no derived geometry, no CAS write, no projection registration, no
 * provisioning request, a Swedish reason, and the error class kept as structured data.
 *
 * Real LocalizationGeometryCurrentProvider + real graph reduction wherever the class can be produced
 * for real (NOT_FOUND, CURRENT, AMBIGUOUS, NO_VERIFIED_GEOMETRY_CANDIDATE, VERIFIER_CONFIGURATION,
 * CURRENTNESS_RESOLUTION_ERROR, DERIVED_GEOMETRY_PERSISTENCE_FAILED). INVALID_SUPERSESSION_GRAPH and
 * INVALID_GEOMETRY_HEAD need signed cyclic/invalid supersession edges; they are produced here by an
 * INJECTED error carrying the provider's real message prefix (labelled as such in the test names).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  geometryRows: [] as Array<{ projectId: string; geometryArtifactId: string; propertyContextRefId: string; propertyContextRefType: string; createdAt: Date }>,
  supersessionRows: [] as Array<{ projectId: string; supersessionArtifactId: string; predecessorGeometryArtifactId: string; successorGeometryArtifactId: string; createdAt: Date }>,
  geometryListError: null as Error | null,
  registerError: null as Error | null,
  registerCalls: 0,
  provisioningCalls: 0,
  supersessionRequestCalls: 0,
}));

vi.mock('../../server/repositories/localizationGeometryProjectionRepository', () => ({
  PrismaLocalizationGeometryProjectionIndex: class {
    async register(row: { projectId: string; geometryArtifactId: string; propertyContextRef: { artifact_id: string; artifact_type: string } }) {
      state.registerCalls += 1;
      if (state.registerError) throw state.registerError;
      state.geometryRows.push({
        projectId: row.projectId, geometryArtifactId: row.geometryArtifactId,
        propertyContextRefId: row.propertyContextRef.artifact_id, propertyContextRefType: row.propertyContextRef.artifact_type,
        createdAt: new Date(),
      });
    }
    async listForProject(projectId: string) {
      if (state.geometryListError) throw state.geometryListError;
      return state.geometryRows.filter((r) => r.projectId === projectId);
    }
  },
}));
vi.mock('../../server/repositories/localizationGeometrySupersessionRepository', () => ({
  PrismaLocalizationGeometrySupersessionIndex: class {
    async register() {}
    async listForProject(projectId: string) {
      return state.supersessionRows.filter((r) => r.projectId === projectId);
    }
  },
}));
vi.mock('../../server/security/projectAccess', () => ({ assertProjectAccess: vi.fn(async () => undefined) }));
vi.mock('../../src/application/resolveCanonicalProjectContext', () => ({
  resolveCanonicalProjectContext: vi.fn(async () => ({
    propertyContextRef: { artifact_id: 'property-ctx-m1a', artifact_type: 'LU_PROPERTY_CONTEXT' },
    coordinates: [6580743.04, 674571.86],
  })),
}));
vi.mock('../../server/modules/localization/localizationIdentityProvisioningQueue', () => ({
  ensureLocalizationIdentityProvisioningRequested: vi.fn(async () => {
    state.provisioningCalls += 1;
    return { status: 'PENDING', failureDetail: null };
  }),
  enqueueLocalizationIdentityProvisioningRequest: vi.fn(async () => ({ status: 'PENDING', failureDetail: null })),
}));
vi.mock('../../server/modules/localization/localizationGeometrySupersessionQueue', () => ({
  ensureLocalizationGeometrySupersessionRequested: vi.fn(async () => {
    state.supersessionRequestCalls += 1;
    return { status: 'PENDING', failureDetail: null };
  }),
}));

import { createLocalizationGeometryArtifactV2 } from '@miljobeslut/mps-lu';
import {
  LOCALIZATION_GEOMETRY_NOT_FOUND_NO_PROJECTION_MESSAGE,
  LocalizationGeometryCurrentnessError,
  classifyLocalizationGeometryCurrentnessError,
} from '../../server/modules/localization/localizationGeometryCurrentness';
import {
  getCurrentLocalizationGeometryForProject,
  resolveOrDeriveCurrentLocalizationGeometry,
  saveUserLocalizationGeometry,
} from '../../server/modules/localization/localizationGeometryService';
import { __resetLocalizationGeometrySupersessionVerifierForTests } from '../../server/security/localizationGeometrySupersessionVerifier';
import type { AuthUser } from '../../server/security/types';

const PROJECT_ID = 'project-m1a-d9a';
const PROPERTY_REF = { artifact_id: 'property-ctx-m1a', artifact_type: 'LU_PROPERTY_CONTEXT' } as const;
const USER: AuthUser = { id: 'user-m1a', organisationId: 'org-m1a', bankidId: 'bankid:m1a', role: 'CONSULTANT' };

class MemoryRepository {
  readonly values = new Map<string, unknown>();
  putCalls = 0;
  async put(artifact: { artifact_id: string; body: unknown }): Promise<void> {
    this.putCalls += 1;
    this.values.set(artifact.artifact_id, artifact.body);
  }
  async resolve<T>(reference: { artifact_id: string }): Promise<T> {
    const value = this.values.get(reference.artifact_id);
    // The real repository contract for an absent object (CasArtifactResolver and
    // InMemoryArtifactRepository). Since M1a-repair (F1) the provider excludes a candidate only on
    // this exact verdict; any other read error is a technical failure and fails closed with 503.
    if (!value) throw new Error(`Artifact not found: ${reference.artifact_id}`);
    return value as T;
  }
}

function userGeometry(northing: number) {
  return createLocalizationGeometryArtifactV2({
    project_id: PROJECT_ID, property_context_ref: PROPERTY_REF,
    wgs84LngLat: [18.07, 59.33], sweref99NorthingEasting: [674571.9, northing],
    provenance: 'user_defined', label: `user point ${northing}`, created_by: USER.id,
  });
}

async function storeAndRegister(repo: MemoryRepository, geometry: ReturnType<typeof userGeometry>, opts: { inCas?: boolean } = {}) {
  if (opts.inCas !== false) await repo.put({ artifact_id: geometry.artifact_id, body: geometry });
  state.geometryRows.push({
    projectId: PROJECT_ID, geometryArtifactId: geometry.artifact_id,
    propertyContextRefId: PROPERTY_REF.artifact_id, propertyContextRefType: PROPERTY_REF.artifact_type, createdAt: new Date(),
  });
}

function derive(repo: MemoryRepository) {
  return resolveOrDeriveCurrentLocalizationGeometry({
    projectId: PROJECT_ID,
    artifactRepository: repo as never,
    propertyContextRef: PROPERTY_REF,
    propertyCentroidSweref: [6580743.04, 674571.86],
    sweref99ToWgs84: vi.fn(async () => [59.33, 18.07] as const),
    createdBy: USER.id,
  });
}

const spatialRuntime = {
  sweref99ToWgs84: vi.fn(async () => [59.33, 18.07] as const),
  wgs84ToSweref99: vi.fn(async () => [6580943.04, 674571.86] as const),
  close: vi.fn(async () => undefined),
} as never;

beforeEach(() => {
  state.geometryRows.length = 0;
  state.supersessionRows.length = 0;
  state.geometryListError = null;
  state.registerError = null;
  state.registerCalls = 0;
  state.provisioningCalls = 0;
  state.supersessionRequestCalls = 0;
  delete process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_KEY_ID;
  delete process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM;
  __resetLocalizationGeometrySupersessionVerifierForTests(null);
});

describe('D9(a) classifier: only the exact "no projection" NOT_FOUND permits derivation', () => {
  it.each([
    [LOCALIZATION_GEOMETRY_NOT_FOUND_NO_PROJECTION_MESSAGE, 'NOT_FOUND'],
    ['REJECT_LOCALIZATION_GEOMETRY_PROJECTION_NOT_FOUND: no candidate survived CAS re-verification', 'NO_VERIFIED_GEOMETRY_CANDIDATE'],
    ['AMBIGUOUS_CURRENT_GEOMETRY: multiple localization geometry heads', 'AMBIGUOUS_CURRENT_GEOMETRY'],
    ['AMBIGUOUS_CURRENT_GEOMETRY: fork in localization geometry supersession graph', 'AMBIGUOUS_CURRENT_GEOMETRY'],
    ['INVALID_SUPERSESSION_GRAPH: cycle in localization geometry supersession graph', 'INVALID_SUPERSESSION_GRAPH'],
    ['REJECT_LOCALIZATION_GEOMETRY_HEAD: missing relation geometry', 'INVALID_GEOMETRY_HEAD'],
    ['REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_CONFIGURATION: missing X', 'VERIFIER_CONFIGURATION'],
    ['connect ECONNREFUSED 127.0.0.1:5432', 'CURRENTNESS_RESOLUTION_ERROR'],
    ['LOCALIZATION_GEOMETRY_CANDIDATE_UNRESOLVABLE: geometry g-1 could not be read or verified: EIO', 'CURRENTNESS_RESOLUTION_ERROR'],
    [`${LOCALIZATION_GEOMETRY_NOT_FOUND_NO_PROJECTION_MESSAGE} (reworded)`, 'NO_VERIFIED_GEOMETRY_CANDIDATE'],
  ])('%s -> %s', (message, expected) => {
    expect(classifyLocalizationGeometryCurrentnessError(new Error(message))).toBe(expected);
  });

  it('a non-Error throw is a fail-closed resolution error, never NOT_FOUND', () => {
    expect(classifyLocalizationGeometryCurrentnessError('boom')).toBe('CURRENTNESS_RESOLUTION_ERROR');
    expect(classifyLocalizationGeometryCurrentnessError(undefined)).toBe('CURRENTNESS_RESOLUTION_ERROR');
  });
});

describe('D9(a) resolveOrDeriveCurrentLocalizationGeometry', () => {
  it('NOT_FOUND (no geometry yet) -> derives the centroid, persists + registers it, provenance DERIVED (derived_in_this_request)', async () => {
    const repo = new MemoryRepository();
    const result = await derive(repo);
    expect(result.wasDerived).toBe(true);
    expect(result.geometry.payload.provenance).toBe('derived_from_property_boundary');
    expect(result.provenanceRecord).toMatchObject({
      status: 'RESOLVED', artifact_id: result.geometry.artifact_id, provenance: 'derived_from_property_boundary',
      derived_in_this_request: true, failure_class: null,
    });
    expect(repo.putCalls).toBe(1);
    expect(state.registerCalls).toBe(1);
    // second call: the derived point is now current -> resolved, not derived again
    const again = await derive(repo);
    expect(again.wasDerived).toBe(false);
    expect(again.geometry.artifact_id).toBe(result.geometry.artifact_id);
    expect(again.provenanceRecord).toMatchObject({ provenance: 'derived_from_property_boundary', derived_in_this_request: false });
  });

  it('CURRENT user_defined geometry -> returned as-is with provenance user_defined, nothing derived or written', async () => {
    const repo = new MemoryRepository();
    const point = userGeometry(6580743.0);
    await storeAndRegister(repo, point);
    const putsBefore = repo.putCalls;
    const result = await derive(repo);
    expect(result.geometry.artifact_id).toBe(point.artifact_id);
    expect(result.provenanceRecord).toMatchObject({ provenance: 'user_defined', derived_in_this_request: false });
    expect(repo.putCalls).toBe(putsBefore);
    expect(state.registerCalls).toBe(0);
  });

  async function expectFailClosed(repo: MemoryRepository, failureClass: string) {
    const putsBefore = repo.putCalls;
    const error = await derive(repo).then(
      () => { throw new Error('expected fail closed'); },
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(LocalizationGeometryCurrentnessError);
    const typed = error as LocalizationGeometryCurrentnessError;
    expect(typed.failureClass).toBe(failureClass);
    expect(typed.reasonCode).toBe(`LOCALIZATION_GEOMETRY_${failureClass}`);
    expect(typed.code).toBe('LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED');
    expect(typed.userMessage).toMatch(/ingen bedömning görs/i);
    expect(repo.putCalls).toBe(putsBefore); // no derived geometry written to CAS
    expect(state.registerCalls).toBe(0); // and nothing registered as current
    return typed;
  }

  it('AMBIGUOUS_CURRENT_GEOMETRY (two real heads, no edge) -> fails closed, no derivation', async () => {
    const repo = new MemoryRepository();
    await storeAndRegister(repo, userGeometry(6580743.0));
    await storeAndRegister(repo, userGeometry(6580843.0));
    const e = await expectFailClosed(repo, 'AMBIGUOUS_CURRENT_GEOMETRY');
    expect(e.httpStatus).toBe(409);
    expect(e.kind).toBe('REFUSED');
  });

  it('NO_VERIFIED_GEOMETRY_CANDIDATE (projection row exists, CAS object missing) -> fails closed, no derivation', async () => {
    const repo = new MemoryRepository();
    await storeAndRegister(repo, userGeometry(6580743.0), { inCas: false });
    await expectFailClosed(repo, 'NO_VERIFIED_GEOMETRY_CANDIDATE');
  });

  it('VERIFIER_CONFIGURATION (supersession edge present, verifier key not configured) -> fails closed', async () => {
    const repo = new MemoryRepository();
    const a = userGeometry(6580743.0);
    const b = userGeometry(6580843.0);
    await storeAndRegister(repo, a);
    await storeAndRegister(repo, b);
    state.supersessionRows.push({
      projectId: PROJECT_ID, supersessionArtifactId: 'supersession-m1a',
      predecessorGeometryArtifactId: a.artifact_id, successorGeometryArtifactId: b.artifact_id, createdAt: new Date(),
    });
    const e = await expectFailClosed(repo, 'VERIFIER_CONFIGURATION');
    expect(e.kind).toBe('ERROR');
  });

  it('CURRENTNESS_RESOLUTION_ERROR (projection/DB error) -> fails closed, no derivation', async () => {
    const repo = new MemoryRepository();
    state.geometryListError = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    const e = await expectFailClosed(repo, 'CURRENTNESS_RESOLUTION_ERROR');
    expect(e.httpStatus).toBe(503);
  });

  it('INVALID_SUPERSESSION_GRAPH (injected provider error with the real message prefix) -> fails closed', async () => {
    const repo = new MemoryRepository();
    state.geometryListError = new Error('INVALID_SUPERSESSION_GRAPH: cycle in localization geometry supersession graph');
    await expectFailClosed(repo, 'INVALID_SUPERSESSION_GRAPH');
  });

  it('INVALID_GEOMETRY_HEAD (injected provider error with the real message prefix) -> fails closed', async () => {
    const repo = new MemoryRepository();
    state.geometryListError = new Error('REJECT_LOCALIZATION_GEOMETRY_HEAD: missing relation geometry');
    await expectFailClosed(repo, 'INVALID_GEOMETRY_HEAD');
  });

  it('NOT_FOUND but registration of the derived point fails -> DERIVED_GEOMETRY_PERSISTENCE_FAILED (no longer swallowed)', async () => {
    const repo = new MemoryRepository();
    state.registerError = new Error('projection write failed');
    const error = await derive(repo).then(
      () => { throw new Error('expected fail closed'); },
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(LocalizationGeometryCurrentnessError);
    expect((error as LocalizationGeometryCurrentnessError).failureClass).toBe('DERIVED_GEOMETRY_PERSISTENCE_FAILED');
    expect(state.geometryRows).toHaveLength(0);
  });
});

describe('D9(a) GET /geometry and POST /geometry service paths', () => {
  it('GET with no geometry yet -> transitional derived point (provenance derived_from_property_boundary) + provisioning requested', async () => {
    const repo = new MemoryRepository();
    const result = await getCurrentLocalizationGeometryForProject({ authUser: USER, projectId: PROJECT_ID, artifactRepository: repo as never, spatialRuntime });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.provenance).toBe('derived_from_property_boundary');
    expect(state.provisioningCalls).toBe(1);
  });

  it('GET with ambiguous current geometry -> 409 with class + Swedish reason; no derived point, no provisioning request', async () => {
    const repo = new MemoryRepository();
    await storeAndRegister(repo, userGeometry(6580743.0));
    await storeAndRegister(repo, userGeometry(6580843.0));
    const putsBefore = repo.putCalls;
    const result = await getCurrentLocalizationGeometryForProject({ authUser: USER, projectId: PROJECT_ID, artifactRepository: repo as never, spatialRuntime });
    expect(result).toMatchObject({
      ok: false, status: 409, code: 'LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED',
      failureClass: 'AMBIGUOUS_CURRENT_GEOMETRY', reasonCode: 'LOCALIZATION_GEOMETRY_AMBIGUOUS_CURRENT_GEOMETRY',
    });
    expect((result as { error: string }).error).toMatch(/flera möjliga aktuella lokaliseringspunkter/);
    expect(repo.putCalls).toBe(putsBefore);
    expect(state.registerCalls).toBe(0);
    expect(state.provisioningCalls).toBe(0);
  });

  it('POST save while current geometry is ambiguous -> 409 with class; NOT registered as a new root, no supersession/provisioning request', async () => {
    const repo = new MemoryRepository();
    await storeAndRegister(repo, userGeometry(6580743.0));
    await storeAndRegister(repo, userGeometry(6580843.0));
    const result = await saveUserLocalizationGeometry({
      authUser: USER, projectId: PROJECT_ID,
      input: { geometry_type: 'POINT', coordinates: [18.08, 59.34], srid: 4326 },
      artifactRepository: repo as never, spatialRuntime,
    });
    expect(result).toMatchObject({ ok: false, status: 409, failureClass: 'AMBIGUOUS_CURRENT_GEOMETRY' });
    expect(state.registerCalls).toBe(0);
    expect(state.geometryRows).toHaveLength(2);
    expect(state.supersessionRequestCalls).toBe(0);
    expect(state.provisioningCalls).toBe(0);
  });

  it('POST save on a project with no geometry yet (NOT_FOUND) -> registered directly as the root, as before', async () => {
    const repo = new MemoryRepository();
    const result = await saveUserLocalizationGeometry({
      authUser: USER, projectId: PROJECT_ID,
      input: { geometry_type: 'POINT', coordinates: [18.08, 59.34], srid: 4326 },
      artifactRepository: repo as never, spatialRuntime,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.provenance).toBe('user_defined');
    expect(state.registerCalls).toBe(1);
    expect(state.supersessionRequestCalls).toBe(0);
  });
});
