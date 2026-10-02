/**
 * PRODUCT-LU-VIEWER-CAPABILITY-PROVISIONING-01 Phase B.
 *
 * SECURITY BOUNDARY: this module is imported ONLY by the standalone viewer-capability
 * provisioning worker process (server/workers/lu-viewer-capability-worker.ts). It must never be
 * imported by server/createApp.ts or any request-handling route -- the same
 * PROD-LU-ADMISSION-02 / PRODUCT-LU-EXECUTION-IDENTITY-V3-PROVISIONING-01 issuer/verifier split
 * reapplied here: the live web server enqueues a request and reads status; it must never hold
 * VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM.
 *
 * PINNING: the request names an EXACT (contextBindingArtifactId, releaseArtifactId,
 * viewerIdentityArtifactId) subject, decided at enqueue time. This module mints a capability
 * scoped to exactly that subject -- it never substitutes "whatever is current" at lease time. If
 * the CURRENT binding or release has since moved on from what was pinned, the request is marked
 * SUPERSEDED (never mutated into a new subject) -- the caller (route handler) is responsible for
 * enqueueing a fresh request against the new current state.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MimersIntegration, type ArtifactRepositoryPort } from '@miljobeslut/mps-runtime';
import {
  createViewerCapabilityIssuerArtifact,
  createProductViewerCapabilityArtifact,
  type ProductViewerCapabilityArtifact,
  type ViewerCapabilityIssuerArtifact,
} from '@miljobeslut/mps-lu';
import {
  attestViewerCapabilityIssuerArtifact,
  attestProductViewerCapability,
  verifyProductViewerCapability,
  verifyViewerCapabilityIssuerArtifact,
} from './productViewerCapabilityAuthority';
import { installOwnerIssuedLocalizationViewerCapability } from './installLocalizationViewerCapability';
import { getViewerCapabilitySigningProvider } from '../../security/viewerCapabilitySigningKey';
import { getViewerCapabilityVerifier } from '../../security/viewerCapabilityVerifier';
import { ProjectContextBindingProvider, type AnyProjectContextBindingArtifact } from './projectContextBindingRuntime';
import { PrismaProjectContextBindingIndex } from '../../repositories/projectContextBindingRepository';
import { getProjectContextBindingIssuerVerifier } from '../../security/projectContextBindingIssuerKey';
import { resolveCanonicalProductRelease } from '../release/productReleaseRuntime';
import { resolveCurrentViewerIdentity } from '../../../src/application/resolveCurrentViewerIdentity';
import { prisma } from '../../db/prisma';
import { assertProjectAccess } from '../../security/projectAccess';
import {
  assertReadUnderItsOwnId,
  isProjectAccessDenied,
  isProvenBindingAbsence,
  isExactlyTheDeterministicArtifact,
  LuReadFaultError,
  readExistingOrProvenAbsent,
  toReadFaultError,
} from './readFaultClassification';
import { provisioningFailure, provisioningReadFaultDetailSv, trackArtifactWrites, type ProvisioningWrites } from './provisioningFailure';

const PRIVATE_KEY_ENV = 'VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM';
/** Deterministic, automated-issuance owner authority ref -- distinct from the manual-install one
 *  scripts/ops/bootstrap-viewer-authority-persistent.ts used, so the two are never confused. */
const OWNER_AUTHORITY_REF = {
  artifact_id: 'owner-authority-automated-viewer-capability-provisioning-v1',
  artifact_type: 'owner_authority_attestation',
} as const;

export type ViewerCapabilityProvisioningOutcome =
  | { readonly ok: true; readonly capabilityArtifactId: string; readonly reused: boolean }
  | { readonly ok: false; readonly superseded: true; readonly detail: string }
  | {
      readonly ok: false;
      readonly superseded: false;
      readonly failureCode: string;
      readonly failureDetail: string;
      /** W-CATCH2: raw fault text for the worker's log only -- never stored, never sent. */
      readonly diagnostic?: string;
    };

