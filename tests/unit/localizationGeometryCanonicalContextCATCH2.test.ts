// @vitest-environment node
/**
 * W-CATCH2 #8 (owner decisions 2026-10-02/03, OD-R2; BOOT verifier: truth-critical before U51):
 * getCurrentLocalizationGeometryForProject / saveUserLocalizationGeometry turned EVERY failure of
 * resolveCanonicalProjectContext into 404 "No canonical project context available: <raw text>" -- a
 * read error read as absence, and the raw storage text (ids, paths, codes) sent to the client.
 *
 * Now, on a REAL FileCAS stack (mkdtemp, cold per read):
 *  - genuine absence (the binding index lists nothing for the project) -> 404 with a NEUTRAL text and
 *    the same message prefix the UI already recognises;
 *  - a read error -> 503 PROJECT_CONTEXT_UNRESOLVED, failureClass READ_ERROR, retryable true;
 *  - a lasting storage/integrity fault or an inconsistent index -> 503, retryable false;
 *  - a binding refused at verification -> 409, retryable false;
 *  - never raw text, never a derived point, never a CAS write, never a provisioning request.
 * Normal flows are unchanged.
 *
 * Replaced (hermetic): server/db/prisma (hermetic guard), the project-access check (allow), the Prisma
 * binding / geometry / supersession indexes (in memory, same contracts), the provisioning queues, the
 * PostGIS spatial runtime (an affine stand-in). Never a real CAS root.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  bindingRows: [] as Array<{ projectId: string; bindingArtifactId: string; contextId: string; contextType: string }>,
  supersessionRows: [] as Array<{ projectId: string; artifactId: string }>,
  listError: null as Error | null,
  geometryRows: [] as Array<{ projectId: string; geometryArtifactId: string; propertyContextRefId: string; propertyContextRefType: string; createdAt: Date }>,
  provisioningRequests: [] as Array<{ projectId: string; geometryArtifactId: string }>,
  accessError: null as Error | null,
}));

vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());
vi.mock('../../server/security/projectAccess', () => ({
  assertProjectAccess: vi.fn(async () => {
    if (state.accessError) throw state.accessError;
  }),
}));
vi.mock('../../server/modules/localization/createLocalizationSpatialRuntime', () => ({
  createLocalizationSpatialRuntime: vi.fn(async () => {
    throw new Error('the real spatial runtime is never created in this test');
  }),
}));
vi.mock('../../server/repositories/projectContextBindingRepository', () => ({
  PrismaProjectContextBindingIndex: class {
    async register(binding: { artifact_id: string; payload: { project_id: string; project_context_ref: { artifact_id: string; artifact_type: string } } }) {
      const p = binding.payload;
      if (!state.bindingRows.some((r) => r.projectId === p.project_id && r.bindingArtifactId === binding.artifact_id)) {
        state.bindingRows.push({ projectId: p.project_id, bindingArtifactId: binding.artifact_id, contextId: p.project_context_ref.artifact_id, contextType: p.project_context_ref.artifact_type });
      }
    }
    async registerSupersession() {}
    async resolve(projectId: string, ref: { artifact_id: string; artifact_type: string }) {
      const rows = state.bindingRows.filter((r) => r.projectId === projectId && r.contextId === ref.artifact_id && r.contextType === ref.artifact_type);
      if (rows.length !== 1) throw new Error('REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE');
      return rows[0]!.bindingArtifactId;
    }
    async listBindingRefs(projectId: string) {
      if (state.listError) throw state.listError;
      return state.bindingRows.filter((r) => r.projectId === projectId).map((r) => ({ artifact_id: r.bindingArtifactId, artifact_type: 'project_context_binding' }));
    }
    async listSupersessionRefs(projectId: string) {
      if (state.listError) throw state.listError;
      return state.supersessionRows.filter((r) => r.projectId === projectId).map((r) => ({ artifact_id: r.artifactId, artifact_type: 'project_context_binding_supersession' }));
    }
  },
}));
vi.mock('../../server/repositories/localizationGeometryProjectionRepository', () => ({
  PrismaLocalizationGeometryProjectionIndex: class {
    async register(row: { projectId: string; geometryArtifactId: string; propertyContextRef: { artifact_id: string; artifact_type: string } }) {
      if (state.geometryRows.some((r) => r.projectId === row.projectId && r.geometryArtifactId === row.geometryArtifactId)) return;
      state.geometryRows.push({
        projectId: row.projectId,
        geometryArtifactId: row.geometryArtifactId,
        propertyContextRefId: row.propertyContextRef.artifact_id,
        propertyContextRefType: row.propertyContextRef.artifact_type,
        createdAt: new Date(Date.UTC(2026, 9, 2) + state.geometryRows.length),
      });
    }
    async listForProject(projectId: string) {
      return state.geometryRows.filter((r) => r.projectId === projectId).map((r) => ({ ...r }));
    }
  },
}));
vi.mock('../../server/repositories/localizationGeometrySupersessionRepository', () => ({
  PrismaLocalizationGeometrySupersessionIndex: class {
    async register() {}
    async listForProject() {
      return [];
    }
  },
}));
vi.mock('../../server/modules/localization/localizationIdentityProvisioningQueue', () => {
  const record = (input: { projectId: string; geometryArtifactId: string }) => {
    state.provisioningRequests.push({ projectId: input.projectId, geometryArtifactId: input.geometryArtifactId });
    return { status: 'PENDING', failureDetail: null };
  };
  return {
    ensureLocalizationIdentityProvisioningRequested: vi.fn(async (input: { projectId: string; geometryArtifactId: string }) => record(input)),
    enqueueLocalizationIdentityProvisioningRequest: vi.fn(async (input: { projectId: string; geometryArtifactId: string }) => record(input)),
  };
});
vi.mock('../../server/modules/localization/localizationGeometrySupersessionQueue', () => ({
  ensureLocalizationGeometrySupersessionRequested: vi.fn(async () => {
    throw new Error('no supersession request in this test');
  }),
}));

import { FileCASRepository, LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import {
  createCanonicalPropertyGeometryArtifact,
  createProductLuProjectContextArtifact,
  createProductLuPropertyContextArtifact,
  createProjectContextBindingArtifactV2,
  createProjectContextBindingIssuerArtifact,
  createProjectPropertyBindingArtifact,
  createPropertyLookupObservationArtifact,
} from '@miljobeslut/mps-lu';
import { MimersByteStorageBackend } from '../../packages/mps-runtime/src/repository/MimersByteStorageBackend';
import { CasBackedArtifactRepository } from '../../packages/mps-runtime/src/repository/CasBackedArtifactRepository';
import { hermeticPrismaTouches } from '../helpers/hermeticPrismaGuard';
import { attestProjectContextBindingArtifact, installVerifiedProductLuContext } from '../../server/modules/localization/projectContextBindingAuthority';
import { PrismaProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';
import {
  getCurrentLocalizationGeometryForProject,
  retryLocalizationIdentityProvisioning,
  saveUserLocalizationGeometry,
} from '../../server/modules/localization/localizationGeometryService';
import type { LocalizationSpatialRuntime } from '../../server/modules/localization/createLocalizationSpatialRuntime';
import type { AuthUser } from '../../server/security/types';

const PROJECT_ID = 'project-w-catch2-geometry-context';
const USER: AuthUser = { id: 'user-catch2', organisationId: 'org-catch2', bankidId: 'bankid-catch2', role: 'CONSULTANT' } as AuthUser;
const CENTROID: readonly [number, number] = [6580000, 674000];

/** An Ed25519 key derived from a fixed seed: signatures (and so every artifact byte) are reproducible. */
function fixedEd25519(keyId: string) {
  const seed = createHash('sha256').update(`w-catch2-geometry:${keyId}`).digest();
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  return { keyId, privateKeyPem, publicKeyPem, provider: new LocalPemSigningKeyProvider(keyId, privateKeyPem, publicKeyPem) };
}
const issuerKey = fixedEd25519('ed25519:pcb-issuer-w-catch2-geometry');

