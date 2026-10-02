// @vitest-environment node
/**
 * W-CATCH2 #11 (owner decisions 2026-10-02/03): the geometry-supersession provisioning worker read every
 * failure to read its issuer or an existing supersession as "not minted yet" and minted / re-issued over
 * it, and a supersession that failed verification likewise. Now only the PROVEN absence of exactly the
 * deterministic id mints; a read error is a typed retryable fault; a corrupt, lost or tampered EXISTING
 * object is a typed lasting fault -- no write, no silent re-issue, no untyped WORM/collision error. On
 * the same surface: the currentness gate (:185, untyped) is typed by M1a's own classification; the
 * pinned geometries, the access check and the outer catch keep their cause without raw text.
 *
 * REAL FileCAS stack (mkdtemp) behind a mocked MimersIntegration.create; in-memory projection indexes
 * as in luGeometrySupersessionProvisioningProofs.test.ts. Normal flows unchanged.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  casDir: '',
  indexDir: '',
  puts: [] as string[],
  geometryRows: [] as Array<{ projectId: string; geometryArtifactId: string; propertyContextRefId: string; propertyContextRefType: string; createdAt: Date }>,
  edgeRows: [] as Array<{ projectId: string; supersessionArtifactId: string; predecessorGeometryArtifactId: string; successorGeometryArtifactId: string; createdAt: Date }>,
  geometryListError: null as Error | null,
  accessError: null as Error | null,
  edgeRegisterError: null as Error | null,
}));

vi.mock('@miljobeslut/mps-runtime', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { FileCASRepository } = await import('@miljobeslut/mimers-brunn-core');
  const { MimersByteStorageBackend } = await import('../../packages/mps-runtime/src/repository/MimersByteStorageBackend');
  const { CasBackedArtifactRepository } = await import('../../packages/mps-runtime/src/repository/CasBackedArtifactRepository');
  return {
    ...actual,
    MimersIntegration: {
      create: async () => {
        const inner = new CasBackedArtifactRepository(new MimersByteStorageBackend(new FileCASRepository(h.casDir, { durabilityMode: 'none' }), h.indexDir));
        return {
          artifactRepository: {
            resolve: (ref: { artifact_id: string; artifact_type: string }) => inner.resolve(ref),
            put: (artifact: { artifact_id: string }) => {
              h.puts.push(artifact.artifact_id);
              return inner.put(artifact as never);
            },
          },
        };
      },
    },
  };
});
vi.mock('../../server/db/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(async () => ({ id: 'user-1', organisationId: 'org-1', bankidId: 'b-1', role: 'CONSULTANT', identityEnvironment: 'TEST' })) } },
}));
vi.mock('../../server/security/projectAccess', () => ({
  assertProjectAccess: vi.fn(async () => {
    if (h.accessError) throw h.accessError;
  }),
}));
vi.mock('../../server/repositories/localizationGeometryProjectionRepository', () => ({
  PrismaLocalizationGeometryProjectionIndex: class {
    async register(row: { projectId: string; geometryArtifactId: string; propertyContextRef: { artifact_id: string; artifact_type: string } }) {
      if (h.geometryRows.some((r) => r.projectId === row.projectId && r.geometryArtifactId === row.geometryArtifactId)) return;
      h.geometryRows.push({ projectId: row.projectId, geometryArtifactId: row.geometryArtifactId, propertyContextRefId: row.propertyContextRef.artifact_id, propertyContextRefType: row.propertyContextRef.artifact_type, createdAt: new Date(Date.UTC(2026, 9, 2) + h.geometryRows.length) });
    }
    async listForProject(projectId: string) {
      if (h.geometryListError) throw h.geometryListError;
      return h.geometryRows.filter((r) => r.projectId === projectId).map((r) => ({ ...r }));
    }
  },
}));
vi.mock('../../server/repositories/localizationGeometrySupersessionRepository', () => ({
  PrismaLocalizationGeometrySupersessionIndex: class {
    async register(row: { projectId: string; supersessionArtifactId: string; predecessorGeometryArtifactId: string; successorGeometryArtifactId: string }) {
      if (h.edgeRegisterError) throw h.edgeRegisterError;
      if (h.edgeRows.some((r) => r.projectId === row.projectId && r.supersessionArtifactId === row.supersessionArtifactId)) return;
      h.edgeRows.push({ ...row, createdAt: new Date(Date.UTC(2026, 9, 2) + h.edgeRows.length) });
    }
    async listForProject(projectId: string) {
      return h.edgeRows.filter((r) => r.projectId === projectId).map((r) => ({ ...r }));
    }
  },
}));

import { FileCASRepository, LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { createLocalizationGeometryArtifact, createLocalizationGeometrySupersessionIssuerArtifact } from '@miljobeslut/mps-lu';
import { MimersByteStorageBackend } from '../../packages/mps-runtime/src/repository/MimersByteStorageBackend';
import { CasBackedArtifactRepository } from '../../packages/mps-runtime/src/repository/CasBackedArtifactRepository';
import { executeGeometrySupersessionProvisioning } from '../../server/modules/localization/luGeometrySupersessionProvisioning';
import { attestLocalizationGeometrySupersessionIssuerArtifact } from '../../server/modules/localization/localizationGeometrySupersessionAuthority';
import { PrismaLocalizationGeometryProjectionIndex } from '../../server/repositories/localizationGeometryProjectionRepository';
import { __resetLocalizationGeometrySupersessionSigningProviderForTests } from '../../server/security/localizationGeometrySupersessionSigningKey';
import { __resetLocalizationGeometrySupersessionVerifierForTests } from '../../server/security/localizationGeometrySupersessionVerifier';

const PROJECT_ID = 'project-w-catch2-supersession';
const PROPERTY_CONTEXT_REF = { artifact_id: 'lu_property_context-catch2', artifact_type: 'LU_PROPERTY_CONTEXT' } as const;
const OWNER_AUTHORITY_REF = { artifact_id: 'owner-authority-automated-localization-geometry-supersession-provisioning-v1', artifact_type: 'owner_authority_attestation' } as const;

function fixedEd25519(keyId: string) {
  const seed = createHash('sha256').update(`w-catch2-supersession:${keyId}`).digest();
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  return { keyId, privateKeyPem, publicKeyPem, provider: new LocalPemSigningKeyProvider(keyId, privateKeyPem, publicKeyPem) };
}
const key = fixedEd25519('ed25519:geometry-supersession-issuer-catch2');
const issuerId = createLocalizationGeometrySupersessionIssuerArtifact({ issuer_key_id: key.keyId, owner_authority_ref: OWNER_AUTHORITY_REF }).artifact_id;

let root: string;
const repository = () => new CasBackedArtifactRepository(new MimersByteStorageBackend(new FileCASRepository(h.casDir, { durabilityMode: 'none' }), h.indexDir));
const indexEntryPath = (id: string) => path.join(h.indexDir, `${createHash('sha256').update(id).digest('hex')}.idx`);
const objectPath = (id: string) => new FileCASRepository(h.casDir).getFilePath((JSON.parse(readFileSync(indexEntryPath(id), 'utf8')) as { hash: string }).hash);

function geometry(label: string, lng: number) {
  return createLocalizationGeometryArtifact({
    project_id: PROJECT_ID,
    property_context_ref: PROPERTY_CONTEXT_REF,
    wgs84LngLat: [lng, 59.33],
    sweref99NorthingEasting: [6580000 + lng * 1000, 674000],
    provenance: 'user_defined',
    label,
    created_by: 'user-1',
  });
}
const A = geometry('A', 18.01);
const B = geometry('B', 18.02);
const C = geometry('C', 18.03);
const request = (pred: { artifact_id: string }, succ: { artifact_id: string }, createdAt = '2026-10-02T10:00:00.000Z') =>
  executeGeometrySupersessionProvisioning({
    requestId: `req-${pred.artifact_id}-${succ.artifact_id}`,
    requestCreatedAt: new Date(createdAt),
    projectId: PROJECT_ID,
    predecessorGeometryArtifactId: pred.artifact_id,
    successorGeometryArtifactId: succ.artifact_id,
    requestedByUserId: 'user-1',
  });

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'wcatch2-supersession-'));
  h.casDir = path.join(root, 'cas');
  h.indexDir = path.join(root, 'index');
  mkdirSync(h.casDir, { recursive: true });
  mkdirSync(h.indexDir, { recursive: true });
  await new FileCASRepository(h.casDir, { durabilityMode: 'none' }).initialize();
  h.puts.length = 0;
  h.geometryRows.length = 0;
  h.edgeRows.length = 0;
  h.geometryListError = null;
  h.accessError = null;
  h.edgeRegisterError = null;
  process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_KEY_ID = key.keyId;
  process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PRIVATE_KEY_PEM = key.privateKeyPem;
  process.env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM = key.publicKeyPem;
  __resetLocalizationGeometrySupersessionSigningProviderForTests(null);
  __resetLocalizationGeometrySupersessionVerifierForTests(null);
  for (const g of [A, B, C]) await repository().put({ artifact_id: g.artifact_id, content_hash: g.content_hash, body: g } as never);
  await new PrismaLocalizationGeometryProjectionIndex().register({ projectId: PROJECT_ID, geometryArtifactId: A.artifact_id, propertyContextRef: PROPERTY_CONTEXT_REF });
  h.puts.length = 0;
});
afterEach(() => {
  __resetLocalizationGeometrySupersessionSigningProviderForTests(null);
  __resetLocalizationGeometrySupersessionVerifierForTests(null);
  rmSync(root, { recursive: true, force: true });
});

const RAW = /[A-Za-z]:[\\/]|\.idx|MIMERS_|WORM|Collision|EIO|EISDIR|ECONNREFUSED|REJECT_|Artifact not found/;

async function transitionedOnce(): Promise<string> {
  const first = await request(A, B);
  expect(first).toEqual({ ok: true, supersessionArtifactId: expect.any(String), reused: false });
  h.puts.length = 0;
  return first.ok ? first.supersessionArtifactId : '';
}

type Expected = { readonly failureCode: string; readonly retryable: boolean };
function expectTypedNoWrite(outcome: unknown, expected: Expected): void {
  const o = outcome as { ok: boolean; superseded?: boolean; failureCode?: string; failureDetail?: string };
  expect({ ok: o.ok, superseded: o.superseded, failureCode: o.failureCode }).toEqual({ ok: false, superseded: false, failureCode: expected.failureCode });
  expect(o.failureDetail).toContain(expected.retryable ? 'Ett nytt försök kan lyckas.' : 'Felet är bestående och löses inte av ett nytt försök.');
  expect(o.failureDetail).not.toMatch(RAW);
  expect(h.puts, 'nothing minted or re-issued over the existing object').toEqual([]);
}

describe('W-CATCH2 #11: normal flows unchanged', () => {
  it('A -> B is minted, a retry of the same request reuses it, B -> C mints only the new relation', async () => {
    const ab = await transitionedOnce();
    expect(await request(A, B)).toEqual({ ok: true, supersessionArtifactId: ab, reused: true });
    expect(h.puts).toEqual([]);
    const bc = await request(B, C, '2026-10-02T11:00:00.000Z');
    expect(bc).toMatchObject({ ok: true, reused: false });
    expect(h.puts).not.toContain(issuerId);
  });
  it('a retry after a crash between the CAS write and the projection rows reuses the relation and re-registers the rows (unchanged)', async () => {
    const ab = await transitionedOnce();
    h.edgeRows.length = 0;
    h.geometryRows.splice(h.geometryRows.findIndex((r) => r.geometryArtifactId === B.artifact_id), 1);
    expect(await request(A, B)).toEqual({ ok: true, supersessionArtifactId: ab, reused: true });
    expect(h.puts).toEqual([]);
    expect(h.edgeRows.map((r) => r.supersessionArtifactId)).toEqual([ab]);
  });
});

describe('W-CATCH2 #11: a damaged or unreadable EXISTING issuer is never "not minted yet"', () => {
  const cases: Array<[string, () => void | Promise<void>, Expected]> = [
    ['issuer bytes corrupted', () => writeFileSync(objectPath(issuerId), Buffer.from('{"x":1}')), { failureCode: 'EXISTING_ARTIFACT_INTEGRITY_FAULT', retryable: false }],
    ['issuer object gone behind its index entry', () => unlinkSync(objectPath(issuerId)), { failureCode: 'EXISTING_ARTIFACT_INTEGRITY_FAULT', retryable: false }],
    ['issuer index entry unreadable (EISDIR)', () => { unlinkSync(indexEntryPath(issuerId)); mkdirSync(indexEntryPath(issuerId)); }, { failureCode: 'EXISTING_ARTIFACT_READ_ERROR', retryable: true }],
    // Mutation C03 analogue: a valid CAS object whose content was edited while its id, content_hash field and key id stay.
    [
      'issuer content edited after persistence (valid CAS object, id/content_hash/key id untouched)',
      async () => {
        const envelope = JSON.parse(readFileSync(objectPath(issuerId), 'utf8')) as { body: { payload: Record<string, unknown> } };
        envelope.body.payload = { ...envelope.body.payload, owner_authority_ref: { artifact_id: 'owner-authority-edited', artifact_type: 'owner_authority_attestation' } };
        const cas = new FileCASRepository(h.casDir, { durabilityMode: 'none' });
        await cas.initialize();
        const { hash } = await cas.putBytes(Buffer.from(JSON.stringify(envelope), 'utf8'));
        writeFileSync(indexEntryPath(issuerId), JSON.stringify({ artifact_id: issuerId, hash }));
      },
      { failureCode: 'EXISTING_ARTIFACT_REFUSED', retryable: false },
    ],
  ];
  for (const [name, sabotage, expected] of cases) {
    it(`${name} -> ${expected.failureCode}, nothing written`, async () => {
      await transitionedOnce();
      await sabotage();
      expectTypedNoWrite(await request(B, C, '2026-10-02T11:00:00.000Z'), expected);
    });
  }
});

describe('W-CATCH2 #11: a damaged, unreadable or unverifiable EXISTING relation is never re-issued', () => {
  const cases: Array<[string, (id: string) => void | Promise<void>, Expected]> = [
    ['relation bytes corrupted', (id) => writeFileSync(objectPath(id), Buffer.from('{"x":1}')), { failureCode: 'EXISTING_ARTIFACT_INTEGRITY_FAULT', retryable: false }],
    ['relation object gone behind its index entry', (id) => unlinkSync(objectPath(id)), { failureCode: 'EXISTING_ARTIFACT_INTEGRITY_FAULT', retryable: false }],
    ['relation index entry unreadable (EISDIR)', (id) => { unlinkSync(indexEntryPath(id)); mkdirSync(indexEntryPath(id)); }, { failureCode: 'EXISTING_ARTIFACT_READ_ERROR', retryable: true }],
    [
      'relation content edited after persistence (valid CAS object)',
      async (id) => {
        const envelope = JSON.parse(readFileSync(objectPath(id), 'utf8')) as { body: { payload: Record<string, unknown> } };
        envelope.body.payload = { ...envelope.body.payload, reason_code: 'EDITED_AFTER_PERSISTENCE' };
        const cas = new FileCASRepository(h.casDir, { durabilityMode: 'none' });
        await cas.initialize();
        const { hash } = await cas.putBytes(Buffer.from(JSON.stringify(envelope), 'utf8'));
        writeFileSync(indexEntryPath(id), JSON.stringify({ artifact_id: id, hash }));
      },
      { failureCode: 'EXISTING_ARTIFACT_REFUSED', retryable: false },
    ],
  ];
  for (const [name, sabotage, expected] of cases) {
    it(`${name} -> ${expected.failureCode}, nothing re-issued`, async () => {
      const ab = await transitionedOnce();
      await sabotage(ab);
      expectTypedNoWrite(await request(A, B), expected);
    });
  }
});

describe('W-CATCH2 #11: the same surface keeps the cause without raw text', () => {
  it('the currentness gate cannot read the projection (index down) -> M1a’s typed class, retryable, never an untyped CURRENT_GEOMETRY_UNAVAILABLE with raw text', async () => {
    await transitionedOnce(); // the issuer exists, so nothing legitimate is minted before the gate
    h.geometryListError = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
    expectTypedNoWrite(await request(B, C, '2026-10-02T11:00:00.000Z'), { failureCode: 'LOCALIZATION_GEOMETRY_CURRENTNESS_RESOLUTION_ERROR', retryable: true });
  });
  it('the pinned successor cannot be read (EISDIR) -> SUCCESSOR_GEOMETRY_UNAVAILABLE with a neutral text', async () => {
    unlinkSync(indexEntryPath(B.artifact_id));
    mkdirSync(indexEntryPath(B.artifact_id));
    const outcome = (await request(A, B)) as { failureCode?: string; failureDetail?: string };
    expect(outcome.failureCode).toBe('SUCCESSOR_GEOMETRY_UNAVAILABLE');
    expect(outcome.failureDetail).toContain('Ett nytt försök kan lyckas.');
    expect(outcome.failureDetail).not.toMatch(RAW);
  });
  it('the access facts cannot be read -> PROVISIONING_EXECUTION_ERROR, never REQUESTER_NOT_AUTHORIZED', async () => {
    h.accessError = Object.assign(new Error("Can't reach database server"), { name: 'PrismaClientInitializationError' });
    const outcome = (await request(A, B)) as { failureCode?: string; failureDetail?: string };
    expect(outcome.failureCode).toBe('PROVISIONING_EXECUTION_ERROR');
    expect(outcome.failureDetail).not.toMatch(/database server/);
  });
});

// ------------------------------------------------------------------------------------------------
// W-CATCH3 (CATCH2 verifier finding 2, probe S3): the reuse of an EXISTING relation returned whatever
// object the index entry of the deterministic id pointed at -- a retry of A->B became COMPLETED with
// the B->C relation. The object under a deterministic id must BE that object.
// ------------------------------------------------------------------------------------------------

/** Points the index entry of `fromId` at the CAS object of `toId` (a misdirected index entry). */
function pointIndexAt(fromId: string, toId: string): void {
  const { hash } = JSON.parse(readFileSync(indexEntryPath(toId), 'utf8')) as { hash: string };
  writeFileSync(indexEntryPath(fromId), JSON.stringify({ artifact_id: fromId, hash }));
}

