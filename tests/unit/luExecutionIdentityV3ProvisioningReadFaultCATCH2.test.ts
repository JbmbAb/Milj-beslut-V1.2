// @vitest-environment node
/**
 * W-CATCH2 #12 (owner decisions 2026-10-02/03): the V3 identity provisioning worker read every failure
 * to read the temporal status, the identity or its attestation as "not there" (null) and minted /
 * re-issued -- and a verification failure of an existing identity likewise. Now only the PROVEN absence
 * of exactly the deterministic id mints; a read error is a typed retryable fault; a corrupt, lost or
 * tampered EXISTING object is a typed lasting fault -- never hidden, never a silent re-issue, never an
 * untyped WORM/collision error. On the same surface: the canonical context, the geometry read, the
 * access check and the outer catch keep their cause without raw text.
 *
 * REAL FileCAS stack (mkdtemp) behind a mocked MimersIntegration.create; otherwise the harness of
 * luExecutionIdentityV3ProvisioningProofs.test.ts. Normal flows unchanged.
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
  contextError: null as unknown,
  accessError: null as Error | null,
  failPutOfIdPrefix: null as string | null,
  /** W-CATCH3: from the n-th read of `id` on, answer with the object stored under `to` (a race or a misdirected entry between two reads). */
  swapRead: null as { id: string; to: string; fromRead: number; reads: number } | null,
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
            resolve: (ref: { artifact_id: string; artifact_type: string }) => {
              const swap = h.swapRead;
              if (swap && ref.artifact_id === swap.id && ++swap.reads >= swap.fromRead) return inner.resolve({ ...ref, artifact_id: swap.to });
              return inner.resolve(ref);
            },
            put: (artifact: { artifact_id: string }) => {
              h.puts.push(artifact.artifact_id);
              if (h.failPutOfIdPrefix && artifact.artifact_id.startsWith(h.failPutOfIdPrefix)) {
                return Promise.reject(Object.assign(new Error("EIO: i/o error, write 'D:\\mimer-demo\\cas\\x.idx'"), { code: 'EIO' }));
              }
              return inner.put(artifact as never);
            },
          },
        };
      },
    },
  };
});
vi.mock('../../src/application/resolveCanonicalProjectContext', () => ({
  resolveCanonicalProjectContext: vi.fn(async () => {
    if (h.contextError) throw h.contextError;
    return {
      propertyContextRef: { artifact_id: 'lu_property_context-catch2', artifact_type: 'LU_PROPERTY_CONTEXT' },
      projectContextRef: { artifact_id: 'lu_project_context-catch2', artifact_type: 'LU_PROJECT_CONTEXT' },
      contextBindingRef: { artifact_id: 'project-context-binding-catch2', artifact_type: 'project_context_binding' },
      propertyIdentity: 'property:test:catch2',
      coordinates: [6580000, 674000],
    };
  }),
}));
vi.mock('../../server/modules/release/productReleaseRuntime', () => ({
  resolveCanonicalProductRelease: vi.fn(async () => ({ artifact_id: 'product-release-catch2', artifact_type: 'product_release_manifest', release_hash: { algorithm: 'sha256', value: 'a'.repeat(64) } })),
}));
vi.mock('../../server/db/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(async () => ({ id: 'requester-1', organisationId: 'org-1', bankidId: 'b-1', role: 'CONSULTANT', identityEnvironment: 'LEGACY' })) } },
}));
vi.mock('../../server/security/projectAccess', () => ({
  assertProjectAccess: vi.fn(async () => {
    if (h.accessError) throw h.accessError;
  }),
}));
vi.mock('node:child_process', () => {
  const spawn = () => ({ once: (event: string, cb: (code: number) => void) => { if (event === 'exit') setTimeout(() => cb(0), 0); } });
  return { spawn, default: { spawn } };
});