function fail(code: string, detail: string): never {
  const error = new Error(detail) as Error & { failureCode: string };
  error.failureCode = code;
  throw error;
}

/** Fresh child process, private key deleted from its env first -- same pattern as the v3-identity worker. */
async function runFreshVerifier(args: {
  readonly capabilityArtifactId: string;
  readonly projectId: string;
  readonly bindingId: string;
  readonly viewerIdentityId: string;
  readonly releaseId: string;
  readonly releaseHash: string;
}): Promise<void> {
  const env = { ...process.env };
  delete env[PRIVATE_KEY_ENV];
  let scriptPath: string;
  try {
    scriptPath = fileURLToPath(new URL('./luViewerCapabilityVerifyCli.ts', import.meta.url));
  } catch {
    // CATCH-REVIEWED: NOT_A_READ: locating the verifier script when import.meta.url is not a file URL; no CAS, index or database read.
    scriptPath = path.resolve(process.cwd(), 'server/modules/localization/luViewerCapabilityVerifyCli.ts');
  }
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', scriptPath, args.capabilityArtifactId, args.projectId, args.bindingId, args.viewerIdentityId, args.releaseId, args.releaseHash],
      { env, stdio: 'inherit' },
    );
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) fail('FRESH_VERIFICATION_FAILED', 'fresh public-key-only verification of the capability failed');
}

async function getOrMintIssuer(repo: ArtifactRepositoryPort): Promise<ViewerCapabilityIssuerArtifact> {
  const signing = getViewerCapabilitySigningProvider();
  const bareIssuer = createViewerCapabilityIssuerArtifact({ issuer_key_id: signing.keyId, owner_authority_ref: OWNER_AUTHORITY_REF });
  // W-CATCH2 #10 (OD-R2): mint ONLY on the proven absence of exactly this deterministic id. A read error
  // or a damaged existing issuer is a typed fault -- never "not minted yet", never minted over.
  const read = await readExistingOrProvenAbsent<ViewerCapabilityIssuerArtifact>(
    repo,
    { artifact_id: bareIssuer.artifact_id, artifact_type: bareIssuer.artifact_type },
    'viewer-capability-issuer',
  );
  if (read.found) {
    const existing = read.value;
    // W-CATCH3 (CATCH2 verifier finding 2): the object under the issuer's id must BE the issuer -- an index
    // entry pointing at another object is a lasting integrity fault, never a refusal of "this issuer".
    assertReadUnderItsOwnId('viewer-capability-issuer', existing, bareIssuer.artifact_id, bareIssuer.artifact_type);
    // Same deterministic identity, so it must be exactly this issuer, field for field (before: anything
    // else fell through to a re-mint; an edit that kept id, content_hash and key id was accepted).
    if (!isExactlyTheDeterministicArtifact(existing, bareIssuer)) {
      throw new LuReadFaultError('viewer-capability-issuer', { faultClass: 'REFUSED', retryable: false, refusalCode: null }, new Error('the stored issuer is not the issuer its id names'));
    }
    // W-CATCH3 (CATCH2 verifier finding 3): the field-for-field comparison leaves out the attestation, so
    // the existing issuer is verified against the trusted key before it is used for anything -- a damaged
    // signature is EXISTING_ARTIFACT_REFUSED here, before any write that would rest on it.
    try {
      await verifyViewerCapabilityIssuerArtifact({ issuer: existing, verification: getViewerCapabilityVerifier() });
    } catch (error) {
      throw toReadFaultError('viewer-capability-issuer', error, 'verify');
    }
    return existing;
  }
  const attestation = await attestViewerCapabilityIssuerArtifact({ issuer: bareIssuer, signing });
  const issuer: ViewerCapabilityIssuerArtifact = { ...bareIssuer, attestation };
  // W-CATCH3: a new issuer is verified BEFORE it is written -- a verification key that does not verify it
  // (a configuration error) writes nothing.
  await verifyViewerCapabilityIssuerArtifact({ issuer, verification: getViewerCapabilityVerifier() });
  await repo.put({ artifact_id: issuer.artifact_id, content_hash: issuer.content_hash, body: issuer });
  return issuer;
}

