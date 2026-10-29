-- AlterEnum
ALTER TYPE "ApprovalType" ADD VALUE 'PTP_EXCEPTION';

-- AlterTable
ALTER TABLE "CaseLoan" ADD COLUMN     "releaseReason" TEXT,
ADD COLUMN     "releasedAt" TIMESTAMP(3);
