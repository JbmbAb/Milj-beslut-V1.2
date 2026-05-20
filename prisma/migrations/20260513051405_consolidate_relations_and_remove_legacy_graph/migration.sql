/*
  Warnings:

  - You are about to drop the column `knowledge_node_id` on the `extracted_requirements` table. All the data in the column will be lost.
  - You are about to drop the `knowledge_edges` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `knowledge_nodes` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."extracted_requirements" DROP CONSTRAINT "extracted_requirements_knowledge_node_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."knowledge_edges" DROP CONSTRAINT "knowledge_edges_source_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."knowledge_edges" DROP CONSTRAINT "knowledge_edges_target_id_fkey";

-- AlterTable
ALTER TABLE "public"."extracted_requirements" DROP COLUMN "knowledge_node_id";

-- DropTable
DROP TABLE "public"."knowledge_edges";

-- DropTable
DROP TABLE "public"."knowledge_nodes";
