// @vitest-environment node
/**
 * W-CATCH2 #10 (owner decisions 2026-10-02/03): the viewer-capability provisioning worker read every
 * failure to read its issuer or an existing capability as "not minted yet" and minted / re-issued over
 * it. A read error, a corrupt or tampered EXISTING object must instead be a typed fail-closed outcome:
 * no write, no silent re-issue, no untyped WORM/collision error; only the PROVEN absence of exactly the
 * deterministic id ("Artifact not found: <id>") may mint. Also on this surface: the current-binding
 * catch (:162, untyped) is typed; the access check's read failure is never "not authorized"; the outer
 * catch stores no raw text.
 *
 * REAL FileCAS stack (mkdtemp) behind a mocked MimersIntegration.create; everything else as in
 * luViewerCapabilityProvisioningValidityWindow.test.ts. Normal flows unchanged.
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
  bindings: [] as Array<{ projectId: string; bindingArtifactId: string; contextId: string; contextType: string }>,
  bindingListError: null as Error | null,
  accessError: null as Error | null,
  viewerIdentityError: null as Error | null,
  viewerIdentityId: '',
  spawns: 0,
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
vi.mock('../../server/modules/release/productReleaseRuntime', () => ({
  resolveCanonicalProductRelease: vi.fn(async () => ({ artifact_id: 'product-release-catch2', artifact_type: 'product_release_manifest', release_hash: { algorithm: 'sha256', value: 'a'.repeat(64) } })),
}));
vi.mock('../../src/application/resolveCurrentViewerIdentity', () => ({
  resolveCurrentViewerIdentity: vi.fn(async () => {
    if (h.viewerIdentityError) throw h.viewerIdentityError;
    return { viewerIdentityRef: { artifact_id: h.viewerIdentityId, artifact_type: 'viewer_identity' } };
  }),
}));
vi.mock('node:child_process', () => {
  const spawn = () => {
    h.spawns += 1;
    return { once: (event: string, cb: (code: number) => void) => { if (event === 'exit') setTimeout(() => cb(0), 0); } };
  };
  return { spawn, default: { spawn } };
});
vi.mock('../../server/repositories/projectContextBindingRepository', () => ({
  PrismaProjectContextBindingIndex: class {
    async register(binding: { artifact_id: string; payload: { project_id: string; project_context_ref: { artifact_id: string; artifact_type: string } } }) {
      const p = binding.payload;
      if (!h.bindings.some((r) => r.bindingArtifactId === binding.artifact_id)) {
        h.bindings.push({ projectId: p.project_id, bindingArtifactId: binding.artifact_id, contextId: p.project_context_ref.artifact_id, contextType: p.project_context_ref.artifact_type });
      }
    }
    async resolve(projectId: string, ref: { artifact_id: string; artifact_type: string }) {
      const rows = h.bindings.filter((r) => r.projectId === projectId && r.contextId === ref.artifact_id && r.contextType === ref.artifact_type);
      if (rows.length !== 1) throw new Error('REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE');
      return rows[0]!.bindingArtifactId;
    }
    async listBindingRefs(projectId: string) {
      if (h.bindingListError) throw h.bindingListError;
      return h.bindings.filter((r) => r.projectId === projectId).map((r) => ({ artifact_id: r.bindingArtifactId, artifact_type: 'project_context_binding' }));
    }
    async listSupersessionRefs() {
      if (h.bindingListError) throw h.bindingListError;
      return [];
    }
  },
}));

import { FileCASRepository, LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import {
  createProjectContextBindingArtifactV2,
  createProjectContextBindingIssuerArtifact,
  createViewerCapabilityIssuerArtifact,
  createViewerIdentityArtifact,
  createViewerIdentityIssuerArtifact,
} from '@miljobeslut/mps-lu';
import { MimersByteStorageBackend } from '../../packages/mps-runtime/src/repository/MimersByteStorageBackend';
import { CasBackedArtifactRepository } from '../../packages/mps-runtime/src/repository/CasBackedArtifactRepository';
import { attestProjectContextBindingArtifact } from '../../server/modules/localization/projectContextBindingAuthority';
import { attestViewerIdentityArtifact, attestViewerIdentityIssuerArtifact } from '../../server/modules/localization/viewerIdentityAuthority';
import { PrismaProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';
import { executeViewerCapabilityProvisioning } from '../../server/modules/localization/luViewerCapabilityProvisioning';
import { __resetViewerCapabilitySigningProviderForTests } from '../../server/security/viewerCapabilitySigningKey';
import { __resetViewerCapabilityVerifierForTests } from '../../server/security/viewerCapabilityVerifier';
import { __resetViewerIdentityVerifierForTests } from '../../server/security/viewerIdentityVerifier';

const PROJECT_ID = 'project-w-catch2-viewer-provisioning';
const RELEASE_ID = 'product-release-catch2';
const RELEASE_HASH = 'a'.repeat(64);
const OWNER_AUTHORITY_REF = { artifact_id: 'owner-authority-automated-viewer-capability-provisioning-v1', artifact_type: 'owner_authority_attestation' } as const;

function fixedEd25519(keyId: string) {
  const seed = createHash('sha256').update(`w-catch2-viewer-provisioning:${keyId}`).digest();
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  return { keyId, privateKeyPem, publicKeyPem, provider: new LocalPemSigningKeyProvider(keyId, privateKeyPem, publicKeyPem) };
}
const capabilityKey = fixedEd25519('ed25519:viewer-capability-issuer-catch2-provisioning');
const identityKey = fixedEd25519('ed25519:viewer-identity-issuer-catch2-provisioning');
const pcbKey = fixedEd25519('ed25519:pcb-issuer-catch2-provisioning');

let root: string;
let bindingId: string;
const repository = () => new CasBackedArtifactRepository(new MimersByteStorageBackend(new FileCASRepository(h.casDir, { durabilityMode: 'none' }), h.indexDir));
const put = (body: { artifact_id: string; content_hash: { algorithm: string; value: string } }) => repository().put({ artifact_id: body.artifact_id, content_hash: body.content_hash, body } as never);
const indexEntryPath = (id: string) => path.join(h.indexDir, `${createHash('sha256').update(id).digest('hex')}.idx`);
const objectPath = (id: string) => new FileCASRepository(h.casDir).getFilePath((JSON.parse(readFileSync(indexEntryPath(id), 'utf8')) as { hash: string }).hash);
const issuerId = createViewerCapabilityIssuerArtifact({ issuer_key_id: capabilityKey.keyId, owner_authority_ref: OWNER_AUTHORITY_REF }).artifact_id;

const input = (from = '2026-01-01T00:00:00.000Z', until = '2027-01-01T00:00:00.000Z') => ({
  projectId: PROJECT_ID,
  contextBindingArtifactId: bindingId,
  releaseArtifactId: RELEASE_ID,
  viewerIdentityArtifactId: h.viewerIdentityId,
  requestedByUserId: 'user-1',
  capabilityValidFrom: new Date(from),
  capabilityValidUntil: new Date(until),
});

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'wcatch2-viewer-provisioning-'));
  h.casDir = path.join(root, 'cas');
  h.indexDir = path.join(root, 'index');
  mkdirSync(h.casDir, { recursive: true });
  mkdirSync(h.indexDir, { recursive: true });
  await new FileCASRepository(h.casDir, { durabilityMode: 'none' }).initialize();
  h.puts.length = 0;
  h.bindings.length = 0;
  h.bindingListError = null;
  h.accessError = null;
  h.viewerIdentityError = null;
  h.spawns = 0;
  process.env.VIEWER_CAPABILITY_ISSUER_KEY_ID = capabilityKey.keyId;
  process.env.VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM = capabilityKey.privateKeyPem;
  process.env.VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM = capabilityKey.publicKeyPem;
  process.env.VIEWER_IDENTITY_ISSUER_KEY_ID = identityKey.keyId;
  process.env.VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM = identityKey.publicKeyPem;
  process.env.PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID = pcbKey.keyId;
  process.env.PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM = pcbKey.publicKeyPem;
  __resetViewerCapabilitySigningProviderForTests(null);
  __resetViewerCapabilityVerifierForTests(null);
  __resetViewerIdentityVerifierForTests(null);

  await put({ artifact_id: RELEASE_ID, content_hash: { algorithm: 'sha256', value: RELEASE_HASH }, artifact_type: 'product_release_manifest', release_hash: { value: RELEASE_HASH } } as never);
  const bareIdentityIssuer = createViewerIdentityIssuerArtifact({ issuer_key_id: identityKey.keyId, owner_authority_ref: { artifact_id: 'owner-authority-catch2-identity', artifact_type: 'owner_authority_attestation' } });
  const identityIssuer = { ...bareIdentityIssuer, attestation: await attestViewerIdentityIssuerArtifact({ issuer: bareIdentityIssuer, signing: identityKey.provider }) };
  await put(identityIssuer);
  const bareIdentity = createViewerIdentityArtifact({
    runtime_component: 'canonical LU ViewerKernel / localization viewer runtime',
    product_release_ref: { artifact_id: RELEASE_ID, artifact_type: 'product_release_manifest' },
    product_release_hash: RELEASE_HASH,
    issuer_ref: { artifact_id: identityIssuer.artifact_id, artifact_type: identityIssuer.artifact_type },
    issuer_key_id: identityKey.keyId,
  });
  const identity = { ...bareIdentity, attestation: await attestViewerIdentityArtifact({ identity: bareIdentity, issuer: identityIssuer, signing: identityKey.provider }) };
  await put(identity);
  h.viewerIdentityId = identity.artifact_id;

  const pcbIssuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: pcbKey.keyId, issuer_version: 'project-context-binding-issuer-v2' });
  await put(pcbIssuer);
  const bareBinding = createProjectContextBindingArtifactV2({
    project_id: PROJECT_ID,
    project_context_ref: { artifact_id: 'lu_project_context-catch2', artifact_type: 'LU_PROJECT_CONTEXT' },
    project_property_binding_ref: { artifact_id: 'project-property-binding-catch2', artifact_type: 'project_property_binding' },
    binding_version: 'project-context-binding-v2',
    authority_ref: { artifact_id: pcbIssuer.artifact_id, artifact_type: pcbIssuer.artifact_type },
  });
  const binding = { ...bareBinding, attestation: await attestProjectContextBindingArtifact({ artifact: bareBinding, issuer: pcbIssuer, signing: pcbKey.provider }) };
  await put(binding);
  await new PrismaProjectContextBindingIndex().register(binding as never);
  bindingId = binding.artifact_id;
  h.puts.length = 0;
});
afterEach(() => {
  __resetViewerCapabilitySigningProviderForTests(null);
  __resetViewerCapabilityVerifierForTests(null);
  __resetViewerIdentityVerifierForTests(null);
  rmSync(root, { recursive: true, force: true });
});

const RAW = /[A-Za-z]:[\\/]|\.idx|MIMERS_|WORM|Collision|EIO|EISDIR|ECONNREFUSED|REJECT_|Artifact not found/;

async function mintedOnce() {
  const first = await executeViewerCapabilityProvisioning(input());
  expect(first).toEqual({ ok: true, capabilityArtifactId: expect.stringMatching(/^viewer-capability-/), reused: false });
  h.puts.length = 0;
  return first.ok ? first.capabilityArtifactId : '';
}

describe('W-CATCH2 #10: normal flows unchanged', () => {
  it('first run mints (issuer + capability), a retry of the same request reuses', async () => {
    const id = await mintedOnce();
    expect(await executeViewerCapabilityProvisioning(input())).toEqual({ ok: true, capabilityArtifactId: id, reused: true });
    expect(h.puts).toEqual([]);
  });
  it('a new window after the issuer exists mints only the new capability (the existing issuer is reused, proven present)', async () => {
    await mintedOnce();
    const second = await executeViewerCapabilityProvisioning(input('2026-02-01T00:00:00.000Z', '2027-02-01T00:00:00.000Z'));
    expect(second).toMatchObject({ ok: true, reused: false });
    expect(h.puts).not.toContain(issuerId);
  });
});

type Expected = { readonly failureCode: string; readonly retryable: boolean };
const expectTypedNoWrite = (outcome: unknown, expected: Expected) => {
  const o = outcome as { ok: boolean; superseded?: boolean; failureCode?: string; failureDetail?: string };
  expect({ ok: o.ok, superseded: o.superseded, failureCode: o.failureCode }).toEqual({ ok: false, superseded: false, failureCode: expected.failureCode });
  expect(o.failureDetail).toContain(expected.retryable ? 'Ett nytt försök kan lyckas.' : 'Felet är bestående och löses inte av ett nytt försök.');
  expect(o.failureDetail).not.toMatch(RAW);
  expect(h.puts, 'nothing minted or re-issued over the existing object').toEqual([]);
};

describe('W-CATCH2 #10: a damaged or unreadable EXISTING issuer is never "not minted yet"', () => {
  const cases: Array<[string, () => void, Expected]> = [
    ['issuer bytes corrupted', () => writeFileSync(objectPath(issuerId), Buffer.from('{"x":1}')), { failureCode: 'EXISTING_ARTIFACT_INTEGRITY_FAULT', retryable: false }],
    ['issuer object gone behind its index entry', () => unlinkSync(objectPath(issuerId)), { failureCode: 'EXISTING_ARTIFACT_INTEGRITY_FAULT', retryable: false }],
    ['issuer index entry torn', () => writeFileSync(indexEntryPath(issuerId), '{"artifact_id":"'), { failureCode: 'EXISTING_ARTIFACT_INTEGRITY_FAULT', retryable: false }],
    ['issuer index entry unreadable (EISDIR)', () => { unlinkSync(indexEntryPath(issuerId)); mkdirSync(indexEntryPath(issuerId)); }, { failureCode: 'EXISTING_ARTIFACT_READ_ERROR', retryable: true }],
  ];
  for (const [name, sabotage, expected] of cases) {
    it(`${name} -> ${expected.failureCode}, nothing written`, async () => {
      await mintedOnce();
      sabotage();
      expectTypedNoWrite(await executeViewerCapabilityProvisioning(input('2026-03-01T00:00:00.000Z', '2027-03-01T00:00:00.000Z')), expected);
    });
  }
});

describe('W-CATCH2 #10: a damaged, unreadable or unverifiable EXISTING capability is never re-issued', () => {
  const cases: Array<[string, (capabilityId: string) => void | Promise<void>, Expected]> = [
    ['capability bytes corrupted', (c) => writeFileSync(objectPath(c), Buffer.from('{"x":1}')), { failureCode: 'EXISTING_ARTIFACT_INTEGRITY_FAULT', retryable: false }],
    ['capability object gone behind its index entry', (c) => unlinkSync(objectPath(c)), { failureCode: 'EXISTING_ARTIFACT_INTEGRITY_FAULT', retryable: false }],
    ['capability index entry unreadable (EISDIR)', (c) => { unlinkSync(indexEntryPath(c)); mkdirSync(indexEntryPath(c)); }, { failureCode: 'EXISTING_ARTIFACT_READ_ERROR', retryable: true }],
    [
      'capability content edited after persistence (valid CAS object)',
      async (c) => {
        const envelope = JSON.parse(readFileSync(objectPath(c), 'utf8')) as { body: { payload: Record<string, unknown> } };
        envelope.body.payload = { ...envelope.body.payload, valid_until: '2099-01-01T00:00:00.000Z' };
        const cas = new FileCASRepository(h.casDir, { durabilityMode: 'none' });
        await cas.initialize();
        const { hash } = await cas.putBytes(Buffer.from(JSON.stringify(envelope), 'utf8'));
        writeFileSync(indexEntryPath(c), JSON.stringify({ artifact_id: c, hash }));
      },
      { failureCode: 'EXISTING_ARTIFACT_REFUSED', retryable: false },
    ],
  ];
  for (const [name, sabotage, expected] of cases) {
    it(`${name} -> ${expected.failureCode}, nothing re-issued`, async () => {
      const id = await mintedOnce();
      await sabotage(id);
      expectTypedNoWrite(await executeViewerCapabilityProvisioning(input()), expected);
    });
  }
  it('never stored (index entry gone): the proven absence of exactly that id mints it again, byte-identical', async () => {
    const id = await mintedOnce();
    const bytes = readFileSync(objectPath(id));
    unlinkSync(indexEntryPath(id));
    expect(await executeViewerCapabilityProvisioning(input())).toEqual({ ok: true, capabilityArtifactId: id, reused: false });
    expect(readFileSync(objectPath(id)).equals(bytes)).toBe(true);
  });
});

describe('W-CATCH2 #10: the same surface -- the current binding, the access check and the outer catch never lose the cause', () => {
  it('the current binding cannot be read (index down) -> CURRENT_BINDING_READ_ERROR (retryable), not an untyped CURRENT_BINDING_UNAVAILABLE with raw text', async () => {
    await mintedOnce();
    h.bindingListError = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
    expectTypedNoWrite(await executeViewerCapabilityProvisioning(input()), { failureCode: 'CURRENT_BINDING_READ_ERROR', retryable: true });
  });
  it('no binding registered at all -> CURRENT_BINDING_UNAVAILABLE (genuine absence; neutral text)', async () => {
    h.bindings.length = 0;
    const outcome = (await executeViewerCapabilityProvisioning(input())) as { failureCode?: string; failureDetail?: string };
    expect(outcome.failureCode).toBe('CURRENT_BINDING_UNAVAILABLE');
    expect(outcome.failureDetail).not.toMatch(RAW);
  });
  it('the access facts cannot be read -> a technical failure, never REQUESTER_NOT_AUTHORIZED', async () => {
    h.accessError = Object.assign(new Error("Can't reach database server"), { name: 'PrismaClientInitializationError' });
    const outcome = (await executeViewerCapabilityProvisioning(input())) as { failureCode?: string; failureDetail?: string };
    expect(outcome.failureCode).toBe('PROVISIONING_EXECUTION_ERROR');
    expect(outcome.failureDetail).not.toMatch(/database server/);
  });
  it('a typed denial -> REQUESTER_NOT_AUTHORIZED (unchanged)', async () => {
    h.accessError = Object.assign(new Error('User is not a member of this project'), { code: 'PROJECT_ACCESS_DENIED' });
    expect(await executeViewerCapabilityProvisioning(input())).toMatchObject({ ok: false, failureCode: 'REQUESTER_NOT_AUTHORIZED' });
  });
  it('the viewer identity cannot be resolved -> the same code, a neutral text without the raw cause', async () => {
    h.viewerIdentityError = Object.assign(new Error("EIO: i/o error, read 'D:\\mimer-demo\\cas\\x.idx'"), { code: 'EIO' });
    const outcome = (await executeViewerCapabilityProvisioning(input())) as { failureCode?: string; failureDetail?: string };
    expect(outcome.failureCode).toBe('VIEWER_IDENTITY_UNAVAILABLE_OR_UNVERIFIABLE');
    expect(outcome.failureDetail).not.toMatch(RAW);
  });
});