let root: string;
let casDir: string;
let indexDir: string;
const puts: string[] = [];

/** A cold production storage stack on the temp CAS; every write through it is recorded. */
function repository() {
  const inner = new CasBackedArtifactRepository(new MimersByteStorageBackend(new FileCASRepository(casDir, { durabilityMode: 'none' }), indexDir));
  return {
    resolve: (ref: { artifact_id: string; artifact_type: string }) => inner.resolve(ref),
    put: (artifact: { artifact_id: string }) => {
      puts.push(artifact.artifact_id);
      return inner.put(artifact as never);
    },
  } as never;
}
function indexEntryPath(artifactId: string): string {
  return path.join(indexDir, `${createHash('sha256').update(artifactId).digest('hex')}.idx`);
}
function objectPath(artifactId: string): string {
  return new FileCASRepository(casDir).getFilePath((JSON.parse(readFileSync(indexEntryPath(artifactId), 'utf8')) as { hash: string }).hash);
}

const spatialRuntime: LocalizationSpatialRuntime = {
  artifactRepository: null as never,
  resolveSpatialProvider: () => ({ query: vi.fn() }) as never,
  wgs84ToSweref99: async (lat: number, lng: number) => [Math.round((lat + 1000) * 100000), Math.round((lng + 1000) * 100000)] as const,
  sweref99ToWgs84: async (n: number, e: number) => [n / 100000 - 1000, e / 100000 - 1000] as const,
  close: async () => undefined,
} as LocalizationSpatialRuntime;

