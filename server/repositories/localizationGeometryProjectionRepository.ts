import { Prisma, prisma } from "../db/prisma";
import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactReference";

export interface LocalizationGeometryProjectionRow {
  readonly projectId: string;
  readonly geometryArtifactId: string;
  readonly propertyContextRefId: string;
  readonly propertyContextRefType: string;
  readonly createdAt: Date;
}

export interface LocalizationGeometryProjectionIndex {
  register(row: {
    readonly projectId: string;
    readonly geometryArtifactId: string;
    readonly propertyContextRef: ArtifactReference;
  }): Promise<void>;
  listForProject(projectId: string): Promise<readonly LocalizationGeometryProjectionRow[]>;
}

type Row = {
  project_id: string;
  geometry_artifact_id: string;
  property_context_ref_id: string;
  property_context_ref_type: string;
  created_at: Date;
};

function toProjectionRow(row: Row): LocalizationGeometryProjectionRow {
  return {
    projectId: row.project_id,
    geometryArtifactId: row.geometry_artifact_id,
    propertyContextRefId: row.property_context_ref_id,
    propertyContextRefType: row.property_context_ref_type,
    createdAt: row.created_at,
  };
}

/**
 * PRODUCT-LU-LOCALIZATION-GEOMETRY-01 Phase B. Same shape and same rules as
 * PrismaProjectAssessmentProjectionIndex: append-only access projection, `id` is the geometry
 * artifact's own content-addressed artifact_id, so a truly identical re-submission (same point,
 * same project) registers idempotently rather than duplicating a row. Callers must always
 * resolve, re-verify, and cross-check the referenced immutable artifact from CAS afterwards --
 * this index is a locator only, never authority.
 */
export class PrismaLocalizationGeometryProjectionIndex implements LocalizationGeometryProjectionIndex {
  async register(row: {
    readonly projectId: string;
    readonly geometryArtifactId: string;
    readonly propertyContextRef: ArtifactReference;
  }): Promise<void> {
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "localization_geometry_projections" (
        "id", "project_id", "geometry_artifact_id",
        "property_context_ref_id", "property_context_ref_type"
      ) VALUES (
        ${row.geometryArtifactId}, ${row.projectId}, ${row.geometryArtifactId},
        ${row.propertyContextRef.artifact_id}, ${row.propertyContextRef.artifact_type}
      ) ON CONFLICT ("project_id", "geometry_artifact_id") DO NOTHING
    `);
  }

  async listForProject(projectId: string): Promise<readonly LocalizationGeometryProjectionRow[]> {
    const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT "project_id", "geometry_artifact_id",
             "property_context_ref_id", "property_context_ref_type", "created_at"
      FROM "localization_geometry_projections"
      WHERE "project_id" = ${projectId}
      ORDER BY "created_at" DESC
    `);
    return rows.map(toProjectionRow);
  }
}
