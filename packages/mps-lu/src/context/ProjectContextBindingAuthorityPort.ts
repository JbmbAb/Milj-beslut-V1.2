import type { VerificationKeyProvider } from "@miljobeslut/mimers-brunn-core";
import type { ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import type {
  ProjectContextBindingArtifact,
  ProjectContextBindingArtifactV2,
} from "../artifacts/ProjectContextBindingArtifact.js";
import type {
  ProjectContextBindingSupersessionArtifact,
  ProjectContextBindingSupersessionArtifactV2,
} from "../artifacts/ProjectContextBindingSupersessionArtifact.js";
import type { ProjectPropertyBindingArtifact } from "../artifacts/ProjectPropertyBindingArtifact.js";

export type ProjectContextBindingAttestable =
  | ProjectPropertyBindingArtifact
  | ProjectContextBindingArtifact
  | ProjectContextBindingArtifactV2
  | ProjectContextBindingSupersessionArtifact
  | ProjectContextBindingSupersessionArtifactV2;

/**
 * Injected authority verification — must preserve existing issuer/signature semantics.
 * Product composition wires the existing server verifier; the package does not mint keys.
 */
export interface ProjectContextBindingAuthorityPort {
  verifyArtifactAuthority(args: {
    readonly artifact: ProjectContextBindingAttestable;
    readonly issuerRef: { readonly artifact_id: string; readonly artifact_type: string };
    readonly artifactRepository: ArtifactRepositoryPort;
    readonly verification: VerificationKeyProvider;
  }): Promise<void>;

  verifySupersessionAuthority(args: {
    readonly artifact: ProjectContextBindingSupersessionArtifact | ProjectContextBindingSupersessionArtifactV2;
    readonly artifactRepository: ArtifactRepositoryPort;
  }): Promise<void>;
}