/** Installs the project's full canonical context through the real installer; returns the artifact ids. */
async function provisionProject(): Promise<{ bindingId: string; issuerId: string; propertyContextId: string }> {
  const issuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: issuerKey.keyId, issuer_version: 'project-context-binding-issuer-v2' });
  const geometry = createCanonicalPropertyGeometryArtifact({ geometry: { type: 'Polygon', coordinates: [[[14, 61], [14.1, 61], [14, 61.1], [14, 61]]] } });
  const observation = createPropertyLookupObservationArtifact({
    property_identity: `property:test:${PROJECT_ID}`,
    property_designation: 'CATCH2 1:1',
    source_key: PROJECT_ID,
    source_dataset: 'test-source',
    source_updated_at: '2026-10-01T00:00:00.000Z',
    municipality: 'TESTKOMMUN',
    geometry_ref: { artifact_id: geometry.artifact_id, artifact_type: geometry.artifact_type },
  });
  const propertyBindingUnsigned = createProjectPropertyBindingArtifact({
    project_id: PROJECT_ID,
    property_identity: observation.payload.property_identity,
    property_designation: 'CATCH2 1:1',
    geometry_ref: { artifact_id: geometry.artifact_id, artifact_type: geometry.artifact_type },
    source_refs: [{ artifact_id: observation.artifact_id, artifact_type: observation.artifact_type }],
    resolver_id: 'test-resolver',
    resolver_version: 'v1',
    contract_version: 'project-property-binding-v1',
  });
  const propertyBinding = { ...propertyBindingUnsigned, attestation: await attestProjectContextBindingArtifact({ artifact: propertyBindingUnsigned, issuer, signing: issuerKey.provider }) };
  const propertyBindingRef = { artifact_id: propertyBinding.artifact_id, artifact_type: propertyBinding.artifact_type };
  const propertyContext = createProductLuPropertyContextArtifact({
    property_identity: observation.payload.property_identity,
    property_ref: 'CATCH2 1:1',
    official_name: 'CATCH2 1:1',
    geometry_ref: { artifact_id: geometry.artifact_id, artifact_type: geometry.artifact_type },
    municipality: 'TESTKOMMUN',
    coordinates: CENTROID,
    project_property_binding_ref: propertyBindingRef,
  });
  const projectContext = createProductLuProjectContextArtifact({
    project_id: PROJECT_ID,
    project_name: 'CATCH2',
    description: 'W-CATCH2 #8 proof',
    created_by: 'test-owner',
    property_context_ref: { artifact_id: propertyContext.artifact_id, artifact_type: propertyContext.artifact_type },
    project_property_binding_ref: propertyBindingRef,
  });
  const contextBindingUnsigned = createProjectContextBindingArtifactV2({
    project_id: PROJECT_ID,
    project_context_ref: { artifact_id: projectContext.artifact_id, artifact_type: projectContext.artifact_type },
    project_property_binding_ref: propertyBindingRef,
    binding_version: 'project-context-binding-v2',
    authority_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
  });
  const contextBinding = { ...contextBindingUnsigned, attestation: await attestProjectContextBindingArtifact({ artifact: contextBindingUnsigned, issuer, signing: issuerKey.provider }) };
  await installVerifiedProductLuContext({
    artifactRepository: repository(),
    index: new PrismaProjectContextBindingIndex(),
    issuer,
    verification: new LocalPemVerificationKeyProvider(issuerKey.keyId, issuerKey.publicKeyPem),
    geometryArtifact: geometry,
    propertyObservation: observation,
    propertyBinding,
    propertyContext,
    projectContext,
    contextBinding,
  });
  puts.length = 0;
  return { bindingId: contextBinding.artifact_id, issuerId: issuer.artifact_id, propertyContextId: propertyContext.artifact_id };
}

const load = () => getCurrentLocalizationGeometryForProject({ authUser: USER, projectId: PROJECT_ID, artifactRepository: repository(), spatialRuntime });
const save = () =>
  saveUserLocalizationGeometry({
    authUser: USER,
    projectId: PROJECT_ID,
    input: { geometry_type: 'POINT', coordinates: [18.07, 59.33], srid: 4326 },
    artifactRepository: repository(),
    spatialRuntime,
  });

