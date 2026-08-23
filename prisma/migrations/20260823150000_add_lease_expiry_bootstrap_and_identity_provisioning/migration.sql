-- LU-PROVISIONING-LEASE-RECOVERY-01 Phase B
-- Additive only: adds lease_expires_at to the two provisioning-request queues that predate the
-- ViewerCapabilityProvisioningRequest queue (which already has this column from day one). This is
-- the H3 fix: a LEASED row whose lease has expired becomes reclaimable by another worker instead
-- of staying stuck forever after a crashed worker.

ALTER TABLE "project_context_bootstrap_requests" ADD COLUMN "lease_expires_at" TIMESTAMP(3);
ALTER TABLE "localization_identity_provisioning_requests" ADD COLUMN "lease_expires_at" TIMESTAMP(3);
