-- LU-PROJECTION-RECONCILIATION-AND-TOTAL-ORDER-V1 Phase B
-- Additive only. Two objects:
--   1. localization_geometry_supersession_requests: durable work-queue state (Prisma model),
--      lease_expires_at from day one (H3 fix never reproduced here).
--   2. localization_geometry_supersessions: append-only, non-authoritative discovery projection
--      for supersession-artifact refs (same shape as project_assessment_projections /
--      localization_geometry_projections -- raw SQL access, not a Prisma model). Authority is the
--      signed LocalizationGeometrySupersessionArtifact in CAS; every row here must be resolved +
--      re-verified before being trusted as a graph edge.

CREATE TYPE "LocalizationGeometrySupersessionStatus" AS ENUM ('PENDING', 'LEASED', 'COMPLETED', 'FAILED', 'SUPERSEDED');

CREATE TABLE "localization_geometry_supersession_requests" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "predecessor_geometry_artifact_id" TEXT NOT NULL,
  "successor_geometry_artifact_id" TEXT NOT NULL,
  "requested_by_user_id" TEXT NOT NULL,
  "status" "LocalizationGeometrySupersessionStatus" NOT NULL DEFAULT 'PENDING',
  "supersession_artifact_id" TEXT,
  "failure_code" TEXT,
  "failure_detail" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leased_at" TIMESTAMP(3),
  "lease_expires_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "failed_at" TIMESTAMP(3),

  CONSTRAINT "localization_geometry_supersession_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "localization_geometry_supersession_requests_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "Project"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "localization_geometry_supersession_requests_requested_by_fkey"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "localization_geometry_supersession_requests_status_created_idx"
  ON "localization_geometry_supersession_requests"("status", "created_at");
CREATE INDEX "localization_geometry_supersession_requests_subject_idx"
  ON "localization_geometry_supersession_requests"("project_id", "predecessor_geometry_artifact_id", "successor_geometry_artifact_id");

CREATE TABLE "localization_geometry_supersessions" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "supersession_artifact_id" TEXT NOT NULL,
  "predecessor_geometry_artifact_id" TEXT NOT NULL,
  "successor_geometry_artifact_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "localization_geometry_supersessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "localization_geometry_supersessions_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "Project"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "localization_geometry_supersessions_project_supersession_key"
  ON "localization_geometry_supersessions"("project_id", "supersession_artifact_id");
CREATE INDEX "localization_geometry_supersessions_project_idx"
  ON "localization_geometry_supersessions"("project_id");
