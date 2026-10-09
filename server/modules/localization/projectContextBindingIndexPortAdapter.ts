import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactReference";
import type { ProjectContextBindingIndexPort } from "@miljobeslut/mps-lu";
import type { ProjectContextBindingIndex } from "../../repositories/projectContextBindingRepository";

/**
 * Read-only adapter: product Prisma/index → package ProjectContextBindingIndexPort.
 * Register/write methods are intentionally not exposed.
 */
export function asProjectContextBindingIndexPort(
  index: ProjectContextBindingIndex,
): ProjectContextBindingIndexPort {
  return {
    async listBindingRefs(projectId: string): Promise<readonly ArtifactReference[]> {
      if (!index.listBindingRefs) {
        throw new Error("REJECT_PROJECT_CONTEXT_BINDING_CURRENT_UNAVAILABLE");
      }
      return index.listBindingRefs(projectId);
    },
    async listSupersessionRefs(projectId: string): Promise<readonly ArtifactReference[]> {
      if (!index.listSupersessionRefs) {
        throw new Error("REJECT_PROJECT_CONTEXT_BINDING_CURRENT_UNAVAILABLE");
      }
      return index.listSupersessionRefs(projectId);
    },
  };
}
