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
import type { ProjectContextBindingArtifact } from '../../../packages/mps-lu/src/artifacts/ProjectContextBindingArtifact';
import {
  attestViewerCapabilityIssuerArtifact,
  attestProductViewerCapability,
  verifyProductViewerCapability,
} from './productViewerCapabilityAuthority';
import { installOwnerIssuedLocalizationViewerCapability } from './installLocalizationViewerCapability';
import { getViewerCapabilitySigningProvider } from '../../security/viewerCapabilitySigningKey';
import { getViewerCapabilityVerifier } from '../../security/viewerCapabilityVerifier';
import { ProjectContextBindingProvider } from './projectContextBindingRuntime';
import { PrismaProjectContextBindingIndex } from '../../repositories/projectContextBindingRepository';
import { getProjectContextBindingIssuerVerifier } from '../../security/projectContextBindingIssuerKey';
import { resolveCurrentProductRelease } from '../../../src/application/resolveCurrentProductRelease';
import { resolveCurrentViewerIdentity } from '../../../src/application/resolveCurrentViewerIdentity';
import { prisma } from '../../db/prisma';
import { assertProjectAccess } from '../../security/projectAccess';

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
  | { readonly ok: false; readonly superseded: false; readonly failureCode: string; readonly failureDetail: string };

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
  try {
    const existing = await repo.resolve<ViewerCapabilityIssuerArtifact>({
      artifact_id: bareIssuer.artifact_id,
      artifact_type: bareIssuer.artifact_type,
    });
    if (existing.payload.issuer_key_id === signing.keyId) return existing;
  } catch {
    // not minted yet -- fall through to mint.
  }
  const attestation = await attestViewerCapabilityIssuerArtifact({ issuer: bareIssuer, signing });
  const issuer: ViewerCapabilityIssuerArtifact = { ...bareIssuer, attestation };
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
    } catch {
      fail('REQUESTER_NOT_AUTHORIZED', `user ${input.requestedByUserId} is not a member of project ${input.projectId}`);
    }

    const mimers = await MimersIntegration.create({ env: { ...process.env, MIMERS_REQUIRED: '1' }, forceMimers: true });
    const repo = mimers.artifactRepository;
    const currentBindingProvider = new ProjectContextBindingProvider(
      repo,
      new PrismaProjectContextBindingIndex(),
      getProjectContextBindingIssuerVerifier(),
    );

    // Currentness gate: if the pinned binding is no longer the current one for this project, this
    // request's subject is stale. Never substitute the new current binding into this request --
    // signal SUPERSEDED so the caller enqueues a fresh request instead.
    let currentBinding: ProjectContextBindingArtifact;
    try {
      currentBinding = await currentBindingProvider.resolveCurrent(input.projectId);
    } catch (error) {
      fail('CURRENT_BINDING_UNAVAILABLE', error instanceof Error ? error.message : String(error));
    }
    if (currentBinding!.artifact_id !== input.contextBindingArtifactId) {
      return { ok: false, superseded: true, detail: `pinned binding ${input.contextBindingArtifactId} superseded by ${currentBinding!.artifact_id}` };
    }

    const currentRelease = await resolveCurrentProductRelease(repo);
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
      fail('VIEWER_IDENTITY_UNAVAILABLE_OR_UNVERIFIABLE', error instanceof Error ? error.message : String(error));
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
    const expectedCapabilityId = bareCapability.artifact_id;

    // Reconciliation-first: a capability for this EXACT subject may already exist (a prior
    // attempt got far enough to mint, or a duplicate request for the same subject). Never
    // re-mint; verify and reuse.
    const reused = await tryReuseExistingCapability({
      repo,
      expectedCapabilityId,
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
    const failureCode = (error as { failureCode?: string })?.failureCode ?? 'PROVISIONING_EXECUTION_ERROR';
    const failureDetail = error instanceof Error ? error.message : String(error);
    return { ok: false, superseded: false, failureCode, failureDetail };
  }
}

async function tryReuseExistingCapability(args: {
  readonly repo: ArtifactRepositoryPort;
  readonly expectedCapabilityId: string;
  readonly projectId: string;
  readonly bindingId: string;
  readonly viewerIdentityId: string;
  readonly releaseId: string;
  readonly releaseHash: string;
  readonly currentBindingProvider: ProjectContextBindingProvider;
}): Promise<string | null> {
  let existing: ProductViewerCapabilityArtifact;
  try {
    existing = await args.repo.resolve<ProductViewerCapabilityArtifact>({
      artifact_id: args.expectedCapabilityId,
      artifact_type: 'viewer_capability',
    });
  } catch {
    return null; // not minted yet -- proceed to issue.
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
    return existing.artifact_id;
  } catch {
    return null; // orphaned/partial/tampered CAS state from a crashed prior attempt -- re-issue rather than trust it.
  }
}
