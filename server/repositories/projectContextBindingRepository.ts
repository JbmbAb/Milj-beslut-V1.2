import { Prisma, prisma } from "../db/prisma";
import type {
  ProjectContextBindingArtifact,
} from "@miljobeslut/mps-lu";
import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactReference";

export interface ProjectContextBindingIndex {
  register(binding: ProjectContextBindingArtifact): Promise<void>;
  resolve(projectId: string, projectContextRef: ArtifactReference): Promise<string>;
}

type BindingRow = { binding_artifact_id: string };

/**
 * Append-only access projection. It is only an efficient lookup; callers must always resolve
 * and validate the referenced immutable binding artifact from CAS afterwards.
 */
export class PrismaProjectContextBindingIndex implements ProjectContextBindingIndex {
  async register(binding: ProjectContextBindingArtifact): Promise<void> {
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "project_context_bindings" (
        "id", "project_id", "binding_artifact_id",
        "project_context_artifact_id", "project_context_artifact_type",
        "binding_version", "authority_artifact_id", "authority_artifact_type"
      ) VALUES (
        ${binding.artifact_id}, ${binding.payload.project_id}, ${binding.artifact_id},
        ${binding.payload.project_context_ref.artifact_id}, ${binding.payload.project_context_ref.artifact_type},
        ${binding.payload.binding_version}, ${binding.payload.authority_ref.artifact_id}, ${binding.payload.authority_ref.artifact_type}
      ) ON CONFLICT ("project_id", "project_context_artifact_id", "project_context_artifact_type") DO NOTHING
    `);

    const resolvedId = await this.resolve(binding.payload.project_id, binding.payload.project_context_ref);
    if (resolvedId !== binding.artifact_id) {
      throw new Error("REJECT_PROJECT_CONTEXT_BINDING_CONFLICT: project/context already has a different binding");
    }
  }

  async resolve(projectId: string, projectContextRef: ArtifactReference): Promise<string> {
    const rows = await prisma.$queryRaw<BindingRow[]>(Prisma.sql`
      SELECT "binding_artifact_id"
      FROM "project_context_bindings"
      WHERE "project_id" = ${projectId}
        AND "project_context_artifact_id" = ${projectContextRef.artifact_id}
        AND "project_context_artifact_type" = ${projectContextRef.artifact_type}
      LIMIT 2
    `);
    if (rows.length !== 1) {
      throw new Error("REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE");
    }
    return rows[0]!.binding_artifact_id;
  }
}
