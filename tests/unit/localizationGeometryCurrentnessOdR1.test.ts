/**
 * OD-R1 (owner decision, 2026-10-02: YES, forward-only, D9(a)): a corrupt, tampered, missing or
 * otherwise inconsistent CURRENT localization geometry fails closed. An older point never becomes
 * current just because the newer one cannot be verified.
 *
 * Before this unit, LocalizationGeometryCurrentProvider excluded a candidate whose state was
 * determined bad (missing from CAS, CASIntegrityError, a REJECT_* verdict, another project, another
 * property context) AND every supersession edge that referenced it -- so when that candidate was the
 * head B of a verified A -> B edge, the superseded A became the only head and resolved CURRENT. The
 * frozen "exclude a determined-bad candidate" rule now only applies to a candidate that a VERIFIED
 * edge proves superseded (it can never be current). A candidate that may be the current point (no
 * verified outgoing edge) and cannot be verified fails the whole resolution closed:
 * CURRENT_GEOMETRY_UNVERIFIED (409, REFUSED), no derived centroid, no stale point, and the read-back
 * never consults the assessment index (so an old point-A assessment is never presented as current).
 *
 * Hermetic: both projection repositories and server/db/prisma are mocked (the prisma guard throws
 * and records on any access); CAS is an in-memory repository with the real "Artifact not found"
 * contract. Real: provider, graph reduction, geometry validation, supersession signing and
 * verification, the D9(a) classifier, the geometry service and the read-back orchestrator.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  geometryRows: [] as Array<{ projectId: string; geometryArtifactId: string; propertyContextRefId: string; propertyContextRefType: string; createdAt: Date }>,
  supersessionRows: [] as Array<{ projectId: string; supersessionArtifactId: string; predecessorGeometryArtifactId: string; successorGeometryArtifactId: string; createdAt: Date }>,
  registerCalls: 0,
}));

vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());
vi.mock('../../server/repositories/localizationGeometryProjectionRepository', () => ({
  PrismaLocalizationGeometryProjectionIndex: class {
    async register() {
      state.registerCalls += 1;
    }
    async listForProject(projectId: string) {
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
vi.mock('../../server/modules/localization/createLocalizationSpatialRuntime', () => ({
  createLocalizationSpatialRuntime: vi.fn(async () => {
    throw new Error('no spatial runtime in this file');
  }),
}));
vi.mock('../../server/modules/localization/localizationIdentityProvisioningQueue', () => ({
  ensureLocalizationIdentityProvisioningRequested: vi.fn(async () => {
    throw new Error('provisioning must not be requested when currentness fails closed');
  }),
  enqueueLocalizationIdentityProvisioningRequest: vi.fn(async () => {
    throw new Error('provisioning must not be requested when currentness fails closed');
  }),
}));
vi.mock('../../server/modules/localization/localizationGeometrySupersessionQueue', () => ({
  ensureLocalizationGeometrySupersessionRequested: vi.fn(async () => {
    throw new Error('no supersession request in this file');
  }),
}));
vi.mock('../../server/services/pdfExportService', () => ({
  buildJsonPdfBuffer: vi.fn(async () => {
    throw new Error('the PDF must not be rendered when currentness fails closed');
  }),
}));

import { CASIntegrityError, LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import {
  LOCALIZATION_GEOMETRY_SUPERSESSION_VERSION,
  createLocalizationGeometryArtifactV2,
  createLocalizationGeometrySupersessionArtifact,
  createLocalizationGeometrySupersessionIssuerArtifact,
  type LocalizationGeometryArtifact,
} from '@miljobeslut/mps-lu';
import { hermeticPrismaTouches } from '../helpers/hermeticPrismaGuard';
import {
  attestLocalizationGeometrySupersessionArtifact,
  attestLocalizationGeometrySupersessionIssuerArtifact,
} from '../../server/modules/localization/localizationGeometrySupersessionAuthority';
import { LocalizationGeometryCurrentnessError } from '../../server/modules/localization/localizationGeometryCurrentness';
import { resolveOrDeriveCurrentLocalizationGeometry } from '../../server/modules/localization/localizationGeometryService';
import {
  exportCurrentLuAssessmentPdf,
  resolveCurrentLuAssessmentSummary,
  verifyCurrentLuAssessment,
} from '../../server/modules/localization/localizationOrchestrator';
import { __resetLocalizationGeometrySupersessionVerifierForTests } from '../../server/security/localizationGeometrySupersessionVerifier';
import type { AuthUser } from '../../server/security/types';

const PROJECT_ID = 'project-od-r1';
const PROPERTY_REF = { artifact_id: 'property-ctx-od-r1', artifact_type: 'LU_PROPERTY_CONTEXT' } as const;
const OTHER_PROPERTY_REF = { artifact_id: 'property-ctx-od-r1-other', artifact_type: 'LU_PROPERTY_CONTEXT' } as const;
const USER: AuthUser = { id: 'user-od-r1', organisationId: 'org-od-r1', bankidId: 'bankid:od-r1', role: 'ADMIN' };
const supersessionKey = LocalPemSigningKeyProvider.generate('ed25519:geometry-supersession-issuer-od-r1');

/** In-memory CAS with the real "Artifact not found: <id>" contract plus per-id fault injection. */
class CasRepository {
  readonly values = new Map<string, unknown>();
  readonly faults = new Map<string, unknown>();
  putCalls = 0;
  async put(artifact: { artifact_id: string; body: unknown }): Promise<void> {
    this.putCalls += 1;
    this.values.set(artifact.artifact_id, artifact.body);
  }
  async resolve<T>(reference: { artifact_id: string }): Promise<T> {
    if (this.faults.has(reference.artifact_id)) throw this.faults.get(reference.artifact_id);
    if (!this.values.has(reference.artifact_id)) throw new Error(`Artifact not found: ${reference.artifact_id}`);
    return this.values.get(reference.artifact_id) as T;
  }
}

