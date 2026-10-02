/**
 * DEMO M1a-repair, verifier findings F1 + F2 (owner decision D9(a), 2026-10-02).
 *
 * F1: a TECHNICAL failure while reading or verifying ONE currentness candidate (a CAS read error on a
 * geometry, a supersession edge or its issuer; a verification step that throws for a reason other
 * than a verification verdict, e.g. an unparsable verifier key) must fail the whole resolution
 * closed. It must never just drop that candidate: dropping the current head lets its superseded
 * predecessor resolve as CURRENT, and a governed run would then use a stale point.
 *
 * F2: such a failure is a retryable technical error -- CURRENTNESS_RESOLUTION_ERROR, HTTP 503 --
 * never a refusal class (AMBIGUOUS / NO_VERIFIED, 409), and code / failureClass / reasonCode survive
 * the service result, the read-back result and the HTTP route.
 *
 * The frozen reject-and-continue posture (LocalizationGeometryCurrentProvider; LU-PROJECTION-
 * RECONCILIATION-AND-TOTAL-ORDER-V1 Phase B) for candidates whose state WAS determined -- missing
 * from CAS, corrupted bytes, tampered content, forged/invalid signature -- is NOT changed by this
 * unit; the "frozen posture unchanged" block pins that. One consequence of that frozen rule is an
 * OPEN OWNER DECISION and is pinned (not endorsed) by the RESIDUAL test at the end of that block.
 *
 * Hermetic: both projection repositories and server/db/prisma are mocked (the prisma guard throws
 * and records on any access); CAS is an in-memory repository with the real "Artifact not found"
 * contract plus per-artifact fault injection. Real: LocalizationGeometryCurrentProvider, graph
 * reduction, geometry validation, supersession signing/verification, the D9(a) classifier, the
 * geometry service, the read-back orchestrator and the Express route.
 */
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  geometryRows: [] as Array<{ projectId: string; geometryArtifactId: string; propertyContextRefId: string; propertyContextRefType: string; createdAt: Date }>,
  supersessionRows: [] as Array<{ projectId: string; supersessionArtifactId: string; predecessorGeometryArtifactId: string; successorGeometryArtifactId: string; createdAt: Date }>,
  registerCalls: 0,
  provisioningCalls: 0,
  /** The CAS the route-level path gets from MimersIntegration.create(). */
  routeRepository: null as unknown,
}));

vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());
vi.mock('../../server/repositories/localizationGeometryProjectionRepository', () => ({
  PrismaLocalizationGeometryProjectionIndex: class {
    async register(row: { projectId: string; geometryArtifactId: string; propertyContextRef: { artifact_id: string; artifact_type: string } }) {
      state.registerCalls += 1;
      state.geometryRows.push({
        projectId: row.projectId, geometryArtifactId: row.geometryArtifactId,
        propertyContextRefId: row.propertyContextRef.artifact_id, propertyContextRefType: row.propertyContextRef.artifact_type,
        createdAt: new Date(),
      });
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
vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));
vi.mock('../../server/security/projectAccess', () => ({ assertProjectAccess: vi.fn(async () => undefined) }));
vi.mock('../../src/application/resolveCanonicalProjectContext', () => ({
  resolveCanonicalProjectContext: vi.fn(async () => ({
    propertyContextRef: { artifact_id: 'property-ctx-m1a-repair', artifact_type: 'LU_PROPERTY_CONTEXT' },
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
  ensureLocalizationGeometrySupersessionRequested: vi.fn(async () => ({ status: 'PENDING', failureDetail: null })),
}));
vi.mock('../../server/modules/localization/createLocalizationSpatialRuntime', () => ({
  createLocalizationSpatialRuntime: vi.fn(async () => ({
    sweref99ToWgs84: vi.fn(async () => [59.33, 18.07] as const),
    wgs84ToSweref99: vi.fn(async () => [6580943.04, 674571.86] as const),
    close: vi.fn(async () => undefined),
  })),
}));
vi.mock('@miljobeslut/mps-runtime', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  MimersIntegration: { create: vi.fn(async () => ({ artifactRepository: state.routeRepository })) },
}));

import { LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { CASIntegrityError } from '@miljobeslut/mimers-brunn-core';
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
import {
  getCurrentLocalizationGeometryForProject,
  resolveOrDeriveCurrentLocalizationGeometry,
} from '../../server/modules/localization/localizationGeometryService';
import { resolveCurrentLuAssessmentSummary } from '../../server/modules/localization/localizationOrchestrator';
import { __resetLocalizationGeometrySupersessionVerifierForTests } from '../../server/security/localizationGeometrySupersessionVerifier';
import { createTokenPair } from '../../server/security/auth';
import localizationRoutes from '../../server/routes/localization.routes';
import type { AuthUser } from '../../server/security/types';

const PROJECT_ID = 'project-m1a-repair';
const PROPERTY_REF = { artifact_id: 'property-ctx-m1a-repair', artifact_type: 'LU_PROPERTY_CONTEXT' } as const;
const USER: AuthUser = { id: 'user-m1a-repair', organisationId: 'org-m1a-repair', bankidId: 'bankid:m1a-repair', role: 'ADMIN' };

const supersessionKey = LocalPemSigningKeyProvider.generate('ed25519:geometry-supersession-issuer-m1a-repair');

/**
 * In-memory CAS with the REAL repository contract for an absent object (CasArtifactResolver and
 * InMemoryArtifactRepository both throw exactly `Artifact not found: <id>`), plus fault injection:
 * `faults.set(id, error)` makes every read of that id throw `error` (a technical read failure).
 */
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

function ioError(): Error {
  return Object.assign(new Error("EIO: i/o error, read 'C:\\mimers\\cas\\objects\\sha256\\ab\\cdef'"), { code: 'EIO' });
}

function userGeometry(northing: number): LocalizationGeometryArtifact {
  return createLocalizationGeometryArtifactV2({
    project_id: PROJECT_ID, property_context_ref: PROPERTY_REF,
    wgs84LngLat: [18.07, 59.33], sweref99NorthingEasting: [674571.9, northing],
    provenance: 'user_defined', label: `user point ${northing}`, created_by: USER.id,
  });
}

async function storeAndRegister(repo: CasRepository, geometry: LocalizationGeometryArtifact) {
  await repo.put({ artifact_id: geometry.artifact_id, body: geometry });
  state.geometryRows.push({
    projectId: PROJECT_ID, geometryArtifactId: geometry.artifact_id,
    propertyContextRefId: PROPERTY_REF.artifact_id, propertyContextRefType: PROPERTY_REF.artifact_type, createdAt: new Date(),
  });
}

function configureVerifier(publicKeyPem: string = supersessionKey.publicKey) {
  process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_KEY_ID = supersessionKey.provider.keyId;
  process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM = publicKeyPem;
  __resetLocalizationGeometrySupersessionVerifierForTests(null);
}

/** A real, signed A -> B supersession edge, CAS-persisted and registered -- what the worker writes. */
async function supersede(repo: CasRepository, predecessor: LocalizationGeometryArtifact, successor: LocalizationGeometryArtifact) {
  const bareIssuer = createLocalizationGeometrySupersessionIssuerArtifact({
    issuer_key_id: supersessionKey.provider.keyId,
    owner_authority_ref: { artifact_id: 'owner-authority-m1a-repair', artifact_type: 'owner_authority_attestation' },
  });
  const issuer = { ...bareIssuer, attestation: await attestLocalizationGeometrySupersessionIssuerArtifact({ issuer: bareIssuer, signing: supersessionKey.provider }) };
  await repo.put({ artifact_id: issuer.artifact_id, body: issuer });
  const bareEdge = createLocalizationGeometrySupersessionArtifact({
    contract_version: LOCALIZATION_GEOMETRY_SUPERSESSION_VERSION,
    project_id: PROJECT_ID,
    predecessor_geometry_ref: { artifact_id: predecessor.artifact_id, artifact_type: predecessor.artifact_type },
    successor_geometry_ref: { artifact_id: successor.artifact_id, artifact_type: successor.artifact_type },
    reason_code: 'USER_LOCALIZATION_CHANGE_V1',
    issuer_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
    issuer_key_id: supersessionKey.provider.keyId,
    issued_at: '2026-10-02T00:00:00.000Z',
  });
  const edge = { ...bareEdge, attestation: await attestLocalizationGeometrySupersessionArtifact({ artifact: bareEdge, issuer, signing: supersessionKey.provider }) };
  await repo.put({ artifact_id: edge.artifact_id, body: edge });
  state.supersessionRows.push({
    projectId: PROJECT_ID, supersessionArtifactId: edge.artifact_id,
    predecessorGeometryArtifactId: predecessor.artifact_id, successorGeometryArtifactId: successor.artifact_id, createdAt: new Date(),
  });
  configureVerifier();
  return { issuer, edge };
}

/** A (superseded) -> B (current), everything readable and verified. */
async function movedPoint() {
  const repo = new CasRepository();
  const a = userGeometry(6580743.0);
  const b = userGeometry(6580843.0);
  await storeAndRegister(repo, a);
  await storeAndRegister(repo, b);
  const { issuer, edge } = await supersede(repo, a, b);
  return { repo, a, b, issuer, edge };
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

/** Resolution must THROW; if it resolved, say which point it silently picked (the F1 defect). */
async function resolutionError(repo: CasRepository, names: Record<string, string>): Promise<unknown> {
  return derive(repo).then(
    (resolved) => {
      throw new Error(
        `expected fail closed, but currentness resolved to ${names[resolved.geometry.artifact_id] ?? resolved.geometry.artifact_id} ` +
          `(wasDerived=${resolved.wasDerived})`,
      );
    },
    (error: unknown) => error,
  );
}

function expectTechnicalFailClosed(error: unknown, repo: CasRepository, putsBefore: number, causeFragment: string) {
  expect(error).toBeInstanceOf(LocalizationGeometryCurrentnessError);
  const typed = error as LocalizationGeometryCurrentnessError;
  expect({ failureClass: typed.failureClass, httpStatus: typed.httpStatus, kind: typed.kind }).toEqual({
    failureClass: 'CURRENTNESS_RESOLUTION_ERROR', httpStatus: 503, kind: 'ERROR',
  });
  expect(typed.code).toBe('LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED');
  expect(typed.reasonCode).toBe('LOCALIZATION_GEOMETRY_CURRENTNESS_RESOLUTION_ERROR');
  expect(typed.userMessage).toMatch(/tekniskt fel/);
  expect(typed.userMessage).toMatch(/Ingen bedömning görs/);
  expect(typed.technicalDetail).toContain(causeFragment); // the real cause is kept for the log
  expect(repo.putCalls).toBe(putsBefore); // nothing derived or written
  expect(state.registerCalls).toBe(0); // nothing registered as current
}

beforeEach(() => {
  state.geometryRows.length = 0;
  state.supersessionRows.length = 0;
  state.registerCalls = 0;
  state.provisioningCalls = 0;
  state.routeRepository = null;
  delete process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_KEY_ID;
  delete process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM;
  __resetLocalizationGeometrySupersessionVerifierForTests(null);
});

afterEach(() => {
  // F3 discipline: nothing in this file may reach a real database client.
  expect(hermeticPrismaTouches).toEqual([]);
});

describe('F1: a technical failure on ONE candidate fails the whole currentness resolution closed', () => {
  it('control: A -> B with everything readable and verified resolves B (the head) as CURRENT', async () => {
    const { repo, b } = await movedPoint();
    const resolved = await derive(repo);
    expect(resolved.geometry.artifact_id).toBe(b.artifact_id);
    expect(resolved.wasDerived).toBe(false);
  });

  it('ADV-1: CAS read of the CURRENT head B fails (EIO) -> 503 technical, never the stale predecessor A', async () => {
    const { repo, a, b } = await movedPoint();
    repo.faults.set(b.artifact_id, ioError());
    const putsBefore = repo.putCalls;
    const error = await resolutionError(repo, { [a.artifact_id]: 'STALE predecessor A', [b.artifact_id]: 'head B' });
    expectTechnicalFailClosed(error, repo, putsBefore, 'EIO');
  });

  it('CAS read of the predecessor A fails (EIO) -> 503 technical (the graph could not be verified)', async () => {
    const { repo, a, b } = await movedPoint();
    repo.faults.set(a.artifact_id, ioError());
    const putsBefore = repo.putCalls;
    const error = await resolutionError(repo, { [a.artifact_id]: 'predecessor A', [b.artifact_id]: 'head B' });
    expectTechnicalFailClosed(error, repo, putsBefore, 'EIO');
  });

  it('a non-Error throw from CAS for the head (throw "socket hang up") -> 503 technical, never the stale A', async () => {
    const { repo, a, b } = await movedPoint();
    repo.faults.set(b.artifact_id, 'socket hang up');
    const putsBefore = repo.putCalls;
    const error = await resolutionError(repo, { [a.artifact_id]: 'STALE predecessor A', [b.artifact_id]: 'head B' });
    expectTechnicalFailClosed(error, repo, putsBefore, 'socket hang up');
  });

  it('ADV-2a: CAS read of the supersession EDGE fails (EIO) -> 503 technical, not AMBIGUOUS 409', async () => {
    const { repo, edge } = await movedPoint();
    repo.faults.set(edge.artifact_id, ioError());
    const putsBefore = repo.putCalls;
    const error = await resolutionError(repo, {});
    expectTechnicalFailClosed(error, repo, putsBefore, 'EIO');
  });

  it('CAS read of the edge ISSUER fails (EIO) -> 503 technical, not AMBIGUOUS 409', async () => {
    const { repo, issuer } = await movedPoint();
    repo.faults.set(issuer.artifact_id, ioError());
    const putsBefore = repo.putCalls;
    const error = await resolutionError(repo, {});
    expectTechnicalFailClosed(error, repo, putsBefore, 'EIO');
  });

  it('ADV-2b: single geometry, transient CAS read error -> 503 technical, not NO_VERIFIED 409, and no centroid derived', async () => {
    const repo = new CasRepository();
    const a = userGeometry(6580743.0);
    await storeAndRegister(repo, a);
    repo.faults.set(a.artifact_id, ioError());
    const putsBefore = repo.putCalls;
    const error = await resolutionError(repo, { [a.artifact_id]: 'A' });
    expectTechnicalFailClosed(error, repo, putsBefore, 'EIO');
  });

  it('verifier key configured but unparsable (verification THROWS, no verdict) -> 503 technical, not AMBIGUOUS 409', async () => {
    const { repo } = await movedPoint();
    configureVerifier('-----BEGIN PUBLIC KEY-----\nbm90IGEga2V5\n-----END PUBLIC KEY-----');
    const putsBefore = repo.putCalls;
    const error = await resolutionError(repo, {});
    expect(error).toBeInstanceOf(LocalizationGeometryCurrentnessError);
    expect((error as LocalizationGeometryCurrentnessError).failureClass).toBe('CURRENTNESS_RESOLUTION_ERROR');
    expect((error as LocalizationGeometryCurrentnessError).httpStatus).toBe(503);
    expect(repo.putCalls).toBe(putsBefore);
    expect(state.registerCalls).toBe(0);
  });
});

describe('Frozen reject-and-continue posture is UNCHANGED for candidates whose state was determined', () => {
  async function refusal(repo: CasRepository): Promise<LocalizationGeometryCurrentnessError> {
    const error = await resolutionError(repo, {});
    expect(error).toBeInstanceOf(LocalizationGeometryCurrentnessError);
    return error as LocalizationGeometryCurrentnessError;
  }

  it('missing CAS object (the repository verdict "Artifact not found") on the only candidate -> excluded -> NO_VERIFIED 409, no derivation', async () => {
    const repo = new CasRepository();
    const a = userGeometry(6580743.0);
    await storeAndRegister(repo, a);
    repo.values.delete(a.artifact_id);
    const e = await refusal(repo);
    expect({ failureClass: e.failureClass, httpStatus: e.httpStatus }).toEqual({ failureClass: 'NO_VERIFIED_GEOMETRY_CANDIDATE', httpStatus: 409 });
    expect(state.registerCalls).toBe(0);
  });

  it('corrupted CAS bytes (CASIntegrityError) on the only candidate -> excluded -> NO_VERIFIED 409', async () => {
    const repo = new CasRepository();
    const a = userGeometry(6580743.0);
    await storeAndRegister(repo, a);
    repo.faults.set(a.artifact_id, new CASIntegrityError("Storage Read Corruption: on-disk hash 'x' != 'y'."));
    const e = await refusal(repo);
    expect(e.failureClass).toBe('NO_VERIFIED_GEOMETRY_CANDIDATE');
  });

  it('a tampered geometry (content_hash mismatch) next to a valid root -> tampered one excluded, the valid one CURRENT', async () => {
    const repo = new CasRepository();
    const a = userGeometry(6580743.0);
    const tampered = userGeometry(6580843.0);
    await storeAndRegister(repo, a);
    await storeAndRegister(repo, tampered);
    repo.values.set(tampered.artifact_id, { ...tampered, payload: { ...tampered.payload, label: 'edited after the fact' } });
    const resolved = await derive(repo);
    expect(resolved.geometry.artifact_id).toBe(a.artifact_id);
  });

  it('a forged edge (signature does not verify) -> edge excluded -> both points are heads -> AMBIGUOUS 409', async () => {
    const { repo, edge } = await movedPoint();
    repo.values.set(edge.artifact_id, { ...edge, attestation: { ...edge.attestation!, signature: `ed25519:${Buffer.alloc(64).toString('base64')}` } });
    const e = await refusal(repo);
    expect({ failureClass: e.failureClass, httpStatus: e.httpStatus }).toEqual({ failureClass: 'AMBIGUOUS_CURRENT_GEOMETRY', httpStatus: 409 });
  });

  it('RESIDUAL, OPEN OWNER DECISION (pinned, not endorsed): head B MISSING from CAS under a verified A -> B edge still resolves the predecessor A as CURRENT', async () => {
    // The frozen rule excludes a missing candidate AND every edge that references it, so the
    // superseded predecessor becomes the only head. Failing closed here instead would change the
    // frozen semantics -- see M1A-REPAIR-REPORT.md, "Open owner decisions". If the owner decides
    // to fail closed, this test must flip to a fail-closed expectation.
    const { repo, a, b } = await movedPoint();
    repo.values.delete(b.artifact_id);
    const resolved = await derive(repo);
    expect(resolved.geometry.artifact_id).toBe(a.artifact_id);
  });
});

describe('F2: the technical class survives the service result, the read-back and the HTTP route', () => {
  it('GET-geometry service: head unreadable -> { ok:false, 503, code, failureClass, reasonCode }, Swedish retry text; no derived point, no provisioning', async () => {
    const { repo, b } = await movedPoint();
    repo.faults.set(b.artifact_id, ioError());
    const putsBefore = repo.putCalls;
    const result = await getCurrentLocalizationGeometryForProject({
      authUser: USER, projectId: PROJECT_ID, artifactRepository: repo as never,
      spatialRuntime: { sweref99ToWgs84: vi.fn(async () => [59.33, 18.07] as const), wgs84ToSweref99: vi.fn(), close: vi.fn(async () => undefined) } as never,
    });
    expect(result).toMatchObject({
      ok: false, status: 503, code: 'LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED',
      failureClass: 'CURRENTNESS_RESOLUTION_ERROR', reasonCode: 'LOCALIZATION_GEOMETRY_CURRENTNESS_RESOLUTION_ERROR',
    });
    expect((result as { error: string }).error).toMatch(/tekniskt fel.*försök igen/);
    expect(repo.putCalls).toBe(putsBefore);
    expect(state.registerCalls).toBe(0);
    expect(state.provisioningCalls).toBe(0);
  });

  it('read-back (current-assessment): head unreadable -> 503 with the class kept; the assessment index is never consulted', async () => {
    const { repo, b } = await movedPoint();
    repo.faults.set(b.artifact_id, ioError());
    const assessmentIndex = { listForProject: vi.fn(async () => []), register: vi.fn() };
    const bindingProvider = { resolveCurrent: vi.fn(async () => { throw new Error('binding provider must not be consulted'); }) };
    const result = await resolveCurrentLuAssessmentSummary({
      authUser: USER, projectId: PROJECT_ID, artifactRepository: repo as never,
      currentBindingProvider: bindingProvider as never, assessmentProjectionIndex: assessmentIndex as never,
    });
    expect(result).toMatchObject({
      ok: false, status: 503, code: 'LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED',
      failureClass: 'CURRENTNESS_RESOLUTION_ERROR', reasonCode: 'LOCALIZATION_GEOMETRY_CURRENTNESS_RESOLUTION_ERROR',
    });
    expect(assessmentIndex.listForProject).not.toHaveBeenCalled();
  });

  it('HTTP GET /api/localization/:projectId/geometry: head unreadable -> HTTP 503 and the structured class on the wire', async () => {
    const { repo, b } = await movedPoint();
    repo.faults.set(b.artifact_id, ioError());
    state.routeRepository = repo;
    const app = express();
    app.use(express.json());
    app.use(localizationRoutes);
    const token = createTokenPair({ id: USER.id, organisationId: USER.organisationId, bankidId: USER.bankidId, role: 'ADMIN' }).accessToken;

    const res = await request(app).get(`/api/localization/${PROJECT_ID}/geometry`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      ok: false, code: 'LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED',
      failureClass: 'CURRENTNESS_RESOLUTION_ERROR', reasonCode: 'LOCALIZATION_GEOMETRY_CURRENTNESS_RESOLUTION_ERROR',
    });
    expect(res.body.error).toMatch(/Ingen bedömning görs/);
    expect(res.body.geometry).toBeUndefined();
    expect(state.provisioningCalls).toBe(0);
  });
});
