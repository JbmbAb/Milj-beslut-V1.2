import type { VerificationKeyProvider } from "@miljobeslut/mimers-brunn-core";
import type { ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import {
  PROJECT_CONTEXT_BINDING_ARTIFACT_TYPE,
  validateProjectContextBindingAnyVersion,
  type ProjectContextBindingArtifact,
  type ProjectContextBindingArtifactV2,
} from "../artifacts/ProjectContextBindingArtifact.js";
import {
  PROJECT_CONTEXT_BINDING_SUPERSESSION_ARTIFACT_TYPE,
  type ProjectContextBindingSupersessionArtifact,
  type ProjectContextBindingSupersessionArtifactV2,
} from "../artifacts/ProjectContextBindingSupersessionArtifact.js";
import { resolveCurrentProjectContextBindingHead } from "../artifacts/ProjectContextBindingSupersessionGraph.js";
import { createProjectContextBindingIssuerArtifact } from "../artifacts/ProjectContextBindingIssuerArtifact.js";
import type { ProjectPropertyBindingArtifact } from "../artifacts/ProjectPropertyBindingArtifact.js";
import type { LUProjectContextArtifact } from "../artifacts/LUProjectContextArtifact.js";
import type { LUPropertyContextArtifact } from "../artifacts/LUPropertyContextArtifact.js";
import type { CanonicalProjectContext, CanonicalProjectGeometry } from "./CanonicalProjectContext.js";
import type { ProjectContextBindingAuthorityPort } from "./ProjectContextBindingAuthorityPort.js";
import type { ProjectContextBindingIndexPort } from "./ProjectContextBindingIndexPort.js";

export type AnyProjectContextBindingArtifact =
  | ProjectContextBindingArtifact
  | ProjectContextBindingArtifactV2;

export interface CanonicalProjectContextReaderDeps {
  readonly artifactRepository: ArtifactRepositoryPort;
  readonly bindingIndex: ProjectContextBindingIndexPort;
  readonly authority: ProjectContextBindingAuthorityPort;
  readonly verification: VerificationKeyProvider;
}

/**
 * Reusable READ-ONLY canonical project-context resolver.
 *
 * Authority is established elsewhere (bootstrap/mint). This reader only resolves
 * and cryptographically verifies already-issued bindings and CAS artifacts.
 *
 * Forbidden in this module: Prisma, PostGIS, SpatialProvider, mint/bootstrap, CAS write.
 */
export class CanonicalProjectContextReader {
  constructor(private readonly deps: CanonicalProjectContextReaderDeps) {}

  /**
   * Resolves the verified current ProjectContextBinding head for a project.
   * Lookup projection only supplies candidate refs; every hop is authority-verified.
   */
  async resolveCurrentBinding(projectId: string): Promise<AnyProjectContextBindingArtifact> {
    try {
      const [bindingRefs, supersessionRefs] = await Promise.all([
        this.deps.bindingIndex.listBindingRefs(projectId),
        this.deps.bindingIndex.listSupersessionRefs(projectId),
      ]);
      const bindings = await Promise.all(
        bindingRefs.map(async (reference) => {
          const binding = validateProjectContextBindingAnyVersion(
            await this.deps.artifactRepository.resolve<AnyProjectContextBindingArtifact>({
              artifact_id: reference.artifact_id,
              artifact_type: PROJECT_CONTEXT_BINDING_ARTIFACT_TYPE,
            }),
          );
          await this.deps.authority.verifyArtifactAuthority({
            artifact: binding,
            issuerRef: binding.payload.authority_ref,
            artifactRepository: this.deps.artifactRepository,
            verification: this.deps.verification,
          });
          return binding;
        }),
      );
      const supersessions = await Promise.all(
        supersessionRefs.map(async (reference) => {
          const relation = await this.deps.artifactRepository.resolve<
            ProjectContextBindingSupersessionArtifact | ProjectContextBindingSupersessionArtifactV2
          >({
            artifact_id: reference.artifact_id,
            artifact_type: PROJECT_CONTEXT_BINDING_SUPERSESSION_ARTIFACT_TYPE,
          });
          await this.deps.authority.verifySupersessionAuthority({
            artifact: relation,
            artifactRepository: this.deps.artifactRepository,
          });
          return relation;
        }),
      );
      return resolveCurrentProjectContextBindingHead({ projectId, bindings, supersessions });
    } catch {
      throw new Error("REJECT_PROJECT_CONTEXT_BINDING_CURRENT_UNAVAILABLE");
    }
  }

  /**
   * Full canonical project/property context for `projectId`.
   * Fails closed on missing/invalid/tampered authority chain.
   */
  async resolve(projectId: string): Promise<CanonicalProjectContext> {
    const binding = await this.resolveCurrentBinding(projectId);
    if (binding.payload.project_id !== projectId) {
      throw new Error("REJECT_PROJECT_CONTEXT: binding project_id does not match requested project");
    }

    const propertyBinding = await this.deps.artifactRepository.resolve<ProjectPropertyBindingArtifact>(
      binding.payload.project_property_binding_ref,
    );
    const propertyBindingAttestation = propertyBinding.attestation;
    const propertyBindingIssuerVersion = (
      propertyBindingAttestation?.predicate as { issuer_version?: unknown } | undefined
    )?.issuer_version;
    if (typeof propertyBindingIssuerVersion !== "string" || !propertyBindingAttestation?.signer) {
      throw new Error("REJECT_PROJECT_CONTEXT: property binding issuer provenance is unavailable");
    }
    const propertyBindingIssuer = createProjectContextBindingIssuerArtifact({
      issuer_key_id: propertyBindingAttestation.signer,
      issuer_version: propertyBindingIssuerVersion as
        | "project-context-binding-issuer-v1"
        | "project-context-binding-issuer-v2",
    });
    await this.deps.authority.verifyArtifactAuthority({
      artifact: propertyBinding,
      issuerRef: {
        artifact_id: propertyBindingIssuer.artifact_id,
        artifact_type: propertyBindingIssuer.artifact_type,
      },
      artifactRepository: this.deps.artifactRepository,
      verification: this.deps.verification,
    });
    if (propertyBinding.payload.project_id !== projectId) {
      throw new Error("REJECT_PROJECT_CONTEXT: property binding project_id does not match requested project");
    }

    const luProjectContext = await this.deps.artifactRepository.resolve<LUProjectContextArtifact>(
      binding.payload.project_context_ref,
    );
    if (luProjectContext.payload.project_id !== projectId) {
      throw new Error("REJECT_PROJECT_CONTEXT: LU_PROJECT_CONTEXT project_id does not match requested project");
    }
    const propertyContextRef = luProjectContext.payload.property_refs[0];
    if (!propertyContextRef) {
      throw new Error("REJECT_PROJECT_CONTEXT: LU_PROJECT_CONTEXT has no bound property");
    }

    const luPropertyContext =
      await this.deps.artifactRepository.resolve<LUPropertyContextArtifact>(propertyContextRef);
    if (
      luPropertyContext.payload.geometry_ref.artifact_id !==
      propertyBinding.payload.geometry_ref.artifact_id
    ) {
      throw new Error(
        "REJECT_PROJECT_CONTEXT: property context geometry does not match the verified property binding",
      );
    }

    const geometryArtifact = await this.deps.artifactRepository.resolve<{
      payload: { geometry: CanonicalProjectGeometry };
    }>(propertyBinding.payload.geometry_ref);

    return {
      projectContextRef: {
        artifact_id: luProjectContext.artifact_id,
        artifact_type: luProjectContext.artifact_type,
      },
      propertyContextRef: {
        artifact_id: luPropertyContext.artifact_id,
        artifact_type: luPropertyContext.artifact_type,
      },
      contextBindingRef: {
        artifact_id: binding.artifact_id,
        artifact_type: binding.artifact_type,
      },
      geometryRef: propertyBinding.payload.geometry_ref,
      propertyDesignation: propertyBinding.payload.property_designation,
      propertyIdentity: propertyBinding.payload.property_identity,
      municipality: luPropertyContext.payload.municipality,
      coordinates: luPropertyContext.payload.coordinates,
      geometry: geometryArtifact.payload.geometry,
    };
  }
}
