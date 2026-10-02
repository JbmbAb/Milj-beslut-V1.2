import type { VerificationKeyProvider } from "@miljobeslut/mimers-brunn-core";
import type { ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import {
  resolveCurrentLocalizationGeometryHead,
  validateLocalizationGeometryArtifact,
  validateLocalizationGeometrySupersessionArtifact,
  type LocalizationGeometryArtifact,
  type LocalizationGeometrySupersessionArtifact,
  type LocalizationGeometrySupersessionIssuerArtifact,
} from "@miljobeslut/mps-lu";
import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactReference";
import type { LocalizationGeometryProjectionIndex } from "../../repositories/localizationGeometryProjectionRepository";
import type { LocalizationGeometrySupersessionIndex } from "../../repositories/localizationGeometrySupersessionRepository";
import { verifyLocalizationGeometrySupersessionArtifact } from "./localizationGeometrySupersessionAuthority";

/**
 * DEMO M1a-repair (verifier F1/F2), owner decision D9(a). Message prefix of the error thrown when
 * ONE currentness candidate (geometry, supersession edge or its issuer) could not be read or
 * verified for a TECHNICAL reason -- its state is unknown, so the whole resolution fails closed.
 * localizationGeometryCurrentness.ts classifies it as CURRENTNESS_RESOLUTION_ERROR (503, retryable).
 */
export const LOCALIZATION_GEOMETRY_CANDIDATE_UNRESOLVABLE_PREFIX = "LOCALIZATION_GEOMETRY_CANDIDATE_UNRESOLVABLE";

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The artifact repository's own "no such artifact" answer for exactly this id (CasArtifactResolver
 *  and InMemoryArtifactRepository both throw this message) -- a determined state: MISSING. */
function isMissingArtifactVerdict(error: unknown, artifactId: string | undefined): boolean {
  return artifactId !== undefined && error instanceof Error && error.message === `Artifact not found: ${artifactId}`;
}

/** CAS re-hashed the stored bytes and they do not match their address -- a determined state: CORRUPTED. */
function isCorruptedBytesVerdict(error: unknown): boolean {
  return error instanceof Error && error.name === "CASIntegrityError";
}

/** A REJECT_* verdict from a validator/verifier run on content that WAS read -- a determined state:
 *  TAMPERED / INVALID / UNTRUSTED. */
function isRejectVerdict(error: unknown, prefix: string): boolean {
  return error instanceof Error && error.message.startsWith(prefix);
}

function candidateUnresolvable(kind: string, artifactId: string | undefined, error: unknown): Error {
  return new Error(
    `${LOCALIZATION_GEOMETRY_CANDIDATE_UNRESOLVABLE_PREFIX}: ${kind} ${artifactId ?? "(no ref)"} could not be read or verified: ${errorDetail(error)}`,
  );
}

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
    //
    // DEMO M1a-repair (F1/F2, D9(a)): that frozen posture covers candidates whose state WAS
    // determined -- missing (the repository's not-found verdict), corrupted (CAS integrity
    // verdict), tampered/invalid (a REJECT_* verdict on content that was read), or bound to another
    // project/property context. It does not cover a read or verification step that FAILED: then the
    // candidate's state is unknown, it may be the real head, and excluding it could make a superseded
    // point current. Such a technical failure therefore fails the whole resolution closed
    // (LOCALIZATION_GEOMETRY_CANDIDATE_UNRESOLVABLE -> CURRENTNESS_RESOLUTION_ERROR, 503).
    const geometryResults = await Promise.all(
      geometryCandidates.map(async (candidate) => {
        const ref = { artifact_id: candidate.geometryArtifactId, artifact_type: "localization_geometry" };
        let resolved: LocalizationGeometryArtifact;
        try {
          resolved = await this.artifactRepository.resolve<LocalizationGeometryArtifact>(ref);
        } catch (error) {
          if (isMissingArtifactVerdict(error, ref.artifact_id) || isCorruptedBytesVerdict(error)) return null;
          throw candidateUnresolvable("geometry", ref.artifact_id, error);
        }
        let geometry: LocalizationGeometryArtifact;
        try {
          geometry = validateLocalizationGeometryArtifact(resolved);
        } catch (error) {
          if (isRejectVerdict(error, "REJECT_LOCALIZATION_GEOMETRY")) return null;
          throw candidateUnresolvable("geometry", ref.artifact_id, error);
        }
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
        // Same split as for geometries (DEMO M1a-repair F1/F2): a determined missing / corrupted /
        // REJECT_* verdict excludes the edge (frozen posture); any other failure while reading the
        // edge or its issuer, or while verifying it, fails the whole resolution closed.
        const ref = { artifact_id: candidate.supersessionArtifactId, artifact_type: "localization_geometry_supersession" };
        let artifact: LocalizationGeometrySupersessionArtifact;
        try {
          artifact = await this.artifactRepository.resolve<LocalizationGeometrySupersessionArtifact>(ref);
        } catch (error) {
          if (isMissingArtifactVerdict(error, ref.artifact_id) || isCorruptedBytesVerdict(error)) return null;
          throw candidateUnresolvable("supersession", ref.artifact_id, error);
        }
        // Structural verdict first, so a malformed edge (e.g. no issuer_ref) is a REJECT_* verdict,
        // not a technical failure while looking up its issuer. Full verification follows below.
        try {
          validateLocalizationGeometrySupersessionArtifact(artifact);
        } catch (error) {
          if (isRejectVerdict(error, "REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION")) return null;
          throw candidateUnresolvable("supersession", ref.artifact_id, error);
        }
        const issuerRef = artifact.payload.issuer_ref;
        let issuer: LocalizationGeometrySupersessionIssuerArtifact;
        try {
          issuer = await this.artifactRepository.resolve<LocalizationGeometrySupersessionIssuerArtifact>(issuerRef);
        } catch (error) {
          if (isMissingArtifactVerdict(error, issuerRef.artifact_id) || isCorruptedBytesVerdict(error)) return null;
          throw candidateUnresolvable("supersession issuer", issuerRef.artifact_id, error);
        }
        try {
          return await verifyLocalizationGeometrySupersessionArtifact({ artifact, issuer, verification: verification! });
        } catch (error) {
          if (isRejectVerdict(error, "REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION")) return null;
          throw candidateUnresolvable("supersession", ref.artifact_id, error);
        }
      }),
    );
    const supersessions = supersessionResults.filter((s): s is LocalizationGeometrySupersessionArtifact => s !== null);

    return resolveCurrentLocalizationGeometryHead({ projectId, geometries, supersessions });
  }
}
