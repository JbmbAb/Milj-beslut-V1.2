/**
 * M1a-F1 -- the independent verifier's findings after the M1a close (2026-10-02).
 *
 * Owner rule OD-R1 (YES, forward-only, D9(a)): an older point NEVER becomes current just because the
 * newer one cannot be verified.
 *
 * F1 (a), MEDIUM: a projection row for the edge B -> C exists, but the edge itself cannot be verified
 * (its index entry lost -> "Artifact not found", its bytes corrupted, its signature forged, or it was
 * signed by an untrusted issuer), AND C has no projection row. The frozen posture dropped the edge, so
 * nothing referred to C any more and B -- which the row says was superseded -- resolved CURRENT. Now
 * the unverifiable row whose claimed successor is not visible fails the resolution closed
 * (CURRENT_GEOMETRY_UNVERIFIED, 409), never B. When C IS visible the frozen outcome is unchanged
 * (B and C are both heads: AMBIGUOUS 409).
 *
 * F1 (b), KNOWN_LIMITATION (owner decision 2026-10-02: accepted as an explicit 72h limit; the head
 * pointer is documented as the next architecture step, not built): when B's geometry row AND the
 * A -> B edge row are both lost, nothing visible refers to B and A resolves CURRENT. Meaning, exactly:
 * "currentness är fail-closed för detekterbara fel men inte bevisad mot korrelerad förlust av all
 * metadata som visar att en nyare punkt existerat" (LOCALIZATION_GEOMETRY_CURRENTNESS_KNOWN_LIMITATION).
 * Pinned below under that label, NOT as approved behaviour.
 *
 * Low (1) retryable honesty and (2) consistency: a stored candidate whose CAS object is gone
 * (MIMERS_ARTIFACT_OBJECT_MISSING) or whose index entry is torn (MIMERS_ARTIFACT_INDEX_READ_FAILED,
 * MALFORMED) is a PERSISTENT storage fault: as a possibly current point it is
 * CURRENTNESS_STORAGE_INTEGRITY_FAULT (503, technical, retryable:false, no "försök igen"); as a point a
 * VERIFIED edge proves superseded it is skipped, exactly like corrupted bytes. A transient index read
 * error (IO) stays CURRENTNESS_RESOLUTION_ERROR (retryable).
 *
 * Low (4): the VERIFIER_CONFIGURATION text names both possible causes (configuration error, or an
 * untrusted/forged issuer), since a forged issuer that is the project's only one looks exactly like a
 * wrong key.
 *
 * Hermetic: both projection repositories and server/db/prisma are mocked (the prisma guard throws and
 * records on any access); CAS is an in-memory repository with the real "Artifact not found" contract
 * plus per-id fault injection using the REAL typed storage errors of MimersByteStorageBackend.
 */
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  geometryRows: [] as Array<{ projectId: string; geometryArtifactId: string; propertyContextRefId: string; propertyContextRefType: string; createdAt: Date }>,
  supersessionRows: [] as Array<{ projectId: string; supersessionArtifactId: string; predecessorGeometryArtifactId: string; successorGeometryArtifactId: string; createdAt: Date }>,
  registerCalls: 0,
  provisioningCalls: 0,
  routeRepository: null as unknown,
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
vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));
vi.mock('../../server/security/projectAccess', () => ({ assertProjectAccess: vi.fn(async () => undefined) }));
vi.mock('../../src/application/resolveCanonicalProjectContext', () => ({
  resolveCanonicalProjectContext: vi.fn(async () => ({
    propertyContextRef: { artifact_id: 'property-ctx-m1a-f1', artifact_type: 'LU_PROPERTY_CONTEXT' },
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
import {
  MimersArtifactIndexReadError,
  MimersArtifactObjectMissingError,
} from '../../packages/mps-runtime/src/repository/MimersByteStorageBackend';
import { hermeticPrismaTouches } from '../helpers/hermeticPrismaGuard';
import {
  attestLocalizationGeometrySupersessionArtifact,
  attestLocalizationGeometrySupersessionIssuerArtifact,
} from '../../server/modules/localization/localizationGeometrySupersessionAuthority';
import { LOCALIZATION_GEOMETRY_CURRENTNESS_KNOWN_LIMITATION } from '../../server/modules/localization/localizationGeometryCurrentProvider';
import {
  LocalizationGeometryCurrentnessError,
  failedClosedGeometryProvenanceRecord,
} from '../../server/modules/localization/localizationGeometryCurrentness';
import {
  getCurrentLocalizationGeometryForProject,
  resolveOrDeriveCurrentLocalizationGeometry,
} from '../../server/modules/localization/localizationGeometryService';
import {
  exportCurrentLuAssessmentPdf,
  resolveCurrentLuAssessmentSummary,
  verifyCurrentLuAssessment,
} from '../../server/modules/localization/localizationOrchestrator';
import { __resetLocalizationGeometrySupersessionVerifierForTests } from '../../server/security/localizationGeometrySupersessionVerifier';
import { createTokenPair } from '../../server/security/auth';
import localizationRoutes from '../../server/routes/localization.routes';
import type { AuthUser } from '../../server/security/types';

const PROJECT_ID = 'project-m1a-f1';
const PROPERTY_REF = { artifact_id: 'property-ctx-m1a-f1', artifact_type: 'LU_PROPERTY_CONTEXT' } as const;
const USER: AuthUser = { id: 'user-m1a-f1', organisationId: 'org-m1a-f1', bankidId: 'bankid:m1a-f1', role: 'ADMIN' };
const KEY_ID = 'ed25519:geometry-supersession-issuer-m1a-f1';
const genuineKey = LocalPemSigningKeyProvider.generate(KEY_ID);
const attackerKey = LocalPemSigningKeyProvider.generate('ed25519:attacker-m1a-f1');
type Signer = ReturnType<typeof LocalPemSigningKeyProvider.generate>;

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

/** The REAL typed storage faults (packages/mps-runtime MimersByteStorageBackend). */
const objectMissing = (id: string) => new MimersArtifactObjectMissingError(id, `sha256:${'ab'.repeat(32)}`, 'get');
const indexTorn = (id: string) => new MimersArtifactIndexReadError(id, 'C:\\cas\\artifact-id-index\\x.idx', 'MALFORMED', 'entry is not valid JSON');
const indexBusy = (id: string) => new MimersArtifactIndexReadError(id, 'C:\\cas\\artifact-id-index\\x.idx', 'IO', 'EBUSY: resource busy or locked');

function userGeometry(northing: number): LocalizationGeometryArtifact {
  return createLocalizationGeometryArtifactV2({
    project_id: PROJECT_ID, property_context_ref: PROPERTY_REF,
    wgs84LngLat: [18.07, 59.33], sweref99NorthingEasting: [674571.9, northing],
    provenance: 'user_defined', label: `user point ${northing}`, created_by: USER.id,
  });
}

async function storeAndProject(repo: CasRepository, geometry: LocalizationGeometryArtifact) {
  await repo.put({ artifact_id: geometry.artifact_id, body: geometry });
  state.geometryRows.push({
    projectId: PROJECT_ID, geometryArtifactId: geometry.artifact_id,
    propertyContextRefId: PROPERTY_REF.artifact_id, propertyContextRefType: PROPERTY_REF.artifact_type, createdAt: new Date(),
  });
}

function dropGeometryRow(geometry: LocalizationGeometryArtifact) {
  const index = state.geometryRows.findIndex((r) => r.geometryArtifactId === geometry.artifact_id);
  expect(index).toBeGreaterThanOrEqual(0);
  state.geometryRows.splice(index, 1);
}

function dropEdgeRow(edgeId: string) {
  const index = state.supersessionRows.findIndex((r) => r.supersessionArtifactId === edgeId);
  expect(index).toBeGreaterThanOrEqual(0);
  state.supersessionRows.splice(index, 1);
}

function configureVerifier(keyId: string, publicKeyPem: string) {
  process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_KEY_ID = keyId;
  process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM = publicKeyPem;
  __resetLocalizationGeometrySupersessionVerifierForTests(null);
}

/** A signed predecessor -> successor edge under `signer`'s issuer, CAS-persisted and registered. */
async function supersede(
  repo: CasRepository,
  predecessor: LocalizationGeometryArtifact,
  successor: LocalizationGeometryArtifact,
  issuedAt: string,
  signer: Signer = genuineKey,
) {
  const bareIssuer = createLocalizationGeometrySupersessionIssuerArtifact({
    issuer_key_id: signer.provider.keyId,
    owner_authority_ref: { artifact_id: 'owner-authority-m1a-f1', artifact_type: 'owner_authority_attestation' },
  });
  const issuer = { ...bareIssuer, attestation: await attestLocalizationGeometrySupersessionIssuerArtifact({ issuer: bareIssuer, signing: signer.provider }) };
  await repo.put({ artifact_id: issuer.artifact_id, body: issuer });
  const bareEdge = createLocalizationGeometrySupersessionArtifact({
    contract_version: LOCALIZATION_GEOMETRY_SUPERSESSION_VERSION,
    project_id: PROJECT_ID,
    predecessor_geometry_ref: { artifact_id: predecessor.artifact_id, artifact_type: predecessor.artifact_type },
    successor_geometry_ref: { artifact_id: successor.artifact_id, artifact_type: successor.artifact_type },
    reason_code: 'USER_LOCALIZATION_CHANGE_V1',
    issuer_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
    issuer_key_id: signer.provider.keyId,
    issued_at: issuedAt,
  });
  const edge = { ...bareEdge, attestation: await attestLocalizationGeometrySupersessionArtifact({ artifact: bareEdge, issuer, signing: signer.provider }) };
  await repo.put({ artifact_id: edge.artifact_id, body: edge });
  state.supersessionRows.push({
    projectId: PROJECT_ID, supersessionArtifactId: edge.artifact_id,
    predecessorGeometryArtifactId: predecessor.artifact_id, successorGeometryArtifactId: successor.artifact_id, createdAt: new Date(),
  });
  return { issuer, edge };
}

/** A (superseded) -> B (current), genuine issuer, everything readable. */
async function movedPoint() {
  const repo = new CasRepository();
  const a = userGeometry(6580743.0);
  const b = userGeometry(6580843.0);
  await storeAndProject(repo, a);
  await storeAndProject(repo, b);
  const { issuer, edge } = await supersede(repo, a, b, '2026-10-02T00:00:00.000Z');
  configureVerifier(KEY_ID, genuineKey.publicKey);
  return { repo, a, b, issuer, edge };
}

/** A -> B -> C (C current), genuine issuer, everything readable and projected. */
async function movedTwice() {
  const { repo, a, b, edge: ab } = await movedPoint();
  const c = userGeometry(6580943.0);
  await storeAndProject(repo, c);
  const { edge: bc } = await supersede(repo, b, c, '2026-10-02T00:00:01.000Z');
  configureVerifier(KEY_ID, genuineKey.publicKey);
  return { repo, a, b, c, ab, bc };
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

/** Resolution must THROW; if it resolved, name the point it silently picked. */
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

function expectNothingWritten(repo: CasRepository, putsBefore: number) {
  expect(repo.putCalls).toBe(putsBefore); // no centroid derived and written
  expect(state.registerCalls).toBe(0); // nothing registered as current
}

function expectStorageIntegrityFault(error: LocalizationGeometryCurrentnessError, marker: string, artifactId: string) {
  expect({ failureClass: error.failureClass, httpStatus: error.httpStatus, kind: error.kind, retryable: error.retryable, reasonCode: error.reasonCode }).toEqual({
    failureClass: 'CURRENTNESS_STORAGE_INTEGRITY_FAULT', httpStatus: 503, kind: 'ERROR', retryable: false,
    reasonCode: 'LOCALIZATION_GEOMETRY_CURRENTNESS_STORAGE_INTEGRITY_FAULT',
  });
  expect(error.userMessage).toMatch(/bestående lagringsfel/);
  expect(error.userMessage).toMatch(/försvinner inte vid ett nytt försök/);
  expect(error.userMessage).not.toMatch(/– försök igen/);
  expect(error.userMessage).toMatch(/Ingen bedömning görs/);
  expect(error.technicalDetail).toContain(marker);
  expect(error.technicalDetail).toContain(artifactId);
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
  expect(hermeticPrismaTouches).toEqual([]);
});

const EDGE_SABOTAGE: ReadonlyArray<[string, string, (f: Awaited<ReturnType<typeof movedTwice>>) => Promise<string>]> = [
  ['the edge\'s index entry is lost ("Artifact not found")', 'EDGE_MISSING_FROM_CAS', async (f) => {
    f.repo.values.delete(f.bc.artifact_id);
    return f.bc.artifact_id;
  }],
  ['the edge\'s bytes are corrupted (CASIntegrityError)', 'EDGE_CORRUPTED_IN_CAS', async (f) => {
    f.repo.faults.set(f.bc.artifact_id, new CASIntegrityError("Storage Read Corruption: on-disk hash 'x' != 'y'."));
    return f.bc.artifact_id;
  }],
  ['the edge\'s signature does not verify (forged/tampered)', 'EDGE_REJECTED', async (f) => {
    f.repo.values.set(f.bc.artifact_id, { ...f.bc, attestation: { ...f.bc.attestation!, signature: `ed25519:${Buffer.alloc(64).toString('base64')}` } });
    return f.bc.artifact_id;
  }],
  ['the edge row names an edge signed by an UNTRUSTED issuer', 'ISSUER_KEY_MISMATCH', async (f) => {
    dropEdgeRow(f.bc.artifact_id);
    const { edge } = await supersede(f.repo, f.b, f.c, '2026-10-02T00:00:02.000Z', attackerKey);
    return edge.artifact_id;
  }],
];

describe('F1 (a): an unverifiable edge row B -> C whose successor C is not visible fails closed -- never B', () => {
  const names = (f: Awaited<ReturnType<typeof movedTwice>>) => ({
    [f.a.artifact_id]: 'STALE A', [f.b.artifact_id]: 'SUPERSEDED B (the edge row says so)', [f.c.artifact_id]: 'C',
  });

  it('control: A -> B -> C with everything verified and projected -> C is CURRENT', async () => {
    const f = await movedTwice();
    expect((await derive(f.repo)).geometry.artifact_id).toBe(f.c.artifact_id);
  });

  it.each(EDGE_SABOTAGE)('%s AND C has no projection row -> CURRENT_GEOMETRY_UNVERIFIED 409, never B', async (_label, reason, sabotage) => {
    const f = await movedTwice();
    const edgeId = await sabotage(f);
    dropGeometryRow(f.c);
    const putsBefore = f.repo.putCalls;
    const error = await resolutionError(f.repo, names(f));
    expect({ failureClass: error.failureClass, httpStatus: error.httpStatus, kind: error.kind, retryable: error.retryable }).toEqual({
      failureClass: 'CURRENT_GEOMETRY_UNVERIFIED', httpStatus: 409, kind: 'REFUSED', retryable: false,
    });
    expect(error.userMessage).toMatch(/äldre punkt används aldrig/);
    expect(error.technicalDetail).toContain(edgeId);
    expect(error.technicalDetail).toContain(reason);
    expect(error.technicalDetail).toContain(f.c.artifact_id);
    expect(error.technicalDetail).toContain(f.b.artifact_id);
    expectNothingWritten(f.repo, putsBefore);
  });

  it.each(EDGE_SABOTAGE)('control: %s but C IS projected and verified -> unchanged frozen outcome AMBIGUOUS 409 (B and C are both heads)', async (_label, _reason, sabotage) => {
    const f = await movedTwice();
    await sabotage(f);
    const error = await resolutionError(f.repo, names(f));
    expect({ failureClass: error.failureClass, httpStatus: error.httpStatus }).toEqual({ failureClass: 'AMBIGUOUS_CURRENT_GEOMETRY', httpStatus: 409 });
  });

  it('control: the B -> C edge verifies but C has no projection row -> CURRENT_GEOMETRY_UNVERIFIED (NOT_PROJECTED), unchanged OD-R1', async () => {
    const f = await movedTwice();
    dropGeometryRow(f.c);
    const error = await resolutionError(f.repo, names(f));
    expect(error.failureClass).toBe('CURRENT_GEOMETRY_UNVERIFIED');
    expect(error.technicalDetail).toContain('NOT_PROJECTED');
  });

  it('read-back: current-assessment, PDF and verify fail closed with 409 and never consult the assessment index (B\'s assessment would be stale)', async () => {
    const f = await movedTwice();
    f.repo.values.delete(f.bc.artifact_id);
    dropGeometryRow(f.c);
    const assessmentIndex = { listForProject: vi.fn(async () => []), register: vi.fn() };
    const bindingProvider = { resolveCurrent: vi.fn(async () => { throw new Error('binding provider must not be consulted'); }) };
    const common = {
      authUser: USER, projectId: PROJECT_ID, artifactRepository: f.repo as never,
      currentBindingProvider: bindingProvider as never, assessmentProjectionIndex: assessmentIndex as never,
    };
    const expected = {
      ok: false, status: 409, code: 'LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED',
      failureClass: 'CURRENT_GEOMETRY_UNVERIFIED', reasonCode: 'LOCALIZATION_GEOMETRY_CURRENT_GEOMETRY_UNVERIFIED', retryable: false,
    };
    expect(await resolveCurrentLuAssessmentSummary(common)).toMatchObject(expected);
    expect(await exportCurrentLuAssessmentPdf(common)).toMatchObject(expected);
    expect(await verifyCurrentLuAssessment(common)).toMatchObject(expected);
    expect(assessmentIndex.listForProject).not.toHaveBeenCalled();
    expect(bindingProvider.resolveCurrent).not.toHaveBeenCalled();
  });
});

describe('KNOWN_LIMITATION (LOCALIZATION_GEOMETRY_CURRENTNESS_CORRELATED_METADATA_LOSS) -- F1 (b), NOT approved behaviour', () => {
  it('the machine-readable marker carries exactly the owner\'s meaning (2026-10-02)', () => {
    expect(LOCALIZATION_GEOMETRY_CURRENTNESS_KNOWN_LIMITATION).toEqual({
      code: 'KNOWN_LIMITATION',
      id: 'LOCALIZATION_GEOMETRY_CURRENTNESS_CORRELATED_METADATA_LOSS',
      meaning_sv:
        'currentness är fail-closed för detekterbara fel men inte bevisad mot korrelerad förlust av all metadata som visar att en nyare punkt existerat',
      owner_decision: '2026-10-02: accepted as an explicit 72h limit; head pointer documented as the next architecture step, not built',
    });
    expect(Object.isFrozen(LOCALIZATION_GEOMETRY_CURRENTNESS_KNOWN_LIMITATION)).toBe(true);
  });

  it('KNOWN_LIMITATION: B\'s projection row AND the A -> B edge row are both lost -> A resolves CURRENT although B and the signed edge are intact in CAS', async () => {
    const { repo, a, b, edge } = await movedPoint();
    dropGeometryRow(b);
    dropEdgeRow(edge.artifact_id);
    // The evidence is still in CAS -- nothing the provider can see refers to it any more.
    expect(await repo.resolve<LocalizationGeometryArtifact>({ artifact_id: b.artifact_id })).toMatchObject({ artifact_id: b.artifact_id });
    expect(await repo.resolve<{ artifact_id: string }>({ artifact_id: edge.artifact_id })).toMatchObject({ artifact_id: edge.artifact_id });
    const resolved = await derive(repo);
    // KNOWN_LIMITATION, pinned -- not a requirement and not approved behaviour: the stale point A is
    // returned. When a CAS head pointer exists this expectation must be inverted to a fail-closed one
    // (CURRENT_GEOMETRY_UNVERIFIED, never A).
    expect(resolved.geometry.artifact_id).toBe(a.artifact_id);
    expect(resolved.wasDerived).toBe(false);
  });
});

describe('(1) retryable honesty: a persistent storage fault on a possibly current point is technical and NOT retryable', () => {
  it.each([
    ['its CAS object is gone under an intact index entry', objectMissing, 'MIMERS_ARTIFACT_OBJECT_MISSING'],
    ['its index entry is torn (MALFORMED)', indexTorn, 'MIMERS_ARTIFACT_INDEX_READ_FAILED'],
  ] as const)('head B: %s -> CURRENTNESS_STORAGE_INTEGRITY_FAULT 503, retryable:false, never A', async (_label, fault, marker) => {
    const { repo, a, b } = await movedPoint();
    repo.faults.set(b.artifact_id, fault(b.artifact_id));
    const putsBefore = repo.putCalls;
    const error = await resolutionError(repo, { [a.artifact_id]: 'STALE predecessor A', [b.artifact_id]: 'head B' });
    expectStorageIntegrityFault(error, marker, b.artifact_id);
    expectNothingWritten(repo, putsBefore);
  });

  it('the only candidate\'s CAS object is gone -> CURRENTNESS_STORAGE_INTEGRITY_FAULT, no centroid derived', async () => {
    const repo = new CasRepository();
    const a = userGeometry(6580743.0);
    await storeAndProject(repo, a);
    repo.faults.set(a.artifact_id, objectMissing(a.artifact_id));
    const putsBefore = repo.putCalls;
    expectStorageIntegrityFault(await resolutionError(repo, { [a.artifact_id]: 'A' }), 'MIMERS_ARTIFACT_OBJECT_MISSING', a.artifact_id);
    expectNothingWritten(repo, putsBefore);
  });

  it.each([
    ['the supersession edge', (f: Awaited<ReturnType<typeof movedPoint>>) => f.edge.artifact_id],
    ['the edge issuer', (f: Awaited<ReturnType<typeof movedPoint>>) => f.issuer.artifact_id],
  ] as const)('%s: CAS object gone -> CURRENTNESS_STORAGE_INTEGRITY_FAULT, retryable:false', async (_label, pick) => {
    const f = await movedPoint();
    const id = pick(f);
    f.repo.faults.set(id, objectMissing(id));
    expectStorageIntegrityFault(await resolutionError(f.repo, {}), 'MIMERS_ARTIFACT_OBJECT_MISSING', id);
  });

  it('control: a transient index READ error (IO, EBUSY) on head B stays CURRENTNESS_RESOLUTION_ERROR, retryable:true', async () => {
    const { repo, b } = await movedPoint();
    repo.faults.set(b.artifact_id, indexBusy(b.artifact_id));
    const error = await resolutionError(repo, {});
    expect({ failureClass: error.failureClass, httpStatus: error.httpStatus, retryable: error.retryable }).toEqual({
      failureClass: 'CURRENTNESS_RESOLUTION_ERROR', httpStatus: 503, retryable: true,
    });
  });

  it('the flag travels: service result, HTTP route and the generate-report FAILED_CLOSED record all say retryable:false', async () => {
    const { repo, b } = await movedPoint();
    repo.faults.set(b.artifact_id, objectMissing(b.artifact_id));
    const result = await getCurrentLocalizationGeometryForProject({
      authUser: USER, projectId: PROJECT_ID, artifactRepository: repo as never,
      spatialRuntime: { sweref99ToWgs84: vi.fn(async () => [59.33, 18.07] as const), wgs84ToSweref99: vi.fn(), close: vi.fn(async () => undefined) } as never,
    });
    expect(result).toMatchObject({
      ok: false, status: 503, code: 'LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED',
      failureClass: 'CURRENTNESS_STORAGE_INTEGRITY_FAULT', retryable: false,
    });
    expect(state.provisioningCalls).toBe(0);

    state.routeRepository = repo;
    const app = express();
    app.use(express.json());
    app.use(localizationRoutes);
    const token = createTokenPair({ id: USER.id, organisationId: USER.organisationId, bankidId: USER.bankidId, role: 'ADMIN' }).accessToken;
    const res = await request(app).get(`/api/localization/${PROJECT_ID}/geometry`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false, failureClass: 'CURRENTNESS_STORAGE_INTEGRITY_FAULT', retryable: false });
    expect(res.body.error).toMatch(/bestående lagringsfel/);

    const error = await resolutionError(repo, {});
    expect(failedClosedGeometryProvenanceRecord(error)).toMatchObject({
      status: 'FAILED_CLOSED', failure_class: 'CURRENTNESS_STORAGE_INTEGRITY_FAULT', retryable: false,
    });
  });
});

describe('(2) consistency: a SUPERSEDED point lost to a storage fault is skipped like corrupted bytes -- only under a verified edge', () => {
  it.each([
    ['CAS object gone', objectMissing],
    ['index entry torn (MALFORMED)', indexTorn],
    ['bytes corrupted (CASIntegrityError, frozen rule, control)', (_id: string) => new CASIntegrityError('Storage Read Corruption')],
  ] as const)('predecessor A: %s under a VERIFIED A -> B edge -> B is CURRENT', async (_label, fault) => {
    const { repo, a, b } = await movedPoint();
    repo.faults.set(a.artifact_id, fault(a.artifact_id));
    const resolved = await derive(repo);
    expect(resolved.geometry.artifact_id).toBe(b.artifact_id);
    expect(resolved.wasDerived).toBe(false);
  });

  it('A\'s CAS object gone and the A -> B edge NOT verifiable (its index entry lost) -> A is not proven superseded -> storage fault, fail closed', async () => {
    const { repo, a, edge } = await movedPoint();
    repo.faults.set(a.artifact_id, objectMissing(a.artifact_id));
    repo.values.delete(edge.artifact_id);
    expectStorageIntegrityFault(await resolutionError(repo, {}), 'MIMERS_ARTIFACT_OBJECT_MISSING', a.artifact_id);
  });

  it('control: a transient read error (IO) on the superseded A still fails closed as retryable (its state is unknown, unchanged)', async () => {
    const { repo, a } = await movedPoint();
    repo.faults.set(a.artifact_id, indexBusy(a.artifact_id));
    const error = await resolutionError(repo, {});
    expect({ failureClass: error.failureClass, retryable: error.retryable }).toEqual({ failureClass: 'CURRENTNESS_RESOLUTION_ERROR', retryable: true });
  });
});

describe('(4) a forged issuer that is the project\'s ONLY issuer: VERIFIER_CONFIGURATION text names both causes', () => {
  it('-> 503 VERIFIER_CONFIGURATION, not retryable; the text says configuration error OR untrusted (forged) issuer, and no longer "not a fault in the project"', async () => {
    const repo = new CasRepository();
    const a = userGeometry(6580743.0);
    const b = userGeometry(6580843.0);
    await storeAndProject(repo, a);
    await storeAndProject(repo, b);
    await supersede(repo, a, b, '2026-10-02T00:00:00.000Z', attackerKey);
    configureVerifier(KEY_ID, genuineKey.publicKey);
    const error = await resolutionError(repo, { [a.artifact_id]: 'A', [b.artifact_id]: 'B' });
    expect({ failureClass: error.failureClass, httpStatus: error.httpStatus, retryable: error.retryable }).toEqual({
      failureClass: 'VERIFIER_CONFIGURATION', httpStatus: 503, retryable: false,
    });
    expect(error.userMessage).toMatch(/konfigurationsfel/);
    expect(error.userMessage).toMatch(/utfärdaren av lokaliseringsbytena inte betrodd/);
    expect(error.userMessage).toMatch(/förfalskad utfärdare/);
    expect(error.userMessage).toMatch(/kontakta systemets administratör/);
    expect(error.userMessage).not.toMatch(/inte ett fel i projektet/);
    expect(error.userMessage).toMatch(/Ingen bedömning görs/);
  });
});
