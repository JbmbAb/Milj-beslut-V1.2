/**
 * PRODUCT-LU-LOCALIZATION-GEOMETRY-01 Phase B.
 *
 * A durable, non-authoritative locator: "which already-persisted LocalizationGeometryArtifact is
 * current for this project." CAS remains the sole content authority -- registerLocalizationGeometry
 * only ever records a pointer to an artifact that has already been persisted;
 * resolveCurrentLocalizationGeometry never trusts a projection row's own claims and re-resolves +
 * re-verifies every candidate against CAS before selecting it. Same three-layer shape as
 * assessmentProjection.ts, deliberately the LIGHTER of this codebase's two "current head" shapes
 * (no signed-supersession-relation table, unlike ProjectContextBindingSupersession) -- this
 * artifact is unsigned user content, so CAS content-hash re-verification is the correct and
 * sufficient integrity check.
 *
 * `createdAt` is NEVER used to decide validity. It is only the final deterministic tiebreaker
 * among candidates that have ALREADY passed CAS re-verification -- selection order is:
 * candidates for this project -> CAS re-verification (exists, correct type, untampered,
 * property_context_ref matches the row) -> only then, among what remains, most recent first.
 */
import type { ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import {
  validateLocalizationGeometryArtifact,
  type LocalizationGeometryArtifact,
} from "@miljobeslut/mps-lu";
import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactReference";
import {
  PrismaLocalizationGeometryProjectionIndex,
  type LocalizationGeometryProjectionIndex,
} from "../../repositories/localizationGeometryProjectionRepository.js";

function sameRef(left: ArtifactReference, right: ArtifactReference): boolean {
  return left.artifact_id === right.artifact_id && left.artifact_type === right.artifact_type;
}

/**
 * Called right after a LocalizationGeometryArtifact has been persisted to CAS. Idempotent: the
 * same exact point (same content-addressed artifact_id) registers as a harmless no-op
 * (`ON CONFLICT DO NOTHING`), never a duplicate row -- moving to a different point always
 * produces a different artifact_id, so it is always a genuinely new row, never an update.
 */
export async function registerLocalizationGeometry(args: {
  readonly projectId: string;
  readonly geometry: LocalizationGeometryArtifact;
  readonly index?: LocalizationGeometryProjectionIndex;
}): Promise<void> {
  const index = args.index ?? new PrismaLocalizationGeometryProjectionIndex();
  await index.register({
    projectId: args.projectId,
    geometryArtifactId: args.geometry.artifact_id,
    propertyContextRef: args.geometry.payload.property_context_ref,
  });
}

export interface CurrentLocalizationGeometry {
  readonly geometryArtifactId: string;
  readonly geometry: LocalizationGeometryArtifact;
}

/**
 * Selection order (frozen): load candidates for this project -> for each (most recent first),
 * re-resolve and re-verify it against CAS (structural validation + content_hash/artifact_id
 * self-consistency + project_id match + property_context_ref matches the projection row),
 * rejecting and moving to the next candidate on any failure -> return the first candidate that
 * survives. Throws (fails closed) if none survive -- callers decide whether that means "derive a
 * transitional geometry from the property boundary" or "refuse the run", never a silent default.
 */
export async function resolveCurrentLocalizationGeometry(args: {
  readonly projectId: string;
  readonly artifactRepository: ArtifactRepositoryPort;
  readonly index?: LocalizationGeometryProjectionIndex;
}): Promise<CurrentLocalizationGeometry> {
  const index = args.index ?? new PrismaLocalizationGeometryProjectionIndex();
  const candidates = await index.listForProject(args.projectId);
  if (candidates.length === 0) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY_PROJECTION_NOT_FOUND: no localization geometry projection for project");
  }

  const ordered = [...candidates].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  for (const candidate of ordered) {
    if (candidate.projectId !== args.projectId) continue;

    let geometry: LocalizationGeometryArtifact;
    try {
      geometry = await args.artifactRepository.resolve<LocalizationGeometryArtifact>({
        artifact_id: candidate.geometryArtifactId,
        artifact_type: "localization_geometry",
      });
    } catch {
      continue; // missing CAS object -> reject this candidate, try the next
    }

    try {
      validateLocalizationGeometryArtifact(geometry);
    } catch {
      continue; // structurally invalid or tampered -> reject this candidate
    }

    if (geometry.payload.project_id !== args.projectId) continue;

    if (
      !sameRef(geometry.payload.property_context_ref, {
        artifact_id: candidate.propertyContextRefId,
        artifact_type: candidate.propertyContextRefType,
      })
    ) {
      continue; // projection row claims a property context this artifact does not actually carry
    }

    return { geometryArtifactId: geometry.artifact_id, geometry };
  }

  throw new Error("REJECT_LOCALIZATION_GEOMETRY_PROJECTION_NOT_FOUND: no candidate survived CAS re-verification");
}
