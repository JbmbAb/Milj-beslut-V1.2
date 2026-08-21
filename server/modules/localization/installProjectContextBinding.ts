import type { ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import {
  type ProjectContextBindingArtifact,
  validateProjectContextBindingArtifact,
} from "@miljobeslut/mps-lu";
import type { ProjectContextBindingIndex } from "../../repositories/projectContextBindingRepository";
import { ProjectContextBindingProvider } from "./projectContextBindingRuntime";

/**
 * Owner-provisioning boundary. It accepts an already-issued artifact and never derives a binding
 * from a route, assessment, naming convention, or runtime default.
 */
export async function installOwnerIssuedProjectContextBinding(args: {
  readonly artifactRepository: ArtifactRepositoryPort;
  readonly index: ProjectContextBindingIndex;
  readonly binding: ProjectContextBindingArtifact;
}): Promise<ProjectContextBindingArtifact> {
  const binding = validateProjectContextBindingArtifact(args.binding);
  try {
    await args.artifactRepository.resolve(binding.payload.authority_ref);
  } catch {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_AUTHORITY_UNAVAILABLE");
  }
  await args.artifactRepository.put({
    artifact_id: binding.artifact_id,
    content_hash: binding.content_hash,
    body: binding,
  });
  await args.index.register(binding);
  return new ProjectContextBindingProvider(args.artifactRepository, args.index).resolve(
    binding.payload.project_id,
    binding.payload.project_context_ref,
  );
}
