import type { VerificationKeyProvider } from "@miljobeslut/mimers-brunn-core";
import type { ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import {
  type ProjectContextBindingArtifact,
  type ProjectContextBindingSupersessionArtifact,
  validateProjectContextBindingArtifact,
  validateProjectContextBindingSupersessionArtifact,
} from "@miljobeslut/mps-lu";
import type { ProjectContextBindingIndex } from "../../repositories/projectContextBindingRepository";
import { ProjectContextBindingProvider } from "./projectContextBindingRuntime";
import { verifyProjectContextBindingArtifactAuthority, verifyProjectContextBindingSupersessionAuthority } from "./projectContextBindingAuthority";

/**
 * Owner-provisioning boundary. It accepts an already-issued artifact and never derives a binding
 * from a route, assessment, naming convention, or runtime default.
 */
export async function installOwnerIssuedProjectContextBinding(args: {
  readonly artifactRepository: ArtifactRepositoryPort;
  readonly index: ProjectContextBindingIndex;
  readonly binding: ProjectContextBindingArtifact;
  readonly verification: VerificationKeyProvider;
}): Promise<ProjectContextBindingArtifact> {
  const binding = validateProjectContextBindingArtifact(args.binding);
  await verifyProjectContextBindingArtifactAuthority({
    artifact: binding,
    issuerRef: binding.payload.authority_ref,
    artifactRepository: args.artifactRepository,
    verification: args.verification,
  });
  await args.artifactRepository.put({
    artifact_id: binding.artifact_id,
    content_hash: binding.content_hash,
    body: binding,
  });
  await args.index.register(binding);
  return new ProjectContextBindingProvider(args.artifactRepository, args.index, args.verification).resolve(
    binding.payload.project_id,
    binding.payload.project_context_ref,
  );
}

/** Owner-side correction boundary. It creates no binding and only persists a verified relation. */
export async function installOwnerIssuedProjectContextBindingSupersession(args: {
  readonly artifactRepository: ArtifactRepositoryPort;
  readonly index: ProjectContextBindingIndex;
  readonly supersession: ProjectContextBindingSupersessionArtifact;
  readonly verification: VerificationKeyProvider;
}): Promise<ProjectContextBindingArtifact> {
  const supersession = validateProjectContextBindingSupersessionArtifact(args.supersession);
  await verifyProjectContextBindingSupersessionAuthority({
    artifact: supersession,
    artifactRepository: args.artifactRepository,
    verification: args.verification,
  });
  const [predecessor, successor] = await Promise.all([
    args.artifactRepository.resolve<ProjectContextBindingArtifact>(supersession.payload.superseded_binding_ref),
    args.artifactRepository.resolve<ProjectContextBindingArtifact>(supersession.payload.successor_binding_ref),
  ]);
  for (const binding of [predecessor, successor]) {
    const verified = validateProjectContextBindingArtifact(binding);
    await verifyProjectContextBindingArtifactAuthority({
      artifact: verified,
      issuerRef: verified.payload.authority_ref,
      artifactRepository: args.artifactRepository,
      verification: args.verification,
    });
    if (verified.payload.project_id !== supersession.payload.project_id) {
      throw new Error("REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_PROJECT");
    }
  }
  if (!args.index.registerSupersession) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_PROJECTION_UNAVAILABLE");
  }
  await args.artifactRepository.put({
    artifact_id: supersession.artifact_id,
    content_hash: supersession.content_hash,
    body: supersession,
  });
  await args.index.registerSupersession(supersession);
  return new ProjectContextBindingProvider(args.artifactRepository, args.index, args.verification)
    .resolveCurrent(supersession.payload.project_id);
}
