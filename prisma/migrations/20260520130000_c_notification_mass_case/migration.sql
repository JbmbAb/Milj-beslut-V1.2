-- CreateTable
CREATE TABLE "public"."c_notification_mass_cases" (
    "id" TEXT NOT NULL,
    "reference_number" TEXT NOT NULL,
    "organisation_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "property_designation" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "municipality_reference" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "c_notification_mass_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "c_notification_mass_cases_reference_number_key" ON "public"."c_notification_mass_cases"("reference_number");

-- CreateIndex
CREATE INDEX "c_notification_mass_cases_organisation_id_idx" ON "public"."c_notification_mass_cases"("organisation_id");

-- CreateIndex
CREATE INDEX "c_notification_mass_cases_project_id_idx" ON "public"."c_notification_mass_cases"("project_id");
