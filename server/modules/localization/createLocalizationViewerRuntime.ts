import { ViewerKernel } from "@miljobeslut/mps-lu";
import { MimersIntegration, type ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import type { ProductViewerCapabilityArtifact } from "@miljobeslut/mps-lu";
import type { ViewerCapabilityArtifact } from "../../../packages/mps-compliance/src/artifacts/ViewerCapabilityArtifact.js";
import { getViewerCapabilityVerifier } from "../../security/viewerCapabilityVerifier.js";
import { verifyProductViewerCapability } from "./productViewerCapabilityAuthority.js";

export const LU_VIEWER_CAPABILITY_ARTIFACT_ID_ENV = "LU_VIEWER_CAPABILITY_ARTIFACT_ID" as const;
export const LU_VIEWER_PROJECT_ID_ENV = "LU_VIEWER_PROJECT_ID" as const;
export const LU_VIEWER_CONTEXT_BINDING_ID_ENV = "LU_VIEWER_CONTEXT_BINDING_ID" as const;
export const LU_VIEWER_IDENTITY_ID_ENV = "LU_VIEWER_IDENTITY_ID" as const;
export const LU_VIEWER_RELEASE_ID_ENV = "LU_VIEWER_RELEASE_ID" as const;
export const LU_VIEWER_RELEASE_HASH_ENV = "LU_VIEWER_RELEASE_HASH" as const;

export interface LocalizationViewerRuntimeConfig {
  readonly capabilityArtifactId: string;
  readonly expectedProjectId: string;
  readonly expectedContextBindingId: string;
  readonly expectedViewerIdentityId: string;
  readonly expectedReleaseId: string;
  readonly expectedReleaseHash: string;
}

export interface LocalizationViewerRuntime {
  readonly artifactRepository: ArtifactRepositoryPort;
  readonly capability: ViewerCapabilityArtifact;
  readonly viewer: ViewerKernel;
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`REJECT_LU_VIEWER_CAPABILITY_CONFIGURATION: ${name} is required`);
  }
  return value;
}

/**
 * Parses only runtime references. The artifact itself must already be owner-issued and persisted
 * in CAS; this composition root never creates, signs, or persists a viewer capability.
 */
export function readLocalizationViewerRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): LocalizationViewerRuntimeConfig {
  return {
    capabilityArtifactId: requiredEnv(env, LU_VIEWER_CAPABILITY_ARTIFACT_ID_ENV),
    expectedProjectId: requiredEnv(env, LU_VIEWER_PROJECT_ID_ENV),
    expectedContextBindingId: requiredEnv(env, LU_VIEWER_CONTEXT_BINDING_ID_ENV),
    expectedViewerIdentityId: requiredEnv(env, LU_VIEWER_IDENTITY_ID_ENV),
    expectedReleaseId: requiredEnv(env, LU_VIEWER_RELEASE_ID_ENV),
    expectedReleaseHash: requiredEnv(env, LU_VIEWER_RELEASE_HASH_ENV),
  };
}

/**
 * Resolves a pre-installed V2 `ProductViewerCapabilityArtifact`, verifies the full cryptographic
 * issuer-trust chain (server/modules/localization/productViewerCapabilityAuthority.ts) -- the
 * SOLE source of trust; the old V1 structural-only admission gate is never called here
 * -- and projects the verified result into the `ViewerCapabilityArtifact` shape `ViewerKernel`
 * requires. Every field in the projection is carried through faithfully from the verified V2
 * payload (nothing fabricated): `viewer_identity_ref` and the temporal window come from the V2
 * artifact's own signed payload, not invented by this adapter.
 */
export class LocalizationViewerCapabilityProvider {
  constructor(
    private readonly artifactRepository: ArtifactRepositoryPort,
    private readonly config: LocalizationViewerRuntimeConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async resolve(): Promise<ViewerCapabilityArtifact> {
    let capability: ProductViewerCapabilityArtifact;
    try {
      capability = await this.artifactRepository.resolve<ProductViewerCapabilityArtifact>({
        artifact_id: this.config.capabilityArtifactId,
        artifact_type: "viewer_capability",
      });
    } catch {
      throw new Error(`REJECT_LU_VIEWER_CAPABILITY_UNAVAILABLE: ${this.config.capabilityArtifactId}`);
    }

    await verifyProductViewerCapability({
      capability,
      repository: this.artifactRepository,
      verification: getViewerCapabilityVerifier(),
      projectId: this.config.expectedProjectId,
      bindingId: this.config.expectedContextBindingId,
      viewerIdentityId: this.config.expectedViewerIdentityId,
      releaseId: this.config.expectedReleaseId,
      releaseHash: this.config.expectedReleaseHash,
      now: this.now(),
    });

    return {
      artifact_id: capability.artifact_id,
      artifact_type: "viewer_capability",
      content_hash: capability.content_hash,
      references: capability.references,
      viewer_identity_ref: capability.payload.viewer_identity_ref,
      granted_by: capability.payload.issuer_ref,
      policy_ref: capability.payload.issuer_ref,
      release_hash: { algorithm: "sha256", value: capability.payload.product_release_hash },
      valid_from: capability.payload.valid_from,
      valid_until: capability.payload.valid_until,
      can_view_domain_evidence: true,
      allowed_operations: ["view", "export"],
      denied_operations: [],
    };
  }
}

export async function createLocalizationViewerRuntime(args: {
  readonly artifactRepository?: ArtifactRepositoryPort;
  readonly config?: LocalizationViewerRuntimeConfig;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => Date;
} = {}): Promise<LocalizationViewerRuntime> {
  const artifactRepository = args.artifactRepository ?? (await MimersIntegration.create()).artifactRepository;
  const config = args.config ?? readLocalizationViewerRuntimeConfig(args.env);
  const capability = await new LocalizationViewerCapabilityProvider(
    artifactRepository,
    config,
    args.now,
  ).resolve();

  return {
    artifactRepository,
    capability,
    viewer: new ViewerKernel(artifactRepository, capability),
  };
}
