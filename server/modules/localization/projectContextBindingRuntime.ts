import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactReference";
import type { VerificationKeyProvider } from "@miljobeslut/mimers-brunn-core";
import type { ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import {
  PROJECT_CONTEXT_BINDING_ARTIFACT_TYPE,
  PROJECT_CONTEXT_BINDING_SUPERSESSION_ARTIFACT_TYPE,
  resolveCurrentProjectContextBindingHead,
  type LocalizationAssessmentArtifact,
  type ProjectContextBindingArtifact,
  type ProjectContextBindingSupersessionArtifact,
  validateProjectContextBindingArtifact,
} from "@miljobeslut/mps-lu";
import type { ProjectContextBindingIndex } from "../../repositories/projectContextBindingRepository";
import { verifyProjectContextBindingArtifactAuthority, verifyProjectContextBindingSupersessionAuthority } from "./projectContextBindingAuthority";

export class ProjectContextBindingProvider {
  constructor(
    private readonly artifactRepository: ArtifactRepositoryPort,
    private readonly index: ProjectContextBindingIndex,
    private readonly verification: VerificationKeyProvider,
  ) {}

  async resolve(projectId: string, projectContextRef: ArtifactReference): Promise<ProjectContextBindingArtifact> {
    let bindingArtifactId: string;
    try {
      bindingArtifactId = await this.index.resolve(projectId, projectContextRef);
    } catch {
      throw new Error("REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE");
    }

    let binding: ProjectContextBindingArtifact;
    try {
      binding = await this.artifactRepository.resolve<ProjectContextBindingArtifact>({
        artifact_id: bindingArtifactId,
        artifact_type: PROJECT_CONTEXT_BINDING_ARTIFACT_TYPE,
      });
    } catch {
      throw new Error("REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE");
    }

    const verified = validateProjectContextBindingArtifact(binding);
    try {
      await verifyProjectContextBindingArtifactAuthority({
        artifact: verified,
        issuerRef: verified.payload.authority_ref,
        artifactRepository: this.artifactRepository,
        verification: this.verification,
      });
    } catch {
      throw new Error("REJECT_PROJECT_CONTEXT_BINDING_AUTHORITY_INVALID");
    }
    if (
      verified.payload.project_id !== projectId ||
      verified.payload.project_context_ref.artifact_id !== projectContextRef.artifact_id ||
      verified.payload.project_context_ref.artifact_type !== projectContextRef.artifact_type
    ) {
      throw new Error("REJECT_PROJECT_CONTEXT_BINDING_MISMATCH");
    }
    return verified;
  }

  /** Resolves the verified graph head; lookup projection only supplies candidate refs. */
  async resolveCurrent(projectId: string): Promise<ProjectContextBindingArtifact> {
    try {
      if (!this.index.listBindingRefs || !this.index.listSupersessionRefs) {
        throw new Error("REJECT_PROJECT_CONTEXT_BINDING_CURRENT_UNAVAILABLE");
      }
      const [bindingRefs, supersessionRefs] = await Promise.all([
        this.index.listBindingRefs(projectId),
        this.index.listSupersessionRefs(projectId),
      ]);
      const bindings = await Promise.all(bindingRefs.map(async (reference) => {
        const binding = validateProjectContextBindingArtifact(
          await this.artifactRepository.resolve<ProjectContextBindingArtifact>(reference),
        );
        await verifyProjectContextBindingArtifactAuthority({
          artifact: binding,
          issuerRef: binding.payload.authority_ref,
          artifactRepository: this.artifactRepository,
          verification: this.verification,
        });
        return binding;
      }));
      const supersessions = await Promise.all(supersessionRefs.map(async (reference) => {
        const relation = await this.artifactRepository.resolve<ProjectContextBindingSupersessionArtifact>({
          artifact_id: reference.artifact_id,
          artifact_type: PROJECT_CONTEXT_BINDING_SUPERSESSION_ARTIFACT_TYPE,
        });
        await verifyProjectContextBindingSupersessionAuthority({
          artifact: relation,
          artifactRepository: this.artifactRepository,
          verification: this.verification,
        });
        return relation;
      }));
      return resolveCurrentProjectContextBindingHead({ projectId, bindings, supersessions });
    } catch {
      throw new Error("REJECT_PROJECT_CONTEXT_BINDING_CURRENT_UNAVAILABLE");
    }
  }
}

/**
 * Presentation access requires both project authorization (performed by the injected guard) and
 * proof that the assessment belongs to that project's immutable LU context.
 */
export async function authorizeAssessmentPresentation(args: {
  readonly projectId: string;
  readonly assessment: LocalizationAssessmentArtifact;
  readonly assertProjectAccess: () => Promise<void>;
  readonly bindingProvider: ProjectContextBindingProvider;
}): Promise<ProjectContextBindingArtifact> {
  await args.assertProjectAccess();
  return args.bindingProvider.resolve(args.projectId, args.assessment.payload.project_context_ref);
}
