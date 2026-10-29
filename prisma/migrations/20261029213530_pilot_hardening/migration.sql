-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('SCHEDULED', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RelatedPartyRole" AS ENUM ('BORROWER', 'CO_BORROWER', 'GUARANTOR', 'CONTACT_PERSON');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BusinessOutcome" ADD VALUE 'DELINQUENCY_CLOSED';
ALTER TYPE "BusinessOutcome" ADD VALUE 'PTP_EXCEPTION_PROPOSED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ExceptionType" ADD VALUE 'CALL_STATE_UNKNOWN';
ALTER TYPE "ExceptionType" ADD VALUE 'CALL_CONTROL_FAILURE';
ALTER TYPE "ExceptionType" ADD VALUE 'REMINDER_DELIVERY_FAILURE';
ALTER TYPE "ExceptionType" ADD VALUE 'DECEASED_VERIFICATION';

-- AlterTable
ALTER TABLE "Interaction" ADD COLUMN     "controlState" JSONB;

-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "agedForDate" DATE;

-- AlterTable
ALTER TABLE "OutboundMessage" ADD COLUMN     "estimatedCost" DECIMAL(12,4),
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'CAMPAIGN',
ADD COLUMN     "segments" INTEGER;

-- AlterTable
ALTER TABLE "Promise" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "SupportCase" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedBy" TEXT,
ADD COLUMN     "reportSource" TEXT,
ADD COLUMN     "reporterRelation" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "WorkerHeartbeat" ADD COLUMN     "capabilitiesJson" JSONB,
ADD COLUMN     "lastCatchUpAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ReminderJob" (
    "id" TEXT NOT NULL,
    "promiseId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "promiseVersion" INTEGER NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'SCHEDULED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "outboundMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttribution" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "agentUserId" TEXT,
    "interactionId" TEXT,
    "ruleVersion" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reportingDate" DATE NOT NULL,
    "attributedAt" TIMESTAMP(3) NOT NULL,
    "reversedAt" TIMESTAMP(3),
    "reversalPaymentId" TEXT,
    "reason" TEXT,

    CONSTRAINT "PaymentAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelatedParty" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "role" "RelatedPartyRole" NOT NULL,
    "displayName" TEXT NOT NULL,
    "relation" TEXT,
    "phoneMasked" TEXT,
    "verification" "ContactVerification" NOT NULL DEFAULT 'UNVERIFIED',
    "disclosureAllowed" BOOLEAN NOT NULL DEFAULT false,
    "contactRules" TEXT,
    "sourceSystem" TEXT NOT NULL DEFAULT 'CUSTOMER_MASTER_DEMO',
    "sourceAsOf" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RelatedParty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReminderJob_dedupKey_key" ON "ReminderJob"("dedupKey");

-- CreateIndex
CREATE INDEX "ReminderJob_status_scheduledFor_idx" ON "ReminderJob"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "ReminderJob_promiseId_idx" ON "ReminderJob"("promiseId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttribution_paymentId_key" ON "PaymentAttribution"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentAttribution_agentUserId_reportingDate_idx" ON "PaymentAttribution"("agentUserId", "reportingDate");

-- CreateIndex
CREATE INDEX "PaymentAttribution_customerId_idx" ON "PaymentAttribution"("customerId");

-- CreateIndex
CREATE INDEX "RelatedParty_customerId_idx" ON "RelatedParty"("customerId");

-- AddForeignKey
ALTER TABLE "ReminderJob" ADD CONSTRAINT "ReminderJob_promiseId_fkey" FOREIGN KEY ("promiseId") REFERENCES "Promise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderJob" ADD CONSTRAINT "ReminderJob_outboundMessageId_fkey" FOREIGN KEY ("outboundMessageId") REFERENCES "OutboundMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttribution" ADD CONSTRAINT "PaymentAttribution_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttribution" ADD CONSTRAINT "PaymentAttribution_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "Interaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelatedParty" ADD CONSTRAINT "RelatedParty_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