function userGeometry(northing: number, overrides: { projectId?: string } = {}): LocalizationGeometryArtifact {
  return createLocalizationGeometryArtifactV2({
    project_id: overrides.projectId ?? PROJECT_ID, property_context_ref: PROPERTY_REF,
    wgs84LngLat: [18.07, 59.33], sweref99NorthingEasting: [674571.9, northing],
    provenance: 'user_defined', label: `user point ${northing}`, created_by: USER.id,
  });
}

function project(geometry: LocalizationGeometryArtifact, propertyRef: { artifact_id: string; artifact_type: string } = PROPERTY_REF) {
  state.geometryRows.push({
    projectId: PROJECT_ID, geometryArtifactId: geometry.artifact_id,
    propertyContextRefId: propertyRef.artifact_id, propertyContextRefType: propertyRef.artifact_type, createdAt: new Date(),
  });
}

async function storeAndProject(repo: CasRepository, geometry: LocalizationGeometryArtifact) {
  await repo.put({ artifact_id: geometry.artifact_id, body: geometry });
  project(geometry);
}

async function signedIssuer(repo: CasRepository) {
  const bareIssuer = createLocalizationGeometrySupersessionIssuerArtifact({
    issuer_key_id: supersessionKey.provider.keyId,
    owner_authority_ref: { artifact_id: 'owner-authority-od-r1', artifact_type: 'owner_authority_attestation' },
  });
  const issuer = { ...bareIssuer, attestation: await attestLocalizationGeometrySupersessionIssuerArtifact({ issuer: bareIssuer, signing: supersessionKey.provider }) };
  await repo.put({ artifact_id: issuer.artifact_id, body: issuer });
  return issuer;
}

/** A real, signed predecessor -> successor edge, CAS-persisted and registered (what the worker writes). */
async function supersede(repo: CasRepository, predecessor: LocalizationGeometryArtifact, successor: LocalizationGeometryArtifact, issuedAt = '2026-10-02T00:00:00.000Z') {
  const issuer = await signedIssuer(repo);
  const bareEdge = createLocalizationGeometrySupersessionArtifact({
    contract_version: LOCALIZATION_GEOMETRY_SUPERSESSION_VERSION,
    project_id: PROJECT_ID,
    predecessor_geometry_ref: { artifact_id: predecessor.artifact_id, artifact_type: predecessor.artifact_type },
    successor_geometry_ref: { artifact_id: successor.artifact_id, artifact_type: successor.artifact_type },
    reason_code: 'USER_LOCALIZATION_CHANGE_V1',
    issuer_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
    issuer_key_id: supersessionKey.provider.keyId,
    issued_at: issuedAt,
  });
  const edge = { ...bareEdge, attestation: await attestLocalizationGeometrySupersessionArtifact({ artifact: bareEdge, issuer, signing: supersessionKey.provider }) };
  await repo.put({ artifact_id: edge.artifact_id, body: edge });
  state.supersessionRows.push({
    projectId: PROJECT_ID, supersessionArtifactId: edge.artifact_id,
    predecessorGeometryArtifactId: predecessor.artifact_id, successorGeometryArtifactId: successor.artifact_id, createdAt: new Date(),
  });
  process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_KEY_ID = supersessionKey.provider.keyId;
  process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM = supersessionKey.publicKey;
  __resetLocalizationGeometrySupersessionVerifierForTests(null);
  return edge;
}