import { FileCASRepository, LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import {
  attestLuExecutionAuthorityIssuer,
  attestLuExecutionAuthorityLifecycle,
  attestLuExecutionAuthorityRoot,
  createLocalizationGeometryArtifact,
  createLuExecutionAuthorityIssuerArtifact,
  createLuExecutionAuthorityLifecycleArtifact,
  createLuExecutionAuthorityRootArtifact,
} from '@miljobeslut/mps-lu';
import { MimersByteStorageBackend } from '../../packages/mps-runtime/src/repository/MimersByteStorageBackend';
import { CasBackedArtifactRepository } from '../../packages/mps-runtime/src/repository/CasBackedArtifactRepository';
import { executeLocalizationIdentityProvisioning } from '../../server/modules/localization/luExecutionIdentityV3Provisioning';
import { ProjectContextBindingCurrentUnavailableError } from '../../server/modules/localization/projectContextBindingRuntime';
import { __resetLuExecutionAuthorityVerifierForTests } from '../../packages/mps-lu/src/execution/LuExecutionAuthorityVerifier';
import { __resetLuExecutionAuthoritySigningProviderForTests } from '../../server/security/luExecutionAuthoritySigningKey';

const PROJECT_ID = 'project-w-catch2-identity';
const ENV_KEYS = [
  'LU_EXECUTION_AUTHORITY_ROOT_KEY_ID',
  'LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM',
  'LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID',
  'LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM',
  'LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM',
  'LU_EXECUTION_AUTHORITY_ISSUER_ARTIFACT_ID',
  'LU_EXECUTION_AUTHORITY_LIFECYCLE_ID',
] as const;

function fixedEd25519(keyId: string) {
  const seed = createHash('sha256').update(`w-catch2-identity:${keyId}`).digest();
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  return { keyId, privateKeyPem, publicKeyPem, provider: new LocalPemSigningKeyProvider(keyId, privateKeyPem, publicKeyPem) };
}
const rootKey = fixedEd25519('ed25519:lu-root-catch2');
const authorityKey = fixedEd25519('ed25519:lu-authority-catch2');

let root: string;
let geometryId: string;
const repository = () => new CasBackedArtifactRepository(new MimersByteStorageBackend(new FileCASRepository(h.casDir, { durabilityMode: 'none' }), h.indexDir));
const put = (body: { artifact_id: string; content_hash: { algorithm: string; value: string } }) => repository().put({ artifact_id: body.artifact_id, content_hash: body.content_hash, body } as never);
const indexEntryPath = (id: string) => path.join(h.indexDir, `${createHash('sha256').update(id).digest('hex')}.idx`);
const objectPath = (id: string) => new FileCASRepository(h.casDir).getFilePath((JSON.parse(readFileSync(indexEntryPath(id), 'utf8')) as { hash: string }).hash);
const ref = (a: { artifact_id: string; artifact_type: string }) => ({ artifact_id: a.artifact_id, artifact_type: a.artifact_type });
const run = () => executeLocalizationIdentityProvisioning({ projectId: PROJECT_ID, geometryArtifactId: geometryId, requestedByUserId: 'requester-1' });

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'wcatch2-identity-'));
  h.casDir = path.join(root, 'cas');
  h.indexDir = path.join(root, 'index');
  mkdirSync(h.casDir, { recursive: true });
  mkdirSync(h.indexDir, { recursive: true });
  await new FileCASRepository(h.casDir, { durabilityMode: 'none' }).initialize();
  h.puts.length = 0;
  h.contextError = null;
  h.accessError = null;
  h.failPutOfIdPrefix = null;
  h.swapRead = null;
  process.env.LU_EXECUTION_AUTHORITY_ROOT_KEY_ID = rootKey.keyId;
  process.env.LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM = rootKey.publicKeyPem;
  process.env.LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID = authorityKey.keyId;
  process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM = authorityKey.publicKeyPem;
  process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM = authorityKey.privateKeyPem;
  __resetLuExecutionAuthorityVerifierForTests(null);
  __resetLuExecutionAuthoritySigningProviderForTests(null);

  const bareRoot = createLuExecutionAuthorityRootArtifact({ root_key_id: rootKey.keyId, public_key_fingerprint: 'root-fingerprint-catch2' });
  const rootArtifact = { ...bareRoot, attestation: await attestLuExecutionAuthorityRoot({ root: bareRoot, signing: rootKey.provider }) };
  const bareIssuer = createLuExecutionAuthorityIssuerArtifact({ issuer_key_id: authorityKey.keyId, public_key_fingerprint: 'issuer-fingerprint-catch2', root_ref: ref(rootArtifact) });
  const issuer = { ...bareIssuer, attestation: await attestLuExecutionAuthorityIssuer({ issuer: bareIssuer, root: rootArtifact, signing: rootKey.provider }) };
  const bareLifecycle = createLuExecutionAuthorityLifecycleArtifact({ root: rootArtifact, issuer, valid_from: '2020-01-01T00:00:00.000Z', valid_until: '2035-01-01T00:00:00.000Z' });
  const lifecycle = { ...bareLifecycle, attestation: await attestLuExecutionAuthorityLifecycle({ lifecycle: bareLifecycle, root: rootArtifact, signing: rootKey.provider }) };
  await put(rootArtifact);
  await put(issuer);
  await put(lifecycle);
  process.env.LU_EXECUTION_AUTHORITY_ISSUER_ARTIFACT_ID = issuer.artifact_id;
  process.env.LU_EXECUTION_AUTHORITY_LIFECYCLE_ID = lifecycle.artifact_id;

  const geometry = createLocalizationGeometryArtifact({
    project_id: PROJECT_ID,
    property_context_ref: { artifact_id: 'lu_property_context-catch2', artifact_type: 'LU_PROPERTY_CONTEXT' },
    wgs84LngLat: [18.07, 59.33],
    sweref99NorthingEasting: [6580000, 674000],
    provenance: 'user_defined',
    label: 'Test point',
    created_by: 'requester-1',
  });
  await put(geometry);
  geometryId = geometry.artifact_id;
  h.puts.length = 0;
});
afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  __resetLuExecutionAuthorityVerifierForTests(null);
  __resetLuExecutionAuthoritySigningProviderForTests(null);
  rmSync(root, { recursive: true, force: true });
});

