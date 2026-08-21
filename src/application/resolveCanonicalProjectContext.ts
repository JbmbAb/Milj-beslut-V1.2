/**
 * PRODUCT-LU-CONTEXT-AND-EVIDENCE-BINDING-V1.
 *
 * Resolves the REAL, already-issued, cryptographically verified project/property context for an
 * authenticated product project. Replaces the `prop-*`/`proj-*`/`geom-*` synthetic-ID fallback
 * previously in generate-localization-report.usecase.ts (analyzeSite): that path fabricated new
 * context artifacts on every run rather than resolving the canonical ones already bound via
 * PRODUCT-LU-VIEWER-AUTHORITY-BOOTSTRAP-01 / the owner-provisioning chain.
 *
 * Fails closed (throws) if no unambiguous, verified binding exists for the project -- it never
 * falls back to fabricating one. A project with no real ProjectContextBinding cannot be assessed
 * under this path.
 */
import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import type { ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import {
  type LUProjectContextArtifact,
  type LUPropertyContextArtifact,
  type ProjectContextBindingArtifact,
  type ProjectPropertyBindingArtifact,
} from "@miljobeslut/mps-lu";
import { PrismaProjectContextBindingIndex } from "../../server/repositories/projectContextBindingRepository";
import { verifyProjectContextBindingArtifactAuthority } from "../../server/modules/localization/projectContextBindingAuthority";
import { getProjectContextBindingIssuerVerifier } from "../../server/security/projectContextBindingIssuerKey";

export interface CanonicalProjectGeometry {
  readonly type: "Polygon" | "MultiPolygon";
  readonly coordinates: unknown;
}

export interface CanonicalProjectContext {
  readonly projectContextRef: ArtifactReference;
  readonly propertyContextRef: ArtifactReference;
  readonly geometryRef: ArtifactReference;
  readonly propertyDesignation: string;
  readonly municipality: string;
  readonly coordinates: readonly [number, number];
  readonly geometry: CanonicalProjectGeometry;
}

/**
 * Resolves and fully cryptographically verifies the canonical project/property context bound to
 * `projectId`. Every hop is verified (issuer trust + canonical content_hash recomputation), not
 * merely resolved -- a caller-supplied or tampered artifact at any hop fails closed.
 */
export async function resolveCanonicalProjectContext(
  projectId: string,
  repo: ArtifactRepositoryPort,
  index: PrismaProjectContextBindingIndex = new PrismaProjectContextBindingIndex(),
): Promise<CanonicalProjectContext> {
  const projectContextRef = await index.findProjectContextRef(projectId);
  const bindingArtifactId = await index.resolve(projectId, projectContextRef);

  const binding = await repo.resolve<ProjectContextBindingArtifact>({
    artifact_id: bindingArtifactId,
    artifact_type: "project_context_binding",
  });
  await verifyProjectContextBindingArtifactAuthority({
    artifact: binding,
    issuerRef: binding.payload.authority_ref,
    artifactRepository: repo,
    verification: getProjectContextBindingIssuerVerifier(),
  });
  if (binding.payload.project_id !== projectId) {
    throw new Error("REJECT_PROJECT_CONTEXT: binding project_id does not match requested project");
  }

  const propertyBinding = await repo.resolve<ProjectPropertyBindingArtifact>(
    binding.payload.project_property_binding_ref,
  );
  await verifyProjectContextBindingArtifactAuthority({
    artifact: propertyBinding,
    issuerRef: binding.payload.authority_ref,
    artifactRepository: repo,
    verification: getProjectContextBindingIssuerVerifier(),
  });
  if (propertyBinding.payload.project_id !== projectId) {
    throw new Error("REJECT_PROJECT_CONTEXT: property binding project_id does not match requested project");
  }

  const luProjectContext = await repo.resolve<LUProjectContextArtifact>(binding.payload.project_context_ref);
  if (luProjectContext.payload.project_id !== projectId) {
    throw new Error("REJECT_PROJECT_CONTEXT: LU_PROJECT_CONTEXT project_id does not match requested project");
  }
  const propertyContextRef = luProjectContext.payload.property_refs[0];
  if (!propertyContextRef) {
    throw new Error("REJECT_PROJECT_CONTEXT: LU_PROJECT_CONTEXT has no bound property");
  }

  const luPropertyContext = await repo.resolve<LUPropertyContextArtifact>(propertyContextRef);
  if (luPropertyContext.payload.geometry_ref.artifact_id !== propertyBinding.payload.geometry_ref.artifact_id) {
    throw new Error("REJECT_PROJECT_CONTEXT: property context geometry does not match the verified property binding");
  }

  const geometryArtifact = await repo.resolve<{ payload: { geometry: CanonicalProjectGeometry } }>(
    propertyBinding.payload.geometry_ref,
  );

  return {
    projectContextRef: { artifact_id: luProjectContext.artifact_id, artifact_type: luProjectContext.artifact_type },
    propertyContextRef: { artifact_id: luPropertyContext.artifact_id, artifact_type: luPropertyContext.artifact_type },
    geometryRef: propertyBinding.payload.geometry_ref,
    propertyDesignation: propertyBinding.payload.property_designation,
    municipality: luPropertyContext.payload.municipality,
    coordinates: luPropertyContext.payload.coordinates,
    geometry: geometryArtifact.payload.geometry,
  };
}
