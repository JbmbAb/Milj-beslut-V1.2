-- CANONICAL-USER-IDENTITY-ENVIRONMENT-MIGRATION-V1
-- Existing users predate BankID environment provenance. Preserve them as
-- LEGACY so BankID TEST/PRODUCTION resolution continues to fail closed.

ALTER TABLE "User"
ADD COLUMN "identity_environment" TEXT NOT NULL DEFAULT 'LEGACY';