describe('W-CATCH3 #11: an object under a deterministic id must BE that object', () => {
  it('S3: the A->B relation index entry points at the (valid) B->C relation; a retry of A->B -> EXISTING_ARTIFACT_INTEGRITY_FAULT, never COMPLETED with B->C, no row written', async () => {
    const ab = await transitionedOnce();
    const bc = await request(B, C, '2026-10-02T11:00:00.000Z');
    expect(bc).toMatchObject({ ok: true, reused: false });
    const bcId = (bc as { supersessionArtifactId: string }).supersessionArtifactId;
    pointIndexAt(ab, bcId);
    h.puts.length = 0;
    const rowsBefore = JSON.stringify({ edges: h.edgeRows, geometries: h.geometryRows });
    expectTypedNoWrite(await request(A, B), { failureCode: 'EXISTING_ARTIFACT_INTEGRITY_FAULT', retryable: false });
    expect(JSON.stringify({ edges: h.edgeRows, geometries: h.geometryRows })).toBe(rowsBefore);
  });
  it('the issuer index entry points at another object (the A->B relation) -> EXISTING_ARTIFACT_INTEGRITY_FAULT, nothing written', async () => {
    const ab = await transitionedOnce();
    pointIndexAt(issuerId, ab);
    expectTypedNoWrite(await request(B, C, '2026-10-02T11:00:00.000Z'), { failureCode: 'EXISTING_ARTIFACT_INTEGRITY_FAULT', retryable: false });
  });
});

