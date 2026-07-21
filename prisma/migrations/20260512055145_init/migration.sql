-- Create Extensions
CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "core";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "env";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "topo10";

-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('ADMIN', 'CONSULTANT', 'AUDITOR', 'BANK');

-- CreateEnum
CREATE TYPE "public"."ProjectStatus" AS ENUM ('ACTIVE', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "public"."ProjectAccessRole" AS ENUM ('OWNER', 'CONTRIBUTOR', 'REVIEWER', 'AUDITOR');

-- CreateEnum
CREATE TYPE "public"."PropertyResponseClass" AS ENUM ('geometry', 'boundaries', 'ownership_redacted');

-- CreateEnum
CREATE TYPE "public"."DocumentProcessingStatus" AS ENUM ('METADATA_ONLY', 'TEXT_EXTRACTED', 'EMBEDDED', 'FAILED', 'CHUNKED');

-- CreateEnum
CREATE TYPE "public"."SearchJobType" AS ENUM ('SYNC_MANIFEST', 'EXTRACT_TEXT', 'EMBED_DOC');

-- CreateEnum
CREATE TYPE "public"."SearchJobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."SearchMode" AS ENUM ('semantic', 'lexical', 'hybrid');

-- CreateEnum
CREATE TYPE "public"."RequirementVerificationStatus" AS ENUM ('AUTO', 'REVIEWED', 'VERIFIED', 'REJECTED', 'NEEDS_REVIEW', 'LOCKED');

-- CreateEnum
CREATE TYPE "public"."KnowledgeNodeType" AS ENUM ('MUNICIPALITY', 'CASE', 'ACTIVITY', 'WASTE_CODE', 'REQUIREMENT', 'RISK', 'LEGAL_RULE', 'TECHNICAL_MEASURE', 'RESTRICTION');

-- CreateEnum
CREATE TYPE "public"."LegalStorageTarget" AS ENUM ('PRISMA', 'POSTGIS', 'FILESYSTEM', 'REVIEW_QUEUE');

-- CreateEnum
CREATE TYPE "public"."SubmissionChannel" AS ENUM ('REST', 'EMAIL', 'WEBHOOK', 'PORTAL', 'MANUAL');

-- CreateEnum
CREATE TYPE "public"."SubmissionProviderMode" AS ENUM ('UNCONFIGURED', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "public"."SubmissionStatus" AS ENUM ('PREPARED', 'DISPATCHED', 'DELIVERED', 'RECEIVED', 'PENDING_REVIEW', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."SubmissionFailureMode" AS ENUM ('MISSING_ENDPOINT', 'HTTP_4XX', 'HTTP_5XX', 'TIMEOUT', 'NETWORK', 'VALIDATION');

-- CreateEnum
CREATE TYPE "public"."SubmissionArtifactRole" AS ENUM ('PRIMARY_DOCUMENT', 'ATTACHMENT', 'RECEIPT', 'DECISION', 'INJUNCTION', 'COMPLEMENT_REQUEST', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."AuthorityInboxEventType" AS ENUM ('ACKNOWLEDGEMENT', 'STATUS_UPDATE', 'DECISION', 'INJUNCTION', 'COMPLEMENT_REQUEST', 'GENERAL_MESSAGE');

-- CreateEnum
CREATE TYPE "public"."AuthorityInboxReviewStatus" AS ENUM ('RECEIVED', 'REVIEW_REQUIRED', 'CLASSIFIED', 'LINKED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."ClassificationStatus" AS ENUM ('SUGGESTED', 'REVIEWING', 'APPROVED', 'REJECTED', 'APPLIED');

-- CreateEnum
CREATE TYPE "public"."ConfidenceLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "bankidId" TEXT NOT NULL,
    "role" "public"."UserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TokenRevocation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenRevocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RateLimitEntry" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Organisation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orgNumber" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Project" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyDesignation" TEXT NOT NULL,
    "status" "public"."ProjectStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "retentionUntil" TIMESTAMP(3),
    "complianceScore" DOUBLE PRECISION,
    "environmentalScore" DOUBLE PRECISION,
    "fundingRating" TEXT,
    "regulatoryRiskScore" DOUBLE PRECISION,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."satellite_scenes" (
    "id" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "cloudCoverPercentage" DOUBLE PRECISION NOT NULL,
    "platform" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "bbox" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "satellite_scenes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."satellite_analyses" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "scene_id" TEXT NOT NULL,
    "analysis_type" TEXT NOT NULL,
    "result_metadata" JSONB NOT NULL,
    "image_disk_path" TEXT,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "satellite_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."c_notification_chemicals" (
    "id" TEXT NOT NULL,
    "organisation_id" TEXT NOT NULL,
    "project_id" TEXT,
    "name" TEXT NOT NULL,
    "annual_consumption" TEXT,
    "storage_note" TEXT,
    "hazard_code" TEXT,
    "requires_safety_data_sheet" BOOLEAN NOT NULL DEFAULT false,
    "review_status" TEXT NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "c_notification_chemicals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PermitApplicationDraft" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "application" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3),
    "sourceTracking" JSONB NOT NULL DEFAULT '[]',
    "externalSourcesUsed" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PermitApplicationDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProjectPlanState" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 2,
    "plan" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectPlanState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessRole" "public"."ProjectAccessRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PropertyAccessLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "propertyDesignation" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purpose" TEXT NOT NULL,
    "responseClass" "public"."PropertyResponseClass" NOT NULL,

    CONSTRAINT "PropertyAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditTrail" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payloadHash" TEXT NOT NULL,
    "prevHash" TEXT,
    "chainHash" TEXT NOT NULL,

    CONSTRAINT "AuditTrail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TransportBooking" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "receiverName" TEXT NOT NULL,
    "wasteCode" TEXT NOT NULL,
    "tons" DOUBLE PRECISION NOT NULL,
    "distanceKm" DOUBLE PRECISION NOT NULL,
    "co2EstimateKg" DOUBLE PRECISION NOT NULL,
    "plannedPickupAt" TIMESTAMP(3) NOT NULL,
    "plannedDeliveryAt" TIMESTAMP(3) NOT NULL,
    "externalReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DriverJournal" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "driverName" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "wasteCode" TEXT NOT NULL,
    "tons" DOUBLE PRECISION NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "odometerStartKm" DOUBLE PRECISION NOT NULL,
    "odometerEndKm" DOUBLE PRECISION,
    "gpsTrackHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "signedByDriver" BOOLEAN NOT NULL DEFAULT false,
    "signedByReviewer" BOOLEAN NOT NULL DEFAULT false,
    "driverSignatureId" TEXT,
    "reviewerSignatureId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverJournal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LimsReport" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT,
    "sampleId" TEXT NOT NULL,
    "labName" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "analyzedAt" TIMESTAMP(3) NOT NULL,
    "rawReference" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "verifiedByHuman" BOOLEAN NOT NULL DEFAULT false,
    "reviewer" TEXT,
    "reviewerSignatureId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LimsReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GpsPosition" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "altitude" DOUBLE PRECISION,
    "speedKmh" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hash" TEXT NOT NULL,
    "prevHash" TEXT,

    CONSTRAINT "GpsPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DocumentRecord" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "receivedTime" TIMESTAMP(3),
    "subject" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "diskName" TEXT NOT NULL,
    "absolutePath" TEXT NOT NULL,
    "fileSize" BIGINT,
    "fileSha256" TEXT,
    "mimeType" TEXT,
    "status" "public"."DocumentProcessingStatus" NOT NULL DEFAULT 'METADATA_ONLY',
    "decisionType" TEXT,
    "municipality" TEXT,
    "wasteType" TEXT,
    "hazardousFlag" BOOLEAN,
    "legalStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "manifestMeta" JSONB,
    "activityCode" TEXT,
    "activityCodeConfidence" DOUBLE PRECISION,
    "activityCodeSource" TEXT,
    "decisionTypeConfidence" DOUBLE PRECISION,
    "decisionTypeSource" TEXT,
    "diarieConfidence" DOUBLE PRECISION,
    "diarieSource" TEXT,
    "fieldExtractorVersion" JSONB,
    "metadataReviewStatus" TEXT NOT NULL DEFAULT 'AUTO',
    "municipalityConfidence" DOUBLE PRECISION,
    "municipalityNormalized" TEXT,
    "municipalityRaw" TEXT,
    "municipalitySource" TEXT,
    "wasteTypeConfidence" DOUBLE PRECISION,
    "wasteTypeSource" TEXT,

    CONSTRAINT "DocumentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DocumentContent" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "contentCiphertext" TEXT NOT NULL,
    "contentIv" TEXT NOT NULL,
    "contentTag" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "searchText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DocumentChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "chunkText" TEXT NOT NULL,
    "embeddingJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SearchJob" (
    "id" TEXT NOT NULL,
    "type" "public"."SearchJobType" NOT NULL,
    "status" "public"."SearchJobStatus" NOT NULL DEFAULT 'PENDING',
    "projectId" TEXT,
    "payload" JSONB NOT NULL,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SearchJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SearchQueryLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "mode" "public"."SearchMode" NOT NULL DEFAULT 'hybrid',
    "topK" INTEGER NOT NULL DEFAULT 20,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "elapsedMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchQueryLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RequirementCase" (
    "id" TEXT NOT NULL,
    "caseKey" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "municipality" TEXT,
    "authorityType" TEXT,
    "authorityName" TEXT,
    "diarienummer" TEXT,
    "documentType" TEXT,
    "documentDate" TIMESTAMP(3),
    "sourceFile" TEXT NOT NULL,
    "sourceSubject" TEXT,
    "reviewStatus" "public"."RequirementVerificationStatus" NOT NULL DEFAULT 'AUTO',
    "validatedBy" TEXT,
    "validatedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "caseReviewStatus" TEXT NOT NULL DEFAULT 'AUTO',

    CONSTRAINT "RequirementCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RequirementRecord" (
    "id" TEXT NOT NULL,
    "requirementCode" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT NOT NULL,
    "requirementTextQuote" TEXT NOT NULL,
    "interpretedRequirement" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "legalReference" TEXT,
    "deadlineText" TEXT,
    "controlFrequency" TEXT,
    "sanctionText" TEXT,
    "triggerCondition" TEXT,
    "wasteType" TEXT,
    "ewcCode" TEXT,
    "maxAmountTon" TEXT,
    "maxStorageTime" TEXT,
    "linkConstruction" BOOLEAN NOT NULL DEFAULT false,
    "linkLeachate" BOOLEAN NOT NULL DEFAULT false,
    "linkControlProgram" BOOLEAN NOT NULL DEFAULT false,
    "linkRisk" BOOLEAN NOT NULL DEFAULT false,
    "templateSection" TEXT,
    "templateField" TEXT,
    "supportingAttachment" TEXT,
    "minimumRequirement" BOOLEAN NOT NULL DEFAULT false,
    "municipalitySpecific" BOOLEAN NOT NULL DEFAULT false,
    "statusInNotification" TEXT NOT NULL DEFAULT 'Ej behandlad',
    "comment" TEXT,
    "codingConfidence" TEXT NOT NULL DEFAULT 'LOW',
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "errorType" TEXT,
    "validationComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "requirementHash" TEXT,
    "verificationStatus" "public"."RequirementVerificationStatus" NOT NULL DEFAULT 'AUTO',

    CONSTRAINT "RequirementRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RequirementCitation" (
    "id" TEXT NOT NULL,
    "citationCode" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "quoteText" TEXT NOT NULL,
    "pageNumber" INTEGER,
    "charStart" INTEGER,
    "charEnd" INTEGER,
    "extractor" TEXT,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verificationStatus" "public"."RequirementVerificationStatus" NOT NULL DEFAULT 'AUTO',

    CONSTRAINT "RequirementCitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."email_messages" (
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
CREATE TABLE "public"."attachments" (
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
    "extracted_text" TEXT,
    "parse_failure_reason" TEXT,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("attachment_hash")
);

-- CreateTable
CREATE TABLE "public"."attachment_occurrences" (
    "message_id" TEXT NOT NULL,
    "attachment_hash" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachment_occurrences_pkey" PRIMARY KEY ("message_id","attachment_hash")
);

-- CreateTable
CREATE TABLE "public"."ingest_runs" (
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
CREATE TABLE "public"."extracted_requirements" (
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
CREATE TABLE "public"."knowledge_nodes" (
    "id" TEXT NOT NULL,
    "node_type" "public"."KnowledgeNodeType" NOT NULL,
    "name" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."knowledge_edges" (
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
CREATE TABLE "public"."DocumentMetadataEvidence" (
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
CREATE TABLE "public"."MetadataReviewQueue" (
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
CREATE TABLE "public"."CaseCandidate" (
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

-- CreateTable
CREATE TABLE "public"."case_notes" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."graph_edges" (
    "edge_id" TEXT NOT NULL,
    "source_node" TEXT NOT NULL,
    "target_node" TEXT NOT NULL,
    "relation_type" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "graph_edges_pkey" PRIMARY KEY ("edge_id")
);

-- CreateTable
CREATE TABLE "public"."graph_nodes" (
    "node_id" TEXT NOT NULL,
    "node_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "graph_nodes_pkey" PRIMARY KEY ("node_id")
);

-- CreateTable
CREATE TABLE "public"."graph_runs" (
    "run_id" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "notes" TEXT,

    CONSTRAINT "graph_runs_pkey" PRIMARY KEY ("run_id")
);

-- CreateTable
CREATE TABLE "public"."BankIdSession" (
    "id" TEXT NOT NULL,
    "orderRef" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "bankidId" TEXT,
    "signatureHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankIdSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RequirementMatrixRow" (
    "id" TEXT NOT NULL,
    "requirement_id" TEXT,
    "citation_id" TEXT,
    "case_id" TEXT,
    "document_id" TEXT,
    "category" TEXT NOT NULL,
    "ruleText" TEXT NOT NULL,
    "sourceText" TEXT,
    "reviewStatus" "public"."RequirementVerificationStatus" NOT NULL DEFAULT 'AUTO',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "comments" TEXT,
    "isAutoSuggested" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "legal_source_id" TEXT,

    CONSTRAINT "RequirementMatrixRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."judgment_records" (
    "id" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "description" TEXT,
    "pubDate" TIMESTAMP(3) NOT NULL,
    "sourceFeed" TEXT NOT NULL DEFAULT 'DOMSTOL_RSS',
    "legalArea" TEXT DEFAULT 'miljo',
    "authorityName" TEXT,
    "authorityType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "judgment_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."legal_source_records" (
    "id" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "normalizedUrl" TEXT,
    "providerId" TEXT,
    "providerLabel" TEXT,
    "authorityName" TEXT,
    "authorityType" TEXT,
    "municipality" TEXT,
    "diarienummer" TEXT,
    "legalArea" TEXT,
    "mimeType" TEXT,
    "formatHint" TEXT,
    "decisionDate" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "storageTarget" "public"."LegalStorageTarget" NOT NULL,
    "postgisSchema" TEXT,
    "postgisTable" TEXT,
    "matrixCategory" TEXT,
    "matrixSuggested" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "judgment_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_source_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."legal_corpus_records" (
    "id" TEXT NOT NULL,
    "record_key" TEXT NOT NULL,
    "canonical_key" TEXT NOT NULL,
    "source_family" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_system" TEXT NOT NULL,
    "external_id" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "authority_name" TEXT,
    "authority_type" TEXT,
    "court" TEXT,
    "court_level" TEXT,
    "municipality" TEXT,
    "legal_area" TEXT,
    "language" TEXT NOT NULL DEFAULT 'sv',
    "mime_type" TEXT,
    "format_hint" TEXT,
    "source_url" TEXT,
    "normalized_url" TEXT,
    "source_path" TEXT NOT NULL,
    "published_at" TIMESTAMP(3),
    "decision_date" TIMESTAMP(3),
    "year" INTEGER,
    "case_number" TEXT,
    "document_text" TEXT,
    "search_text" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "content_hash" TEXT,
    "byte_size" INTEGER,
    "judgment_id" TEXT,
    "legal_source_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "search_vector" tsvector,

    CONSTRAINT "legal_corpus_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Submission" (
    "id" TEXT NOT NULL,
    "submissionKey" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "requirementCaseId" TEXT,
    "domain" TEXT NOT NULL,
    "authorityName" TEXT NOT NULL,
    "authorityType" TEXT,
    "recipientCode" TEXT,
    "recipientChannel" "public"."SubmissionChannel" NOT NULL,
    "providerMode" "public"."SubmissionProviderMode" NOT NULL DEFAULT 'UNCONFIGURED',
    "status" "public"."SubmissionStatus" NOT NULL DEFAULT 'PREPARED',
    "externalReference" TEXT,
    "caseNumber" TEXT,
    "submittedBy" TEXT,
    "submittedAt" TIMESTAMP(3),
    "lastStatusAt" TIMESTAMP(3),
    "responseCode" INTEGER,
    "failureMode" "public"."SubmissionFailureMode",
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SubmissionArtifact" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "documentId" TEXT,
    "role" "public"."SubmissionArtifactRole" NOT NULL,
    "label" TEXT,
    "diskPath" TEXT,
    "mimeType" TEXT,
    "fileSha256" TEXT,
    "sizeBytes" BIGINT,
    "sourceType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SubmissionStatusEvent" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "status" "public"."SubmissionStatus" NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "summary" TEXT,
    "externalReference" TEXT,
    "responseCode" INTEGER,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuthorityInboxEvent" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "requirementCaseId" TEXT,
    "submissionId" TEXT,
    "documentId" TEXT,
    "sourceSystem" TEXT NOT NULL,
    "sourceChannel" "public"."SubmissionChannel" NOT NULL,
    "authorityName" TEXT,
    "authorityType" TEXT,
    "municipality" TEXT,
    "externalReference" TEXT,
    "caseNumber" TEXT,
    "eventType" "public"."AuthorityInboxEventType" NOT NULL,
    "reviewStatus" "public"."AuthorityInboxReviewStatus" NOT NULL DEFAULT 'RECEIVED',
    "bindingEffectSuggested" BOOLEAN NOT NULL DEFAULT false,
    "requiresHumanReview" BOOLEAN NOT NULL DEFAULT true,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "classifiedAt" TIMESTAMP(3),
    "classifiedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthorityInboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ClassificationRecommendation" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sourceDocumentHash" TEXT NOT NULL,
    "status" "public"."ClassificationStatus" NOT NULL DEFAULT 'SUGGESTED',
    "aiClassification" TEXT NOT NULL,
    "aiConfidence" "public"."ConfidenceLevel" NOT NULL DEFAULT 'LOW',
    "aiReasoning" TEXT,
    "sourceTextSegment" TEXT NOT NULL,
    "charStart" INTEGER,
    "charEnd" INTEGER,
    "suggestedConditions" JSONB,
    "suggestedRequirements" JSONB,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "reviewDecision" TEXT,
    "appliedAt" TIMESTAMP(3),
    "appliedBy" TEXT,
    "appliedWithChanges" BOOLEAN NOT NULL DEFAULT false,
    "appliedChangesNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassificationRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ApprovalLog" (
    "id" TEXT NOT NULL,
    "classificationRecommendationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "actorRole" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "metadata" JSONB,

    CONSTRAINT "ApprovalLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."HumanApprovalGate" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "pendingRecommendationsCount" INTEGER NOT NULL DEFAULT 0,
    "reviewedCount" INTEGER NOT NULL DEFAULT 0,
    "approvedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HumanApprovalGate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CaseSnapshot" (
    "id" TEXT NOT NULL,
    "requirementCaseId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "submissionId" TEXT,
    "snapshotType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "snapshotVersion" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auditAnchorHash" TEXT NOT NULL,
    "auditAnchorId" TEXT,
    "auditAnchorAt" TIMESTAMP(3),
    "auditTrailRowCountAtSnapshot" INTEGER,
    "contentHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "CaseSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EvidenceExport" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "requirementCaseId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "manifest" JSONB NOT NULL,

    CONSTRAINT "EvidenceExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."decision_cases" (
    "id" TEXT NOT NULL,
    "external_case_key" TEXT,
    "municipality" TEXT NOT NULL,
    "county" TEXT,
    "activity_type" TEXT,
    "ewc_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "volume_ton" DOUBLE PRECISION,
    "received_date" TIMESTAMP(3),
    "decision_date" TIMESTAMP(3),
    "processing_days" INTEGER,
    "outcome" TEXT,
    "has_completion_request" BOOLEAN NOT NULL DEFAULT false,
    "has_injunction" BOOLEAN NOT NULL DEFAULT false,
    "has_approval" BOOLEAN NOT NULL DEFAULT false,
    "data_source" TEXT NOT NULL DEFAULT 'IMPORT',
    "source_document_id" TEXT,
    "app_requirement_case_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "decision_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."decision_requirements" (
    "id" TEXT NOT NULL,
    "decision_case_id" TEXT NOT NULL,
    "requirement_type" TEXT NOT NULL,
    "requirement_text" TEXT NOT NULL,
    "source_document_id" TEXT,
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."decision_risk_features" (
    "id" TEXT NOT NULL,
    "decision_case_id" TEXT NOT NULL,
    "has_sampling_plan" BOOLEAN,
    "has_recipient_description" BOOLEAN,
    "has_site_plan" BOOLEAN,
    "near_water_protection" BOOLEAN,
    "near_natura2000" BOOLEAN,
    "volume_bucket" TEXT,
    "ewc_category" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_risk_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."municipality_decision_profile" (
    "municipality" TEXT NOT NULL,
    "total_cases" INTEGER NOT NULL DEFAULT 0,
    "completion_rate" DOUBLE PRECISION,
    "avg_processing_days" DOUBLE PRECISION,
    "common_requirement_types" JSONB,
    "strictness_score" DOUBLE PRECISION,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "municipality_decision_profile_pkey" PRIMARY KEY ("municipality")
);

-- CreateTable
CREATE TABLE "public"."spatial_migrations" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "executed_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spatial_migrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."component_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT NOT NULL,
    "manufacturer" TEXT,
    "modelNumber" TEXT,
    "dimensions" JSONB,
    "requirements" JSONB,
    "geometryTemplate" JSONB,

    CONSTRAINT "component_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."project_components" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "template_id" TEXT,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "geometry" JSONB NOT NULL,
    "attributes" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."env_registerenhetsomradesytor" (
    "id" SERIAL NOT NULL,
    "objekt_id" TEXT NOT NULL,
    "externid" TEXT,
    "fastighet_id" TEXT,
    "objekt_version" INTEGER,
    "detaljtyp" TEXT,
    "fastighet" TEXT,
    "geom" geometry(MultiPolygon, 3006) NOT NULL,
    "area" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "env_registerenhetsomradesytor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "env"."env_sgu_jordarter" (
    "id" SERIAL NOT NULL,
    "jordart_kod" TEXT,
    "jordart_namn" TEXT,
    "beskrivning" TEXT,
    "geom" geometry(MultiPolygon, 3006) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "env_sgu_jordarter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "env"."env_sgu_grundvatten_sarbarhet" (
    "id" SERIAL NOT NULL,
    "klass" TEXT,
    "beskrivning" TEXT,
    "geom" geometry(MultiPolygon, 3006) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "env_sgu_grundvatten_sarbarhet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."env_viss_vattenforekomster" (
    "id" SERIAL NOT NULL,
    "viss_id" TEXT NOT NULL,
    "namn" TEXT,
    "kategori" TEXT,
    "ekologisk_status" TEXT,
    "kemisk_status" TEXT,
    "mkn_tidsfrist" TIMESTAMP(3),
    "is_protected" BOOLEAN NOT NULL DEFAULT false,
    "geom" geometry(Geometry, 3006) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "env_viss_vattenforekomster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."env_svar_avrinningsomraden" (
    "id" SERIAL NOT NULL,
    "aro_id" TEXT NOT NULL,
    "namn" TEXT,
    "huvud_aro" INTEGER,
    "geom" geometry(MultiPolygon, 3006) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "env_svar_avrinningsomraden_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."env_lm_marktacke" (
    "id" SERIAL NOT NULL,
    "detaljtyp" TEXT,
    "klass_kod" INTEGER,
    "geom" geometry(MultiPolygon, 3006) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "env_lm_marktacke_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_bankidId_key" ON "public"."User"("bankidId");

-- CreateIndex
CREATE UNIQUE INDEX "TokenRevocation_jti_key" ON "public"."TokenRevocation"("jti");

-- CreateIndex
CREATE INDEX "TokenRevocation_userId_revokedAt_idx" ON "public"."TokenRevocation"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "TokenRevocation_expiresAt_idx" ON "public"."TokenRevocation"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimitEntry_key_key" ON "public"."RateLimitEntry"("key");

-- CreateIndex
CREATE INDEX "RateLimitEntry_resetAt_idx" ON "public"."RateLimitEntry"("resetAt");

-- CreateIndex
CREATE UNIQUE INDEX "Organisation_orgNumber_key" ON "public"."Organisation"("orgNumber");

-- CreateIndex
CREATE INDEX "Project_organisationId_status_idx" ON "public"."Project"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "satellite_scenes_sceneId_key" ON "public"."satellite_scenes"("sceneId");

-- CreateIndex
CREATE INDEX "satellite_analyses_project_id_analysis_type_idx" ON "public"."satellite_analyses"("project_id", "analysis_type");

-- CreateIndex
CREATE INDEX "satellite_analyses_scene_id_idx" ON "public"."satellite_analyses"("scene_id");

-- CreateIndex
CREATE INDEX "c_notification_chemicals_organisation_id_updated_at_idx" ON "public"."c_notification_chemicals"("organisation_id", "updated_at");

-- CreateIndex
CREATE INDEX "c_notification_chemicals_project_id_idx" ON "public"."c_notification_chemicals"("project_id");

-- CreateIndex
CREATE INDEX "PermitApplicationDraft_projectId_updatedAt_idx" ON "public"."PermitApplicationDraft"("projectId", "updatedAt");

-- CreateIndex
CREATE INDEX "PermitApplicationDraft_organisationId_idx" ON "public"."PermitApplicationDraft"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPlanState_projectId_key" ON "public"."ProjectPlanState"("projectId");

-- CreateIndex
CREATE INDEX "ProjectPlanState_updatedAt_idx" ON "public"."ProjectPlanState"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "public"."ProjectMember"("projectId", "userId");

-- CreateIndex
CREATE INDEX "PropertyAccessLog_projectId_timestamp_idx" ON "public"."PropertyAccessLog"("projectId", "timestamp");

-- CreateIndex
CREATE INDEX "PropertyAccessLog_userId_timestamp_idx" ON "public"."PropertyAccessLog"("userId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "AuditTrail_chainHash_key" ON "public"."AuditTrail"("chainHash");

-- CreateIndex
CREATE INDEX "AuditTrail_entityType_timestamp_idx" ON "public"."AuditTrail"("entityType", "timestamp");

-- CreateIndex
CREATE INDEX "TransportBooking_status_idx" ON "public"."TransportBooking"("status");

-- CreateIndex
CREATE INDEX "TransportBooking_receiverId_idx" ON "public"."TransportBooking"("receiverId");

-- CreateIndex
CREATE INDEX "DriverJournal_driverName_idx" ON "public"."DriverJournal"("driverName");

-- CreateIndex
CREATE INDEX "DriverJournal_status_idx" ON "public"."DriverJournal"("status");

-- CreateIndex
CREATE INDEX "LimsReport_sampleId_idx" ON "public"."LimsReport"("sampleId");

-- CreateIndex
CREATE INDEX "GpsPosition_bookingId_timestamp_idx" ON "public"."GpsPosition"("bookingId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentRecord_diskName_key" ON "public"."DocumentRecord"("diskName");

-- CreateIndex
CREATE INDEX "DocumentRecord_projectId_receivedTime_idx" ON "public"."DocumentRecord"("projectId", "receivedTime");

-- CreateIndex
CREATE INDEX "DocumentRecord_organisationId_receivedTime_idx" ON "public"."DocumentRecord"("organisationId", "receivedTime");

-- CreateIndex
CREATE INDEX "DocumentRecord_status_updatedAt_idx" ON "public"."DocumentRecord"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "DocumentRecord_municipalityNormalized_decisionType_idx" ON "public"."DocumentRecord"("municipalityNormalized", "decisionType");

-- CreateIndex
CREATE INDEX "DocumentRecord_metadataReviewStatus_updatedAt_idx" ON "public"."DocumentRecord"("metadataReviewStatus", "updatedAt");

-- CreateIndex
CREATE INDEX "DocumentRecord_legalStatus_idx" ON "public"."DocumentRecord"("legalStatus");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentContent_documentId_key" ON "public"."DocumentContent"("documentId");

-- CreateIndex
CREATE INDEX "DocumentChunk_documentId_idx" ON "public"."DocumentChunk"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentChunk_documentId_chunkIndex_key" ON "public"."DocumentChunk"("documentId", "chunkIndex");

-- CreateIndex
CREATE INDEX "SearchJob_status_createdAt_idx" ON "public"."SearchJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SearchJob_type_status_idx" ON "public"."SearchJob"("type", "status");

-- CreateIndex
CREATE INDEX "SearchQueryLog_projectId_createdAt_idx" ON "public"."SearchQueryLog"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "SearchQueryLog_userId_createdAt_idx" ON "public"."SearchQueryLog"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementCase_caseKey_key" ON "public"."RequirementCase"("caseKey");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementCase_documentId_key" ON "public"."RequirementCase"("documentId");

-- CreateIndex
CREATE INDEX "RequirementCase_projectId_documentDate_idx" ON "public"."RequirementCase"("projectId", "documentDate");

-- CreateIndex
CREATE INDEX "RequirementCase_municipality_authorityType_idx" ON "public"."RequirementCase"("municipality", "authorityType");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementRecord_requirementCode_key" ON "public"."RequirementRecord"("requirementCode");

-- CreateIndex
CREATE INDEX "RequirementRecord_documentId_idx" ON "public"."RequirementRecord"("documentId");

-- CreateIndex
CREATE INDEX "RequirementRecord_requirementHash_idx" ON "public"."RequirementRecord"("requirementHash");

-- CreateIndex
CREATE INDEX "RequirementRecord_projectId_category_idx" ON "public"."RequirementRecord"("projectId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementCitation_citationCode_key" ON "public"."RequirementCitation"("citationCode");

-- CreateIndex
CREATE INDEX "RequirementCitation_documentId_pageNumber_idx" ON "public"."RequirementCitation"("documentId", "pageNumber");

-- CreateIndex
CREATE INDEX "RequirementCitation_requirementId_idx" ON "public"."RequirementCitation"("requirementId");

-- CreateIndex
CREATE INDEX "attachments_parsed_idx" ON "public"."attachments"("parsed");

-- CreateIndex
CREATE INDEX "attachments_document_id_idx" ON "public"."attachments"("document_id");

-- CreateIndex
CREATE INDEX "idx_attachments_document" ON "public"."attachments"("document_id");

-- CreateIndex
CREATE INDEX "idx_attachments_parsed" ON "public"."attachments"("parsed");

-- CreateIndex
CREATE INDEX "extracted_requirements_attachment_hash_idx" ON "public"."extracted_requirements"("attachment_hash");

-- CreateIndex
CREATE INDEX "extracted_requirements_municipality_category_idx" ON "public"."extracted_requirements"("municipality", "category");

-- CreateIndex
CREATE INDEX "extracted_requirements_category_requirement_level_idx" ON "public"."extracted_requirements"("category", "requirement_level");

-- CreateIndex
CREATE INDEX "knowledge_nodes_node_type_idx" ON "public"."knowledge_nodes"("node_type");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_nodes_node_type_name_key" ON "public"."knowledge_nodes"("node_type", "name");

-- CreateIndex
CREATE INDEX "knowledge_edges_source_id_relation_idx" ON "public"."knowledge_edges"("source_id", "relation");

-- CreateIndex
CREATE INDEX "knowledge_edges_target_id_relation_idx" ON "public"."knowledge_edges"("target_id", "relation");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_edges_source_id_target_id_relation_key" ON "public"."knowledge_edges"("source_id", "target_id", "relation");

-- CreateIndex
CREATE INDEX "DocumentMetadataEvidence_documentId_fieldName_createdAt_idx" ON "public"."DocumentMetadataEvidence"("documentId", "fieldName", "createdAt");

-- CreateIndex
CREATE INDEX "MetadataReviewQueue_status_queueType_createdAt_idx" ON "public"."MetadataReviewQueue"("status", "queueType", "createdAt");

-- CreateIndex
CREATE INDEX "MetadataReviewQueue_documentId_idx" ON "public"."MetadataReviewQueue"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "CaseCandidate_caseKey_key" ON "public"."CaseCandidate"("caseKey");

-- CreateIndex
CREATE INDEX "CaseCandidate_status_caseConfidence_idx" ON "public"."CaseCandidate"("status", "caseConfidence");

-- CreateIndex
CREATE INDEX "CaseCandidate_diarie_idx" ON "public"."CaseCandidate"("diarie");

-- CreateIndex
CREATE INDEX "case_notes_case_id_created_at_idx" ON "public"."case_notes"("case_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_graph_edges_rel" ON "public"."graph_edges"("relation_type");

-- CreateIndex
CREATE UNIQUE INDEX "graph_edges_source_node_target_node_relation_type_key" ON "public"."graph_edges"("source_node", "target_node", "relation_type");

-- CreateIndex
CREATE INDEX "idx_graph_nodes_type" ON "public"."graph_nodes"("node_type");

-- CreateIndex
CREATE UNIQUE INDEX "graph_nodes_node_type_name_key" ON "public"."graph_nodes"("node_type", "name");

-- CreateIndex
CREATE UNIQUE INDEX "BankIdSession_orderRef_key" ON "public"."BankIdSession"("orderRef");

-- CreateIndex
CREATE UNIQUE INDEX "BankIdSession_signatureHash_key" ON "public"."BankIdSession"("signatureHash");

-- CreateIndex
CREATE INDEX "BankIdSession_orderRef_idx" ON "public"."BankIdSession"("orderRef");

-- CreateIndex
CREATE INDEX "BankIdSession_expiresAt_idx" ON "public"."BankIdSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementMatrixRow_legal_source_id_key" ON "public"."RequirementMatrixRow"("legal_source_id");

-- CreateIndex
CREATE INDEX "RequirementMatrixRow_case_id_category_idx" ON "public"."RequirementMatrixRow"("case_id", "category");

-- CreateIndex
CREATE INDEX "RequirementMatrixRow_legal_source_id_idx" ON "public"."RequirementMatrixRow"("legal_source_id");

-- CreateIndex
CREATE INDEX "RequirementMatrixRow_reviewStatus_idx" ON "public"."RequirementMatrixRow"("reviewStatus");

-- CreateIndex
CREATE UNIQUE INDEX "judgment_records_guid_key" ON "public"."judgment_records"("guid");

-- CreateIndex
CREATE INDEX "judgment_records_pubDate_idx" ON "public"."judgment_records"("pubDate");

-- CreateIndex
CREATE INDEX "judgment_records_sourceFeed_pubDate_idx" ON "public"."judgment_records"("sourceFeed", "pubDate");

-- CreateIndex
CREATE UNIQUE INDEX "legal_source_records_judgment_id_key" ON "public"."legal_source_records"("judgment_id");

-- CreateIndex
CREATE INDEX "legal_source_records_storageTarget_matrixSuggested_idx" ON "public"."legal_source_records"("storageTarget", "matrixSuggested");

-- CreateIndex
CREATE INDEX "legal_source_records_municipality_authorityType_idx" ON "public"."legal_source_records"("municipality", "authorityType");

-- CreateIndex
CREATE INDEX "legal_source_records_providerId_storageTarget_idx" ON "public"."legal_source_records"("providerId", "storageTarget");

-- CreateIndex
CREATE UNIQUE INDEX "legal_source_records_sourceSystem_externalId_key" ON "public"."legal_source_records"("sourceSystem", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "legal_corpus_records_record_key_key" ON "public"."legal_corpus_records"("record_key");

-- CreateIndex
CREATE INDEX "legal_corpus_records_canonical_key_idx" ON "public"."legal_corpus_records"("canonical_key");

-- CreateIndex
CREATE INDEX "legal_corpus_records_source_family_source_type_published_at_idx" ON "public"."legal_corpus_records"("source_family", "source_type", "published_at");

-- CreateIndex
CREATE INDEX "legal_corpus_records_source_system_external_id_idx" ON "public"."legal_corpus_records"("source_system", "external_id");

-- CreateIndex
CREATE INDEX "legal_corpus_records_authority_type_legal_area_published_at_idx" ON "public"."legal_corpus_records"("authority_type", "legal_area", "published_at");

-- CreateIndex
CREATE INDEX "legal_corpus_records_court_level_decision_date_idx" ON "public"."legal_corpus_records"("court_level", "decision_date");

-- CreateIndex
CREATE INDEX "legal_corpus_records_judgment_id_idx" ON "public"."legal_corpus_records"("judgment_id");

-- CreateIndex
CREATE INDEX "legal_corpus_records_legal_source_id_idx" ON "public"."legal_corpus_records"("legal_source_id");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_submissionKey_key" ON "public"."Submission"("submissionKey");

-- CreateIndex
CREATE INDEX "Submission_projectId_createdAt_idx" ON "public"."Submission"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Submission_organisationId_createdAt_idx" ON "public"."Submission"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "Submission_requirementCaseId_createdAt_idx" ON "public"."Submission"("requirementCaseId", "createdAt");

-- CreateIndex
CREATE INDEX "Submission_status_recipientChannel_createdAt_idx" ON "public"."Submission"("status", "recipientChannel", "createdAt");

-- CreateIndex
CREATE INDEX "SubmissionArtifact_submissionId_role_idx" ON "public"."SubmissionArtifact"("submissionId", "role");

-- CreateIndex
CREATE INDEX "SubmissionArtifact_documentId_idx" ON "public"."SubmissionArtifact"("documentId");

-- CreateIndex
CREATE INDEX "SubmissionStatusEvent_submissionId_occurredAt_idx" ON "public"."SubmissionStatusEvent"("submissionId", "occurredAt");

-- CreateIndex
CREATE INDEX "SubmissionStatusEvent_status_occurredAt_idx" ON "public"."SubmissionStatusEvent"("status", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthorityInboxEvent_eventKey_key" ON "public"."AuthorityInboxEvent"("eventKey");

-- CreateIndex
CREATE INDEX "AuthorityInboxEvent_projectId_receivedAt_idx" ON "public"."AuthorityInboxEvent"("projectId", "receivedAt");

-- CreateIndex
CREATE INDEX "AuthorityInboxEvent_organisationId_receivedAt_idx" ON "public"."AuthorityInboxEvent"("organisationId", "receivedAt");

-- CreateIndex
CREATE INDEX "AuthorityInboxEvent_submissionId_receivedAt_idx" ON "public"."AuthorityInboxEvent"("submissionId", "receivedAt");

-- CreateIndex
CREATE INDEX "AuthorityInboxEvent_requirementCaseId_receivedAt_idx" ON "public"."AuthorityInboxEvent"("requirementCaseId", "receivedAt");

-- CreateIndex
CREATE INDEX "AuthorityInboxEvent_reviewStatus_eventType_receivedAt_idx" ON "public"."AuthorityInboxEvent"("reviewStatus", "eventType", "receivedAt");

-- CreateIndex
CREATE INDEX "ClassificationRecommendation_caseId_status_idx" ON "public"."ClassificationRecommendation"("caseId", "status");

-- CreateIndex
CREATE INDEX "ClassificationRecommendation_status_createdAt_idx" ON "public"."ClassificationRecommendation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ClassificationRecommendation_reviewedBy_reviewedAt_idx" ON "public"."ClassificationRecommendation"("reviewedBy", "reviewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClassificationRecommendation_caseId_documentId_charStart_ch_key" ON "public"."ClassificationRecommendation"("caseId", "documentId", "charStart", "charEnd");

-- CreateIndex
CREATE INDEX "ApprovalLog_classificationRecommendationId_timestamp_idx" ON "public"."ApprovalLog"("classificationRecommendationId", "timestamp");

-- CreateIndex
CREATE INDEX "ApprovalLog_actor_timestamp_idx" ON "public"."ApprovalLog"("actor", "timestamp");

-- CreateIndex
CREATE INDEX "HumanApprovalGate_caseId_idx" ON "public"."HumanApprovalGate"("caseId");

-- CreateIndex
CREATE INDEX "HumanApprovalGate_isOpen_updatedAt_idx" ON "public"."HumanApprovalGate"("isOpen", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HumanApprovalGate_caseId_documentId_key" ON "public"."HumanApprovalGate"("caseId", "documentId");

-- CreateIndex
CREATE INDEX "CaseSnapshot_organisationId_createdAt_idx" ON "public"."CaseSnapshot"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "CaseSnapshot_projectId_createdAt_idx" ON "public"."CaseSnapshot"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "CaseSnapshot_requirementCaseId_snapshotVersion_idx" ON "public"."CaseSnapshot"("requirementCaseId", "snapshotVersion");

-- CreateIndex
CREATE INDEX "CaseSnapshot_submissionId_createdAt_idx" ON "public"."CaseSnapshot"("submissionId", "createdAt");

-- CreateIndex
CREATE INDEX "EvidenceExport_organisationId_createdAt_idx" ON "public"."EvidenceExport"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "EvidenceExport_projectId_createdAt_idx" ON "public"."EvidenceExport"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "EvidenceExport_requirementCaseId_createdAt_idx" ON "public"."EvidenceExport"("requirementCaseId", "createdAt");

-- CreateIndex
CREATE INDEX "EvidenceExport_snapshotId_createdAt_idx" ON "public"."EvidenceExport"("snapshotId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "decision_cases_external_case_key_key" ON "public"."decision_cases"("external_case_key");

-- CreateIndex
CREATE INDEX "decision_cases_municipality_decision_date_idx" ON "public"."decision_cases"("municipality", "decision_date");

-- CreateIndex
CREATE INDEX "decision_cases_municipality_received_date_idx" ON "public"."decision_cases"("municipality", "received_date");

-- CreateIndex
CREATE INDEX "decision_cases_outcome_idx" ON "public"."decision_cases"("outcome");

-- CreateIndex
CREATE INDEX "decision_requirements_decision_case_id_requirement_type_idx" ON "public"."decision_requirements"("decision_case_id", "requirement_type");

-- CreateIndex
CREATE INDEX "decision_requirements_source_document_id_idx" ON "public"."decision_requirements"("source_document_id");

-- CreateIndex
CREATE INDEX "decision_risk_features_decision_case_id_idx" ON "public"."decision_risk_features"("decision_case_id");

-- CreateIndex
CREATE INDEX "decision_risk_features_ewc_category_volume_bucket_idx" ON "public"."decision_risk_features"("ewc_category", "volume_bucket");

-- CreateIndex
CREATE INDEX "project_components_project_id_idx" ON "public"."project_components"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "env_registerenhetsomradesytor_objekt_id_key" ON "public"."env_registerenhetsomradesytor"("objekt_id");

-- CreateIndex
CREATE INDEX "env_registerenhetsomradesytor_fastighet_idx" ON "public"."env_registerenhetsomradesytor"("fastighet");

-- CreateIndex
CREATE INDEX "env_sgu_jordarter_jordart_kod_idx" ON "env"."env_sgu_jordarter"("jordart_kod");

-- CreateIndex
CREATE UNIQUE INDEX "env_viss_vattenforekomster_viss_id_key" ON "public"."env_viss_vattenforekomster"("viss_id");

-- CreateIndex
CREATE INDEX "env_viss_vattenforekomster_viss_id_idx" ON "public"."env_viss_vattenforekomster"("viss_id");

-- CreateIndex
CREATE UNIQUE INDEX "env_svar_avrinningsomraden_aro_id_key" ON "public"."env_svar_avrinningsomraden"("aro_id");

-- CreateIndex
CREATE INDEX "env_lm_marktacke_klass_kod_idx" ON "public"."env_lm_marktacke"("klass_kod");

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "public"."Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Project" ADD CONSTRAINT "Project_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "public"."Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."satellite_analyses" ADD CONSTRAINT "satellite_analyses_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."satellite_analyses" ADD CONSTRAINT "satellite_analyses_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "public"."satellite_scenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."c_notification_chemicals" ADD CONSTRAINT "c_notification_chemicals_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."c_notification_chemicals" ADD CONSTRAINT "c_notification_chemicals_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PermitApplicationDraft" ADD CONSTRAINT "PermitApplicationDraft_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PermitApplicationDraft" ADD CONSTRAINT "PermitApplicationDraft_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProjectPlanState" ADD CONSTRAINT "ProjectPlanState_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PropertyAccessLog" ADD CONSTRAINT "PropertyAccessLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PropertyAccessLog" ADD CONSTRAINT "PropertyAccessLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DriverJournal" ADD CONSTRAINT "DriverJournal_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "public"."TransportBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LimsReport" ADD CONSTRAINT "LimsReport_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "public"."TransportBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GpsPosition" ADD CONSTRAINT "GpsPosition_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "public"."TransportBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DocumentRecord" ADD CONSTRAINT "DocumentRecord_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DocumentRecord" ADD CONSTRAINT "DocumentRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DocumentContent" ADD CONSTRAINT "DocumentContent_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."DocumentRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DocumentChunk" ADD CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."DocumentRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SearchQueryLog" ADD CONSTRAINT "SearchQueryLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SearchQueryLog" ADD CONSTRAINT "SearchQueryLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequirementCase" ADD CONSTRAINT "RequirementCase_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."DocumentRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequirementCase" ADD CONSTRAINT "RequirementCase_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "public"."Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequirementCase" ADD CONSTRAINT "RequirementCase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequirementRecord" ADD CONSTRAINT "RequirementRecord_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "public"."RequirementCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequirementRecord" ADD CONSTRAINT "RequirementRecord_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."DocumentRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequirementRecord" ADD CONSTRAINT "RequirementRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequirementCitation" ADD CONSTRAINT "RequirementCitation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "public"."RequirementCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequirementCitation" ADD CONSTRAINT "RequirementCitation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."DocumentRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequirementCitation" ADD CONSTRAINT "RequirementCitation_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "public"."RequirementRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."email_messages" ADD CONSTRAINT "email_messages_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."ingest_runs"("run_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."attachments" ADD CONSTRAINT "attachments_canonical_message_id_fkey" FOREIGN KEY ("canonical_message_id") REFERENCES "public"."email_messages"("message_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."attachments" ADD CONSTRAINT "attachments_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."DocumentRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."attachment_occurrences" ADD CONSTRAINT "attachment_occurrences_attachment_hash_fkey" FOREIGN KEY ("attachment_hash") REFERENCES "public"."attachments"("attachment_hash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."attachment_occurrences" ADD CONSTRAINT "attachment_occurrences_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."email_messages"("message_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."extracted_requirements" ADD CONSTRAINT "extracted_requirements_attachment_hash_fkey" FOREIGN KEY ("attachment_hash") REFERENCES "public"."attachments"("attachment_hash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."extracted_requirements" ADD CONSTRAINT "extracted_requirements_knowledge_node_id_fkey" FOREIGN KEY ("knowledge_node_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."knowledge_edges" ADD CONSTRAINT "knowledge_edges_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."knowledge_edges" ADD CONSTRAINT "knowledge_edges_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DocumentMetadataEvidence" ADD CONSTRAINT "DocumentMetadataEvidence_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."DocumentRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MetadataReviewQueue" ADD CONSTRAINT "MetadataReviewQueue_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."DocumentRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."case_notes" ADD CONSTRAINT "case_notes_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."RequirementCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."graph_edges" ADD CONSTRAINT "graph_edges_source_node_fkey" FOREIGN KEY ("source_node") REFERENCES "public"."graph_nodes"("node_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."graph_edges" ADD CONSTRAINT "graph_edges_target_node_fkey" FOREIGN KEY ("target_node") REFERENCES "public"."graph_nodes"("node_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."RequirementMatrixRow" ADD CONSTRAINT "RequirementMatrixRow_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."RequirementCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequirementMatrixRow" ADD CONSTRAINT "RequirementMatrixRow_citation_id_fkey" FOREIGN KEY ("citation_id") REFERENCES "public"."RequirementCitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequirementMatrixRow" ADD CONSTRAINT "RequirementMatrixRow_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."DocumentRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequirementMatrixRow" ADD CONSTRAINT "RequirementMatrixRow_legal_source_id_fkey" FOREIGN KEY ("legal_source_id") REFERENCES "public"."legal_source_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequirementMatrixRow" ADD CONSTRAINT "RequirementMatrixRow_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "public"."RequirementRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."legal_source_records" ADD CONSTRAINT "legal_source_records_judgment_id_fkey" FOREIGN KEY ("judgment_id") REFERENCES "public"."judgment_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."legal_corpus_records" ADD CONSTRAINT "legal_corpus_records_judgment_id_fkey" FOREIGN KEY ("judgment_id") REFERENCES "public"."judgment_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."legal_corpus_records" ADD CONSTRAINT "legal_corpus_records_legal_source_id_fkey" FOREIGN KEY ("legal_source_id") REFERENCES "public"."legal_source_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Submission" ADD CONSTRAINT "Submission_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Submission" ADD CONSTRAINT "Submission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Submission" ADD CONSTRAINT "Submission_requirementCaseId_fkey" FOREIGN KEY ("requirementCaseId") REFERENCES "public"."RequirementCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SubmissionArtifact" ADD CONSTRAINT "SubmissionArtifact_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."DocumentRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SubmissionArtifact" ADD CONSTRAINT "SubmissionArtifact_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "public"."Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SubmissionStatusEvent" ADD CONSTRAINT "SubmissionStatusEvent_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "public"."Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuthorityInboxEvent" ADD CONSTRAINT "AuthorityInboxEvent_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."DocumentRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuthorityInboxEvent" ADD CONSTRAINT "AuthorityInboxEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuthorityInboxEvent" ADD CONSTRAINT "AuthorityInboxEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuthorityInboxEvent" ADD CONSTRAINT "AuthorityInboxEvent_requirementCaseId_fkey" FOREIGN KEY ("requirementCaseId") REFERENCES "public"."RequirementCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuthorityInboxEvent" ADD CONSTRAINT "AuthorityInboxEvent_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "public"."Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClassificationRecommendation" ADD CONSTRAINT "ClassificationRecommendation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "public"."RequirementCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClassificationRecommendation" ADD CONSTRAINT "ClassificationRecommendation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."DocumentRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ApprovalLog" ADD CONSTRAINT "ApprovalLog_classificationRecommendationId_fkey" FOREIGN KEY ("classificationRecommendationId") REFERENCES "public"."ClassificationRecommendation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CaseSnapshot" ADD CONSTRAINT "CaseSnapshot_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CaseSnapshot" ADD CONSTRAINT "CaseSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CaseSnapshot" ADD CONSTRAINT "CaseSnapshot_requirementCaseId_fkey" FOREIGN KEY ("requirementCaseId") REFERENCES "public"."RequirementCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CaseSnapshot" ADD CONSTRAINT "CaseSnapshot_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "public"."Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EvidenceExport" ADD CONSTRAINT "EvidenceExport_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EvidenceExport" ADD CONSTRAINT "EvidenceExport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EvidenceExport" ADD CONSTRAINT "EvidenceExport_requirementCaseId_fkey" FOREIGN KEY ("requirementCaseId") REFERENCES "public"."RequirementCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EvidenceExport" ADD CONSTRAINT "EvidenceExport_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "public"."CaseSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."decision_cases" ADD CONSTRAINT "decision_cases_app_requirement_case_id_fkey" FOREIGN KEY ("app_requirement_case_id") REFERENCES "public"."RequirementCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."decision_cases" ADD CONSTRAINT "decision_cases_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "public"."DocumentRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."decision_requirements" ADD CONSTRAINT "decision_requirements_decision_case_id_fkey" FOREIGN KEY ("decision_case_id") REFERENCES "public"."decision_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."decision_requirements" ADD CONSTRAINT "decision_requirements_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "public"."DocumentRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."decision_risk_features" ADD CONSTRAINT "decision_risk_features_decision_case_id_fkey" FOREIGN KEY ("decision_case_id") REFERENCES "public"."decision_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_components" ADD CONSTRAINT "project_components_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_components" ADD CONSTRAINT "project_components_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."component_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
