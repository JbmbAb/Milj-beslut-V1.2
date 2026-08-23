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
import { resolveCurrentProductRelease } from '../../../src/application/resolveCurrentProductRelease';
import { resolveCurrentViewerIdentity } from '../../../src/application/resolveCurrentViewerIdentity';
import {
  ensureViewerCapabilityProvisioningRequested,
  type ViewerCapabilityProvisioningRequestRecord,
} from './viewerCapabilityProvisioningQueue';

export async function ensureViewerCapabilityProvisioningEnqueuedForCompletedBootstrap(input: {
  readonly projectId: string;
  readonly contextBindingArtifactId: string;
  readonly requestedByUserId: string;
}): Promise<ViewerCapabilityProvisioningRequestRecord> {
  const mimers = await MimersIntegration.create();
  const repo = mimers.artifactRepository;

  const currentRelease = await resolveCurrentProductRelease(repo);
  const viewerIdentity = await resolveCurrentViewerIdentity({
    artifactRepository: repo,
    releaseId: currentRelease.releaseRef.artifact_id,
    releaseHash: currentRelease.releaseHash,
  });

  return ensureViewerCapabilityProvisioningRequested({
    projectId: input.projectId,
    contextBindingArtifactId: input.contextBindingArtifactId,
    releaseArtifactId: currentRelease.releaseRef.artifact_id,
    viewerIdentityArtifactId: viewerIdentity.viewerIdentityRef.artifact_id,
    requestedByUserId: input.requestedByUserId,
  });
}
