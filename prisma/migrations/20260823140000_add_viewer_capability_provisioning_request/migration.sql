-- PRODUCT-LU-VIEWER-CAPABILITY-PROVISIONING-01 Phase B
-- Additive only: one new enum, one new table (durable work-queue state, non-authoritative).
-- CAS remains the sole content authority for the ProductViewerCapability artifact itself.
-- Unlike the two earlier queues this pattern was copied from, this one has lease_expires_at from
-- day one, so a LEASED row is reclaimable if the worker that leased it dies before completing.

CREATE TYPE "ViewerCapabilityProvisioningStatus" AS ENUM ('PENDING', 'LEASED', 'COMPLETED', 'FAILED', 'SUPERSEDED');

CREATE TABLE "viewer_capability_provisioning_requests" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "context_binding_artifact_id" TEXT NOT NULL,
  "release_artifact_id" TEXT NOT NULL,
  "viewer_identity_artifact_id" TEXT NOT NULL,
  "requested_by_user_id" TEXT NOT NULL,
  "status" "ViewerCapabilityProvisioningStatus" NOT NULL DEFAULT 'PENDING',
  "capability_artifact_id" TEXT,
  "failure_code" TEXT,
  "failure_detail" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leased_at" TIMESTAMP(3),
  "lease_expires_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "failed_at" TIMESTAMP(3),

  CONSTRAINT "viewer_capability_provisioning_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "viewer_capability_provisioning_requests_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "Project"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "viewer_capability_provisioning_requests_requested_by_user_id_fkey"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "viewer_capability_provisioning_requests_status_created_at_idx"
  ON "viewer_capability_provisioning_requests"("status", "created_at");
CREATE INDEX "viewer_capability_provisioning_requests_project_id_ctx_rel_vid_idx"
  ON "viewer_capability_provisioning_requests"("project_id", "context_binding_artifact_id", "release_artifact_id", "viewer_identity_artifact_id");
