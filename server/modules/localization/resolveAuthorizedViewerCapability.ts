/**
 * PRODUCT-LU-VIEWER-CAPABILITY-WIRING-01 PHASE B.
 *
 * The one production-addressable entrypoint for "may this authenticated user open the governed
 * LU viewer for this project, in its exact current state". Two distinct, non-overlapping
 * authorities compose here, deliberately kept separate:
 *
 *   USER AUTHORIZATION  -- assertProjectAccess: may THIS PERSON access this project at all.
 *   VIEWER AUTHORITY    -- ViewerCapability: is the governed ViewerKernel implementation admitted
 *                          for this project's exact current release + ProjectContextBinding head.
 *
 * ViewerCapability is NOT a per-user or per-session grant (see
 * docs/architecture/VIEWER-IDENTITY-AUTHORITY-BOOTSTRAP-01-PROVEN.md) -- it is per
 * project + release + current binding + governed viewer identity. This function never mints,
 * signs, or installs one: on a missing, stale (superseded-binding), or otherwise invalid
 * capability it fails closed. The private signing key is never imported by this module, this
 * file's whole call graph, or anything it depends on -- see
 * localizationViewerCapabilityAuthorization.test.ts's source-grep proof.
 */
import type { ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import type { AuthUser } from "../../security/types.js";
import { assertProjectAccess } from "../../security/projectAccess.js";
import {
  createLocalizationViewerRuntime,
  type LocalizationViewerRuntime,
  type LocalizationViewerRuntimeConfig,
} from "./createLocalizationViewerRuntime.js";
import { ProjectContextBindingProvider } from "./projectContextBindingRuntime.js";

export async function resolveAuthorizedViewerCapability(args: {
  readonly authUser: AuthUser;
  readonly projectId: string;
  readonly artifactRepository: ArtifactRepositoryPort;
  /**
   * The deployment's known viewer-capability configuration for this project (which artifact,
   * which project/binding/viewer-identity/release it is expected to bind). Static per-deployment
   * today -- there is no per-project capability lookup index yet, matching the existing
   * LocalizationViewerRuntimeConfig contract. `config.expectedProjectId` is defensively required
   * to match the REQUESTED `projectId`: a static config naming a different project must never be
   * silently substituted for whatever project the caller actually asked for.
   */
  readonly config: LocalizationViewerRuntimeConfig;
  readonly now?: () => Date;
  readonly currentBindingProvider?: ProjectContextBindingProvider;
}): Promise<LocalizationViewerRuntime> {
  // 1. USER AUTHORIZATION -- must pass before any capability/CAS resolution is attempted, so an
  // unauthorized caller can never learn anything about capability/binding state for a project
  // they cannot access.
  await assertProjectAccess(args.authUser, args.projectId, args.authUser.organisationId);

  if (args.config.expectedProjectId !== args.projectId) {
    throw new Error("REJECT_VIEWER_CAPABILITY_WRONG_PROJECT_CONFIG");
  }

  // 2. VIEWER AUTHORITY -- resolves the current canonical binding, resolves the installed
  // capability, verifies its full signed trust chain including that it binds the CURRENT head
  // (not a superseded one). Never mints, signs, or installs anything.
  return createLocalizationViewerRuntime({
    artifactRepository: args.artifactRepository,
    config: args.config,
    now: args.now,
    currentBindingProvider: args.currentBindingProvider,
  });
}
