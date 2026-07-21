/*
  Warnings:

  - You are about to drop the `env_sgu_grundvatten_sarbarhet` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `env_sgu_jordarter` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `env_lm_marktacke` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `env_registerenhetsomradesytor` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `env_svar_avrinningsomraden` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `env_viss_vattenforekomster` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "env"."env_sgu_grundvatten_sarbarhet";

-- DropTable
DROP TABLE "env"."env_sgu_jordarter";

-- DropTable
DROP TABLE "env_lm_marktacke";

-- DropTable
DROP TABLE "env_registerenhetsomradesytor";

-- DropTable
DROP TABLE "env_svar_avrinningsomraden";

-- DropTable
DROP TABLE "env_viss_vattenforekomster";

-- CreateTable
CREATE TABLE "geo_sources" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "licenceType" TEXT NOT NULL DEFAULT 'OpenData',
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geo_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geo_analysis_layers" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "geo_source_id" TEXT NOT NULL,
    "analysis_type" TEXT NOT NULL,
    "analysis_result" JSONB NOT NULL,
    "image_disk_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geo_analysis_layers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "geo_sources_provider_product_key" ON "geo_sources"("provider", "product");

-- CreateIndex
CREATE INDEX "geo_analysis_layers_project_id_analysis_type_idx" ON "geo_analysis_layers"("project_id", "analysis_type");

-- AddForeignKey
ALTER TABLE "geo_analysis_layers" ADD CONSTRAINT "geo_analysis_layers_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geo_analysis_layers" ADD CONSTRAINT "geo_analysis_layers_geo_source_id_fkey" FOREIGN KEY ("geo_source_id") REFERENCES "geo_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
