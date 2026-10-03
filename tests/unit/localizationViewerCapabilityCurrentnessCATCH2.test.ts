// @vitest-environment node
/**
 * W-CATCH2 #13 + #9 (owner decisions 2026-10-02/03, OD-R1/OD-R2; BOOT verifier: truth-critical before
 * U51): resolveLocalizationViewerRuntimeConfigForProject skipped EVERY completed capability it could
 * not read or verify. With one unreadable capability the answer became null ("not configured", 404);
 * with an unreadable one next to a valid one, the valid one was chosen SILENTLY and the ambiguity check
 * was bypassed -- the pattern W-APR closed for assessments.
 *
 * Now, on a REAL FileCAS stack (mkdtemp, cold per resolution): a completed request records a capability
 * that was minted, so it must exist and verify. A capability is skipped ONLY when its own content (bound
 * to its id) proves it is not the current one -- another project, binding, viewer identity or release, a
 * superseded binding, a validity window that has not started or has ended. Anything else (read error,
 * lost or never-stored object, corrupt bytes, tampered content, failed signature/issuer, a binding that
 * cannot be resolved) is a typed LuReadFaultError and fails the whole resolution closed. #9: the
 * "current binding unavailable" refusal inside the verification keeps its cause, so a read error there
 * is READ_ERROR (retryable), not a refusal. The route answers it 503/409 with its own code, never 404.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());

import { FileCASRepository, LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import {
  createProductViewerCapabilityArtifact,
  createViewerCapabilityIssuerArtifact,
  type ProductViewerCapabilityArtifact,
} from '../../packages/mps-lu/src/artifacts/ProductViewerCapabilityArtifact';
import { createViewerIdentityArtifact, createViewerIdentityIssuerArtifact } from '../../packages/mps-lu/src/artifacts/ViewerIdentityArtifact';
import { MimersByteStorageBackend } from '../../packages/mps-runtime/src/repository/MimersByteStorageBackend';
import { CasBackedArtifactRepository } from '../../packages/mps-runtime/src/repository/CasBackedArtifactRepository';
import { attestProductViewerCapability, attestViewerCapabilityIssuerArtifact } from '../../server/modules/localization/productViewerCapabilityAuthority';
import { attestViewerIdentityArtifact, attestViewerIdentityIssuerArtifact } from '../../server/modules/localization/viewerIdentityAuthority';
import {
  LocalizationViewerCapabilityProvider,
  resolveLocalizationViewerRuntimeConfigForProject,
  type ViewerCapabilityCurrentnessDependencies,
} from '../../server/modules/localization/createLocalizationViewerRuntime';
import { ProjectContextBindingCurrentUnavailableError, type ProjectContextBindingProvider } from '../../server/modules/localization/projectContextBindingRuntime';
import type { ViewerCapabilityProvisioningRequestRecord } from '../../server/modules/localization/viewerCapabilityProvisioningQueue';
import { LuReadFaultError } from '../../server/modules/localization/readFaultClassification';
import { __resetViewerCapabilityVerifierForTests } from '../../server/security/viewerCapabilityVerifier';
import { __resetViewerIdentityVerifierForTests } from '../../server/security/viewerIdentityVerifier';
import { hermeticPrismaTouches } from '../helpers/hermeticPrismaGuard';

const NOW = new Date('2026-08-20T12:00:00.000Z');
const RELEASE_HASH = 'a'.repeat(64);
const PROJECT_ID = 'project-w-catch2-viewer';
const BINDING_REF = { artifact_id: 'project-context-binding-w-catch2-viewer', artifact_type: 'project_context_binding' } as const;
const RELEASE_REF = { artifact_id: 'product-release-w-catch2-viewer', artifact_type: 'product_release' } as const;
const OWNER_AUTHORITY_REF = { artifact_id: 'owner-authority-w-catch2-viewer', artifact_type: 'owner_authority_attestation' } as const;

function fixedEd25519(keyId: string) {
  const seed = createHash('sha256').update(`w-catch2-viewer:${keyId}`).digest();
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  return { keyId, privateKeyPem, publicKeyPem, provider: new LocalPemSigningKeyProvider(keyId, privateKeyPem, publicKeyPem) };
}
const capabilityKey = fixedEd25519('ed25519:viewer-capability-issuer-w-catch2');
const foreignKey = fixedEd25519('ed25519:viewer-capability-issuer-w-catch2'); // same id, other seed below
const otherSeedKey = (() => {
  const seed = createHash('sha256').update('w-catch2-viewer:a-forger').digest();
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  return new LocalPemSigningKeyProvider(foreignKey.keyId, privateKeyPem, publicKeyPem);
})();
const identityKey = fixedEd25519('ed25519:viewer-identity-issuer-w-catch2');

const unsignedIdentityIssuer = createViewerIdentityIssuerArtifact({ issuer_key_id: identityKey.keyId, owner_authority_ref: OWNER_AUTHORITY_REF });
const unsignedIdentity = createViewerIdentityArtifact({
  runtime_component: 'canonical LU ViewerKernel / localization viewer runtime',
  product_release_ref: RELEASE_REF,
  product_release_hash: RELEASE_HASH,
  issuer_ref: { artifact_id: unsignedIdentityIssuer.artifact_id, artifact_type: unsignedIdentityIssuer.artifact_type },
  issuer_key_id: identityKey.keyId,
});
const VIEWER_IDENTITY_REF = { artifact_id: unsignedIdentity.artifact_id, artifact_type: unsignedIdentity.artifact_type };

let root: string;
let casDir: string;
let indexDir: string;
function repository() {
  return new CasBackedArtifactRepository(new MimersByteStorageBackend(new FileCASRepository(casDir, { durabilityMode: 'none' }), indexDir));
}
async function put(body: { artifact_id: string; content_hash: { algorithm: string; value: string } }): Promise<void> {
  await repository().put({ artifact_id: body.artifact_id, content_hash: body.content_hash, body } as never);
}
function indexEntryPath(artifactId: string): string {
  return path.join(indexDir, `${createHash('sha256').update(artifactId).digest('hex')}.idx`);
}
function objectPath(artifactId: string): string {
  return new FileCASRepository(casDir).getFilePath((JSON.parse(readFileSync(indexEntryPath(artifactId), 'utf8')) as { hash: string }).hash);
}

async function seed() {
  const unsignedIssuer = createViewerCapabilityIssuerArtifact({ issuer_key_id: capabilityKey.keyId, owner_authority_ref: OWNER_AUTHORITY_REF });
  const issuer = { ...unsignedIssuer, attestation: await attestViewerCapabilityIssuerArtifact({ issuer: unsignedIssuer, signing: capabilityKey.provider }) };
  await put(issuer);
  await put({
    artifact_id: RELEASE_REF.artifact_id,
    content_hash: { algorithm: 'sha256', value: RELEASE_HASH },
    artifact_type: RELEASE_REF.artifact_type,
    references: [],
    payload: {},
    release_hash: { algorithm: 'sha256', value: RELEASE_HASH },
  } as never);
  const identityIssuer = { ...unsignedIdentityIssuer, attestation: await attestViewerIdentityIssuerArtifact({ issuer: unsignedIdentityIssuer, signing: identityKey.provider }) };
  await put(identityIssuer);
  const identity = { ...unsignedIdentity, attestation: await attestViewerIdentityArtifact({ identity: unsignedIdentity, issuer: identityIssuer, signing: identityKey.provider }) };
  await put(identity);
  const capability = await buildCapability(issuer);
  await put(capability);
  return { issuer, capability };
}

async function buildCapability(
  issuer: { artifact_id: string; artifact_type: string; payload: { issuer_key_id: string } } & object,
  overrides: Partial<
    Pick<
      ProductViewerCapabilityArtifact['payload'],
      'subject_project_id' | 'project_context_binding_ref' | 'viewer_identity_ref' | 'product_release_ref' | 'valid_from' | 'valid_until'
    >
  > = {},
  signing: LocalPemSigningKeyProvider = capabilityKey.provider,
): Promise<ProductViewerCapabilityArtifact> {
  const unsigned = createProductViewerCapabilityArtifact({
    issuer_key_id: capabilityKey.keyId,
    issuer_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
    subject_project_id: overrides.subject_project_id ?? PROJECT_ID,
    project_context_binding_ref: overrides.project_context_binding_ref ?? BINDING_REF,
    viewer_identity_ref: overrides.viewer_identity_ref ?? VIEWER_IDENTITY_REF,
    product_release_ref: overrides.product_release_ref ?? RELEASE_REF,
    product_release_hash: RELEASE_HASH,
    valid_from: overrides.valid_from ?? '2026-01-01T00:00:00.000Z',
    valid_until: overrides.valid_until ?? '2027-01-01T00:00:00.000Z',
  });
  const attestation = await attestProductViewerCapability({ capability: unsigned, issuer: issuer as never, signing });
  return { ...unsigned, attestation };
}

function completedRequest(capabilityArtifactId: string): ViewerCapabilityProvisioningRequestRecord {
  return {
    id: `request-${capabilityArtifactId}`,
    projectId: PROJECT_ID,
    contextBindingArtifactId: BINDING_REF.artifact_id,
    releaseArtifactId: RELEASE_REF.artifact_id,
    viewerIdentityArtifactId: VIEWER_IDENTITY_REF.artifact_id,
    requestedByUserId: 'user-w-catch2',
    status: 'COMPLETED',
    capabilityArtifactId,
    capabilityValidFrom: new Date('2026-01-01T00:00:00.000Z'),
    capabilityValidUntil: new Date('2027-01-01T00:00:00.000Z'),
    failureCode: null,
    failureDetail: null,
    createdAt: NOW,
    leasedAt: null,
    leaseExpiresAt: null,
    completedAt: NOW,
    failedAt: null,
  };
}

/** resolveCurrent answers the binding on the first `healthyCalls` calls, then fails with `later`. */
function bindingProvider(healthyCalls = Infinity, later?: () => Error): ProjectContextBindingProvider {
  let calls = 0;
  return {
    resolveCurrent: async () => {
      calls += 1;
      if (calls > healthyCalls && later) throw later();
      return { artifact_id: BINDING_REF.artifact_id, artifact_type: BINDING_REF.artifact_type } as never;
    },
  } as unknown as ProjectContextBindingProvider;
}

