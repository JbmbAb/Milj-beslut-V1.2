/*
  Warnings:

  - You are about to drop the column `verificationStatus` on the `RequirementCitation` table. All the data in the column will be lost.
  - You are about to drop the column `verificationStatus` on the `RequirementRecord` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "KnowledgeNodeType" AS ENUM ('MUNICIPALITY', 'CASE', 'ACTIVITY', 'WASTE_CODE', 'REQUIREMENT', 'RISK', 'LEGAL_RULE', 'TECHNICAL_MEASURE', 'RESTRICTION');

-- AlterEnum
ALTER TYPE "DocumentProcessingStatus" ADD VALUE 'CHUNKED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RequirementVerificationStatus" ADD VALUE 'NEEDS_REVIEW';
ALTER TYPE "RequirementVerificationStatus" ADD VALUE 'LOCKED';

-- DropIndex
DROP INDEX "DocumentRecord_municipality_decisionType_idx";

-- DropIndex
DROP INDEX "RequirementCitation_verificationStatus_createdAt_idx";

-- DropIndex
DROP INDEX "RequirementRecord_verificationStatus_updatedAt_idx";

-- AlterTable
ALTER TABLE "DocumentRecord" ADD COLUMN     "activityCode" TEXT,
ADD COLUMN     "activityCodeConfidence" DOUBLE PRECISION,
ADD COLUMN     "activityCodeSource" TEXT,
ADD COLUMN     "decisionTypeConfidence" DOUBLE PRECISION,
ADD COLUMN     "decisionTypeSource" TEXT,
ADD COLUMN     "diarieConfidence" DOUBLE PRECISION,
ADD COLUMN     "diarieSource" TEXT,
ADD COLUMN     "fieldExtractorVersion" JSONB,
ADD COLUMN     "metadataReviewStatus" TEXT NOT NULL DEFAULT 'AUTO',
ADD COLUMN     "municipalityConfidence" DOUBLE PRECISION,
ADD COLUMN     "municipalityNormalized" TEXT,
ADD COLUMN     "municipalityRaw" TEXT,
ADD COLUMN     "municipalitySource" TEXT,
ADD COLUMN     "wasteTypeConfidence" DOUBLE PRECISION,
ADD COLUMN     "wasteTypeSource" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "complianceScore" DOUBLE PRECISION,
ADD COLUMN     "environmentalScore" DOUBLE PRECISION,
ADD COLUMN     "fundingRating" TEXT,
ADD COLUMN     "regulatoryRiskScore" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "RequirementCase" ADD COLUMN     "caseReviewStatus" TEXT NOT NULL DEFAULT 'AUTO';

-- AlterTable
ALTER TABLE "RequirementCitation" DROP COLUMN "verificationStatus";

-- AlterTable
ALTER TABLE "RequirementRecord" DROP COLUMN "verificationStatus",
ADD COLUMN     "requirementHash" TEXT;

-- CreateTable
CREATE TABLE "email_messages" (
    "message_id" TEXT NOT NULL,
    "sender" TEXT,
    "subject" TEXT,
    "received_at" TIMESTAMP(3),
    "processed_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "run_id" TEXT,
    "raw_eml_path" TEXT,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("message_id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "attachment_hash" TEXT NOT NULL,
    "canonical_message_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "filesize" BIGINT,
    "checksum_sha256" TEXT NOT NULL,
    "stored_path" TEXT,
    "parsed" BOOLEAN NOT NULL DEFAULT false,
    "document_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("attachment_hash")
);

-- CreateTable
CREATE TABLE "attachment_occurrences" (
    "message_id" TEXT NOT NULL,
    "attachment_hash" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachment_occurrences_pkey" PRIMARY KEY ("message_id","attachment_hash")
);

-- CreateTable
CREATE TABLE "ingest_runs" (
    "run_id" TEXT NOT NULL,
    "run_type" TEXT NOT NULL,
    "stage_name" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "processed_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "config_snapshot" JSONB,
    "notes" TEXT,

    CONSTRAINT "ingest_runs_pkey" PRIMARY KEY ("run_id")
);

-- CreateTable
CREATE TABLE "extracted_requirements" (
    "id" TEXT NOT NULL,
    "attachment_hash" TEXT NOT NULL,
    "municipality" TEXT,
    "case_number" TEXT,
    "requirement_text" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "requirement_level" TEXT NOT NULL DEFAULT 'mandatory',
    "legal_reference" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "page_number" INTEGER,
    "source_segment" TEXT,
    "parsed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "knowledge_node_id" TEXT,

    CONSTRAINT "extracted_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_nodes" (
    "id" TEXT NOT NULL,
    "node_type" "KnowledgeNodeType" NOT NULL,
    "name" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_edges" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentMetadataEvidence" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "fieldValue" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "sourceType" TEXT NOT NULL,
    "extractorVersion" TEXT NOT NULL DEFAULT '1.0',
    "rawEvidence" TEXT,
    "llmPromptHash" TEXT,
    "llmResponse" TEXT,
    "modelName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentMetadataEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetadataReviewQueue" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "queueType" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "proposedValue" TEXT,
    "confidence" DOUBLE PRECISION,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetadataReviewQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseCandidate" (
    "id" TEXT NOT NULL,
    "caseKey" TEXT NOT NULL,
    "documentIds" JSONB NOT NULL DEFAULT '[]',
    "entryIds" JSONB NOT NULL DEFAULT '[]',
    "municipality" TEXT,
    "diarie" TEXT,
    "decisionType" TEXT,
    "activityCode" TEXT,
    "wasteType" TEXT,
    "caseConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reasoning" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'CANDIDATE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attachments_parsed_idx" ON "attachments"("parsed");

-- CreateIndex
CREATE INDEX "attachments_document_id_idx" ON "attachments"("document_id");

-- CreateIndex
CREATE INDEX "extracted_requirements_attachment_hash_idx" ON "extracted_requirements"("attachment_hash");

-- CreateIndex
CREATE INDEX "extracted_requirements_municipality_category_idx" ON "extracted_requirements"("municipality", "category");

-- CreateIndex
CREATE INDEX "extracted_requirements_category_requirement_level_idx" ON "extracted_requirements"("category", "requirement_level");

-- CreateIndex
CREATE INDEX "knowledge_nodes_node_type_idx" ON "knowledge_nodes"("node_type");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_nodes_node_type_name_key" ON "knowledge_nodes"("node_type", "name");

-- CreateIndex
CREATE INDEX "knowledge_edges_source_id_relation_idx" ON "knowledge_edges"("source_id", "relation");

-- CreateIndex
CREATE INDEX "knowledge_edges_target_id_relation_idx" ON "knowledge_edges"("target_id", "relation");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_edges_source_id_target_id_relation_key" ON "knowledge_edges"("source_id", "target_id", "relation");

-- CreateIndex
CREATE INDEX "DocumentMetadataEvidence_documentId_fieldName_createdAt_idx" ON "DocumentMetadataEvidence"("documentId", "fieldName", "createdAt");

-- CreateIndex
CREATE INDEX "MetadataReviewQueue_status_queueType_createdAt_idx" ON "MetadataReviewQueue"("status", "queueType", "createdAt");

-- CreateIndex
CREATE INDEX "MetadataReviewQueue_documentId_idx" ON "MetadataReviewQueue"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "CaseCandidate_caseKey_key" ON "CaseCandidate"("caseKey");

-- CreateIndex
CREATE INDEX "CaseCandidate_status_caseConfidence_idx" ON "CaseCandidate"("status", "caseConfidence");

-- CreateIndex
CREATE INDEX "CaseCandidate_diarie_idx" ON "CaseCandidate"("diarie");

-- CreateIndex
CREATE INDEX "DocumentRecord_municipalityNormalized_decisionType_idx" ON "DocumentRecord"("municipalityNormalized", "decisionType");

-- CreateIndex
CREATE INDEX "DocumentRecord_metadataReviewStatus_updatedAt_idx" ON "DocumentRecord"("metadataReviewStatus", "updatedAt");

-- CreateIndex
CREATE INDEX "DocumentRecord_legalStatus_idx" ON "DocumentRecord"("legalStatus");

-- CreateIndex
CREATE INDEX "RequirementRecord_requirementHash_idx" ON "RequirementRecord"("requirementHash");

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_canonical_message_id_fkey" FOREIGN KEY ("canonical_message_id") REFERENCES "email_messages"("message_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment_occurrences" ADD CONSTRAINT "attachment_occurrences_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "email_messages"("message_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment_occurrences" ADD CONSTRAINT "attachment_occurrences_attachment_hash_fkey" FOREIGN KEY ("attachment_hash") REFERENCES "attachments"("attachment_hash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_requirements" ADD CONSTRAINT "extracted_requirements_attachment_hash_fkey" FOREIGN KEY ("attachment_hash") REFERENCES "attachments"("attachment_hash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "knowledge_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentMetadataEvidence" ADD CONSTRAINT "DocumentMetadataEvidence_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DocumentRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetadataReviewQueue" ADD CONSTRAINT "MetadataReviewQueue_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DocumentRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