/**
 * Executes (or reconciles) ViewerCapability provisioning for exactly one request. Idempotent: if
 * a valid capability for the exact derived subject already exists, it is recognized and reused --
 * never re-minted. Safe to retry after a crash at any point: content-addressing means a retry
 * either finds the already-genuine capability (reused: true) or mints exactly once.
 */
export async function executeViewerCapabilityProvisioning(input: {
  readonly projectId: string;
  readonly contextBindingArtifactId: string;
  readonly releaseArtifactId: string;
  readonly viewerIdentityArtifactId: string;
  readonly requestedByUserId: string;
  /**
   * PROJECT-CONTEXT-BINDING-V2-PRODUCER-ADOPTION-01 Phase A.1: pinned once by the web layer at
   * enqueue time (see viewerCapabilityProvisioningTrigger.ts). This worker reads these verbatim
   * and never derives or refreshes them -- not from the pinned binding's created_at, not from the
   * release, not from its own clock. A retry/reclaim of the same request always uses the exact
   * same window, which is what keeps the resulting capability's identity deterministic.
   */
  readonly capabilityValidFrom: Date;
  readonly capabilityValidUntil: Date;
}): Promise<ViewerCapabilityProvisioningOutcome> {
  // W-CATCH3 (CATCH2 verifier finding 3): what this run has written, so the stored text never says
  // "Inget utfärdades." after a write was attempted.
  const writes: ProvisioningWrites = { written: false };
  try {
    const requester = await prisma.user.findUnique({
      where: { id: input.requestedByUserId },
      select: { id: true, organisationId: true, bankidId: true, role: true, identityEnvironment: true },
    });
    if (!requester?.organisationId) fail('REQUESTER_NOT_AUTHORIZED', `requesting user ${input.requestedByUserId} has no organisation membership`);
    try {
      await assertProjectAccess(
        { ...requester, identityEnvironment: requester.identityEnvironment as 'MOCK' | 'TEST' | 'PRODUCTION' | 'LEGACY' | undefined },
        input.projectId,
        requester.organisationId,
      );
    } catch (error) {
      // W-CATCH2 (#14 class): only the access check's own denial is "not authorized"; a failed read of
      // the access facts is a technical failure (classified by the outer catch).
      if (!isProjectAccessDenied(error)) throw toReadFaultError('project-access', error);
      fail('REQUESTER_NOT_AUTHORIZED', `user ${input.requestedByUserId} is not a member of project ${input.projectId}`);
    }

    const mimers = await MimersIntegration.create({ env: { ...process.env, MIMERS_REQUIRED: '1' }, forceMimers: true });
    const repo = trackArtifactWrites(mimers.artifactRepository, writes);
    const currentBindingProvider = new ProjectContextBindingProvider(
      repo,
      new PrismaProjectContextBindingIndex(),
      getProjectContextBindingIssuerVerifier(),
    );

    // Currentness gate: if the pinned binding is no longer the current one for this project, this
    // request's subject is stale. Never substitute the new current binding into this request --
    // signal SUPERSEDED so the caller enqueues a fresh request instead.
    let currentBinding: AnyProjectContextBindingArtifact;
    try {
      currentBinding = await currentBindingProvider.resolveCurrent(input.projectId);
    } catch (error) {
      // W-CATCH2 #10 (:162): absence only when proven; any other failure keeps its class (CURRENT_BINDING_*).
      if (isProvenBindingAbsence(error)) fail('CURRENT_BINDING_UNAVAILABLE', 'Projektet har ingen registrerad koppling till fastigheten. Inget utfärdades.');
      throw toReadFaultError('current-binding', error);
    }
    if (currentBinding!.artifact_id !== input.contextBindingArtifactId) {
      return { ok: false, superseded: true, detail: `pinned binding ${input.contextBindingArtifactId} superseded by ${currentBinding!.artifact_id}` };
    }

    // PRODUCT-RELEASE-AUTHORITY-BINDING-V1 (H13): trusted-issuer-signed release only.
    const canonicalRelease = await resolveCanonicalProductRelease({ artifactRepository: repo });
    const currentRelease = {
      releaseRef: { artifact_id: canonicalRelease.artifact_id, artifact_type: canonicalRelease.artifact_type },
      releaseHash: canonicalRelease.release_hash.value,
    };
    if (currentRelease.releaseRef.artifact_id !== input.releaseArtifactId) {
      return { ok: false, superseded: true, detail: `pinned release ${input.releaseArtifactId} superseded by ${currentRelease.releaseRef.artifact_id}` };
    }

    let viewerIdentity;
    try {
      viewerIdentity = await resolveCurrentViewerIdentity({
        artifactRepository: repo,
        releaseId: currentRelease.releaseRef.artifact_id,
        releaseHash: currentRelease.releaseHash,
      });
    } catch (error) {
      // W-CATCH2: same code, but a neutral text with the fault's class instead of the raw message.
      fail('VIEWER_IDENTITY_UNAVAILABLE_OR_UNVERIFIABLE', provisioningReadFaultDetailSv(error, 'Visningskomponentens identitet'));
    }
    if (viewerIdentity!.viewerIdentityRef.artifact_id !== input.viewerIdentityArtifactId) {
      fail(
        'VIEWER_IDENTITY_MISMATCH',
        `pinned viewer identity ${input.viewerIdentityArtifactId} does not match current ${viewerIdentity!.viewerIdentityRef.artifact_id}`,
      );
    }

    const issuer = await getOrMintIssuer(repo);
    const signing = getViewerCapabilitySigningProvider();

    // PROJECT-CONTEXT-BINDING-V2-PRODUCER-ADOPTION-01 Phase A.1: the validity window is pinned by
    // the web layer at enqueue time, not derived here. binding.created_at (V1-only anyway) and
    // release.issued_at both turned out to have no real semantic connection to "how long should
    // this capability remain valid" -- authority currentness (binding/release/viewer-identity
    // still current) already independently revokes the capability regardless of this window; the
    // window is a separate, coarser rotation/max-age ceiling. Using the pinned request values
    // verbatim is what keeps a retry/reclaim of the exact same request byte-identical.
    const validFrom = input.capabilityValidFrom.toISOString();
    const validUntil = input.capabilityValidUntil.toISOString();

    const barePayloadInput = {
      issuer_key_id: signing.keyId,
      issuer_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
      subject_project_id: input.projectId,
      project_context_binding_ref: { artifact_id: input.contextBindingArtifactId, artifact_type: 'project_context_binding' as const },
      viewer_identity_ref: viewerIdentity!.viewerIdentityRef,
      product_release_ref: currentRelease.releaseRef,
      product_release_hash: currentRelease.releaseHash,
      valid_from: validFrom,
      valid_until: validUntil,
    };
    const bareCapability = createProductViewerCapabilityArtifact(barePayloadInput);

    // Reconciliation-first: a capability for this EXACT subject may already exist (a prior
    // attempt got far enough to mint, or a duplicate request for the same subject). Never
    // re-mint; verify and reuse.
    const reused = await tryReuseExistingCapability({
      repo,
      bareCapability,
      projectId: input.projectId,
      bindingId: input.contextBindingArtifactId,
      viewerIdentityId: input.viewerIdentityArtifactId,
      releaseId: currentRelease.releaseRef.artifact_id,
      releaseHash: currentRelease.releaseHash,
      currentBindingProvider,
    });
    if (reused) {
      await runFreshVerifier({
        capabilityArtifactId: reused,
        projectId: input.projectId,
        bindingId: input.contextBindingArtifactId,
        viewerIdentityId: input.viewerIdentityArtifactId,
        releaseId: currentRelease.releaseRef.artifact_id,
        releaseHash: currentRelease.releaseHash,
      });
      return { ok: true, capabilityArtifactId: reused, reused: true };
    }

    const attestation = await attestProductViewerCapability({ capability: bareCapability, issuer, signing });
    const capability: ProductViewerCapabilityArtifact = { ...bareCapability, attestation };

    await installOwnerIssuedLocalizationViewerCapability({ artifactRepository: repo, capability, currentBindingProvider });

    await runFreshVerifier({
      capabilityArtifactId: capability.artifact_id,
      projectId: input.projectId,
      bindingId: input.contextBindingArtifactId,
      viewerIdentityId: input.viewerIdentityArtifactId,
      releaseId: currentRelease.releaseRef.artifact_id,
      releaseHash: currentRelease.releaseHash,
    });

    return { ok: true, capabilityArtifactId: capability.artifact_id, reused: false };
  } catch (error) {
    // W-CATCH2: a stable code by class and a neutral text (provisioningFailure.ts); never the raw message.
    return { ok: false, superseded: false, ...provisioningFailure(error, writes) };
  }
}