// ------------------------------------------------------------------------------------------------
// W-CATCH3 (CATCH2 verifier finding 3, probes S1/S1b): the field-for-field issuer comparison leaves out
// the attestation, and the relation was written BEFORE the step that verifies the issuer's attestation
// -- a GLOBAL issuer with a garbled signature led to a CAS write, while the stored text said
// "Inget utfärdades.". An existing issuer is now verified before it is used, every new artifact is
// verified before it is written, and the stored text says what may have been written.
// ------------------------------------------------------------------------------------------------

const NOTHING_ISSUED = 'Inget utfärdades.';
const MAY_HAVE_WRITTEN = 'Ett eller flera objekt kan ha sparats i arkivet innan felet uppstod, men begäran slutfördes inte.';
const garble = (signature: unknown) => String(signature ?? '').split('').reverse().join('');

async function rewriteObject(id: string, edit: (body: Record<string, unknown>) => void): Promise<void> {
  const envelope = JSON.parse(readFileSync(objectPath(id), 'utf8')) as { body: Record<string, unknown> };
  edit(envelope.body);
  const cas = new FileCASRepository(h.casDir, { durabilityMode: 'none' });
  await cas.initialize();
  const { hash } = await cas.putBytes(Buffer.from(JSON.stringify(envelope), 'utf8'));
  writeFileSync(indexEntryPath(id), JSON.stringify({ artifact_id: id, hash }));
}

