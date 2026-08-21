/**
 * P3-LU-PRESENTATION-BOUNDARY-01 PHASE 1 (backend-only).
 *
 * The canonical LU presentation path. Replaces the ungoverned GET /api/spatial/evidence shape
 * (raw PostGIS query -> hand-built evidence-like object -> no auth -> no CAS -> no
 * ViewerCapability -> no ViewerKernel) with a chain that consumes only already-captured,
 * governed artifacts:
 *
 *   authenticated request
 *   -> project authorization (assertProjectAccess)
 *   -> resolveAuthorizedViewerCapability (current ProjectContextBinding + verified ViewerCapability)
 *   -> resolve the already-persisted LocalizationAssessmentArtifact (caller-supplied id -- there
 *      is no durable projectId -> assessment index in this codebase yet; the caller must already
 *      hold the id returned by the report-generation run that produced it)
 *   -> verify the assessment's own canonical body hash (tamper detection) and that its
 *      project_context_ref is authoritatively bound to this project (authorizeAssessmentPresentation)
 *   -> verify each referenced SPATIAL_EVIDENCE artifact's own canonical content hash (tamper
 *      detection) before it ever reaches ViewerKernel
 *   -> ViewerKernel.exportAsGeoJSON
 *
 * PostGIS/the spatial layer tables are never queried here -- this module has no dependency on
 * @miljobeslut/spatial-provider-postgis at all, by construction. Nothing here ever puts an
 * artifact into CAS, mints/signs a ViewerCapability, or imports the viewer-capability signing key
 * module. A missing or invalid artifact at any step fails closed; there is no fallback to
 * re-deriving evidence live.
 */
import type { ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import { sha256ContentHash } from "@miljobeslut/mps-compliance/src/canonical/sha256Canonical";
import {
  localizationAssessmentCanonicalBody,
  buildSpatialEvidenceContentHash,
  type LocalizationAssessmentArtifact,
  type SpatialEvidenceArtifact,
} from "@miljobeslut/mps-lu";
import type { AuthUser } from "../../security/types.js";
import { assertProjectAccess } from "../../security/projectAccess.js";
import { resolveAuthorizedViewerCapability } from "./resolveAuthorizedViewerCapability.js";
import type { LocalizationViewerRuntimeConfig } from "./createLocalizationViewerRuntime.js";
import { ProjectContextBindingProvider, authorizeAssessmentPresentation } from "./projectContextBindingRuntime.js";
import { PrismaProjectContextBindingIndex } from "../../repositories/projectContextBindingRepository.js";
import { getProjectContextBindingIssuerVerifier } from "../../security/projectContextBindingIssuerKey.js";

export interface GovernedLocalizationPresentation {
  readonly capabilityArtifactId: string;
  readonly assessmentArtifactId: string;
  readonly geojson: unknown;
}

function sameHash(
  left: { readonly algorithm: string; readonly value: string },
  right: { readonly algorithm: string; readonly value: string },
): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}

export async function resolveGovernedLocalizationPresentation(args: {
  readonly authUser: AuthUser;
  readonly projectId: string;
  readonly assessmentArtifactId: string;
  readonly artifactRepository: ArtifactRepositoryPort;
  readonly config: LocalizationViewerRuntimeConfig;
  readonly now?: () => Date;
  readonly currentBindingProvider?: ProjectContextBindingProvider;
}): Promise<GovernedLocalizationPresentation> {
  // 1. USER AUTHORIZATION -- fails closed before any artifact, capability, or binding is touched.
  await assertProjectAccess(args.authUser, args.projectId, args.authUser.organisationId);

  // 2. VIEWER AUTHORITY -- current binding + verified, non-superseded ViewerCapability. Never
  // mints/signs; the ViewerKernel instance it returns is what actually renders evidence below.
  const currentBindingProvider =
    args.currentBindingProvider ??
    new ProjectContextBindingProvider(
      args.artifactRepository,
      new PrismaProjectContextBindingIndex(),
      getProjectContextBindingIssuerVerifier(),
    );
  const viewerRuntime = await resolveAuthorizedViewerCapability({
    authUser: args.authUser,
    projectId: args.projectId,
    artifactRepository: args.artifactRepository,
    config: args.config,
    now: args.now,
    currentBindingProvider,
  });

  // 3. Resolve the already-persisted assessment. This is the ONLY place a caller-supplied id is
  // trusted as input; everything about it is independently re-verified below.
  const assessment = await args.artifactRepository.resolve<LocalizationAssessmentArtifact>({
    artifact_id: args.assessmentArtifactId,
    artifact_type: "LOCALIZATION_ASSESSMENT",
  });

  // 4. Tamper detection: recompute the assessment's own canonical body hash and artifact_id from
  // its CURRENT resolved content, exactly as GovernedAssessmentPersistence does at write time.
  // A caller cannot present a body that was mutated in storage after being persisted.
  const recomputedAssessmentHash = sha256ContentHash(localizationAssessmentCanonicalBody(assessment));
  if (
    !sameHash(assessment.content_hash, recomputedAssessmentHash) ||
    assessment.artifact_id !== `assessment-${recomputedAssessmentHash.value}`
  ) {
    throw new Error("REJECT_LOCALIZATION_PRESENTATION: assessment canonical_body_hash");
  }

  // 5. The assessment's project_context_ref must be authoritatively, verifiably bound to THIS
  // project -- not merely asserted by the caller-supplied artifact_id.
  await authorizeAssessmentPresentation({
    projectId: args.projectId,
    assessment,
    assertProjectAccess: async () => {
      // Already verified in step 1; re-run defensively rather than trusting a closure boundary.
      await assertProjectAccess(args.authUser, args.projectId, args.authUser.organisationId);
    },
    bindingProvider: currentBindingProvider,
  });

  // 6. Only SPATIAL_EVIDENCE-typed refs are meaningful to ViewerKernel; a mixed evidence_refs
  // array (e.g. containing document evidence) must not be silently coerced or dropped-and-ignored
  // -- this is an explicit, deliberate filter, not a bypass of anything ViewerKernel itself checks.
  const spatialEvidenceIds = assessment.payload.evidence_refs
    .filter((ref) => ref.artifact_type === "SPATIAL_EVIDENCE")
    .map((ref) => ref.artifact_id);

  // 7. Tamper detection for each piece of evidence BEFORE it ever reaches ViewerKernel: recompute
  // its own canonical content hash from its current resolved payload.
  for (const artifactId of spatialEvidenceIds) {
    const evidence = await args.artifactRepository.resolve<SpatialEvidenceArtifact>({
      artifact_id: artifactId,
      artifact_type: "SPATIAL_EVIDENCE",
    });
    const recomputedEvidenceHash = buildSpatialEvidenceContentHash(evidence.payload);
    if (!sameHash(evidence.content_hash, recomputedEvidenceHash)) {
      throw new Error(`REJECT_LOCALIZATION_PRESENTATION: evidence content_hash mismatch for ${artifactId}`);
    }
  }

  // 8. Project. No PostGIS, no CAS writes -- purely a read/verify/render over already-captured,
  // now-reverified governed artifacts.
  const geojson = await viewerRuntime.viewer.exportAsGeoJSON(spatialEvidenceIds);

  return {
    capabilityArtifactId: viewerRuntime.capability.artifact_id,
    assessmentArtifactId: assessment.artifact_id,
    geojson,
  };
}
