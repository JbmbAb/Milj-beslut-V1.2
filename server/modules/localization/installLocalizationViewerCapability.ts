import type { ProductViewerCapabilityArtifact } from "@miljobeslut/mps-lu";
import type { ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import {
  createLocalizationViewerRuntime,
  type LocalizationViewerRuntime,
  type LocalizationViewerRuntimeConfig,
} from "./createLocalizationViewerRuntime";
import { verifyProductViewerCapability } from "./productViewerCapabilityAuthority";
import { getViewerCapabilityVerifier } from "../../security/viewerCapabilityVerifier";

export type ViewerCapabilityInstallResult = {
  readonly artifactId: string;
  readonly releaseHash: string;
  readonly runtimeConfig: LocalizationViewerRuntimeConfig;
};

/**
 * Owner-side installation boundary. The capability is supplied as an already-issued V2
 * `ProductViewerCapabilityArtifact`; this function does not construct, sign, mutate, or
 * otherwise mint it. It verifies the full cryptographic issuer-trust chain BEFORE persisting --
 * the old V1 structural-only admission gate is never called, so V1 can no longer independently
 * activate installation.
 */
export async function installOwnerIssuedLocalizationViewerCapability(args: {
  readonly artifactRepository: ArtifactRepositoryPort;
  readonly capability: ProductViewerCapabilityArtifact;
  readonly now?: () => Date;
}): Promise<ViewerCapabilityInstallResult> {
  const now = args.now?.() ?? new Date();

  await verifyProductViewerCapability({
    capability: args.capability,
    repository: args.artifactRepository,
    verification: getViewerCapabilityVerifier(),
    projectId: args.capability.payload.subject_project_id,
    bindingId: args.capability.payload.project_context_binding_ref.artifact_id,
    viewerIdentityId: args.capability.payload.viewer_identity_ref.artifact_id,
    releaseId: args.capability.payload.product_release_ref.artifact_id,
    releaseHash: args.capability.payload.product_release_hash,
    now,
  });

  await args.artifactRepository.put({
    artifact_id: args.capability.artifact_id,
    content_hash: args.capability.content_hash,
    body: args.capability,
  });

  const runtimeConfig: LocalizationViewerRuntimeConfig = {
    capabilityArtifactId: args.capability.artifact_id,
    expectedProjectId: args.capability.payload.subject_project_id,
    expectedContextBindingId: args.capability.payload.project_context_binding_ref.artifact_id,
    expectedViewerIdentityId: args.capability.payload.viewer_identity_ref.artifact_id,
    expectedReleaseId: args.capability.payload.product_release_ref.artifact_id,
    expectedReleaseHash: args.capability.payload.product_release_hash,
  };
  const runtime = await createLocalizationViewerRuntime({
    artifactRepository: args.artifactRepository,
    config: runtimeConfig,
    now: args.now,
  });

  return {
    artifactId: runtime.capability.artifact_id,
    releaseHash: runtime.capability.release_hash.value,
    runtimeConfig,
  };
}

/** Owner-side post-install probe used by the CLI and production activation runbook. */
export async function verifyInstalledLocalizationViewerCapability(args: {
  readonly artifactRepository: ArtifactRepositoryPort;
  readonly config: LocalizationViewerRuntimeConfig;
  readonly now?: () => Date;
}): Promise<LocalizationViewerRuntime> {
  return createLocalizationViewerRuntime(args);
}