/** Another Ed25519 public key under the SAME key id (a verifier configured with the wrong key). */
function wrongVerifierUnderTheSameKeyId(keyId: string): LocalPemVerificationKeyProvider {
  const seed = createHash('sha256').update(`w-catch3-wrong-key:${keyId}`).digest();
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
  return new LocalPemVerificationKeyProvider(keyId, createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString());
}

describe('W-CATCH3 #11: an existing issuer is verified before anything is written (finding 3)', () => {
  it('S1b: the GLOBAL issuer is stored with exact content but a garbled signature before the project\'s FIRST transition -> EXISTING_ARTIFACT_REFUSED, nothing written, no edge', async () => {
    const bare = createLocalizationGeometrySupersessionIssuerArtifact({ issuer_key_id: key.keyId, owner_authority_ref: OWNER_AUTHORITY_REF });
    const attestation = await attestLocalizationGeometrySupersessionIssuerArtifact({ issuer: bare, signing: key.provider });
    const damaged = { ...bare, attestation: { ...attestation, signature: garble(attestation.signature) } };
    await repository().put({ artifact_id: damaged.artifact_id, content_hash: damaged.content_hash, body: damaged } as never);
    h.puts.length = 0;
    expectTypedNoWrite(await request(A, B), { failureCode: 'EXISTING_ARTIFACT_REFUSED', retryable: false });
    expect(h.edgeRows).toEqual([]);
  });
  it('S1: the same damage after the project already has a transition -> EXISTING_ARTIFACT_REFUSED, nothing written, edges unchanged', async () => {
    await transitionedOnce();
    await rewriteObject(issuerId, (body) => {
      const att = body.attestation as Record<string, unknown>;
      body.attestation = { ...att, signature: garble(att.signature) };
    });
    const edgesBefore = JSON.stringify(h.edgeRows);
    expectTypedNoWrite(await request(B, C, '2026-10-02T11:00:00.000Z'), { failureCode: 'EXISTING_ARTIFACT_REFUSED', retryable: false });
    expect(JSON.stringify(h.edgeRows)).toBe(edgesBefore);
  });
  it('the verification key is another key under the issuer key id (configuration error): the first transition writes NOTHING -- neither the issuer nor the relation -- so "Inget utfärdades." is true', async () => {
    __resetLocalizationGeometrySupersessionVerifierForTests(wrongVerifierUnderTheSameKeyId(key.keyId));
    const outcome = (await request(A, B)) as { ok: boolean; failureDetail?: string };
    expect(outcome.ok).toBe(false);
    expect(h.puts, 'nothing written before the new issuer and the new relation verify').toEqual([]);
    expect(h.edgeRows).toEqual([]);
    expect(outcome.failureDetail?.endsWith(NOTHING_ISSUED)).toBe(true);
    expect(outcome.failureDetail).not.toMatch(RAW);
  });
});