function deps(requests: readonly ViewerCapabilityProvisioningRequestRecord[], provider = bindingProvider()): ViewerCapabilityCurrentnessDependencies {
  return {
    currentBindingProvider: provider,
    resolveRelease: async () => ({ artifact_id: RELEASE_REF.artifact_id, artifact_type: RELEASE_REF.artifact_type, release_hash: { value: RELEASE_HASH } }),
    resolveViewerIdentity: async () => ({ viewerIdentityRef: VIEWER_IDENTITY_REF }),
    listCompletedRequests: async () => requests,
    now: () => NOW,
  };
}

async function outcome(requests: readonly ViewerCapabilityProvisioningRequestRecord[], provider?: ProjectContextBindingProvider) {
  try {
    return { config: await resolveLocalizationViewerRuntimeConfigForProject(PROJECT_ID, repository(), deps(requests, provider)) };
  } catch (error) {
    return { error: error as Error & Record<string, unknown> };
  }
}

function expectTyped(result: Awaited<ReturnType<typeof outcome>>, subject: string, faultClass: string, retryable: boolean): void {
  expect('error' in result, 'a typed fault, never a config or null').toBe(true);
  if (!('error' in result)) return;
  expect(result.error).toBeInstanceOf(LuReadFaultError);
  expect({ subject: result.error.subject, faultClass: result.error.faultClass, retryable: result.error.retryable }).toEqual({ subject, faultClass, retryable });
  expect(result.error.message).not.toMatch(/viewer-capability-|Artifact not found|[A-Za-z]:[\\/]/);
}

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'wcatch2-viewer-capability-'));
  casDir = path.join(root, 'cas');
  indexDir = path.join(root, 'index');
  mkdirSync(casDir, { recursive: true });
  mkdirSync(indexDir, { recursive: true });
  await new FileCASRepository(casDir, { durabilityMode: 'none' }).initialize();
  __resetViewerCapabilityVerifierForTests(new LocalPemVerificationKeyProvider(capabilityKey.keyId, capabilityKey.publicKeyPem));
  __resetViewerIdentityVerifierForTests(new LocalPemVerificationKeyProvider(identityKey.keyId, identityKey.publicKeyPem));
});
afterEach(() => {
  __resetViewerCapabilityVerifierForTests(null);
  __resetViewerIdentityVerifierForTests(null);
  rmSync(root, { recursive: true, force: true });
});

