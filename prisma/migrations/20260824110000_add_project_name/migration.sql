-- CANONICAL-PROJECT-NAME-MIGRATION-V1
-- Project.name is a human-readable product label. Historical projects predate
-- the field and remain NULL; ordinary product creation supplies it explicitly.

ALTER TABLE "Project"
ADD COLUMN "name" TEXT;
