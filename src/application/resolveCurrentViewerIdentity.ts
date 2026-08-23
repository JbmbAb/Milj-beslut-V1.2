/**
 * PRODUCT-LU-VIEWER-CAPABILITY-PROVISIONING-01 Phase B.
 *
 * Resolves the canonical ViewerIdentity for LU presentation. There is exactly one canonical
 * viewer kind for the whole LU product (`LU_CANONICAL_PRESENTATION_VIEWER` -- there is no
 * per-project ViewerIdentity, the same way there is no per-project ProductRelease), so an
 * env-configured artifact_id (`LU_VIEWER_IDENTITY_ID`) is the legitimate resolution mechanism --
 * exactly the same pattern as resolveCurrentProductRelease.ts's `PRODUCT_RELEASE_ARTIFACT_ID`.
 * This is public-key-only: it fully verifies the resolved artifact (issuer trust chain, contract
 * version, viewer kind, release binding) before returning it, so it is safe to call from the live
 * web server as well as from the worker -- it never touches a private key.
 */
import type { ArtifactReference } from '@miljobeslut/mps-compliance/src/artifacts/ArtifactContract';
import type { ArtifactRepositoryPort } from '@miljobeslut/mps-runtime';
import { verifyViewerIdentityArtifact } from '../../server/modules/localization/viewerIdentityAuthority';
import { getViewerIdentityVerifier } from '../../server/security/viewerIdentityVerifier';

export const LU_VIEWER_IDENTITY_ID_ENV = 'LU_VIEWER_IDENTITY_ID' as const;

export interface CurrentViewerIdentity {
  readonly viewerIdentityRef: ArtifactReference;
}

export async function resolveCurrentViewerIdentity(args: {
  readonly artifactRepository: ArtifactRepositoryPort;
  readonly releaseId: string;
  readonly releaseHash: string;
  readonly env?: NodeJS.ProcessEnv;
}): Promise<CurrentViewerIdentity> {
  const env = args.env ?? process.env;
  const artifactId = env[LU_VIEWER_IDENTITY_ID_ENV]?.trim();
  if (!artifactId) {
    throw new Error(`REJECT_VIEWER_IDENTITY_RUNTIME_CONFIGURATION: ${LU_VIEWER_IDENTITY_ID_ENV} is required`);
  }
  const identityRef: ArtifactReference = { artifact_id: artifactId, artifact_type: 'viewer_identity' };

  await verifyViewerIdentityArtifact({
    identityRef,
    repository: args.artifactRepository,
    verification: getViewerIdentityVerifier(env),
    releaseId: args.releaseId,
    releaseHash: args.releaseHash,
  });

  return { viewerIdentityRef: identityRef };
}