async function tryReuseExistingCapability(args: {
  readonly repo: ArtifactRepositoryPort;
  /** The capability this exact request deterministically names (without its attestation). */
  readonly bareCapability: ReturnType<typeof createProductViewerCapabilityArtifact>;
  readonly projectId: string;
  readonly bindingId: string;
  readonly viewerIdentityId: string;
  readonly releaseId: string;
  readonly releaseHash: string;
  readonly currentBindingProvider: ProjectContextBindingProvider;
}): Promise<string | null> {
  const expectedCapabilityId = args.bareCapability.artifact_id;
  // W-CATCH2 #10 (OD-R2): "not minted yet" ONLY on the proven absence of exactly this id; a read error
  // or a damaged existing capability is a typed fault, never re-issued over.
  const read = await readExistingOrProvenAbsent<ProductViewerCapabilityArtifact>(
    args.repo,
    { artifact_id: expectedCapabilityId, artifact_type: 'viewer_capability' },
    'viewer-capability',
  );
  if (!read.found) return null; // proven absence: proceed to issue.
  const existing = read.value;
  // W-CATCH3 (CATCH2 verifier finding 2, probe P4): the object under the deterministic id must BE that
  // capability -- an index entry pointing at another (even valid) capability is a lasting integrity
  // fault, never a COMPLETED request with another capability -- and exactly the capability this request
  // names, field for field (the same discipline as the issuers); its attestation is verified below.
  assertReadUnderItsOwnId('viewer-capability', existing, expectedCapabilityId, args.bareCapability.artifact_type);
  if (!isExactlyTheDeterministicArtifact(existing, args.bareCapability)) {
    throw new LuReadFaultError('viewer-capability', { faultClass: 'REFUSED', retryable: false, refusalCode: null }, new Error('the stored capability is not the capability its id names'));
  }
  try {
    await verifyProductViewerCapability({
      capability: existing,
      repository: args.repo,
      verification: getViewerCapabilityVerifier(),
      projectId: args.projectId,
      bindingId: args.bindingId,
      viewerIdentityId: args.viewerIdentityId,
      releaseId: args.releaseId,
      releaseHash: args.releaseHash,
      now: new Date(),
      currentBindingProvider: args.currentBindingProvider,
    });
    return expectedCapabilityId;
  } catch (error) {
    // W-CATCH2 #10: an existing capability for this exact subject that does not verify is never
    // re-issued over (a re-issue yields the same id: either the same bytes, or a WORM/collision error).
    // A read inside the verification stays a READ_ERROR; anything else is a refusal of that object.
    throw toReadFaultError('viewer-capability', error, 'verify');
  }
}
