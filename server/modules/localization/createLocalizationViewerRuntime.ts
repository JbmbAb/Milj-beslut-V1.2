import { ViewerKernel } from "@miljobeslut/mps-lu";
import { MimersIntegration, type ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import type { ProductViewerCapabilityArtifact } from "@miljobeslut/mps-lu";
import type { ViewerCapabilityArtifact } from "../../../packages/mps-compliance/src/artifacts/ViewerCapabilityArtifact.js";
import { getViewerCapabilityVerifier } from "../../security/viewerCapabilityVerifier.js";
import { verifyProductViewerCapability } from "./productViewerCapabilityAuthority.js";
import { ProjectContextBindingProvider } from "./projectContextBindingRuntime.js";
import { PrismaProjectContextBindingIndex } from "../../repositories/projectContextBindingRepository.js";
import { getProjectContextBindingIssuerVerifier } from "../../security/projectContextBindingIssuerKey.js";
import {
  listCompletedProvisioningRequestsForSubject,
  type ViewerCapabilityProvisioningRequestRecord,
} from "./viewerCapabilityProvisioningQueue.js";
import { resolveCanonicalProductRelease } from "../release/productReleaseRuntime.js";
import { resolveCurrentViewerIdentity } from "../../../src/application/resolveCurrentViewerIdentity.js";
import {
  assertReadUnderItsOwnId,
  classifyReadFault,
  isProvenBindingAbsence,
  LuReadFaultError,
  readFaultOfClass,
  toReadFaultError,
} from "./readFaultClassification.js";

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

export interface ViewerCapabilityCurrentnessDependencies {
  readonly currentBindingProvider?: ProjectContextBindingProvider;
  readonly resolveRelease?: (args: { readonly artifactRepository: ArtifactRepositoryPort }) => Promise<{
    readonly artifact_id: string;
    readonly artifact_type: string;
    readonly release_hash: { readonly value: string };
  }>;
  readonly resolveViewerIdentity?: (args: {
    readonly artifactRepository: ArtifactRepositoryPort;
    readonly releaseId: string;
    readonly releaseHash: string;
  }) => Promise<{ readonly viewerIdentityRef: { readonly artifact_id: string; readonly artifact_type: string } }>;
  readonly listCompletedRequests?: (
    projectId: string,
    contextBindingArtifactId: string,
    releaseArtifactId: string,
    viewerIdentityArtifactId: string,
  ) => Promise<readonly ViewerCapabilityProvisioningRequestRecord[]>;
  readonly now?: () => Date;
}

/**
 * W-CATCH2 #13, narrowed by W-CATCH3 (CATCH2 verifier finding 1): verifyProductViewerCapability's
 * refusals that rest on the capability's OWN content and prove it is no longer the current capability:
 * the binding it names has been superseded since its row was selected, or its validity window has not
 * started or has ended. Exactly these three, by the plain refusal itself (no cause). The content they
 * rest on is bound to the requested id first: the object read is checked to BE the requested capability
 * (assertReadUnderItsOwnId), and validateProductViewerCapabilityArtifact (the first step of the
 * verification) rebuilds its id and content hash from its payload. Every other refusal (tampered,
 * forged, issuer, scope, release hash, malformed window, a viewer identity or current binding that
 * cannot be verified) and every read fault is not proof of anything, so it fails the resolution closed.
 */
const PROVABLY_NOT_CURRENT_CAPABILITY: ReadonlySet<string> = new Set([
  "REJECT_VIEWER_CAPABILITY_CONTEXT_BINDING_SUPERSEDED",
  "REJECT_VIEWER_CAPABILITY_NOT_YET_VALID",
  "REJECT_VIEWER_CAPABILITY_EXPIRED",
]);

function isProvablyNotCurrentCapability(error: unknown): boolean {
  return error instanceof Error && error.cause === undefined && PROVABLY_NOT_CURRENT_CAPABILITY.has(error.message);
}

/**
 * W-CATCH3 (CATCH2 verifier finding 1): the capability is of another project, binding, viewer identity
 * or release than its row. The completed rows are selected on exactly these columns
 * (listCompletedProvisioningRequestsForSubject) and the worker mints a capability for exactly its row's
 * subject, so such a difference can only be damage -- a misfiled row or a misdirected object: a lasting
 * integrity fault, never "not current". The refusal token stays as the reason.
 */
const ROW_SUBJECT_MISMATCH: ReadonlySet<string> = new Set([
  "REJECT_VIEWER_CAPABILITY_PROJECT",
  "REJECT_VIEWER_CAPABILITY_CONTEXT_BINDING",
  "REJECT_VIEWER_CAPABILITY_VIEWER_IDENTITY",
  "REJECT_VIEWER_CAPABILITY_RELEASE_REF",
]);

function rowSubjectMismatch(error: unknown): string | null {
  return error instanceof Error && error.cause === undefined && ROW_SUBJECT_MISMATCH.has(error.message) ? error.message : null;
}

/** W-CATCH3: a lasting integrity fault of the completed-request rows or of the capability under them. */
function capabilityRecordIntegrityFault(cause: unknown, refusalCode: string | null = null): LuReadFaultError {
  return new LuReadFaultError("viewer-capability", { ...readFaultOfClass("STORAGE_INTEGRITY_FAULT"), refusalCode }, cause);
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
 * completed requests for this project's exact verified current subject, then derives the config
 * from a fully verified capability artifact. Queue timestamps and row order are never authority:
 * duplicate requests that resolve to one canonical capability are harmless, while distinct valid
 * capabilities for the same subject fail closed as ambiguous.
 */
export async function resolveLocalizationViewerRuntimeConfigForProject(
  projectId: string,
  artifactRepository: ArtifactRepositoryPort,
  dependencies: ViewerCapabilityCurrentnessDependencies = {},
): Promise<LocalizationViewerRuntimeConfig | null> {
  const currentBindingProvider = dependencies.currentBindingProvider ?? defaultCurrentBindingProvider(artifactRepository);
  let currentBinding: Awaited<ReturnType<ProjectContextBindingProvider["resolveCurrent"]>>;
  try {
    currentBinding = await currentBindingProvider.resolveCurrent(projectId);
  } catch (error) {
    // W-CATCH2 #13: only a project PROVABLY without a binding has no capability (null); a binding that
    // cannot be read or verified is a typed fault, never "not configured" and never a raw provider error.
    if (isProvenBindingAbsence(error)) return null;
    throw toReadFaultError("current-binding", error, "read");
  }
  const release = await (dependencies.resolveRelease ?? resolveCanonicalProductRelease)({ artifactRepository });
  const viewerIdentity = await (dependencies.resolveViewerIdentity ?? resolveCurrentViewerIdentity)({
    artifactRepository,
    releaseId: release.artifact_id,
    releaseHash: release.release_hash.value,
  });
  const requests = await (dependencies.listCompletedRequests ?? listCompletedProvisioningRequestsForSubject)(
    projectId,
    currentBinding.artifact_id,
    release.artifact_id,
    viewerIdentity.viewerIdentityRef.artifact_id,
  );

  const capabilities = new Map<string, ProductViewerCapabilityArtifact>();
  for (const request of requests) {
    // W-CATCH3 (CATCH2 verifier finding 1): every row was selected on exactly this subject and records a
    // capability that was minted. A row of another subject, or a COMPLETED row without a capability id
    // (null or ''), is damage of the rows -- a typed integrity fault, never skipped.
    if (
      request.status !== 'COMPLETED' ||
      request.projectId !== projectId ||
      request.contextBindingArtifactId !== currentBinding.artifact_id ||
      request.releaseArtifactId !== release.artifact_id ||
      request.viewerIdentityArtifactId !== viewerIdentity.viewerIdentityRef.artifact_id
    ) {
      throw capabilityRecordIntegrityFault(new Error('a completed request listed for this subject is not of this subject'));
    }
    const capabilityArtifactId = request.capabilityArtifactId;
    if (typeof capabilityArtifactId !== 'string' || capabilityArtifactId.length === 0) {
      throw capabilityRecordIntegrityFault(new Error('a completed request records no capability'));
    }

    // W-CATCH2 #13 (OD-R1/OD-R2, the pattern W-APR closed for assessments): a COMPLETED request records
    // a capability that was minted, so it must exist and verify. A capability whose own content proves
    // it is not the current one is skipped (it can never be the current capability); one that cannot be
    // read or verified MAY be the current one, so the whole resolution fails closed with a typed fault --
    // never null ("not configured") and never a silent win for another capability past the ambiguity
    // check below.
    let read: unknown;
    try {
      read = await artifactRepository.resolve<ProductViewerCapabilityArtifact>({
        artifact_id: capabilityArtifactId,
        artifact_type: 'viewer_capability',
      });
    } catch (error) {
      throw toReadFaultError("viewer-capability", error, "read");
    }
    // W-CATCH3: the object read under the requested id must BE that capability (never another one).
    assertReadUnderItsOwnId("viewer-capability", read, capabilityArtifactId);
    const capability = read as ProductViewerCapabilityArtifact;
    try {
      await verifyProductViewerCapability({
        capability,
        repository: artifactRepository,
        verification: getViewerCapabilityVerifier(),
        projectId,
        bindingId: currentBinding.artifact_id,
        viewerIdentityId: viewerIdentity.viewerIdentityRef.artifact_id,
        releaseId: release.artifact_id,
        releaseHash: release.release_hash.value,
        now: (dependencies.now ?? (() => new Date()))(),
        currentBindingProvider,
      });
    } catch (error) {
      if (isProvablyNotCurrentCapability(error)) continue;
      const mismatch = rowSubjectMismatch(error);
      if (mismatch) throw capabilityRecordIntegrityFault(error, mismatch);
      throw toReadFaultError("viewer-capability", error, "verify");
    }
    capabilities.set(capability.artifact_id, capability);
  }

  if (capabilities.size === 0) return null;
  if (capabilities.size > 1) {
    throw new Error(
      'REJECT_LU_VIEWER_CAPABILITY_AMBIGUOUS_CURRENT: multiple valid completed capabilities for the exact current subject',
    );
  }

  const capability = capabilities.values().next().value as ProductViewerCapabilityArtifact;

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
    } catch (error) {
      // W-CATCH2 #13: still the same refusal (its callers and the presentation path key on it), but the
      // original fault is kept as `cause` and classified (`faultClass`, `retryable`), so a read error is
      // never indistinguishable from a capability that is not there.
      const fault = classifyReadFault(error);
      throw Object.assign(new Error(`REJECT_LU_VIEWER_CAPABILITY_UNAVAILABLE: ${this.config.capabilityArtifactId}`, { cause: error }), {
        faultClass: fault.faultClass,
        retryable: fault.retryable,
      });
    }
    try {
      // W-CATCH3 (CATCH2 verifier finding 1): the object read under the configured id must BE that
      // capability -- another valid capability of the same subject would pass every check below.
      assertReadUnderItsOwnId("viewer-capability", capability, this.config.capabilityArtifactId);
    } catch (error) {
      const fault = classifyReadFault(error);
      throw Object.assign(new Error(`REJECT_LU_VIEWER_CAPABILITY_UNAVAILABLE: ${this.config.capabilityArtifactId}`, { cause: error }), {
        faultClass: fault.faultClass,
        retryable: fault.retryable,
      });
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
