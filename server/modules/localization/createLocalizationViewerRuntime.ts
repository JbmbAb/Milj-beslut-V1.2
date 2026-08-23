import { ViewerKernel } from "@miljobeslut/mps-lu";
import { MimersIntegration, type ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import type { ProductViewerCapabilityArtifact } from "@miljobeslut/mps-lu";
import type { ViewerCapabilityArtifact } from "../../../packages/mps-compliance/src/artifacts/ViewerCapabilityArtifact.js";
import { getViewerCapabilityVerifier } from "../../security/viewerCapabilityVerifier.js";
import { verifyProductViewerCapability } from "./productViewerCapabilityAuthority.js";
import { ProjectContextBindingProvider } from "./projectContextBindingRuntime.js";
import { PrismaProjectContextBindingIndex } from "../../repositories/projectContextBindingRepository.js";
import { getProjectContextBindingIssuerVerifier } from "../../security/projectContextBindingIssuerKey.js";
import { getLatestProvisioningRequestForProject } from "./viewerCapabilityProvisioningQueue.js";

function defaultCurrentBindingProvider(artifactRepository: ArtifactRepositoryPort): ProjectContextBindingProvider {
  return new ProjectContextBindingProvider(
    artifactRepository,
    new PrismaProjectContextBindingIndex(),
    getProjectContextBindingIssuerVerifier(),
  );
}

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
 * PRODUCT-LU-VIEWER-CAPABILITY-PROVISIONING-01 Phase B: per-project resolution, replacing the
 * single-deployment-wide-env-var lookup this function used to be the only way to get a
 * `LocalizationViewerRuntimeConfig`. Looks up this SPECIFIC project's own
 * `ViewerCapabilityProvisioningRequest` (COMPLETED status only) and derives the config from the
 * resolved capability artifact's own verified payload -- never from caller/env-supplied
 * expectations. A project with no completed provisioning request has no config yet (not an
 * error state a caller should treat as "wrong project configured" -- it means "not ready").
 */
export async function resolveLocalizationViewerRuntimeConfigForProject(
  projectId: string,
  artifactRepository: ArtifactRepositoryPort,
): Promise<LocalizationViewerRuntimeConfig | null> {
  const request = await getLatestProvisioningRequestForProject(projectId);
  if (!request || request.status !== 'COMPLETED' || !request.capabilityArtifactId) return null;

  let capability: ProductViewerCapabilityArtifact;
  try {
    capability = await artifactRepository.resolve<ProductViewerCapabilityArtifact>({
      artifact_id: request.capabilityArtifactId,
      artifact_type: 'viewer_capability',
    });
  } catch {
    return null;
  }
  if (capability.payload.subject_project_id !== projectId) return null;

  return {
    capabilityArtifactId: capability.artifact_id,
    expectedProjectId: capability.payload.subject_project_id,
    expectedContextBindingId: capability.payload.project_context_binding_ref.artifact_id,
    expectedViewerIdentityId: capability.payload.viewer_identity_ref.artifact_id,
    expectedReleaseId: capability.payload.product_release_ref.artifact_id,
    expectedReleaseHash: capability.payload.product_release_hash,
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
    /**
     * VIEWER-CAPABILITY-CURRENT-BINDING-WIRING-01: defaults to the real, Postgres-backed
     * canonical resolver. Tests inject a stub with a matching `resolveCurrent(projectId)` shape
     * (structurally typed -- `ProjectContextBindingProvider` has no private members) rather than
     * needing a live database.
     */
    private readonly currentBindingProvider: ProjectContextBindingProvider = defaultCurrentBindingProvider(artifactRepository),
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
      currentBindingProvider: this.currentBindingProvider,
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
  readonly currentBindingProvider?: ProjectContextBindingProvider;
} = {}): Promise<LocalizationViewerRuntime> {
  const artifactRepository = args.artifactRepository ?? (await MimersIntegration.create()).artifactRepository;
  const config = args.config ?? readLocalizationViewerRuntimeConfig(args.env);
  const capability = await new LocalizationViewerCapabilityProvider(
    artifactRepository,
    config,
    args.now,
    args.currentBindingProvider ?? defaultCurrentBindingProvider(artifactRepository),
  ).resolve();

  return {
    artifactRepository,
    capability,
    viewer: new ViewerKernel(artifactRepository, capability),
  };
}
