-- AlterTable: add reference_number column to AuditTrail for indexed audit queries
ALTER TABLE "AuditTrail" ADD COLUMN "reference_number" TEXT;

-- CreateIndex
CREATE INDEX "AuditTrail_reference_number_idx" ON "AuditTrail"("reference_number");