/** A (superseded) -> B (current): both geometries, a real signed edge, everything readable. */
async function movedPoint() {
  const repo = new CasRepository();
  const a = userGeometry(6580743.0);
  const b = userGeometry(6580843.0);
  await storeAndProject(repo, a);
  await storeAndProject(repo, b);
  const edge = await supersede(repo, a, b);
  return { repo, a, b, edge };
}

function derive(repo: CasRepository) {
  return resolveOrDeriveCurrentLocalizationGeometry({
    projectId: PROJECT_ID,
    artifactRepository: repo as never,
    propertyContextRef: PROPERTY_REF,
    propertyCentroidSweref: [6580743.04, 674571.86],
    sweref99ToWgs84: vi.fn(async () => [59.33, 18.07] as const),
    createdBy: USER.id,
  });
}

/** Resolution must THROW; if it resolved, name the point it silently picked (the OD-R1 defect). */
async function resolutionError(repo: CasRepository, names: Record<string, string>): Promise<LocalizationGeometryCurrentnessError> {
  const error = await derive(repo).then(
    (resolved) => {
      throw new Error(
        `expected fail closed, but currentness resolved to ${names[resolved.geometry.artifact_id] ?? resolved.geometry.artifact_id} ` +
          `(wasDerived=${resolved.wasDerived})`,
      );
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(LocalizationGeometryCurrentnessError);
  return error as LocalizationGeometryCurrentnessError;
}

function expectCurrentUnverified(error: LocalizationGeometryCurrentnessError, repo: CasRepository, putsBefore: number, headId: string) {
  expect({ failureClass: error.failureClass, httpStatus: error.httpStatus, kind: error.kind, reasonCode: error.reasonCode }).toEqual({
    failureClass: 'CURRENT_GEOMETRY_UNVERIFIED', httpStatus: 409, kind: 'REFUSED',
    reasonCode: 'LOCALIZATION_GEOMETRY_CURRENT_GEOMETRY_UNVERIFIED',
  });
  expect(error.userMessage).toMatch(/aktuella lokaliseringspunkt kunde inte verifieras/);
  expect(error.userMessage).toMatch(/äldre punkt används aldrig/);
  expect(error.userMessage).toMatch(/Ingen bedömning görs/);
  expect(error.technicalDetail).toContain(headId);
  expect(repo.putCalls).toBe(putsBefore); // no centroid derived and written
  expect(state.registerCalls).toBe(0); // nothing registered as current
}

beforeEach(() => {
  state.geometryRows.length = 0;
  state.supersessionRows.length = 0;
  state.registerCalls = 0;
  delete process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_KEY_ID;
  delete process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM;
  __resetLocalizationGeometrySupersessionVerifierForTests(null);
});

afterEach(() => {
  expect(hermeticPrismaTouches).toEqual([]);
});

describe('OD-R1: the current head B under a verified A -> B edge cannot be verified -> fail closed, never A', () => {
  const names = (a: LocalizationGeometryArtifact, b: LocalizationGeometryArtifact) => ({
    [a.artifact_id]: 'STALE predecessor A', [b.artifact_id]: 'head B',
  });

  it('control: A -> B, everything verified -> B is CURRENT (unchanged)', async () => {
    const { repo, b } = await movedPoint();
    const resolved = await derive(repo);
    expect(resolved.geometry.artifact_id).toBe(b.artifact_id);
    expect(resolved.wasDerived).toBe(false);
  });

  it('B missing from CAS (the repository verdict "Artifact not found") -> CURRENT_GEOMETRY_UNVERIFIED 409', async () => {
    const { repo, a, b } = await movedPoint();
    repo.values.delete(b.artifact_id);
    const putsBefore = repo.putCalls;
    expectCurrentUnverified(await resolutionError(repo, names(a, b)), repo, putsBefore, b.artifact_id);
  });

  it('B corrupted in CAS (CASIntegrityError) -> CURRENT_GEOMETRY_UNVERIFIED 409', async () => {
    const { repo, a, b } = await movedPoint();
    repo.faults.set(b.artifact_id, new CASIntegrityError("Storage Read Corruption: on-disk hash 'x' != 'y'."));
    const putsBefore = repo.putCalls;
    expectCurrentUnverified(await resolutionError(repo, names(a, b)), repo, putsBefore, b.artifact_id);
  });

  it('B tampered (content changed after the fact -> REJECT_* verdict) -> CURRENT_GEOMETRY_UNVERIFIED 409', async () => {
    const { repo, a, b } = await movedPoint();
    repo.values.set(b.artifact_id, { ...b, payload: { ...b.payload, label: 'edited after the fact' } });
    const putsBefore = repo.putCalls;
    expectCurrentUnverified(await resolutionError(repo, names(a, b)), repo, putsBefore, b.artifact_id);
  });

  it("fourth case: B's projection row points to ANOTHER property context -> CURRENT_GEOMETRY_UNVERIFIED 409", async () => {
    const repo = new CasRepository();
    const a = userGeometry(6580743.0);
    const b = userGeometry(6580843.0);
    await storeAndProject(repo, a);
    await repo.put({ artifact_id: b.artifact_id, body: b });
    project(b, OTHER_PROPERTY_REF);
    await supersede(repo, a, b);
    const putsBefore = repo.putCalls;
    expectCurrentUnverified(await resolutionError(repo, names(a, b)), repo, putsBefore, b.artifact_id);
  });

  it("B's CAS content belongs to another project -> CURRENT_GEOMETRY_UNVERIFIED 409", async () => {
    const { repo, a, b } = await movedPoint();
    const foreign = userGeometry(6580843.0, { projectId: 'some-other-project' });
    repo.values.set(b.artifact_id, foreign);
    const putsBefore = repo.putCalls;
    const error = await resolutionError(repo, names(a, b));
    // The foreign content fails validation against B's own id or its project check; either way B is
    // the possible current point and cannot be verified.
    expectCurrentUnverified(error, repo, putsBefore, b.artifact_id);
  });

  it('a verified edge A -> B whose successor B has NO projection row -> CURRENT_GEOMETRY_UNVERIFIED 409, never A', async () => {
    const repo = new CasRepository();
    const a = userGeometry(6580743.0);
    const b = userGeometry(6580843.0);
    await storeAndProject(repo, a);
    await repo.put({ artifact_id: b.artifact_id, body: b }); // in CAS, but not in the projection
    await supersede(repo, a, b);
    const putsBefore = repo.putCalls;
    expectCurrentUnverified(await resolutionError(repo, names(a, b)), repo, putsBefore, b.artifact_id);
  });

  it('two roots without an edge, one of them tampered -> CURRENT_GEOMETRY_UNVERIFIED 409 (the tampered one may be the current point)', async () => {
    const repo = new CasRepository();
    const a = userGeometry(6580743.0);
    const tampered = userGeometry(6580843.0);
    await storeAndProject(repo, a);
    await storeAndProject(repo, tampered);
    repo.values.set(tampered.artifact_id, { ...tampered, payload: { ...tampered.payload, label: 'edited after the fact' } });
    const putsBefore = repo.putCalls;
    expectCurrentUnverified(await resolutionError(repo, { [a.artifact_id]: 'A' }), repo, putsBefore, tampered.artifact_id);
  });

  it('a cycle A -> B -> A with B missing never resolves A: INVALID_SUPERSESSION_GRAPH 409', async () => {
    const { repo, a, b } = await movedPoint();
    await supersede(repo, b, a, '2026-10-02T00:00:01.000Z');
    repo.values.delete(b.artifact_id);
    const error = await resolutionError(repo, names(a, b));
    expect({ failureClass: error.failureClass, httpStatus: error.httpStatus }).toEqual({ failureClass: 'INVALID_SUPERSESSION_GRAPH', httpStatus: 409 });
    expect(state.registerCalls).toBe(0);
  });
});

describe('OD-R1 keeps the frozen rule for candidates the verified graph proves superseded', () => {
  it.each([
    ['missing from CAS', (repo: CasRepository, id: string) => repo.values.delete(id)],
    ['corrupted (CASIntegrityError)', (repo: CasRepository, id: string) => repo.faults.set(id, new CASIntegrityError('Storage Read Corruption'))],
    ['tampered', (repo: CasRepository, id: string) => {
      const value = repo.values.get(id) as LocalizationGeometryArtifact;
      repo.values.set(id, { ...value, payload: { ...value.payload, label: 'edited after the fact' } });
    }],
  ])('predecessor A %s under a verified A -> B edge -> excluded, B is CURRENT (unchanged)', async (_label, sabotage) => {
    const { repo, a, b } = await movedPoint();
    sabotage(repo, a.artifact_id);
    const resolved = await derive(repo);
    expect(resolved.geometry.artifact_id).toBe(b.artifact_id);
    expect(resolved.wasDerived).toBe(false);
  });

  it('the only candidate missing -> NO_VERIFIED_GEOMETRY_CANDIDATE 409, no derivation (unchanged)', async () => {
    const repo = new CasRepository();
    const a = userGeometry(6580743.0);
    project(a);
    const error = await resolutionError(repo, {});
    expect({ failureClass: error.failureClass, httpStatus: error.httpStatus }).toEqual({ failureClass: 'NO_VERIFIED_GEOMETRY_CANDIDATE', httpStatus: 409 });
  });

  it('a broken middle point W -> X -> Y (X missing, X -> Y verified) still fails closed as AMBIGUOUS 409 (unchanged)', async () => {
    const repo = new CasRepository();
    const w = userGeometry(6580643.0);
    const x = userGeometry(6580743.0);
    const y = userGeometry(6580843.0);
    for (const g of [w, x, y]) await storeAndProject(repo, g);
    await supersede(repo, w, x, '2026-10-02T00:00:00.000Z');
    await supersede(repo, x, y, '2026-10-02T00:00:01.000Z');
    repo.values.delete(x.artifact_id);
    const error = await resolutionError(repo, { [w.artifact_id]: 'STALE W' });
    expect({ failureClass: error.failureClass, httpStatus: error.httpStatus }).toEqual({ failureClass: 'AMBIGUOUS_CURRENT_GEOMETRY', httpStatus: 409 });
  });
});

describe('OD-R1 read-back: current-assessment, PDF and verify fail closed and never consult the assessment index', () => {
  it.each([
    ['B missing from CAS', async (repo: CasRepository, b: LocalizationGeometryArtifact) => { repo.values.delete(b.artifact_id); }],
    ["B's projection row points to another property context", async (_repo: CasRepository, b: LocalizationGeometryArtifact) => {
      const row = state.geometryRows.find((r) => r.geometryArtifactId === b.artifact_id)!;
      row.propertyContextRefId = OTHER_PROPERTY_REF.artifact_id;
    }],
  ])('%s -> 409 CURRENT_GEOMETRY_UNVERIFIED on all three paths; the old point-A assessment is never looked up', async (_label, sabotage) => {
    const { repo, b } = await movedPoint();
    await sabotage(repo, b);
    const assessmentIndex = { listForProject: vi.fn(async () => []), register: vi.fn() };
    const bindingProvider = { resolveCurrent: vi.fn(async () => { throw new Error('binding provider must not be consulted'); }) };
    const common = {
      authUser: USER, projectId: PROJECT_ID, artifactRepository: repo as never,
      currentBindingProvider: bindingProvider as never, assessmentProjectionIndex: assessmentIndex as never,
    };
    const expected = {
      ok: false, status: 409, code: 'LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED',
      failureClass: 'CURRENT_GEOMETRY_UNVERIFIED', reasonCode: 'LOCALIZATION_GEOMETRY_CURRENT_GEOMETRY_UNVERIFIED',
    };
    expect(await resolveCurrentLuAssessmentSummary(common)).toMatchObject(expected);
    expect(await exportCurrentLuAssessmentPdf(common)).toMatchObject(expected);
    expect(await verifyCurrentLuAssessment(common)).toMatchObject(expected);
    expect(assessmentIndex.listForProject).not.toHaveBeenCalled();
    expect(bindingProvider.resolveCurrent).not.toHaveBeenCalled();
  });
});
