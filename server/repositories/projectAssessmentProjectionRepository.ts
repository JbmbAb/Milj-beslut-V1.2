import { Prisma, prisma } from "../db/prisma";
import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactReference";

export interface ProjectAssessmentProjectionRow {
  readonly projectId: string;
  readonly assessmentArtifactId: string;
  readonly assessmentArtifactType: string;
  readonly projectContextRefId: string;
  readonly projectContextRefType: string;
  readonly bindingArtifactId: string;
  readonly releaseArtifactId: string;
  /** PRODUCT-LU-LOCALIZATION-GEOMETRY-01 Phase B. Null for rows registered before this unit. */
  readonly localizationGeometryArtifactId: string | null;
  readonly createdAt: Date;
}

export interface ProjectAssessmentProjectionIndex {
  register(row: {
    readonly projectId: string;
    readonly assessmentArtifactId: string;
    readonly assessmentArtifactType: string;
    readonly projectContextRef: ArtifactReference;
    readonly bindingArtifactId: string;
    readonly releaseArtifactId: string;
    readonly localizationGeometryArtifactId?: string | null;
  }): Promise<void>;
  listForProject(projectId: string): Promise<readonly ProjectAssessmentProjectionRow[]>;
}

type Row = {
  project_id: string;
  assessment_artifact_id: string;
  assessment_artifact_type: string;
  project_context_ref_id: string;
  project_context_ref_type: string;
  binding_artifact_id: string;
  release_artifact_id: string;
  localization_geometry_artifact_id: string | null;
  created_at: Date;
};

function toProjectionRow(row: Row): ProjectAssessmentProjectionRow {
  return {
    projectId: row.project_id,
    assessmentArtifactId: row.assessment_artifact_id,
    assessmentArtifactType: row.assessment_artifact_type,
    projectContextRefId: row.project_context_ref_id,
    projectContextRefType: row.project_context_ref_type,
    bindingArtifactId: row.binding_artifact_id,
    releaseArtifactId: row.release_artifact_id,
    localizationGeometryArtifactId: row.localization_geometry_artifact_id,
    createdAt: row.created_at,
  };
}

/**
 * P3-LU-ASSESSMENT-CURRENT-PROJECTION-01. Append-only access projection -- it is only an
 * efficient "which candidates exist" lookup; callers must always resolve, re-verify, and
 * cross-check the referenced immutable assessment artifact from CAS afterwards. `id` is the
 * assessment's own content-addressed artifact_id (globally unique in CAS already), so a truly
 * identical re-run (same evidence, same findings -> same assessment artifact_id) registers
 * idempotently rather than duplicating a row.
 */
export class PrismaProjectAssessmentProjectionIndex implements ProjectAssessmentProjectionIndex {
  async register(row: {
    readonly projectId: string;
    readonly assessmentArtifactId: string;
    readonly assessmentArtifactType: string;
    readonly projectContextRef: ArtifactReference;
    readonly bindingArtifactId: string;
    readonly releaseArtifactId: string;
    readonly localizationGeometryArtifactId?: string | null;
  }): Promise<void> {
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "project_assessment_projections" (
        "id", "project_id", "assessment_artifact_id", "assessment_artifact_type",
        "project_context_ref_id", "project_context_ref_type",
        "binding_artifact_id", "release_artifact_id", "localization_geometry_artifact_id"
      ) VALUES (
        ${row.assessmentArtifactId}, ${row.projectId}, ${row.assessmentArtifactId}, ${row.assessmentArtifactType},
        ${row.projectContextRef.artifact_id}, ${row.projectContextRef.artifact_type},
        ${row.bindingArtifactId}, ${row.releaseArtifactId}, ${row.localizationGeometryArtifactId ?? null}
      ) ON CONFLICT ("project_id", "assessment_artifact_id") DO NOTHING
    `);
  }

  async listForProject(projectId: string): Promise<readonly ProjectAssessmentProjectionRow[]> {
    const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT "project_id", "assessment_artifact_id", "assessment_artifact_type",
             "project_context_ref_id", "project_context_ref_type",
             "binding_artifact_id", "release_artifact_id", "localization_geometry_artifact_id", "created_at"
      FROM "project_assessment_projections"
      WHERE "project_id" = ${projectId}
      ORDER BY "created_at" DESC
    `);
    return rows.map(toProjectionRow);
  }
}
