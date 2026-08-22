-- PRODUCT-LU-EXECUTION-IDENTITY-V3-PROVISIONING-01 Phase B
-- Additive only: one new enum, one new table (durable work-queue state, non-authoritative).
-- CAS remains the sole content authority for the ExecutionIdentity artifact itself.

CREATE TYPE "LocalizationIdentityProvisioningStatus" AS ENUM ('PENDING', 'LEASED', 'COMPLETED', 'FAILED');

CREATE TABLE "localization_identity_provisioning_requests" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "geometry_artifact_id" TEXT NOT NULL,
  "requested_by_user_id" TEXT NOT NULL,
  "status" "LocalizationIdentityProvisioningStatus" NOT NULL DEFAULT 'PENDING',
  "execution_identity_artifact_id" TEXT,
  "failure_code" TEXT,
  "failure_detail" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leased_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "failed_at" TIMESTAMP(3),

  CONSTRAINT "localization_identity_provisioning_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "localization_identity_provisioning_requests_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "Project"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "localization_identity_provisioning_requests_requested_by_user_id_fkey"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "localization_identity_provisioning_requests_status_created_at_idx"
  ON "localization_identity_provisioning_requests"("status", "created_at");
CREATE INDEX "localization_identity_provisioning_requests_project_id_geometry_artifact_id_idx"
  ON "localization_identity_provisioning_requests"("project_id", "geometry_artifact_id");