describe('W-CATCH2 #13: normal flows unchanged', () => {
  it('one valid completed capability -> its config', async () => {
    const { capability } = await seed();
    const result = await outcome([completedRequest(capability.artifact_id)]);
    expect(result).toEqual({
      config: {
        capabilityArtifactId: capability.artifact_id,
        expectedProjectId: PROJECT_ID,
        expectedContextBindingId: BINDING_REF.artifact_id,
        expectedViewerIdentityId: VIEWER_IDENTITY_REF.artifact_id,
        expectedReleaseId: RELEASE_REF.artifact_id,
        expectedReleaseHash: RELEASE_HASH,
      },
    });
  });
  it('no completed request -> null (not configured yet)', async () => {
    await seed();
    expect(await outcome([])).toEqual({ config: null });
  });
  it('two distinct valid capabilities -> AMBIGUOUS (unchanged)', async () => {
    const { issuer, capability } = await seed();
    const rotated = await buildCapability(issuer, { valid_from: '2026-02-01T00:00:00.000Z', valid_until: '2027-02-01T00:00:00.000Z' });
    await put(rotated);
    const result = await outcome([completedRequest(capability.artifact_id), completedRequest(rotated.artifact_id)]);
    expect('error' in result && result.error.message).toMatch(/^REJECT_LU_VIEWER_CAPABILITY_AMBIGUOUS_CURRENT/);
  });
});

