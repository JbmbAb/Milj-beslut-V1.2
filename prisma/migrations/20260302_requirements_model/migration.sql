-- CreateEnum
CREATE TYPE "RequirementVerificationStatus" AS ENUM ('AUTO', 'REVIEWED', 'VERIFIED', 'REJECTED');

-- CreateTable
CREATE TABLE "RequirementCase" (
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
    "reviewStatus" "RequirementVerificationStatus" NOT NULL DEFAULT 'AUTO',
    "validatedBy" TEXT,
    "validatedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequirementCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementRecord" (
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
    "verificationStatus" "RequirementVerificationStatus" NOT NULL DEFAULT 'AUTO',
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "errorType" TEXT,
    "validationComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequirementRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementCitation" (
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
    "verificationStatus" "RequirementVerificationStatus" NOT NULL DEFAULT 'AUTO',
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementCitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RequirementCase_caseKey_key" ON "RequirementCase"("caseKey");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementCase_documentId_key" ON "RequirementCase"("documentId");

-- CreateIndex
CREATE INDEX "RequirementCase_projectId_documentDate_idx" ON "RequirementCase"("projectId", "documentDate");

-- CreateIndex
CREATE INDEX "RequirementCase_municipality_authorityType_idx" ON "RequirementCase"("municipality", "authorityType");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementRecord_requirementCode_key" ON "RequirementRecord"("requirementCode");

-- CreateIndex
CREATE INDEX "RequirementRecord_documentId_idx" ON "RequirementRecord"("documentId");

-- CreateIndex
CREATE INDEX "RequirementRecord_projectId_category_idx" ON "RequirementRecord"("projectId", "category");

-- CreateIndex
CREATE INDEX "RequirementRecord_verificationStatus_updatedAt_idx" ON "RequirementRecord"("verificationStatus", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementCitation_citationCode_key" ON "RequirementCitation"("citationCode");

-- CreateIndex
CREATE INDEX "RequirementCitation_documentId_pageNumber_idx" ON "RequirementCitation"("documentId", "pageNumber");

-- CreateIndex
CREATE INDEX "RequirementCitation_requirementId_idx" ON "RequirementCitation"("requirementId");

-- CreateIndex
CREATE INDEX "RequirementCitation_verificationStatus_createdAt_idx" ON "RequirementCitation"("verificationStatus", "createdAt");

-- AddForeignKey
ALTER TABLE "RequirementCase" ADD CONSTRAINT "RequirementCase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementCase" ADD CONSTRAINT "RequirementCase_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DocumentRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementRecord" ADD CONSTRAINT "RequirementRecord_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RequirementCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementRecord" ADD CONSTRAINT "RequirementRecord_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DocumentRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementRecord" ADD CONSTRAINT "RequirementRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementCitation" ADD CONSTRAINT "RequirementCitation_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "RequirementRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementCitation" ADD CONSTRAINT "RequirementCitation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RequirementCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementCitation" ADD CONSTRAINT "RequirementCitation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DocumentRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