const RAW = /[A-Za-z]:[\\/]|\.idx|MIMERS_|WORM|Collision|EIO|EISDIR|ECONNREFUSED|REJECT_|Artifact not found/;

/** First (healthy) provisioning: returns the identity id, its attestation id and the temporal status id. */
async function provisionedOnce() {
  const first = await run();
  expect(first).toEqual({ ok: true, executionIdentityArtifactId: expect.any(String), reused: false });
  const identityId = first.ok ? first.executionIdentityArtifactId : '';
  const attestationId = `lu-identity-attestation-${identityId}`;
  const temporalId = h.puts.find((id) => id !== identityId && id !== attestationId)!;
  expect(temporalId).toBeDefined();
  h.puts.length = 0;
  return { identityId, attestationId, temporalId };
}

type Expected = { readonly failureCode: string; readonly retryable: boolean };
function expectTypedNoWrite(outcome: unknown, expected: Expected): void {
  const o = outcome as { ok: boolean; failureCode?: string; failureDetail?: string };
  expect({ ok: o.ok, failureCode: o.failureCode }).toEqual({ ok: false, failureCode: expected.failureCode });
  expect(o.failureDetail).toContain(expected.retryable ? 'Ett nytt försök kan lyckas.' : 'Felet är bestående och löses inte av ett nytt försök.');
  expect(o.failureDetail).not.toMatch(RAW);
  expect(h.puts, 'nothing minted or re-issued over the existing object').toEqual([]);
}

