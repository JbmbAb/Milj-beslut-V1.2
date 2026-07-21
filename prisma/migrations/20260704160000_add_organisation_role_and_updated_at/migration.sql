-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('CLIENT', 'AUTHORITY', 'CONTRACTOR', 'PARTNER');

-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN "role" "OrganizationRole" NOT NULL DEFAULT 'CLIENT';
ALTER TABLE "Organisation" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Organisation" ADD COLUMN "contactEmail" TEXT;
ALTER TABLE "Organisation" ADD COLUMN "phone" TEXT;
ALTER TABLE "Organisation" ADD COLUMN "address" JSONB;
