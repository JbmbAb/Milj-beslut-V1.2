import { Prisma, prisma } from "../db/prisma";

export interface LocalizationGeometrySupersessionRow {
  readonly projectId: string;
  readonly supersessionArtifactId: string;
  readonly predecessorGeometryArtifactId: string;
  readonly successorGeometryArtifactId: string;
  readonly createdAt: Date;
}

export interface LocalizationGeometrySupersessionIndex {
  register(row: {
    readonly projectId: string;
    readonly supersessionArtifactId: string;
    readonly predecessorGeometryArtifactId: string;
    readonly successorGeometryArtifactId: string;
  }): Promise<void>;
  listForProject(projectId: string): Promise<readonly LocalizationGeometrySupersessionRow[]>;
}

type Row = {
  project_id: string;
  supersession_artifact_id: string;
  predecessor_geometry_artifact_id: string;
  successor_geometry_artifact_id: string;
  created_at: Date;
};

function toRow(row: Row): LocalizationGeometrySupersessionRow {
  return {
    projectId: row.project_id,
    supersessionArtifactId: row.supersession_artifact_id,
    predecessorGeometryArtifactId: row.predecessor_geometry_artifact_id,
    successorGeometryArtifactId: row.successor_geometry_artifact_id,
    createdAt: row.created_at,
  };
}

/**
 * LU-PROJECTION-RECONCILIATION-AND-TOTAL-ORDER-V1 Phase B. Append-only, non-authoritative
 * discovery projection -- same shape and same rules as PrismaLocalizationGeometryProjectionIndex:
 * `id` is the supersession artifact's own content-addressed artifact_id, so idempotent by
 * construction. Authority is the signed LocalizationGeometrySupersessionArtifact in CAS; every row
 * read from here MUST be resolved + fully re-verified (issuer trust chain + signature) before
 * being trusted as a graph edge -- see LocalizationGeometryCurrentProvider.resolveCurrent.
 */
export class PrismaLocalizationGeometrySupersessionIndex implements LocalizationGeometrySupersessionIndex {
  async register(row: {
    readonly projectId: string;
    readonly supersessionArtifactId: string;
    readonly predecessorGeometryArtifactId: string;
    readonly successorGeometryArtifactId: string;
  }): Promise<void> {
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "localization_geometry_supersessions" (
        "id", "project_id", "supersession_artifact_id",
        "predecessor_geometry_artifact_id", "successor_geometry_artifact_id"
      ) VALUES (
        ${row.supersessionArtifactId}, ${row.projectId}, ${row.supersessionArtifactId},
        ${row.predecessorGeometryArtifactId}, ${row.successorGeometryArtifactId}
      ) ON CONFLICT ("project_id", "supersession_artifact_id") DO NOTHING
    `);
  }

  async listForProject(projectId: string): Promise<readonly LocalizationGeometrySupersessionRow[]> {
    const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT "project_id", "supersession_artifact_id",
             "predecessor_geometry_artifact_id", "successor_geometry_artifact_id", "created_at"
      FROM "localization_geometry_supersessions"
      WHERE "project_id" = ${projectId}
    `);
    return rows.map(toRow);
  }
}
