/**
 * PRODUCT-LU-VIEWER-CAPABILITY-PROVISIONING-01 Phase B.
 *
 * Web-server-safe trigger: called from the bootstrap-status route once it observes a project's
 * ProjectContextBootstrapRequest is COMPLETED. Derives the pinned subject entirely from real,
 * already-governed, server-side sources (the just-completed binding, the current release, the
 * current viewer identity) -- never from anything the browser supplies. Public-key-only: resolving
 * the current release/viewer identity here only verifies signatures, it never touches
 * VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM. Best-effort: a resolution failure here must not break
 * the bootstrap-status response itself, so callers should treat a thrown error as "not triggered
 * this time", not as a request failure.
 */
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import { resolveCanonicalProductRelease } from '../release/productReleaseRuntime';
import { resolveCurrentViewerIdentity } from '../../../src/application/resolveCurrentViewerIdentity';
import {
  ensureViewerCapabilityProvisioningRequested,
  type ViewerCapabilityProvisioningRequestRecord,
} from './viewerCapabilityProvisioningQueue';

/**
 * PROJECT-CONTEXT-BINDING-V2-PRODUCER-ADOPTION-01 Phase A.1, frozen owner contract:
 *
 *   authority currentness (current binding, current release, expected viewer identity, project
 *   scope, signature/issuer trust) answers "is this capability still authorized" -- entirely
 *   independent of the validity window below.
 *
 *   temporal validity is a SEPARATE, explicit issuance policy: a maximum-age/rotation ceiling,
 *   decided ONCE here (the only place with a legitimate clock for this decision -- the web layer,
 *   at the moment it accepts the request) and pinned durably on the request row. The worker never
 *   derives or refreshes it -- never from binding.created_at, never from release.issued_at
 *   (neither has any real semantic connection to capability validity), never from its own
 *   Date.now() at mint time.
 */
const CAPABILITY_VALIDITY_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

export async function ensureViewerCapabilityProvisioningEnqueuedForCompletedBootstrap(input: {
  readonly projectId: string;
  readonly contextBindingArtifactId: string;
  readonly requestedByUserId: string;
}): Promise<ViewerCapabilityProvisioningRequestRecord> {
  const mimers = await MimersIntegration.create();
  const repo = mimers.artifactRepository;

  // PRODUCT-RELEASE-AUTHORITY-BINDING-V1 (H13): trusted-issuer-signed release only.
  const canonicalRelease = await resolveCanonicalProductRelease({ artifactRepository: repo });
  const currentRelease = {
    releaseRef: { artifact_id: canonicalRelease.artifact_id, artifact_type: canonicalRelease.artifact_type },
    releaseHash: canonicalRelease.release_hash.value,
  };
  const viewerIdentity = await resolveCurrentViewerIdentity({
    artifactRepository: repo,
    releaseId: currentRelease.releaseRef.artifact_id,
    releaseHash: currentRelease.releaseHash,
  });

  const capabilityValidFrom = new Date();
  const capabilityValidUntil = new Date(capabilityValidFrom.getTime() + CAPABILITY_VALIDITY_WINDOW_MS);

  return ensureViewerCapabilityProvisioningRequested({
    projectId: input.projectId,
    contextBindingArtifactId: input.contextBindingArtifactId,
    releaseArtifactId: currentRelease.releaseRef.artifact_id,
    viewerIdentityArtifactId: viewerIdentity.viewerIdentityRef.artifact_id,
    requestedByUserId: input.requestedByUserId,
    capabilityValidFrom,
    capabilityValidUntil,
  });
}