describe('W-CATCH2 #13: skipped ONLY when the capability\'s own content proves it is not current', () => {
  it('an expired capability next to a valid one -> the valid one (expired is proven not current)', async () => {
    const { issuer, capability } = await seed();
    const expired = await buildCapability(issuer, { valid_from: '2025-01-01T00:00:00.000Z', valid_until: '2025-06-01T00:00:00.000Z' });
    await put(expired);
    const result = await outcome([completedRequest(expired.artifact_id), completedRequest(capability.artifact_id)]);
    expect('config' in result && result.config?.capabilityArtifactId).toBe(capability.artifact_id);
  });
  it('a capability not yet valid, alone -> null', async () => {
    const { issuer } = await seed();
    const future = await buildCapability(issuer, { valid_from: '2026-12-01T00:00:00.000Z', valid_until: '2027-12-01T00:00:00.000Z' });
    await put(future);
    expect(await outcome([completedRequest(future.artifact_id)])).toEqual({ config: null });
  });
  // W-CATCH3 (CATCH2 verifier finding 1): this case used to read a COMPLETED row of the CURRENT binding
  // naming a capability of another binding as "superseded, skip it". The rows are selected on exactly the
  // current binding, so that is a misfiled row (damage), now a typed fault (see the W-CATCH3 block below).
  // A binding that really moves on is the race below: the capability's own binding was current when its
  // row was selected and is superseded when it is verified.
  it('the binding is superseded while the resolution runs (the capability names the binding its row was selected on) -> proven not current, skipped -> null', async () => {
    const { capability } = await seed();
    let calls = 0;
    const provider = {
      resolveCurrent: async () => {
        calls += 1;
        return (calls === 1 ? BINDING_REF : { artifact_id: 'project-context-binding-successor', artifact_type: 'project_context_binding' }) as never;
      },
    } as unknown as ProjectContextBindingProvider;
    expect(await outcome([completedRequest(capability.artifact_id)], provider)).toEqual({ config: null });
  });
});

type Sabotage = (ids: { capabilityId: string; issuerId: string }) => void | Promise<void>;
const DAMAGE: Array<[string, Sabotage, string, boolean]> = [
  ['the capability object is gone behind its index entry', ({ capabilityId }) => unlinkSync(objectPath(capabilityId)), 'STORAGE_INTEGRITY_FAULT', false],
  ['the capability index entry is torn', ({ capabilityId }) => writeFileSync(indexEntryPath(capabilityId), '{"artifact_id":"'), 'STORAGE_INTEGRITY_FAULT', false],
  ['the capability index entry cannot be read (EISDIR)', ({ capabilityId }) => { unlinkSync(indexEntryPath(capabilityId)); mkdirSync(indexEntryPath(capabilityId)); }, 'READ_ERROR', true],
  ['the completed capability was never stored in the CAS', ({ capabilityId }) => unlinkSync(indexEntryPath(capabilityId)), 'MISSING_FROM_CAS', false],
  ['the capability bytes are corrupted', ({ capabilityId }) => writeFileSync(objectPath(capabilityId), Buffer.from('{"not":"what the hash says"}')), 'STORAGE_INTEGRITY_FAULT', false],
  [
    'the capability content was edited after persistence (a valid CAS object)',
    async ({ capabilityId }) => {
      const envelope = JSON.parse(readFileSync(objectPath(capabilityId), 'utf8')) as { body: { payload: Record<string, unknown> } };
      envelope.body.payload = { ...envelope.body.payload, valid_until: '2099-01-01T00:00:00.000Z' };
      const cas = new FileCASRepository(casDir, { durabilityMode: 'none' });
      await cas.initialize();
      const { hash } = await cas.putBytes(Buffer.from(JSON.stringify(envelope), 'utf8'));
      writeFileSync(indexEntryPath(capabilityId), JSON.stringify({ artifact_id: capabilityId, hash }));
    },
    'REFUSED',
    false,
  ],
  ["the capability's issuer is gone behind its index entry", ({ issuerId }) => unlinkSync(objectPath(issuerId)), 'STORAGE_INTEGRITY_FAULT', false],
];

