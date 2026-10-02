/**
 * OD-R3 (owner decision 2026-10-02: fix): a configuration error in the localization-geometry
 * supersession verifier key is not a geometry conflict. Before this unit a valid-but-wrong key (other
 * key material under the same key id, or another key id) and a valid PEM of the wrong key type (RSA)
 * made every edge fail verification, the edges were excluded and the project read as AMBIGUOUS 409
 * ("flera möjliga aktuella lokaliseringspunkter"); an unparsable PEM read as
 * CURRENTNESS_RESOLUTION_ERROR. All of them are now VERIFIER_CONFIGURATION: technical (503, kind
 * ERROR), fail-closed, NOT retryable (retrying cannot fix a configuration), with a Swedish text that
 * says it is a configuration error -- on the error, the service result and the HTTP route.
 *
 * Genuine ambiguity keeps its 409: two roots without an edge, a fork of verified edges, a forged edge
 * under the genuine issuer, and a forged issuer next to a genuine one (the configured key verifies at
 * least one issuer of the project, so the key is proven right).
 *
 * Hermetic: both projection repositories and server/db/prisma are mocked (the prisma guard throws and
 * records on any access); CAS is an in-memory repository with the real "Artifact not found" contract.
 */
import { generateKeyPairSync } from 'node:crypto';
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
    propertyContextRef: { artifact_id: 'property-ctx-od-r3', artifact_type: 'LU_PROPERTY_CONTEXT' },
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
import {
  __resetLocalizationGeometrySupersessionVerifierForTests,
  getLocalizationGeometrySupersessionVerifier,
} from '../../server/security/localizationGeometrySupersessionVerifier';
import { createTokenPair } from '../../server/security/auth';
import localizationRoutes from '../../server/routes/localization.routes';
import type { AuthUser } from '../../server/security/types';

const PROJECT_ID = 'project-od-r3';
const PROPERTY_REF = { artifact_id: 'property-ctx-od-r3', artifact_type: 'LU_PROPERTY_CONTEXT' } as const;
const USER: AuthUser = { id: 'user-od-r3', organisationId: 'org-od-r3', bankidId: 'bankid:od-r3', role: 'ADMIN' };
const KEY_ID = 'ed25519:geometry-supersession-issuer-od-r3';
const genuineKey = LocalPemSigningKeyProvider.generate(KEY_ID);
const otherKeySameId = LocalPemSigningKeyProvider.generate(KEY_ID);
const attackerKey = LocalPemSigningKeyProvider.generate('ed25519:attacker-od-r3');
const rsaPublicKeyPem = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }).toString();

class CasRepository {
  readonly values = new Map<string, unknown>();
  putCalls = 0;
  async put(artifact: { artifact_id: string; body: unknown }): Promise<void> {
    this.putCalls += 1;
    this.values.set(artifact.artifact_id, artifact.body);
  }
  async resolve<T>(reference: { artifact_id: string }): Promise<T> {
    if (!this.values.has(reference.artifact_id)) throw new Error(`Artifact not found: ${reference.artifact_id}`);
    return this.values.get(reference.artifact_id) as T;
  }
}

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