describe('W-CATCH3 #11: the stored text tells the truth about writes (finding 3, provisioningFailure.ts)', () => {
  it('a failure AFTER the relation was written (the edge cannot be registered) never says "Inget utfärdades." and never "kunde inte läsas"; it says an object may have been saved', async () => {
    h.edgeRegisterError = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
    const outcome = (await request(A, B)) as { ok: boolean; failureCode?: string; failureDetail?: string };
    expect(outcome.ok).toBe(false);
    expect(h.puts.length, 'the relation (and the issuer) were written before the edge failed').toBeGreaterThan(0);
    expect(outcome.failureCode).toBe('PROVISIONING_EXECUTION_ERROR');
    expect(outcome.failureDetail).not.toContain('Inget utfärdades');
    expect(outcome.failureDetail).not.toContain('kunde inte läsas');
    expect(outcome.failureDetail).toContain('Ett nytt försök kan lyckas.');
    expect(outcome.failureDetail?.endsWith(MAY_HAVE_WRITTEN)).toBe(true);
    expect(outcome.failureDetail).not.toMatch(RAW);
  });
  it('a failure after the global issuer was minted in this run (no current point) does not claim "Inget utfärdades."', async () => {
    h.geometryRows.length = 0; // the project has no current point: the gate fails after the issuer was minted and written
    const outcome = (await request(A, B)) as { ok: boolean; failureCode?: string; failureDetail?: string };
    expect(outcome.ok).toBe(false);
    expect(h.puts).toEqual([issuerId]);
    expect(outcome.failureCode).toBe('CURRENT_GEOMETRY_UNAVAILABLE');
    expect(outcome.failureDetail).not.toContain('Inget utfärdades');
    expect(outcome.failureDetail?.endsWith(MAY_HAVE_WRITTEN)).toBe(true);
  });
  it('control: a failure before anything was written still ends "Inget utfärdades." (the pinned successor cannot be read)', async () => {
    unlinkSync(indexEntryPath(B.artifact_id));
    mkdirSync(indexEntryPath(B.artifact_id));
    const outcome = (await request(A, B)) as { failureDetail?: string };
    expect(h.puts).toEqual([]);
    expect(outcome.failureDetail?.endsWith(NOTHING_ISSUED)).toBe(true);
  });
});