describe('W-CATCH2 #13: a capability that cannot be read or verified is never skipped', () => {
  for (const [name, sabotage, faultClass, retryable] of DAMAGE) {
    it(`ALONE: ${name} -> typed ${faultClass} (retryable ${retryable}), never null "not configured"`, async () => {
      const { issuer, capability } = await seed();
      await sabotage({ capabilityId: capability.artifact_id, issuerId: issuer.artifact_id });
      expectTyped(await outcome([completedRequest(capability.artifact_id)]), 'viewer-capability', faultClass, retryable);
    });
    it(`NEXT TO A VALID ONE: ${name} -> typed ${faultClass}, the valid one is never chosen silently`, async () => {
      const { issuer, capability } = await seed();
      const other = await buildCapability(issuer, { valid_from: '2026-03-01T00:00:00.000Z', valid_until: '2027-03-01T00:00:00.000Z' });
      await put(other);
      // The damaged one is the original capability; the other stays intact (except for the issuer case, shared by both).
      await sabotage({ capabilityId: capability.artifact_id, issuerId: issuer.artifact_id });
      expectTyped(await outcome([completedRequest(other.artifact_id), completedRequest(capability.artifact_id)]), 'viewer-capability', faultClass, retryable);
    });
  }

  it('a capability signed by another key under the trusted key id -> REFUSED, never skipped in favour of a valid one', async () => {
    const { issuer, capability } = await seed();
    const forged = await buildCapability(issuer, { valid_from: '2026-04-01T00:00:00.000Z', valid_until: '2027-04-01T00:00:00.000Z' }, otherSeedKey);
    await put(forged);
    const result = await outcome([completedRequest(capability.artifact_id), completedRequest(forged.artifact_id)]);
    expectTyped(result, 'viewer-capability', 'REFUSED', false);
    expect('error' in result && result.error.refusalCode).toBe('REJECT_VIEWER_CAPABILITY_SIGNATURE');
  });

  it('#9: the current binding cannot be read DURING verification (EIO) -> READ_ERROR (retryable) through the kept cause, never a refusal or a skip', async () => {
    const { capability } = await seed();
    const eio = () => new ProjectContextBindingCurrentUnavailableError(false, Object.assign(new Error('EIO: i/o error'), { code: 'EIO' }));
    expectTyped(await outcome([completedRequest(capability.artifact_id)], bindingProvider(1, eio)), 'viewer-capability', 'READ_ERROR', true);
  });

  it('#9: the current binding is refused during verification -> REFUSED with the binding\'s own token', async () => {
    const { capability } = await seed();
    const refused = () => new ProjectContextBindingCurrentUnavailableError(false, new Error('REJECT_PROJECT_CONTEXT_BINDING_V2_SIGNATURE'));
    const result = await outcome([completedRequest(capability.artifact_id)], bindingProvider(1, refused));
    expectTyped(result, 'viewer-capability', 'REFUSED', false);
    expect('error' in result && result.error.refusalCode).toBe('REJECT_PROJECT_CONTEXT_BINDING_V2_SIGNATURE');
  });
});

