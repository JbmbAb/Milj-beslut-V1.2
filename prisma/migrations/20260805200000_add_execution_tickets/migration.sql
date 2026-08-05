-- CreateEnum
CREATE TYPE "ExecutionTicketStatus" AS ENUM ('PENDING', 'LEASED', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "execution_tickets" (
    "id" TEXT NOT NULL,
    "status" "ExecutionTicketStatus" NOT NULL DEFAULT 'PENDING',
    "manifest_id" TEXT NOT NULL,
    "manifest_type" TEXT NOT NULL DEFAULT 'execution_manifest',
    "attempt_ref" TEXT,
    "lease_ref" TEXT,
    "fail_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "leased_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "execution_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "execution_tickets_status_created_at_idx" ON "execution_tickets"("status", "created_at");

-- CreateIndex
CREATE INDEX "execution_tickets_manifest_id_idx" ON "execution_tickets"("manifest_id");
