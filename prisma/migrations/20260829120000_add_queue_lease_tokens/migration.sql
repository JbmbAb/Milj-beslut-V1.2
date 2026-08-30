ALTER TABLE "project_context_bootstrap_requests"
  ADD COLUMN "lease_token" TEXT;

ALTER TABLE "localization_identity_provisioning_requests"
  ADD COLUMN "lease_token" TEXT;

ALTER TABLE "viewer_capability_provisioning_requests"
  ADD COLUMN "lease_token" TEXT;

ALTER TABLE "localization_geometry_supersession_requests"
  ADD COLUMN "lease_token" TEXT;
