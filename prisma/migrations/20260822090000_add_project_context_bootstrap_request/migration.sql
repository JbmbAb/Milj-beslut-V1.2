-- PRODUCT-LU-PROJECT-CONTEXT-BOOTSTRAP-01 Phase B
-- Durable, append-only WORK QUEUE state only -- this row is never itself authority for
-- context/binding. Authority remains exactly what it already was: signed PropertyContext /
-- ProjectContext / ProjectContextBinding artifacts, in CAS, verified by public key only.
CREATE TYPE "ProjectContextBootstrapStatus" AS ENUM ('PENDING', 'LEASED', 'COMPLETED', 'FAILED');

CREATE TABLE "project_context_bootstrap_requests" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "requested_by_user_id" TEXT NOT NULL,
  "property_designation" TEXT NOT NULL,
  "status" "ProjectContextBootstrapStatus" NOT NULL DEFAULT 'PENDING',
  "context_binding_artifact_id" TEXT,
  "failure_code" TEXT,
  "failure_detail" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leased_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "failed_at" TIMESTAMP(3),

  CONSTRAINT "project_context_bootstrap_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_context_bootstrap_requests_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "Project"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_context_bootstrap_requests_requested_by_user_id_fkey"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "project_context_bootstrap_requests_status_created_idx"
  ON "project_context_bootstrap_requests"("status", "created_at");
CREATE INDEX "project_context_bootstrap_requests_project_idx"
  ON "project_context_bootstrap_requests"("project_id");
