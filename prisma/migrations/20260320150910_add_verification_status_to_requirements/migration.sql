-- AlterTable
ALTER TABLE "RequirementCitation" ADD COLUMN     "verificationStatus" "RequirementVerificationStatus" NOT NULL DEFAULT 'AUTO';

-- AlterTable
ALTER TABLE "RequirementRecord" ADD COLUMN     "verificationStatus" "RequirementVerificationStatus" NOT NULL DEFAULT 'AUTO';
