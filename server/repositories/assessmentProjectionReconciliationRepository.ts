import { Prisma, prisma } from '../db/prisma';

export type AssessmentProjectionReconciliationStatus =
  'PENDING' | 'RECONCILED' | 'NOT_CURRENT' | 'MISSING_CAS' | 'TAMPERED';

export interface AssessmentProjectionReconciliationObligation {
  readonly assessmentArtifactId: string;
  readonly status: AssessmentProjectionReconciliationStatus;
  readonly attemptCount: number;
  readonly lastError: string | null;
  readonly projectId: string | null;
  readonly bindingArtifactId: string | null;
  readonly releaseArtifactId: string | null;
  readonly localizationGeometryArtifactId: string | null;
}

export interface AssessmentProjectionReconciliationStore {
  upsertPending(input: {
    readonly assessmentArtifactId: string;
    readonly projectId?: string | null;
    readonly bindingArtifactId?: string | null;
    readonly releaseArtifactId?: string | null;
    readonly localizationGeometryArtifactId?: string | null;
  }): Promise<void>;
  listRecoverableForProject(
    projectId: string,
  ): Promise<readonly AssessmentProjectionReconciliationObligation[]>;
  markReconciled(assessmentArtifactId: string): Promise<void>;
  markNotCurrent(assessmentArtifactId: string): Promise<void>;
  markMissingCas(assessmentArtifactId: string): Promise<void>;
  markTampered(assessmentArtifactId: string, reason: string): Promise<void>;
  recordRetryableFailure(assessmentArtifactId: string, reason: string): Promise<void>;
}

type Row = {
  assessment_artifact_id: string;
  status: AssessmentProjectionReconciliationStatus;
  attempt_count: number;
  last_error: string | null;
  project_id: string | null;
  binding_artifact_id: string | null;
  release_artifact_id: string | null;
  localization_geometry_artifact_id: string | null;
};

function toObligation(row: Row): AssessmentProjectionReconciliationObligation {
  return {
    assessmentArtifactId: row.assessment_artifact_id,
    status: row.status,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    projectId: row.project_id,
    bindingArtifactId: row.binding_artifact_id,
    releaseArtifactId: row.release_artifact_id,
    localizationGeometryArtifactId: row.localization_geometry_artifact_id,
  };
}

function boundedError(reason: string): string {
  return reason.slice(0, 2000);
}

export class PrismaAssessmentProjectionReconciliationStore implements AssessmentProjectionReconciliationStore {
  async upsertPending(input: {
    readonly assessmentArtifactId: string;
    readonly projectId?: string | null;
    readonly bindingArtifactId?: string | null;
    readonly releaseArtifactId?: string | null;
    readonly localizationGeometryArtifactId?: string | null;
  }): Promise<void> {
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "assessment_projection_reconciliation_obligations" (
        "assessment_artifact_id", "status", "project_id", "binding_artifact_id",
        "release_artifact_id", "localization_geometry_artifact_id", "updated_at"
      ) VALUES (
        ${input.assessmentArtifactId}, 'PENDING'::"AssessmentProjectionReconciliationStatus",
        ${input.projectId ?? null}, ${input.bindingArtifactId ?? null},
        ${input.releaseArtifactId ?? null}, ${input.localizationGeometryArtifactId ?? null},
        CURRENT_TIMESTAMP
      )
      ON CONFLICT ("assessment_artifact_id") DO UPDATE SET
        "project_id" = COALESCE(EXCLUDED."project_id", "assessment_projection_reconciliation_obligations"."project_id"),
        "binding_artifact_id" = COALESCE(EXCLUDED."binding_artifact_id", "assessment_projection_reconciliation_obligations"."binding_artifact_id"),
        "release_artifact_id" = COALESCE(EXCLUDED."release_artifact_id", "assessment_projection_reconciliation_obligations"."release_artifact_id"),
        "localization_geometry_artifact_id" = COALESCE(EXCLUDED."localization_geometry_artifact_id", "assessment_projection_reconciliation_obligations"."localization_geometry_artifact_id"),
        "status" = CASE
          WHEN "assessment_projection_reconciliation_obligations"."status" = 'RECONCILED'::"AssessmentProjectionReconciliationStatus"
            THEN "assessment_projection_reconciliation_obligations"."status"
          WHEN "assessment_projection_reconciliation_obligations"."status" = 'TAMPERED'::"AssessmentProjectionReconciliationStatus"
            THEN "assessment_projection_reconciliation_obligations"."status"
          ELSE 'PENDING'::"AssessmentProjectionReconciliationStatus"
        END,
        "updated_at" = CURRENT_TIMESTAMP
    `);
  }

  async listRecoverableForProject(
    projectId: string,
  ): Promise<readonly AssessmentProjectionReconciliationObligation[]> {
    const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT "assessment_artifact_id", "status", "attempt_count", "last_error",
             "project_id", "binding_artifact_id", "release_artifact_id",
             "localization_geometry_artifact_id"
      FROM "assessment_projection_reconciliation_obligations"
      WHERE "project_id" = ${projectId}
        AND "status" IN (
          'PENDING'::"AssessmentProjectionReconciliationStatus",
          'MISSING_CAS'::"AssessmentProjectionReconciliationStatus",
          'NOT_CURRENT'::"AssessmentProjectionReconciliationStatus"
        )
      ORDER BY "updated_at" ASC
    `);
    return rows.map(toObligation);
  }

  async markReconciled(assessmentArtifactId: string): Promise<void> {
    await this.setStatus(assessmentArtifactId, 'RECONCILED', null);
  }

  async markNotCurrent(assessmentArtifactId: string): Promise<void> {
    await this.setStatus(assessmentArtifactId, 'NOT_CURRENT', null);
  }

  async markMissingCas(assessmentArtifactId: string): Promise<void> {
    await this.setStatus(assessmentArtifactId, 'MISSING_CAS', null);
  }

  async markTampered(assessmentArtifactId: string, reason: string): Promise<void> {
    await this.setStatus(assessmentArtifactId, 'TAMPERED', boundedError(reason));
  }

  async recordRetryableFailure(assessmentArtifactId: string, reason: string): Promise<void> {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "assessment_projection_reconciliation_obligations"
      SET "status" = 'PENDING'::"AssessmentProjectionReconciliationStatus",
          "attempt_count" = "attempt_count" + 1,
          "last_error" = ${boundedError(reason)},
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "assessment_artifact_id" = ${assessmentArtifactId}
    `);
  }

  private async setStatus(
    assessmentArtifactId: string,
    status: AssessmentProjectionReconciliationStatus,
    lastError: string | null,
  ): Promise<void> {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "assessment_projection_reconciliation_obligations"
      SET "status" = ${status}::"AssessmentProjectionReconciliationStatus",
          "attempt_count" = "attempt_count" + 1,
          "last_error" = ${lastError},
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "assessment_artifact_id" = ${assessmentArtifactId}
    `);
  }
}