async function editAfterPersistence(id: string, edit: (body: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
  const envelope = JSON.parse(readFileSync(objectPath(id), 'utf8')) as { body: Record<string, unknown> };
  envelope.body = edit(envelope.body);
  const cas = new FileCASRepository(h.casDir, { durabilityMode: 'none' });
  await cas.initialize();
  const { hash } = await cas.putBytes(Buffer.from(JSON.stringify(envelope), 'utf8'));
  writeFileSync(indexEntryPath(id), JSON.stringify({ artifact_id: id, hash }));
}

describe('W-CATCH2 #12: normal flows unchanged', () => {
  it('first run issues identity, attestation and temporal status; a retry reuses everything without a write', async () => {
    const { identityId } = await provisionedOnce();
    expect(await run()).toEqual({ ok: true, executionIdentityArtifactId: identityId, reused: true });
    expect(h.puts).toEqual([]);
  });
  it('the attestation never stored (index entry gone): its proven absence re-issues it, same identity', async () => {
    const { identityId, attestationId } = await provisionedOnce();
    unlinkSync(indexEntryPath(attestationId));
    expect(await run()).toEqual({ ok: true, executionIdentityArtifactId: identityId, reused: false });
  });
});

describe('W-CATCH2 #12: a damaged, unreadable or unverifiable EXISTING object is never "not there"', () => {
  const cases: Array<[string, (ids: Awaited<ReturnType<typeof provisionedOnce>>) => void | Promise<void>, Expected]> = [
    ['identity bytes corrupted', ({ identityId }) => writeFileSync(objectPath(identityId), Buffer.from('{"x":1}')), { failureCode: 'EXISTING_ARTIFACT_INTEGRITY_FAULT', retryable: false }],
    ['identity index entry unreadable (EISDIR)', ({ identityId }) => { unlinkSync(indexEntryPath(identityId)); mkdirSync(indexEntryPath(identityId)); }, { failureCode: 'EXISTING_ARTIFACT_READ_ERROR', retryable: true }],
    ['identity attestation gone behind its index entry', ({ attestationId }) => unlinkSync(objectPath(attestationId)), { failureCode: 'EXISTING_ARTIFACT_INTEGRITY_FAULT', retryable: false }],
    ['identity attestation index entry unreadable (EISDIR)', ({ attestationId }) => { unlinkSync(indexEntryPath(attestationId)); mkdirSync(indexEntryPath(attestationId)); }, { failureCode: 'EXISTING_ARTIFACT_READ_ERROR', retryable: true }],
    [
      'identity content edited after persistence (valid CAS object) -- its attestation no longer verifies',
      ({ identityId }) => editAfterPersistence(identityId, (body) => ({ ...body, subject_v3: { ...(body.subject_v3 as object), site_id: 'site-edited-after-persistence' } })),
      { failureCode: 'EXISTING_ARTIFACT_REFUSED', retryable: false },
    ],
    ['temporal status bytes corrupted', ({ temporalId }) => writeFileSync(objectPath(temporalId), Buffer.from('{"x":1}')), { failureCode: 'EXISTING_ARTIFACT_INTEGRITY_FAULT', retryable: false }],
    ['temporal status index entry unreadable (EISDIR)', ({ temporalId }) => { unlinkSync(indexEntryPath(temporalId)); mkdirSync(indexEntryPath(temporalId)); }, { failureCode: 'EXISTING_ARTIFACT_READ_ERROR', retryable: true }],
    [
      'temporal status content edited after persistence (valid CAS object)',
      ({ temporalId }) => editAfterPersistence(temporalId, (body) => ({ ...body, payload: { ...(body.payload as object), action: 'ACTION_EDITED_AFTER_PERSISTENCE' } })),
      { failureCode: 'EXISTING_ARTIFACT_REFUSED', retryable: false },
    ],
  ];
  for (const [name, sabotage, expected] of cases) {
    it(`${name} -> ${expected.failureCode}, nothing re-issued`, async () => {
      const ids = await provisionedOnce();
      await sabotage(ids);
      expectTypedNoWrite(await run(), expected);
    });
  }
});

describe('W-CATCH2 #12: the same surface keeps the cause without raw text', () => {
  it('the canonical context: the binding cannot be read -> CURRENT_BINDING_READ_ERROR (retryable)', async () => {
    h.contextError = new ProjectContextBindingCurrentUnavailableError(false, Object.assign(new Error("EIO: i/o error, read 'D:\\mimer-demo\\x.idx'"), { code: 'EIO' }));
    expectTypedNoWrite(await run(), { failureCode: 'CURRENT_BINDING_READ_ERROR', retryable: true });
  });
  it('the canonical context: no binding registered -> CURRENT_BINDING_UNAVAILABLE with a neutral text', async () => {
    h.contextError = new ProjectContextBindingCurrentUnavailableError(true, new Error('REJECT_PROJECT_CONTEXT_BINDING_HEAD: bindings'));
    const outcome = (await run()) as { failureCode?: string; failureDetail?: string };
    expect(outcome.failureCode).toBe('CURRENT_BINDING_UNAVAILABLE');
    expect(outcome.failureDetail).not.toMatch(RAW);
  });
  it('the pinned geometry cannot be read (EISDIR) -> GEOMETRY_UNAVAILABLE_OR_TAMPERED with a neutral text', async () => {
    unlinkSync(indexEntryPath(geometryId));
    mkdirSync(indexEntryPath(geometryId));
    const outcome = (await run()) as { failureCode?: string; failureDetail?: string };
    expect(outcome.failureCode).toBe('GEOMETRY_UNAVAILABLE_OR_TAMPERED');
    expect(outcome.failureDetail).toContain('Ett nytt försök kan lyckas.');
    expect(outcome.failureDetail).not.toMatch(RAW);
  });
  it('the access facts cannot be read -> PROVISIONING_EXECUTION_ERROR, never REQUESTER_NOT_AUTHORIZED', async () => {
    h.accessError = Object.assign(new Error("Can't reach database server"), { name: 'PrismaClientInitializationError' });
    const outcome = (await run()) as { failureCode?: string; failureDetail?: string };
    expect(outcome.failureCode).toBe('PROVISIONING_EXECUTION_ERROR');
    expect(outcome.failureDetail).not.toMatch(/database server/);
  });
});

describe('W-CATCH3 (CATCH2 verifier finding 3): the stored text tells the truth about writes (shared provisioningFailure.ts)', () => {
  const MAY_HAVE_WRITTEN = 'Ett eller flera objekt kan ha sparats innan felet uppstod, men begäran slutfördes inte.';
  it('a failure AFTER the identity and its attestation were written (the temporal status cannot be written) never says "Inget utfärdades." or "kunde inte läsas"', async () => {
    h.failPutOfIdPrefix = 'lu-source-authority-status-';
    const outcome = (await run()) as { ok: boolean; failureCode?: string; failureDetail?: string };
    expect(outcome.ok).toBe(false);
    expect(h.puts.some((id) => id.startsWith('lu-identity-v3-')), 'the identity was written before the failure').toBe(true);
    expect(outcome.failureCode).toBe('PROVISIONING_EXECUTION_ERROR');
    expect(outcome.failureDetail).not.toContain('Inget utfärdades');
    expect(outcome.failureDetail).not.toContain('kunde inte läsas');
    expect(outcome.failureDetail).toContain('Ett nytt försök kan lyckas.');
    expect(outcome.failureDetail?.endsWith(MAY_HAVE_WRITTEN)).toBe(true);
    expect(outcome.failureDetail).not.toMatch(RAW);
  });
  it('control: a failure before anything was written still ends "Inget utfärdades." (the pinned geometry cannot be read)', async () => {
    unlinkSync(indexEntryPath(geometryId));
    mkdirSync(indexEntryPath(geometryId));
    const outcome = (await run()) as { failureDetail?: string };
    expect(h.puts).toEqual([]);
    expect(outcome.failureDetail?.endsWith('Inget utfärdades.')).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------
// W-CATCH3 (owner decision 2026-10-03: capability, issuer AND provisioning are bound to exactly the
// requested id and content; CATCH2 verifier finding 2 for the identity worker): an index entry of the
// deterministic identity or temporal-status id pointing at ANOTHER valid object was caught only
// indirectly (its attestation did not match -> EXISTING_ARTIFACT_REFUSED). The object under the id must
// BE that object: a misdirected entry is a lasting integrity fault, never reused, nothing written.
// ------------------------------------------------------------------------------------------------
describe('W-CATCH3 #12: an object under a deterministic id must BE that object', () => {
  const pointIndexAt = (fromId: string, toId: string) => {
    const { hash } = JSON.parse(readFileSync(indexEntryPath(toId), 'utf8')) as { hash: string };
    writeFileSync(indexEntryPath(fromId), JSON.stringify({ artifact_id: fromId, hash }));
  };
  /** Provisions a SECOND point of the same project (same property context) and returns its ids. */
  async function otherPointProvisioned() {
    const original = geometryId;
    const other = createLocalizationGeometryArtifact({
      project_id: PROJECT_ID,
      property_context_ref: { artifact_id: 'lu_property_context-catch2', artifact_type: 'LU_PROPERTY_CONTEXT' },
      wgs84LngLat: [18.09, 59.35],
      sweref99NorthingEasting: [6581000, 675000],
      provenance: 'user_defined',
      label: 'Other point',
      created_by: 'requester-1',
    });
    await put(other);
    geometryId = other.artifact_id;
    const ids = await provisionedOnce();
    geometryId = original;
    return ids;
  }
  it('the identity index entry points at ANOTHER valid identity (another point) -> EXISTING_ARTIFACT_INTEGRITY_FAULT, never reused, nothing written', async () => {
    const mine = await provisionedOnce();
    const other = await otherPointProvisioned();
    expect(other.identityId).not.toBe(mine.identityId);
    pointIndexAt(mine.identityId, other.identityId);
    expectTypedNoWrite(await run(), { failureCode: 'EXISTING_ARTIFACT_INTEGRITY_FAULT', retryable: false });
  });
  it('the temporal-status index entry points at ANOTHER valid status (another point) -> EXISTING_ARTIFACT_INTEGRITY_FAULT, nothing written', async () => {
    const mine = await provisionedOnce();
    const other = await otherPointProvisioned();
    expect(other.temporalId).not.toBe(mine.temporalId);
    pointIndexAt(mine.temporalId, other.temporalId);
    expectTypedNoWrite(await run(), { failureCode: 'EXISTING_ARTIFACT_INTEGRITY_FAULT', retryable: false });
  });
});

// W-CATCH3 mutation F5-C: the reuse path reads the verified identity a second time; that read is bound
// to the id too -- another identity answered on the re-read is an integrity fault, never used.
describe('W-CATCH3 #12: the re-read after a verified reuse is bound to its id', () => {
  it('the second read of the reused identity answers another valid identity -> EXISTING_ARTIFACT_INTEGRITY_FAULT, nothing written', async () => {
    const mine = await provisionedOnce();
    const original = geometryId;
    const other = createLocalizationGeometryArtifact({
      project_id: PROJECT_ID,
      property_context_ref: { artifact_id: 'lu_property_context-catch2', artifact_type: 'LU_PROPERTY_CONTEXT' },
      wgs84LngLat: [18.11, 59.36],
      sweref99NorthingEasting: [6582000, 676000],
      provenance: 'user_defined',
      label: 'Third point',
      created_by: 'requester-1',
    });
    await put(other);
    geometryId = other.artifact_id;
    const theirs = await provisionedOnce();
    geometryId = original;
    h.swapRead = { id: mine.identityId, to: theirs.identityId, fromRead: 2, reads: 0 };
    expectTypedNoWrite(await run(), { failureCode: 'EXISTING_ARTIFACT_INTEGRITY_FAULT', retryable: false });
  });
});

// ------------------------------------------------------------------------------------------------
// W-CATCH3-R2 (CATCH3 verifier findings 2 and 3, MEDIUM; owner decision: provisioning bound to exactly
// the requested id and content): the worker read the requested point and the configured authority
// (lifecycle, root, issuer) without binding them to the ids it asked for. A misdirected point entry made
// a request for P COMPLETED with Q's identity (or minted one for Q); a configured, REVOKED lifecycle
// whose entry pointed at the older one minted a temporal status anyway -- the revocation was bypassed.
// ------------------------------------------------------------------------------------------------
describe('W-CATCH3-R2 #12: the requested point and the configured authority are bound to their ids', () => {
  const pointAt = (fromId: string, toId: string) => {
    const { hash } = JSON.parse(readFileSync(indexEntryPath(toId), 'utf8')) as { hash: string };
    writeFileSync(indexEntryPath(fromId), JSON.stringify({ artifact_id: fromId, hash }));
  };
  async function anotherPoint(label: string, lng: number, provision: boolean) {
    const original = geometryId;
    const other = createLocalizationGeometryArtifact({
      project_id: PROJECT_ID,
      property_context_ref: { artifact_id: 'lu_property_context-catch2', artifact_type: 'LU_PROPERTY_CONTEXT' },
      wgs84LngLat: [lng, 59.35],
      sweref99NorthingEasting: [6581000 + Math.round(lng * 10), 675000],
      provenance: 'user_defined',
      label,
      created_by: 'requester-1',
    });
    await put(other);
    let ids: Awaited<ReturnType<typeof provisionedOnce>> | null = null;
    if (provision) {
      geometryId = other.artifact_id;
      ids = await provisionedOnce();
      geometryId = original;
    }
    return { geometryId: other.artifact_id, ids };
  }
  const authority = async () => {
    const issuerId = process.env.LU_EXECUTION_AUTHORITY_ISSUER_ARTIFACT_ID!;
    const issuer = (await repository().resolve({ artifact_id: issuerId, artifact_type: 'lu_execution_authority_issuer' })) as never as {
      artifact_id: string;
      payload: { root_ref: { artifact_id: string; artifact_type: string } };
    };
    const root = (await repository().resolve(issuer.payload.root_ref)) as never as { artifact_id: string; artifact_type: string };
    return { issuer, root };
  };
  const STORAGE: Expected = { failureCode: 'PROVISIONING_STORAGE_INTEGRITY_FAULT', retryable: false };

  it('IN1: the requested point P\'s index entry points at another valid point Q (Q already provisioned) -> GEOMETRY_UNAVAILABLE_OR_TAMPERED (lasting integrity fault), never COMPLETED with Q\'s identity', async () => {
    await provisionedOnce();
    const q = await anotherPoint('IN1-Q', 18.24, true);
    pointAt(geometryId, q.geometryId);
    const outcome = (await run()) as { ok: boolean; failureCode?: string; failureDetail?: string };
    expect({ ok: outcome.ok, failureCode: outcome.failureCode }).toEqual({ ok: false, failureCode: 'GEOMETRY_UNAVAILABLE_OR_TAMPERED' });
    expect(outcome.failureDetail).toContain('bestående lagrings- eller integritetsfel');
    expect(outcome.failureDetail?.endsWith('Inget utfärdades.')).toBe(true);
    expect(h.puts).toEqual([]);
  });
  it('IN1b: the same misdirection, Q never provisioned -> typed, nothing minted for Q', async () => {
    const q = await anotherPoint('IN1b-Q', 18.25, false);
    pointAt(geometryId, q.geometryId);
    const outcome = (await run()) as { ok: boolean; failureCode?: string };
    expect({ ok: outcome.ok, failureCode: outcome.failureCode }).toEqual({ ok: false, failureCode: 'GEOMETRY_UNAVAILABLE_OR_TAMPERED' });
    expect(h.puts).toEqual([]);
  });
  it('IN8: the configured lifecycle is REVOKED and its index entry points at the older, non-revoked lifecycle -> a lasting integrity fault, never a temporal status bound to the older one', async () => {
    const { issuer, root } = await authority();
    const olderLifecycleId = process.env.LU_EXECUTION_AUTHORITY_LIFECYCLE_ID!;
    const bareRevoked = createLuExecutionAuthorityLifecycleArtifact({
      root: root as never,
      issuer: issuer as never,
      valid_from: '2020-01-01T00:00:00.000Z',
      valid_until: '2035-01-01T00:00:00.000Z',
      revoked_at: '2021-01-01T00:00:00.000Z',
      previous_lifecycle_ref: { artifact_id: olderLifecycleId, artifact_type: 'lu_execution_authority_lifecycle' },
    });
    const revoked = { ...bareRevoked, attestation: await attestLuExecutionAuthorityLifecycle({ lifecycle: bareRevoked, root: root as never, signing: rootKey.provider }) };
    await put(revoked as never);
    process.env.LU_EXECUTION_AUTHORITY_LIFECYCLE_ID = revoked.artifact_id;
    const control = (await run()) as { ok: boolean };
    expect(control.ok, 'control: the revoked configured lifecycle refuses with an intact index').toBe(false);
    h.puts.length = 0;
    pointAt(revoked.artifact_id, olderLifecycleId);
    expectTypedNoWrite(await run(), STORAGE);
  });
  it('the configured root\'s index entry points at ANOTHER root signed by the same key -> a lasting integrity fault, nothing written', async () => {
    await provisionedOnce();
    const { root } = await authority();
    const bareOther = createLuExecutionAuthorityRootArtifact({ root_key_id: rootKey.keyId, public_key_fingerprint: 'root-fingerprint-other-catch3' });
    const otherRoot = { ...bareOther, attestation: await attestLuExecutionAuthorityRoot({ root: bareOther, signing: rootKey.provider }) };
    await put(otherRoot);
    pointAt(root.artifact_id, otherRoot.artifact_id);
    expectTypedNoWrite(await run(), STORAGE);
  });
  it('the configured issuer\'s index entry points at ANOTHER issuer of the same key and root -> a lasting integrity fault, nothing written', async () => {
    await provisionedOnce();
    const { issuer, root } = await authority();
    const bareOther = createLuExecutionAuthorityIssuerArtifact({ issuer_key_id: authorityKey.keyId, public_key_fingerprint: 'issuer-fingerprint-other-catch3', root_ref: { artifact_id: root.artifact_id, artifact_type: root.artifact_type } });
    const otherIssuer = { ...bareOther, attestation: await attestLuExecutionAuthorityIssuer({ issuer: bareOther, root: root as never, signing: rootKey.provider }) };
    await put(otherIssuer);
    pointAt(issuer.artifact_id, otherIssuer.artifact_id);
    expectTypedNoWrite(await run(), STORAGE);
  });
  it('controls (no over-closing): a fresh point mints, a retry reuses without a write, a second point mints its own identity', async () => {
    const first = (await run()) as { ok: boolean; reused?: boolean; executionIdentityArtifactId?: string };
    expect(first).toMatchObject({ ok: true, reused: false });
    h.puts.length = 0;
    expect(await run()).toEqual({ ok: true, executionIdentityArtifactId: first.executionIdentityArtifactId, reused: true });
    expect(h.puts).toEqual([]);
    const q = await anotherPoint('control-Q', 18.26, true);
    expect(q.ids?.identityId).not.toBe(first.executionIdentityArtifactId);
  });
});
