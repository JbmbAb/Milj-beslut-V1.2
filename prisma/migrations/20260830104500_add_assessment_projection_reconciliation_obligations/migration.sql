CREATE TYPE "AssessmentProjectionReconciliationStatus" AS ENUM (
  'PENDING',
  'RECONCILED',
  'NOT_CURRENT',
  'MISSING_CAS',
  'TAMPERED'
);

CREATE TABLE "assessment_projection_reconciliation_obligations" (
  "assessment_artifact_id" TEXT NOT NULL,
  "status" "AssessmentProjectionReconciliationStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "project_id" TEXT,
  "binding_artifact_id" TEXT,
  "release_artifact_id" TEXT,
  "localization_geometry_artifact_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "assessment_projection_reconciliation_obligations_pkey"
    PRIMARY KEY ("assessment_artifact_id")
);

CREATE INDEX "assessment_projection_reconciliation_obligations_project_status_idx"
  ON "assessment_projection_reconciliation_obligations"("project_id", "status");

CREATE INDEX "assessment_projection_reconciliation_obligations_status_updated_idx"
  ON "assessment_projection_reconciliation_obligations"("status", "updated_at");
