-- PROJECT-CONTEXT-BINDING-V2-PRODUCER-ADOPTION-01 Phase A.1
-- Additive only. Explicit capability-issuance validity window, pinned once by the web layer at
-- request-creation time -- replaces the prior implicit derivation from binding.created_at, which
-- had no real semantic connection to "how long should this capability remain valid" (currentness
-- of binding/release/viewer identity already independently revokes authority; this window is a
-- separate, coarser rotation/max-age ceiling). Nullable: pre-existing rows predate this field.

ALTER TABLE "viewer_capability_provisioning_requests" ADD COLUMN "capability_valid_from" TIMESTAMP(3);
ALTER TABLE "viewer_capability_provisioning_requests" ADD COLUMN "capability_valid_until" TIMESTAMP(3);
