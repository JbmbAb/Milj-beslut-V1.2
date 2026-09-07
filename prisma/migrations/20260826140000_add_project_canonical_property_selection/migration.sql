-- LU-PROPERTY-SELECTION-CANONICAL-BINDING-01
-- New localization projects persist the canonical property identity selected by the user.
-- Historical projects remain nullable and retain their frozen behaviour.

ALTER TABLE "Project"
ADD COLUMN "property_source_key" TEXT,
ADD COLUMN "property_source_dataset" TEXT;
