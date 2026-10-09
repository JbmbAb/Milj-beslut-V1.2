import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactReference";

/**
 * Read-only projection for current ProjectContextBinding resolution.
 *
 * Concrete product adapters (e.g. Prisma) may implement this; the reusable
 * canonical reader must never see Prisma/SQL types.
 *
 * Write/register operations are intentionally absent — this port is READ ONLY.
 */
export interface ProjectContextBindingIndexPort {
  listBindingRefs(projectId: string): Promise<readonly ArtifactReference[]>;
  listSupersessionRefs(projectId: string): Promise<readonly ArtifactReference[]>;
}