describe('W-CATCH2 #13: the current binding of the subject itself', () => {
  it('genuinely absent (no binding registered) -> null, no capability can exist', async () => {
    await seed();
    const emptyIndex = { listBindingRefs: async () => [], listSupersessionRefs: async () => [] };
    const { ProjectContextBindingProvider } = await import('../../server/modules/localization/projectContextBindingRuntime');
    const provider = new ProjectContextBindingProvider(repository(), emptyIndex as never, {} as never);
    expect(await outcome([], provider)).toEqual({ config: null });
  });
  it('cannot be read (database down) -> typed READ_ERROR for the current binding, never a raw provider error', async () => {
    await seed();
    const down = () => new ProjectContextBindingCurrentUnavailableError(false, Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }));
    expectTyped(await outcome([], bindingProvider(0, down)), 'current-binding', 'READ_ERROR', true);
    expect(hermeticPrismaTouches).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------
// W-CATCH3 (CATCH2 verifier finding 1, probes V1-V9): the object read under a capability id must BE
// that capability, and a completed row selected on exactly this subject can only differ from its
// capability through damage. The CAS resolver hands back whatever bytes the index entry points at
// (it compares neither the envelope nor the body with the id it was asked for), so before this an
// index entry pointing at another capability's bytes, or a misfiled row, read as "not configured"
// (null -> 404) or let another valid capability win silently past the ambiguity check.
// ------------------------------------------------------------------------------------------------

/** Points the index entry of `fromId` at the CAS object of `toId` (a misdirected index entry). */
function pointIndexAt(fromId: string, toId: string): void {
  const { hash } = JSON.parse(readFileSync(indexEntryPath(toId), 'utf8')) as { hash: string };
  writeFileSync(indexEntryPath(fromId), JSON.stringify({ artifact_id: fromId, hash }));
}

function expectIntegrity(result: Awaited<ReturnType<typeof outcome>>, refusalCode: string | null = null): void {
  expectTyped(result, 'viewer-capability', 'STORAGE_INTEGRITY_FAULT', false);
  expect('error' in result && result.error.refusalCode).toBe(refusalCode);
}

const EXPIRED_WINDOW = { valid_from: '2025-01-01T00:00:00.000Z', valid_until: '2025-06-01T00:00:00.000Z' } as const;
const OTHER_WINDOW = { valid_from: '2026-03-01T00:00:00.000Z', valid_until: '2027-03-01T00:00:00.000Z' } as const;

describe('W-CATCH3 #13: the object read under a capability id is that capability (V1, V2, V9)', () => {
  it('V1: the index entry of the ONLY capability points at an EXPIRED capability of the same subject -> typed STORAGE_INTEGRITY_FAULT, never null "not configured"', async () => {
    const { issuer, capability } = await seed();
    const expired = await buildCapability(issuer, EXPIRED_WINDOW);
    await put(expired);
    pointIndexAt(capability.artifact_id, expired.artifact_id);
    expectIntegrity(await outcome([completedRequest(capability.artifact_id)]));
  });
  it('V2: the index entry of the only capability points at a valid capability of ANOTHER project -> typed STORAGE_INTEGRITY_FAULT', async () => {
    const { issuer, capability } = await seed();
    const foreign = await buildCapability(issuer, { subject_project_id: 'project-someone-else' });
    await put(foreign);
    pointIndexAt(capability.artifact_id, foreign.artifact_id);
    expectIntegrity(await outcome([completedRequest(capability.artifact_id)]));
  });
  it('the index entry points at ANOTHER VALID capability of the same subject -> typed STORAGE_INTEGRITY_FAULT, never that other capability', async () => {
    const { issuer, capability } = await seed();
    const sibling = await buildCapability(issuer, OTHER_WINDOW);
    await put(sibling);
    pointIndexAt(capability.artifact_id, sibling.artifact_id);
    expectIntegrity(await outcome([completedRequest(capability.artifact_id)]));
  });
  it('V9a (intact control): two distinct valid capabilities -> AMBIGUOUS, unchanged', async () => {
    const { issuer, capability } = await seed();
    const other = await buildCapability(issuer, OTHER_WINDOW);
    await put(other);
    const result = await outcome([completedRequest(capability.artifact_id), completedRequest(other.artifact_id)]);
    expect('error' in result && result.error.message).toMatch(/^REJECT_LU_VIEWER_CAPABILITY_AMBIGUOUS_CURRENT/);
  });
  it('V9b: the same two, but X\'s index entry points at an expired object -> typed STORAGE_INTEGRITY_FAULT, the other valid one is NEVER chosen silently', async () => {
    const { issuer, capability } = await seed();
    const other = await buildCapability(issuer, OTHER_WINDOW);
    await put(other);
    const expired = await buildCapability(issuer, EXPIRED_WINDOW);
    await put(expired);
    pointIndexAt(capability.artifact_id, expired.artifact_id);
    for (const order of [
      [completedRequest(capability.artifact_id), completedRequest(other.artifact_id)],
      [completedRequest(other.artifact_id), completedRequest(capability.artifact_id)],
    ]) {
      expectIntegrity(await outcome(order));
    }
  });
});

describe('W-CATCH3 #13: a completed row selected on exactly this subject differs from its capability only by damage (V3, V4)', () => {
  const MISFILED: Array<[string, Parameters<typeof buildCapability>[1], string]> = [
    ['another project', { subject_project_id: 'project-someone-else' }, 'REJECT_VIEWER_CAPABILITY_PROJECT'],
    ['another binding', { project_context_binding_ref: { artifact_id: 'project-context-binding-elsewhere', artifact_type: 'project_context_binding' } }, 'REJECT_VIEWER_CAPABILITY_CONTEXT_BINDING'],
    ['another viewer identity', { viewer_identity_ref: { artifact_id: 'viewer-identity-elsewhere', artifact_type: 'viewer_identity' } }, 'REJECT_VIEWER_CAPABILITY_VIEWER_IDENTITY'],
    ['another release', { product_release_ref: { artifact_id: 'product-release-elsewhere', artifact_type: 'product_release' } }, 'REJECT_VIEWER_CAPABILITY_RELEASE_REF'],
  ];
  for (const [what, overrides, refusal] of MISFILED) {
    it(`V3: the row names a valid capability of ${what} -> typed STORAGE_INTEGRITY_FAULT (${refusal} kept as the reason), never "not current"`, async () => {
      const { issuer } = await seed();
      const misfiled = await buildCapability(issuer, overrides);
      await put(misfiled);
      expectIntegrity(await outcome([completedRequest(misfiled.artifact_id)]), refusal);
    });
    it(`V3 next to the valid capability: a row naming a capability of ${what} -> typed, the valid one is never chosen silently`, async () => {
      const { issuer, capability } = await seed();
      const misfiled = await buildCapability(issuer, overrides);
      await put(misfiled);
      expectIntegrity(await outcome([completedRequest(misfiled.artifact_id), completedRequest(capability.artifact_id)]), refusal);
    });
  }
  it('V4: a COMPLETED row whose capability id is the empty string -> typed STORAGE_INTEGRITY_FAULT, never skipped', async () => {
    const { capability } = await seed();
    expectIntegrity(await outcome([completedRequest('')]));
    expectIntegrity(await outcome([completedRequest(''), completedRequest(capability.artifact_id)]));
  });
  it('V4: a COMPLETED row without a capability id (null) -> typed STORAGE_INTEGRITY_FAULT, never skipped (mutation OWN-X7)', async () => {
    const { capability } = await seed();
    const withoutId = { ...completedRequest('x'), capabilityArtifactId: null };
    expectIntegrity(await outcome([withoutId]));
    expectIntegrity(await outcome([completedRequest(capability.artifact_id), withoutId]));
  });
  it('a row listed for this subject that is not of this subject (another release, or not COMPLETED) -> typed STORAGE_INTEGRITY_FAULT', async () => {
    const { capability } = await seed();
    expectIntegrity(await outcome([{ ...completedRequest(capability.artifact_id), releaseArtifactId: 'product-release-elsewhere' }]));
    expectIntegrity(await outcome([{ ...completedRequest(capability.artifact_id), status: 'FAILED' }]));
  });
});

describe('W-CATCH3 #13: what stays proof of "not current", and what stays unchanged (V5-V8)', () => {
  // OWN-X2 (CATCH2 verifier) and W-CATCH3 mutation F1-H: a refusal-shaped error that carries a cause is
  // not the verifier's own verdict about the capability's content -- neither proof of "not current" nor a
  // row damage; its cause decides (here a read error).
  for (const token of ['REJECT_VIEWER_CAPABILITY_EXPIRED', 'REJECT_VIEWER_CAPABILITY_PROJECT']) {
    it(`a refusal-shaped error (${token}) that carries a cause (a failed READ inside the verification) is never "not current" nor row damage -> READ_ERROR`, async () => {
      const { issuer, capability } = await seed();
      const inner = repository();
      const eio = Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
      const repo = {
        put: (artifact: never) => inner.put(artifact),
        resolve: async <T,>(ref: { artifact_id: string; artifact_type: string }): Promise<T> => {
          if (ref.artifact_id === issuer.artifact_id) throw new Error(token, { cause: eio });
          return inner.resolve<T>(ref);
        },
      };
      const result = await (async () => {
        try {
          return { config: await resolveLocalizationViewerRuntimeConfigForProject(PROJECT_ID, repo as never, deps([completedRequest(capability.artifact_id)])) };
        } catch (error) {
          return { error: error as Error & Record<string, unknown> };
        }
      })();
      expectTyped(result, 'viewer-capability', 'READ_ERROR', true);
    });
  }
  it('V5: the whole index directory is gone -> typed MISSING_FROM_CAS (the known ENOENT limit fails closed here: the completed row says it must exist)', async () => {
    const { capability } = await seed();
    rmSync(indexDir, { recursive: true, force: true });
    expectTyped(await outcome([completedRequest(capability.artifact_id)]), 'viewer-capability', 'MISSING_FROM_CAS', false);
  });
  it('V7/V8 controls: proven absence of the binding -> null; a valid capability -> its config', async () => {
    const { capability } = await seed();
    expect(await outcome([completedRequest(capability.artifact_id)])).toMatchObject({ config: { capabilityArtifactId: capability.artifact_id } });
    const emptyIndex = { listBindingRefs: async () => [], listSupersessionRefs: async () => [] };
    const { ProjectContextBindingProvider } = await import('../../server/modules/localization/projectContextBindingRuntime');
    expect(await outcome([], new ProjectContextBindingProvider(repository(), emptyIndex as never, {} as never))).toEqual({ config: null });
  });
});

describe('W-CATCH3 #13: the runtime provider re-reads the resolved capability by its id -- the object must be that capability', () => {
  it('the index entry of the configured capability points at another VALID capability of the same subject -> refused as a lasting integrity fault, never the other capability', async () => {
    const { issuer, capability } = await seed();
    const sibling = await buildCapability(issuer, OTHER_WINDOW);
    await put(sibling);
    pointIndexAt(capability.artifact_id, sibling.artifact_id);
    const provider = new LocalizationViewerCapabilityProvider(
      repository(),
      {
        capabilityArtifactId: capability.artifact_id,
        expectedProjectId: PROJECT_ID,
        expectedContextBindingId: BINDING_REF.artifact_id,
        expectedViewerIdentityId: VIEWER_IDENTITY_REF.artifact_id,
        expectedReleaseId: RELEASE_REF.artifact_id,
        expectedReleaseHash: RELEASE_HASH,
      },
      () => NOW,
      bindingProvider(),
    );
    const failure = await provider.resolve().then(
      () => null,
      (error: unknown) => error as Error & Record<string, unknown>,
    );
    expect(failure, 'the other capability is never handed to the viewer').not.toBeNull();
    expect(failure?.message).toMatch(/^REJECT_LU_VIEWER_CAPABILITY_UNAVAILABLE/);
    expect({ faultClass: failure?.faultClass, retryable: failure?.retryable }).toEqual({ faultClass: 'STORAGE_INTEGRITY_FAULT', retryable: false });
  });
  it('control: the intact configured capability still resolves', async () => {
    const { capability } = await seed();
    const provider = new LocalizationViewerCapabilityProvider(
      repository(),
      {
        capabilityArtifactId: capability.artifact_id,
        expectedProjectId: PROJECT_ID,
        expectedContextBindingId: BINDING_REF.artifact_id,
        expectedViewerIdentityId: VIEWER_IDENTITY_REF.artifact_id,
        expectedReleaseId: RELEASE_REF.artifact_id,
        expectedReleaseHash: RELEASE_HASH,
      },
      () => NOW,
      bindingProvider(),
    );
    await expect(provider.resolve()).resolves.toMatchObject({ artifact_id: capability.artifact_id });
  });
});

// ------------------------------------------------------------------------------------------------
// W-CATCH3-R2 (CATCH3 verifier Low 1): "not current" (EXPIRED / NOT_YET_VALID / SUPERSEDED) was decided
// BEFORE the capability's attestation was checked, so a capability with no attestation, a garbled
// signature or a forged one (another key under the trusted key id) whose own window had passed read as
// "harmlessly expired": alone null ("not configured"), next to a valid one the valid one won. The
// attestation is now verified first: such a capability is REFUSED, never "not current".
// ------------------------------------------------------------------------------------------------
describe('W-CATCH3-R2 #13: a capability is authentic before it can be "not current"', () => {
  const damaged: Array<[string, (c: ProductViewerCapabilityArtifact) => ProductViewerCapabilityArtifact | Promise<ProductViewerCapabilityArtifact>, string]> = [
    ['without an attestation', (c) => { const { attestation: _a, ...rest } = c; return rest as ProductViewerCapabilityArtifact; }, 'REJECT_VIEWER_CAPABILITY_TAMPERED'],
    ['with a garbled signature', (c) => ({ ...c, attestation: { ...c.attestation!, signature: String(c.attestation!.signature).split('').reverse().join('') } }), 'REJECT_VIEWER_CAPABILITY_SIGNATURE'],
  ];
  for (const [what, damage, refusal] of damaged) {
    it(`an EXPIRED capability ${what}, alone -> REFUSED (${refusal}), never null "not configured"`, async () => {
      const { issuer } = await seed();
      const expired = await damage(await buildCapability(issuer, EXPIRED_WINDOW));
      await put(expired);
      const result = await outcome([completedRequest(expired.artifact_id)]);
      expectTyped(result, 'viewer-capability', 'REFUSED', false);
      expect('error' in result && result.error.refusalCode).toBe(refusal);
    });
    it(`an EXPIRED capability ${what}, next to a valid one -> REFUSED, the valid one is never chosen silently`, async () => {
      const { issuer, capability } = await seed();
      const expired = await damage(await buildCapability(issuer, EXPIRED_WINDOW));
      await put(expired);
      expectTyped(await outcome([completedRequest(expired.artifact_id), completedRequest(capability.artifact_id)]), 'viewer-capability', 'REFUSED', false);
    });
  }
  it('a FORGED (another key under the trusted key id) expired capability next to a valid one -> REFUSED (REJECT_VIEWER_CAPABILITY_SIGNATURE)', async () => {
    const { issuer, capability } = await seed();
    const forged = await buildCapability(issuer, EXPIRED_WINDOW, otherSeedKey);
    await put(forged);
    const result = await outcome([completedRequest(capability.artifact_id), completedRequest(forged.artifact_id)]);
    expectTyped(result, 'viewer-capability', 'REFUSED', false);
    expect('error' in result && result.error.refusalCode).toBe('REJECT_VIEWER_CAPABILITY_SIGNATURE');
  });
  it('controls: an authentic expired capability is still "not current" (alone null, next to a valid one the valid one)', async () => {
    const { issuer, capability } = await seed();
    const expired = await buildCapability(issuer, EXPIRED_WINDOW);
    await put(expired);
    expect(await outcome([completedRequest(expired.artifact_id)])).toEqual({ config: null });
    const result = await outcome([completedRequest(expired.artifact_id), completedRequest(capability.artifact_id)]);
    expect('config' in result && result.config?.capabilityArtifactId).toBe(capability.artifact_id);
  });
});
