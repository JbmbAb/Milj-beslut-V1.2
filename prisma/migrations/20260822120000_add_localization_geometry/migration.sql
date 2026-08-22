-- PRODUCT-LU-LOCALIZATION-GEOMETRY-01 Phase B
-- Additive only: one new table (locator/read-model, non-authoritative), one new nullable column.
-- CAS remains the sole content authority for both LocalizationGeometryArtifact and the current
-- assessment's localization-geometry match.

ALTER TABLE "project_assessment_projections"
  ADD COLUMN "localization_geometry_artifact_id" TEXT;

CREATE INDEX "project_assessment_projections_project_id_localization_geometry_artifact_id_idx"
  ON "project_assessment_projections"("project_id", "localization_geometry_artifact_id");

CREATE TABLE "localization_geometry_projections" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "geometry_artifact_id" TEXT NOT NULL,
  "property_context_ref_id" TEXT NOT NULL,
  "property_context_ref_type" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "localization_geometry_projections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "localization_geometry_projections_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "Project"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "localization_geometry_projections_project_id_geometry_artifact_id_key"
  ON "localization_geometry_projections"("project_id", "geometry_artifact_id");
CREATE INDEX "localization_geometry_projections_project_id_created_at_idx"
  ON "localization_geometry_projections"("project_id", "created_at");
