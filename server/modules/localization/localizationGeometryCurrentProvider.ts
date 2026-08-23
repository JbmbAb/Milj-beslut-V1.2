import type { VerificationKeyProvider } from "@miljobeslut/mimers-brunn-core";
import type { ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import {
  resolveCurrentLocalizationGeometryHead,
  validateLocalizationGeometryArtifact,
  type LocalizationGeometryArtifact,
  type LocalizationGeometrySupersessionArtifact,
  type LocalizationGeometrySupersessionIssuerArtifact,
} from "@miljobeslut/mps-lu";
import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactReference";
import type { LocalizationGeometryProjectionIndex } from "../../repositories/localizationGeometryProjectionRepository";
import type { LocalizationGeometrySupersessionIndex } from "../../repositories/localizationGeometrySupersessionRepository";
import { verifyLocalizationGeometrySupersessionArtifact } from "./localizationGeometrySupersessionAuthority";

/**
 * LU-PROJECTION-RECONCILIATION-AND-TOTAL-ORDER-V1 Phase B.
 *
 * Resolves the CURRENT LocalizationGeometry for a project via the verified supersession graph --
 * `createdAt` and artifact-id lexical order play no role. Same shape as
 * ProjectContextBindingProvider.resolveCurrent: the two Postgres indexes only supply CANDIDATE
 * refs (non-authoritative, rebuildable); every candidate (geometry AND supersession) is
 * independently resolved from CAS and re-verified here before being trusted as a graph node/edge.
 * Geometry artifacts get structural + project_id verification (unsigned user content, per the
 * frozen contract); supersession artifacts get full issuer-trust-chain + signature verification
 * (the authority actually lives on the transition, not the content).
 */
export class LocalizationGeometryCurrentProvider {
  /**
   * `verification` is a thunk, not an instance: a project with zero or one geometry (no
   * supersession edges to verify at all) must resolve without ever requiring
   * LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM to be configured -- e.g. a project's
   * very first GET-current, or a test that never exercises a transition. Only called lazily, and
   * only when there is at least one supersession candidate to verify.
   */
  constructor(
    private readonly artifactRepository: ArtifactRepositoryPort,
    private readonly geometryIndex: LocalizationGeometryProjectionIndex,
    private readonly supersessionIndex: LocalizationGeometrySupersessionIndex,
    private readonly verification: VerificationKeyProvider | (() => VerificationKeyProvider),
  ) {}

  async resolveCurrent(projectId: string): Promise<LocalizationGeometryArtifact> {
    const [geometryCandidates, supersessionCandidates] = await Promise.all([
      this.geometryIndex.listForProject(projectId),
      this.supersessionIndex.listForProject(projectId),
    ]);
    if (geometryCandidates.length === 0) {
      throw new Error("REJECT_LOCALIZATION_GEOMETRY_PROJECTION_NOT_FOUND: no localization geometry projection for project");
    }

    const sameRef = (left: ArtifactReference, right: ArtifactReference) =>
      left.artifact_id === right.artifact_id && left.artifact_type === right.artifact_type;

    // An individually corrupted/tampered/missing candidate is EXCLUDED, not fatal to the whole
    // resolution -- same resilience posture as every other current-selection path in this
    // codebase (Assessment: reject-and-continue). Only a genuine multi-node ambiguity (fork,
    // cycle) among the SURVIVING, verified set fails the whole resolution closed.
    const geometryResults = await Promise.all(
      geometryCandidates.map(async (candidate) => {
        try {
          const geometry = validateLocalizationGeometryArtifact(
            await this.artifactRepository.resolve<LocalizationGeometryArtifact>({
              artifact_id: candidate.geometryArtifactId,
              artifact_type: "localization_geometry",
            }),
          );
          if (geometry.payload.project_id !== projectId) return null;
          if (
            !sameRef(geometry.payload.property_context_ref, {
              artifact_id: candidate.propertyContextRefId,
              artifact_type: candidate.propertyContextRefType,
            })
          ) {
            return null;
          }
          return geometry;
        } catch {
          return null;
        }
      }),
    );
    const geometries = geometryResults.filter((g): g is LocalizationGeometryArtifact => g !== null);
    if (geometries.length === 0) {
      throw new Error("REJECT_LOCALIZATION_GEOMETRY_PROJECTION_NOT_FOUND: no candidate survived CAS re-verification");
    }
    const survivingIds = new Set(geometries.map((g) => g.artifact_id));

    const verification =
      supersessionCandidates.length === 0
        ? null
        : typeof this.verification === "function"
          ? this.verification()
          : this.verification;
    const supersessionResults = await Promise.all(
      supersessionCandidates.map(async (candidate) => {
        // An edge referencing a geometry that didn't survive verification cannot be trusted --
        // exclude it rather than letting the graph algorithm fail closed on a corrupted single row.
        if (!survivingIds.has(candidate.predecessorGeometryArtifactId) || !survivingIds.has(candidate.successorGeometryArtifactId)) {
          return null;
        }
        try {
          const artifact = await this.artifactRepository.resolve<LocalizationGeometrySupersessionArtifact>({
            artifact_id: candidate.supersessionArtifactId,
            artifact_type: "localization_geometry_supersession",
          });
          const issuer = await this.artifactRepository.resolve<LocalizationGeometrySupersessionIssuerArtifact>(
            artifact.payload.issuer_ref,
          );
          return await verifyLocalizationGeometrySupersessionArtifact({ artifact, issuer, verification: verification! });
        } catch {
          return null;
        }
      }),
    );
    const supersessions = supersessionResults.filter((s): s is LocalizationGeometrySupersessionArtifact => s !== null);

    return resolveCurrentLocalizationGeometryHead({ projectId, geometries, supersessions });
  }
}