/** No raw storage text, id, path or token in what the client is sent. */
function expectNoRawText(text: string): void {
  expect(text).not.toMatch(/REJECT_|MIMERS_|Artifact not found|WORM|EIO|ECONNREFUSED|EISDIR|project-context-binding-|\.idx|[A-Za-z]:[\\/]|\/tmp\//);
}

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'wcatch2-geometry-context-'));
  casDir = path.join(root, 'cas');
  indexDir = path.join(root, 'index');
  mkdirSync(casDir, { recursive: true });
  mkdirSync(indexDir, { recursive: true });
  await new FileCASRepository(casDir, { durabilityMode: 'none' }).initialize();
  state.bindingRows.length = 0;
  state.supersessionRows.length = 0;
  state.listError = null;
  state.geometryRows.length = 0;
  state.provisioningRequests.length = 0;
  state.accessError = null;
  puts.length = 0;
  process.env.PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID = issuerKey.keyId;
  process.env.PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM = issuerKey.publicKeyPem;
});
afterEach(() => {
  delete process.env.PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID;
  delete process.env.PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM;
  rmSync(root, { recursive: true, force: true });
});

describe('W-CATCH2 #8: normal flows are unchanged', () => {
  it('a project with a healthy canonical context: GET derives and registers the centroid point, then reads it back', async () => {
    await provisionProject();
    const first = await load();
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.provenance).toBe('derived_from_property_boundary');
    expect(puts).toEqual([first.data.artifact_id]);
    const again = await load();
    expect(again).toEqual(first);
    expect(state.provisioningRequests).toHaveLength(2);
    expect(hermeticPrismaTouches).toEqual([]);
  });

  it('a project with a healthy canonical context: POST saves the user point', async () => {
    await provisionProject();
    const saved = await save();
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.data.provenance).toBe('user_defined');
  });
});

describe('W-CATCH2 #8: genuine absence stays 404, with a NEUTRAL text', () => {
  for (const [name, call] of [['GET', load], ['POST', save]] as const) {
    it(`${name}: the binding index lists nothing for the project -> 404, neutral text, no code, nothing derived or written`, async () => {
      const result = await call();
      expect(result).toEqual({
        ok: false,
        status: 404,
        error: 'No canonical project context available: the project has no registered project-context binding yet.',
      });
      expect(puts).toEqual([]);
      expect(state.provisioningRequests).toEqual([]);
    });
  }
});

type Expected = { readonly status: 409 | 503; readonly failureClass: string; readonly retryable: boolean };
const READ: Expected = { status: 503, failureClass: 'READ_ERROR', retryable: true };
const STORAGE: Expected = { status: 503, failureClass: 'STORAGE_INTEGRITY_FAULT', retryable: false };
const MISSING: Expected = { status: 503, failureClass: 'MISSING_FROM_CAS', retryable: false };
const INCONSISTENT: Expected = { status: 503, failureClass: 'BINDING_INDEX_INCONSISTENT', retryable: false };
const REFUSED: Expected = { status: 409, failureClass: 'REFUSED', retryable: false };

const FAULTS: Array<[string, (ids: { bindingId: string; issuerId: string; propertyContextId: string }) => void | Promise<void>, Expected]> = [
  ['the binding index cannot be read (database down)', () => { state.listError = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }); }, READ],
  ['the binding object is gone behind its index entry', ({ bindingId }) => unlinkSync(objectPath(bindingId)), STORAGE],
  ['the binding index entry is torn', ({ bindingId }) => writeFileSync(indexEntryPath(bindingId), '{"artifact_id":"'), STORAGE],
  ['the binding index entry cannot be read (EISDIR)', ({ bindingId }) => { unlinkSync(indexEntryPath(bindingId)); mkdirSync(indexEntryPath(bindingId)); }, READ],
  ['the binding the index lists was never stored in the CAS', ({ bindingId }) => unlinkSync(indexEntryPath(bindingId)), MISSING],
  ['the binding bytes are corrupted', ({ bindingId }) => writeFileSync(objectPath(bindingId), Buffer.from('{"not":"what the hash says"}')), STORAGE],
  [
    'the binding content was edited after persistence (a valid CAS object)',
    async ({ bindingId }) => {
      const envelope = JSON.parse(readFileSync(objectPath(bindingId), 'utf8')) as { body: { payload: Record<string, unknown> } };
      envelope.body.payload = { ...envelope.body.payload, project_context_ref: { artifact_id: 'edited-after-persistence', artifact_type: 'LU_PROJECT_CONTEXT' } };
      const cas = new FileCASRepository(casDir, { durabilityMode: 'none' });
      await cas.initialize();
      const { hash } = await cas.putBytes(Buffer.from(JSON.stringify(envelope), 'utf8'));
      writeFileSync(indexEntryPath(bindingId), JSON.stringify({ artifact_id: bindingId, hash }));
    },
    REFUSED,
  ],
  ["the binding's issuer is gone behind its index entry", ({ issuerId }) => unlinkSync(objectPath(issuerId)), STORAGE],
  ["the property context the binding names is gone behind its index entry", ({ propertyContextId }) => unlinkSync(objectPath(propertyContextId)), STORAGE],
  ['the index lists a supersession relation but lost every binding row', () => { state.bindingRows.length = 0; state.supersessionRows.push({ projectId: PROJECT_ID, artifactId: 'pcb-supersession-lost' }); }, INCONSISTENT],
  ['the same binding row listed twice', () => { state.bindingRows.push({ ...state.bindingRows[0]! }); }, INCONSISTENT],
];

