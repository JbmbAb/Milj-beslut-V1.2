/**
 * PRODUCT-LU-LOCALIZATION-GEOMETRY-01 Phase B.
 * LU-PROJECTION-RECONCILIATION-AND-TOTAL-ORDER-V1 Phase B: currentness rewired onto the signed
 * supersession graph (H4/H9). See LOCALIZATION-GEOMETRY-CURRENTNESS-V1 (frozen contract):
 *
 *  1. Geometry artifacts remain immutable/content-addressed, unsigned user content.
 *  2. Saving a new geometry does NOT make it current merely because it has the newest createdAt.
 *  3. Currentness is established through an explicit immutable predecessor->successor
 *     supersession relation (LocalizationGeometrySupersessionArtifact, signed by a dedicated
 *     issuer -- see localizationGeometrySupersessionAuthority.ts).
 *  4. Projection tables (this file's PrismaLocalizationGeometryProjectionIndex, and
 *     PrismaLocalizationGeometrySupersessionIndex) remain non-authoritative/rebuildable.
 *  5. resolveCurrentLocalizationGeometry derives the unique graph head via
 *     LocalizationGeometryCurrentProvider -- createdAt and artifact-id lexical order have no
 *     authority over currentness anywhere in this path.
 *  6/7/8/9. Zero heads -> NOT_FOUND; exactly one head -> CURRENT; multiple heads -> fail closed
 *     (AMBIGUOUS_CURRENT_GEOMETRY); cycle -> fail closed (INVALID_SUPERSESSION_GRAPH).
 *
 * `registerLocalizationGeometry` is unchanged in shape, but callers now only invoke it directly
 * for a project's FIRST (root, no-predecessor) geometry -- see localizationGeometryService.ts.
 * Every subsequent transition is registered by the geometry-supersession worker, together with
 * its verified edge, so a geometry candidate never appears in this projection without either being
 * the root or already having a settled edge.
 */
import type { ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import type { LocalizationGeometryArtifact } from "@miljobeslut/mps-lu";
import {
  PrismaLocalizationGeometryProjectionIndex,
  type LocalizationGeometryProjectionIndex,
} from "../../repositories/localizationGeometryProjectionRepository.js";
import {
  PrismaLocalizationGeometrySupersessionIndex,
  type LocalizationGeometrySupersessionIndex,
} from "../../repositories/localizationGeometrySupersessionRepository.js";
import { LocalizationGeometryCurrentProvider } from "./localizationGeometryCurrentProvider.js";
import { getLocalizationGeometrySupersessionVerifier } from "../../security/localizationGeometrySupersessionVerifier.js";

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
 * Currentness resolution (frozen contract, see file header): delegates entirely to
 * LocalizationGeometryCurrentProvider, which derives the unique verified supersession-graph head.
 * Zero candidates -> REJECT_LOCALIZATION_GEOMETRY_PROJECTION_NOT_FOUND (unchanged message, callers
 * already branch on this to decide "derive a transitional geometry" vs "refuse the run"). Multiple
 * heads -> AMBIGUOUS_CURRENT_GEOMETRY. A cycle -> INVALID_SUPERSESSION_GRAPH. `createdAt` and
 * artifact-id lexical order play no role anywhere in this path.
 */
export async function resolveCurrentLocalizationGeometry(args: {
  readonly projectId: string;
  readonly artifactRepository: ArtifactRepositoryPort;
  readonly index?: LocalizationGeometryProjectionIndex;
  readonly supersessionIndex?: LocalizationGeometrySupersessionIndex;
  readonly provider?: LocalizationGeometryCurrentProvider;
}): Promise<CurrentLocalizationGeometry> {
  const provider =
    args.provider ??
    new LocalizationGeometryCurrentProvider(
      args.artifactRepository,
      args.index ?? new PrismaLocalizationGeometryProjectionIndex(),
      args.supersessionIndex ?? new PrismaLocalizationGeometrySupersessionIndex(),
      getLocalizationGeometrySupersessionVerifier,
    );
  const geometry = await provider.resolveCurrent(args.projectId);
  return { geometryArtifactId: geometry.artifact_id, geometry };
}
