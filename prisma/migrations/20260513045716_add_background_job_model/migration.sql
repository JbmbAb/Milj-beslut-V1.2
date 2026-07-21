/*
  Warnings:

  - You are about to drop the column `executed_at` on the `spatial_migrations` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `spatial_migrations` table. All the data in the column will be lost.
  - You are about to drop the `graph_edges` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `graph_nodes` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `fileName` to the `spatial_migrations` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "public"."extracted_requirements" DROP CONSTRAINT "extracted_requirements_attachment_hash_fkey";

-- DropForeignKey
ALTER TABLE "public"."graph_edges" DROP CONSTRAINT "graph_edges_source_node_fkey";

-- DropForeignKey
ALTER TABLE "public"."graph_edges" DROP CONSTRAINT "graph_edges_target_node_fkey";

-- AlterTable
ALTER TABLE "public"."spatial_migrations" DROP COLUMN "executed_at",
DROP COLUMN "name",
ADD COLUMN     "appliedAt" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "fileName" VARCHAR(255) NOT NULL;

-- DropTable
DROP TABLE "public"."graph_edges";

-- DropTable
DROP TABLE "public"."graph_nodes";

-- CreateTable
CREATE TABLE "public"."BackgroundJob" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "payload" JSONB,
    "result" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackgroundJob_status_type_idx" ON "public"."BackgroundJob"("status", "type");

-- AddForeignKey
ALTER TABLE "public"."extracted_requirements" ADD CONSTRAINT "extracted_requirements_attachment_hash_fkey" FOREIGN KEY ("attachment_hash") REFERENCES "public"."attachments"("attachment_hash") ON DELETE CASCADE ON UPDATE CASCADE;
