-- CreateTable
CREATE TABLE "public"."mpf_rules" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "codeType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "permitClass" TEXT NOT NULL,
    "thresholdValue" DOUBLE PRECISION NOT NULL,
    "sensitiveThresholdValue" DOUBLE PRECISION,
    "sensitivePermitClass" TEXT,
    "thresholdUnit" TEXT NOT NULL DEFAULT 'ton/år',
    "mpfReference" TEXT NOT NULL,
    "requiresEia" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mpf_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mpf_rules_code_key" ON "public"."mpf_rules"("code");

-- CreateIndex
CREATE INDEX "mpf_rules_codeType_idx" ON "public"."mpf_rules"("codeType");