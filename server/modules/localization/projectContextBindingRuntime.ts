import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactReference";
import type { ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import {
  PROJECT_CONTEXT_BINDING_ARTIFACT_TYPE,
  type LocalizationAssessmentArtifact,
  type ProjectContextBindingArtifact,
  validateProjectContextBindingArtifact,
} from "@miljobeslut/mps-lu";
import type { ProjectContextBindingIndex } from "../../repositories/projectContextBindingRepository";

export class ProjectContextBindingProvider {
  constructor(
    private readonly artifactRepository: ArtifactRepositoryPort,
    private readonly index: ProjectContextBindingIndex,
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
    if (
      verified.payload.project_id !== projectId ||
      verified.payload.project_context_ref.artifact_id !== projectContextRef.artifact_id ||
      verified.payload.project_context_ref.artifact_type !== projectContextRef.artifact_type
    ) {
      throw new Error("REJECT_PROJECT_CONTEXT_BINDING_MISMATCH");
    }
    return verified;
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