/** A signed predecessor -> successor edge under the issuer of `signer` (genuine unless told otherwise). */
async function supersede(
  repo: CasRepository,
  predecessor: LocalizationGeometryArtifact,
  successor: LocalizationGeometryArtifact,
  signer: ReturnType<typeof LocalPemSigningKeyProvider.generate> = genuineKey,
  issuedAt = '2026-10-02T00:00:00.000Z',
) {
  const bareIssuer = createLocalizationGeometrySupersessionIssuerArtifact({
    issuer_key_id: signer.provider.keyId,
    owner_authority_ref: { artifact_id: 'owner-authority-od-r3', artifact_type: 'owner_authority_attestation' },
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
  return edge;
}

function configureVerifier(keyId: string | undefined, publicKeyPem: string | undefined) {
  if (keyId === undefined) delete process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_KEY_ID;
  else process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_KEY_ID = keyId;
  if (publicKeyPem === undefined) delete process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM;
  else process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM = publicKeyPem;
  __resetLocalizationGeometrySupersessionVerifierForTests(null);
}

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

async function failure(repo: CasRepository): Promise<LocalizationGeometryCurrentnessError> {
  const error = await derive(repo).then(
    (resolved) => {
      throw new Error(`expected fail closed, but currentness resolved ${resolved.geometry.artifact_id} (wasDerived=${resolved.wasDerived})`);
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(LocalizationGeometryCurrentnessError);
  return error as LocalizationGeometryCurrentnessError;
}

function expectVerifierConfiguration(error: LocalizationGeometryCurrentnessError, repo: CasRepository, putsBefore: number) {
  expect({ failureClass: error.failureClass, httpStatus: error.httpStatus, kind: error.kind, retryable: error.retryable }).toEqual({
    failureClass: 'VERIFIER_CONFIGURATION', httpStatus: 503, kind: 'ERROR', retryable: false,
  });
  expect(error.reasonCode).toBe('LOCALIZATION_GEOMETRY_VERIFIER_CONFIGURATION');
  expect(error.userMessage).toMatch(/konfigurationsfel/);
  expect(error.userMessage).toMatch(/Ingen bedömning görs/);
  expect(error.userMessage).not.toMatch(/flera möjliga aktuella lokaliseringspunkter/);
  expect(repo.putCalls).toBe(putsBefore);
  expect(state.registerCalls).toBe(0);
}

beforeEach(() => {
  state.geometryRows.length = 0;
  state.supersessionRows.length = 0;
  state.registerCalls = 0;
  state.provisioningCalls = 0;
  state.routeRepository = null;
  configureVerifier(undefined, undefined);
});

afterEach(() => {
  expect(hermeticPrismaTouches).toEqual([]);
});

describe('OD-R3: a wrong or broken verifier key is VERIFIER_CONFIGURATION (503, not retryable), never AMBIGUOUS 409', () => {
  it('control: the genuine key -> B is CURRENT', async () => {
    const { repo, b } = await movedPoint();
    configureVerifier(KEY_ID, genuineKey.publicKey);
    expect((await derive(repo)).geometry.artifact_id).toBe(b.artifact_id);
  });

  it('a valid Ed25519 key with OTHER key material under the same key id -> VERIFIER_CONFIGURATION', async () => {
    const { repo } = await movedPoint();
    configureVerifier(KEY_ID, otherKeySameId.publicKey);
    const putsBefore = repo.putCalls;
    expectVerifierConfiguration(await failure(repo), repo, putsBefore);
  });

  it('a valid Ed25519 key under ANOTHER key id -> VERIFIER_CONFIGURATION', async () => {
    const { repo } = await movedPoint();
    configureVerifier('ed25519:some-other-issuer', otherKeySameId.publicKey);
    const putsBefore = repo.putCalls;
    expectVerifierConfiguration(await failure(repo), repo, putsBefore);
  });

  it('a valid PEM of the wrong key type (RSA) -> VERIFIER_CONFIGURATION', async () => {
    const { repo } = await movedPoint();
    configureVerifier(KEY_ID, rsaPublicKeyPem);
    const putsBefore = repo.putCalls;
    expectVerifierConfiguration(await failure(repo), repo, putsBefore);
  });

  it('an unparsable PEM -> VERIFIER_CONFIGURATION (not CURRENTNESS_RESOLUTION_ERROR)', async () => {
    const { repo } = await movedPoint();
    configureVerifier(KEY_ID, '-----BEGIN PUBLIC KEY-----\nbm90IGEga2V5\n-----END PUBLIC KEY-----');
    const putsBefore = repo.putCalls;
    expectVerifierConfiguration(await failure(repo), repo, putsBefore);
  });

  it('a missing key -> VERIFIER_CONFIGURATION (unchanged class, now with the not-retryable flag)', async () => {
    const { repo } = await movedPoint();
    const putsBefore = repo.putCalls;
    expectVerifierConfiguration(await failure(repo), repo, putsBefore);
  });

  it('the verifier itself refuses an unparsable or non-Ed25519 PEM at load, and never echoes the PEM', () => {
    const garbage = '-----BEGIN PUBLIC KEY-----\nbm90IGEga2V5\n-----END PUBLIC KEY-----';
    expect(() => getLocalizationGeometrySupersessionVerifier({
      LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_KEY_ID: KEY_ID, LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM: garbage,
    } as NodeJS.ProcessEnv)).toThrow(/^REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_CONFIGURATION: /);
    let message = '';
    try {
      getLocalizationGeometrySupersessionVerifier({
        LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_KEY_ID: KEY_ID, LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM: rsaPublicKeyPem,
      } as NodeJS.ProcessEnv);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/^REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_CONFIGURATION: .*rsa/);
    expect(message).not.toContain('BEGIN PUBLIC KEY');
    expect(message).not.toContain(garbage);
    // a refused configuration is not cached: the next call with the genuine key succeeds
    const ok = getLocalizationGeometrySupersessionVerifier({
      LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_KEY_ID: KEY_ID, LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM: genuineKey.publicKey,
    } as NodeJS.ProcessEnv);
    expect(ok.keyId).toBe(KEY_ID);
  });

  it('service + HTTP route: GET geometry with a wrong key -> 503, failureClass VERIFIER_CONFIGURATION, Swedish text, retryable:false; no provisioning', async () => {
    const { repo } = await movedPoint();
    configureVerifier(KEY_ID, otherKeySameId.publicKey);
    const result = await getCurrentLocalizationGeometryForProject({
      authUser: USER, projectId: PROJECT_ID, artifactRepository: repo as never,
      spatialRuntime: { sweref99ToWgs84: vi.fn(async () => [59.33, 18.07] as const), wgs84ToSweref99: vi.fn(), close: vi.fn(async () => undefined) } as never,
    });
    expect(result).toMatchObject({
      ok: false, status: 503, code: 'LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED',
      failureClass: 'VERIFIER_CONFIGURATION', reasonCode: 'LOCALIZATION_GEOMETRY_VERIFIER_CONFIGURATION', retryable: false,
    });

    state.routeRepository = repo;
    const app = express();
    app.use(express.json());
    app.use(localizationRoutes);
    const token = createTokenPair({ id: USER.id, organisationId: USER.organisationId, bankidId: USER.bankidId, role: 'ADMIN' }).accessToken;
    const res = await request(app).get(`/api/localization/${PROJECT_ID}/geometry`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      ok: false, code: 'LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED',
      failureClass: 'VERIFIER_CONFIGURATION', reasonCode: 'LOCALIZATION_GEOMETRY_VERIFIER_CONFIGURATION', retryable: false,
    });
    expect(res.body.error).toMatch(/konfigurationsfel/);
    expect(res.body.geometry).toBeUndefined();
    expect(state.provisioningCalls).toBe(0);
  });

  it('a technical CAS failure stays retryable on the wire (CURRENTNESS_RESOLUTION_ERROR, retryable:true)', async () => {
    const { repo, b } = await movedPoint();
    configureVerifier(KEY_ID, genuineKey.publicKey);
    const original = repo.resolve.bind(repo);
    repo.resolve = (async (reference: { artifact_id: string }) => {
      if (reference.artifact_id === b.artifact_id) throw Object.assign(new Error('EIO: i/o error, read'), { code: 'EIO' });
      return original(reference);
    }) as typeof repo.resolve;
    const result = await getCurrentLocalizationGeometryForProject({
      authUser: USER, projectId: PROJECT_ID, artifactRepository: repo as never,
      spatialRuntime: { sweref99ToWgs84: vi.fn(async () => [59.33, 18.07] as const), wgs84ToSweref99: vi.fn(), close: vi.fn(async () => undefined) } as never,
    });
    expect(result).toMatchObject({ ok: false, status: 503, failureClass: 'CURRENTNESS_RESOLUTION_ERROR', retryable: true });
  });
});

describe('OD-R3 keeps genuine ambiguity at 409 (the configured key verifies at least one issuer)', () => {
  async function ambiguous(repo: CasRepository) {
    const error = await failure(repo);
    expect({ failureClass: error.failureClass, httpStatus: error.httpStatus, kind: error.kind, retryable: error.retryable }).toEqual({
      failureClass: 'AMBIGUOUS_CURRENT_GEOMETRY', httpStatus: 409, kind: 'REFUSED', retryable: false,
    });
  }

  it('two roots without an edge -> AMBIGUOUS 409 (no key needed at all)', async () => {
    const repo = new CasRepository();
    await storeAndProject(repo, userGeometry(6580743.0));
    await storeAndProject(repo, userGeometry(6580843.0));
    await ambiguous(repo);
  });

  it('a fork of two verified edges A -> B and A -> C -> AMBIGUOUS 409', async () => {
    const { repo, a } = await movedPoint();
    const c = userGeometry(6580943.0);
    await storeAndProject(repo, c);
    await supersede(repo, a, c, genuineKey, '2026-10-02T00:00:01.000Z');
    configureVerifier(KEY_ID, genuineKey.publicKey);
    await ambiguous(repo);
  });

  it('a forged edge under the GENUINE issuer (edge signature does not verify) -> AMBIGUOUS 409', async () => {
    const { repo, edge } = await movedPoint();
    repo.values.set(edge.artifact_id, { ...edge, attestation: { ...edge.attestation!, signature: `ed25519:${Buffer.alloc(64).toString('base64')}` } });
    configureVerifier(KEY_ID, genuineKey.publicKey);
    await ambiguous(repo);
  });

  it('a forged issuer (attacker key) next to a genuine edge -> the forged edge is excluded, B and C are heads -> AMBIGUOUS 409', async () => {
    const { repo, a } = await movedPoint();
    const c = userGeometry(6580943.0);
    await storeAndProject(repo, c);
    await supersede(repo, a, c, attackerKey, '2026-10-02T00:00:01.000Z');
    configureVerifier(KEY_ID, genuineKey.publicKey);
    await ambiguous(repo);
  });
});