describe('W-CATCH2 #8: a context that cannot be read or verified is a typed fault, never 404 "missing", never raw text', () => {
  for (const [name, sabotage, expected] of FAULTS) {
    for (const [verb, call] of [['GET', load], ['POST', save]] as const) {
      it(`${verb}: ${name} -> ${expected.status} ${expected.failureClass} (retryable ${expected.retryable}); nothing derived, written or requested`, async () => {
        const ids = await provisionProject();
        await sabotage(ids);
        const result = await call();
        expect(result.ok).toBe(false);
        if (result.ok) return;
        const typed = result as typeof result & { code?: string; failureClass?: string; reasonCode?: string; retryable?: boolean };
        expect({ status: typed.status, code: typed.code, failureClass: typed.failureClass, retryable: typed.retryable }).toEqual({
          status: expected.status,
          code: 'PROJECT_CONTEXT_UNRESOLVED',
          failureClass: expected.failureClass,
          retryable: expected.retryable,
        });
        expect(typed.reasonCode).toMatch(/^[A-Z][A-Z0-9_]+$/);
        expect(typed.error.startsWith('Projektets koppling till fastigheten')).toBe(true);
        expect(typed.error).toContain(expected.retryable ? 'Ett nytt försök kan lyckas.' : 'Felet är bestående och löses inte av ett nytt försök.');
        expect(typed.error).not.toContain('No canonical project context available');
        expectNoRawText(typed.error);
        expect(puts).toEqual([]);
        expect(state.provisioningRequests).toEqual([]);
        expect(hermeticPrismaTouches).toEqual([]);
      });
    }
  }
});

describe('W-CATCH2 #14 (same surface): the geometry routes answer 403 only for the access check’s own typed denial', () => {
  const denial = () => Object.assign(new Error('User is not a member of this project'), { code: 'PROJECT_ACCESS_DENIED', name: 'ProjectAccessDeniedError' });
  const dbDown = () => Object.assign(new Error("Can't reach database server at 10.0.0.5:5432"), { name: 'PrismaClientInitializationError' });
  const retry = () => retryLocalizationIdentityProvisioning({ authUser: USER, projectId: PROJECT_ID });
  for (const [verb, call] of [['GET', load], ['POST', save], ['RETRY', retry]] as const) {
    it(`${verb}: a typed denial -> 403 (unchanged)`, async () => {
      state.accessError = denial();
      expect(await call()).toEqual({ ok: false, status: 403, error: 'Not authorized for this project.' });
    });
    it(`${verb}: the access facts cannot be read -> 503 PROJECT_ACCESS_UNRESOLVED (retryable), never 403; nothing read or written`, async () => {
      state.accessError = dbDown();
      const result = await call();
      expect(result).toEqual({
        ok: false,
        status: 503,
        error: expect.stringMatching(/^Behörigheten till projektet kunde inte läsas \(tekniskt fel\)\. Ett nytt försök kan lyckas\./),
        code: 'PROJECT_ACCESS_UNRESOLVED',
        failureClass: 'READ_ERROR',
        reasonCode: 'READ_ERROR',
        retryable: true,
      });
      expect(JSON.stringify(result)).not.toMatch(/10\.0\.0\.5|database server/);
      expect(puts).toEqual([]);
      expect(state.provisioningRequests).toEqual([]);
    });
  }
});
