-- P3-LU-ASSESSMENT-CURRENT-PROJECTION-01
-- Append-only, non-authoritative locator: "which already-persisted LocalizationAssessmentArtifact
-- is current for this project's current ProjectContextBinding." CAS remains the sole content
-- authority; every read must still resolve, re-verify, and cross-check the CAS artifact before
-- treating a row as valid. created_at is never used to decide validity, only as the final
-- deterministic tiebreaker among candidates that already passed CAS re-verification and
-- current-binding eligibility.
CREATE TABLE "project_assessment_projections" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "assessment_artifact_id" TEXT NOT NULL,
  "assessment_artifact_type" TEXT NOT NULL,
  "project_context_ref_id" TEXT NOT NULL,
  "project_context_ref_type" TEXT NOT NULL,
  "binding_artifact_id" TEXT NOT NULL,
  "release_artifact_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "project_assessment_projections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_assessment_projections_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "Project"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "project_assessment_projections_project_assessment_key"
  ON "project_assessment_projections"("project_id", "assessment_artifact_id");
CREATE INDEX "project_assessment_projections_binding_idx"
  ON "project_assessment_projections"("project_id", "binding_artifact_id");
CREATE INDEX "project_assessment_projections_created_idx"
  ON "project_assessment_projections"("project_id", "created_at");
