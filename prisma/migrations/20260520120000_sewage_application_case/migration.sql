-- CreateTable
CREATE TABLE "public"."sewage_application_cases" (
    "id" TEXT NOT NULL,
    "reference_number" TEXT NOT NULL,
    "organisation_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "project_id" TEXT,
    "municipality_code" TEXT,
    "pe" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "property_designation" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "applicant_name" TEXT NOT NULL,
    "applicant_email" TEXT NOT NULL,
    "system_type" TEXT NOT NULL,
    "purpose" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "decision_note" TEXT,
    "municipality_reference" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sewage_application_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sewage_application_cases_reference_number_key" ON "public"."sewage_application_cases"("reference_number");

-- CreateIndex
CREATE INDEX "sewage_application_cases_organisation_id_idx" ON "public"."sewage_application_cases"("organisation_id");

-- CreateIndex
CREATE INDEX "sewage_application_cases_reference_number_idx" ON "public"."sewage_application_cases"("reference_number");
