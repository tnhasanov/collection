-- CreateEnum
CREATE TYPE "Role" AS ENUM ('AGENT', 'SENIOR_AGENT', 'TEAM_LEAD', 'COLLECTIONS_HEAD', 'RISK_ANALYST', 'MODEL_MAKER', 'INDEPENDENT_APPROVER', 'INTEGRATION_OPERATOR', 'AUDITOR', 'ADMIN', 'SERVICE');

-- CreateEnum
CREATE TYPE "Seniority" AS ENUM ('REGULAR', 'SENIOR');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('AZ', 'EN', 'RU');

-- CreateEnum
CREATE TYPE "TeamKind" AS ENUM ('REGULAR', 'SENIOR', 'SUPPORT', 'RECOVERY', 'MANAGEMENT');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DECEASED_NOTIFIED', 'LEGAL');

-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('MOBILE', 'LANDLINE', 'EMAIL', 'ADDRESS');

-- CreateEnum
CREATE TYPE "ContactVerification" AS ENUM ('VERIFIED', 'UNVERIFIED', 'INVALID');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('ACTIVE', 'PAID_OFF', 'CLOSED', 'RESTRUCTURED');

-- CreateEnum
CREATE TYPE "ScheduleSource" AS ENUM ('CORE_IMPORT', 'LOCAL_SIMULATION');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('SCHEDULED', 'DUE', 'PARTIALLY_PAID', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('POSTED', 'PENDING', 'REVERSED', 'QUARANTINED', 'UNMATCHED');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'REVIEW', 'RESOLVED', 'REVERSAL_LINKED');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('OPEN', 'MATCHED', 'NOT_FOUND', 'RESOLVED');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('OPEN', 'CURED', 'CLOSED', 'HANDOVER');

-- CreateEnum
CREATE TYPE "VersionStatus" AS ENUM ('DRAFT', 'TESTED', 'APPROVED', 'ACTIVE', 'RETIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DecisionSegment" AS ENUM ('DPD_0', 'DPD_1_3', 'DPD_4_10', 'DPD_11_16', 'DPD_17_23', 'DPD_24_30', 'DPD_31_45', 'DPD_46_60', 'DPD_61_90', 'DPD_91_PLUS');

-- CreateEnum
CREATE TYPE "ScoreStatus" AS ENUM ('SCORED', 'UNSCORED');

-- CreateEnum
CREATE TYPE "ProbabilitySource" AS ENUM ('DRAFT_TREE_4_10', 'DEMO_ONLY_1_3_RULE', 'DRAFT_ROLL_RATE_11_30', 'NONE');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "WorkItemType" AS ENUM ('CALL', 'CALLBACK', 'PTP_FOLLOWUP', 'RECONCILIATION', 'DISPUTE_REVIEW', 'SUPPORT_REVIEW', 'MANUAL_REVIEW', 'LATER_STAGE_REVIEW', 'HANDOVER', 'DIGITAL_REMINDER');

-- CreateEnum
CREATE TYPE "WorkItemStatus" AS ENUM ('QUEUED', 'ELIGIBLE', 'DEFERRED', 'CLAIMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'DIALING', 'CONNECTED', 'WRAP_UP', 'RELEASED', 'CANCELLED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "AgentState" AS ENUM ('OFFLINE', 'NOT_READY', 'READY', 'RESERVED', 'DIALING', 'TALKING', 'ACW', 'BREAK', 'CONNECTION_PROBLEM');

-- CreateEnum
CREATE TYPE "TechnicalResult" AS ENUM ('ANSWERED', 'NO_ANSWER', 'BUSY', 'UNREACHABLE', 'FAILED', 'MACHINE', 'CANCELLED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('VOICE_OUTBOUND', 'VOICE_INBOUND', 'SMS', 'MANUAL_NOTE');

-- CreateEnum
CREATE TYPE "IdentityStatus" AS ENUM ('RPC_VERIFIED', 'THIRD_PARTY', 'VERIFICATION_FAILED', 'WRONG_PERSON', 'WRONG_NUMBER', 'NOT_ESTABLISHED');

-- CreateEnum
CREATE TYPE "BusinessOutcome" AS ENUM ('PTP', 'PARTIAL_COMMITMENT', 'NO_COMMITMENT', 'CALLBACK_REQUESTED', 'ALREADY_PAID_CLAIM', 'DISPUTE', 'SUPPORT_NEEDED', 'REFUSED', 'SPECIAL_REFERRAL', 'NO_CONVERSATION');

-- CreateEnum
CREATE TYPE "NonPaymentReason" AS ENUM ('SALARY_TIMING', 'TEMPORARY_SHORTFALL', 'INCOME_INTERRUPTION', 'AFFORDABILITY', 'FORGOT', 'TECHNICAL_PAYMENT_ISSUE', 'DISPUTED_DEBT', 'OTHER', 'NOT_STATED');

-- CreateEnum
CREATE TYPE "NextActionKind" AS ENUM ('MONITOR_PTP', 'ELIGIBLE_CALLBACK', 'RECONCILE_CLAIM', 'DISPUTE_REVIEW', 'SUPPORT_REFERRAL', 'POLICY_RETRY', 'CONTACT_CORRECTION', 'COOLDOWN', 'NO_FURTHER_ACTION', 'SPECIAL_REFERRAL');

-- CreateEnum
CREATE TYPE "InteractionStatus" AS ENUM ('OPEN', 'DRAFT', 'SAVED', 'CORRECTED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "WrapUpStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'ACKNOWLEDGED', 'FAILED');

-- CreateEnum
CREATE TYPE "PromiseStatus" AS ENUM ('ACTIVE', 'KEPT', 'PARTIALLY_PAID', 'BROKEN', 'CANCELLED', 'PENDING_RECONCILIATION');

-- CreateEnum
CREATE TYPE "SupportCaseType" AS ENUM ('HARDSHIP', 'DISPUTE', 'COMPLAINT', 'SPECIAL_HANDLING', 'DECEASED_LEGAL');

-- CreateEnum
CREATE TYPE "SupportCaseStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ArrangementType" AS ENUM ('TEMPORARY_PLAN', 'RESTRUCTURE');

-- CreateEnum
CREATE TYPE "ArrangementStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'REVIEWED', 'APPROVED', 'REJECTED', 'SENT_TO_CORE', 'CORE_CONFIRMED', 'ACTIVE', 'FAILED');

-- CreateEnum
CREATE TYPE "ApprovalType" AS ENUM ('MODEL_ACTIVATION', 'STRATEGY_ACTIVATION', 'POLICY_ACTIVATION', 'RECONCILIATION_DECISION', 'WAIVER', 'RESTRUCTURE', 'RESTRICTION_OVERRIDE', 'EXPORT', 'TEMPLATE_ACTIVATION', 'CAMPAIGN_RELEASE', 'HANDOVER', 'ROLLBACK');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'INFO_REQUESTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HandoverStatus" AS ENUM ('DRAFT', 'REVIEW_REQUESTED', 'APPROVED', 'EXPORTED', 'ACCEPTED', 'RETURNED');

-- CreateEnum
CREATE TYPE "TemplateKind" AS ENUM ('SMS', 'AGENT_SCRIPT', 'PTP_REMINDER', 'SUPPORT_SCRIPT', 'THIRD_PARTY_SCRIPT');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'REVIEWED', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'UNKNOWN', 'CANCELLED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'VALIDATED', 'DRY_RUN', 'COMMITTED', 'FAILED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "IssueSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "SourceHealth" AS ENUM ('HEALTHY', 'DEGRADED', 'STALE', 'DISABLED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "IntegrationEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'DUPLICATE', 'REJECTED', 'QUARANTINED', 'FAILED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "ProviderEventStatus" AS ENUM ('RECEIVED', 'APPLIED', 'DUPLICATE', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'REJECTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ExceptionType" AS ENUM ('CLAIMED_ALREADY_PAID', 'UNMATCHED_PAYMENT', 'REVERSED_PAYMENT', 'STALE_BALANCES', 'STALE_FEATURES', 'MISSING_MODEL_INPUT', 'WRONG_NUMBER', 'DUPLICATE_CIF', 'DISPUTE', 'EXPIRED_POLICY_OR_MODEL', 'SOURCE_MISMATCH', 'HANDOVER_FAILURE', 'SCHEDULE_MISMATCH', 'PROVIDER_WRAPUP_FAILURE', 'WITHDRAWAL_UNACKNOWLEDGED', 'SENIOR_CAPACITY_OVERFLOW', 'SCREEN_POP_DELAY', 'SUPPRESSION_SYNC_FAILURE');

-- CreateEnum
CREATE TYPE "ExceptionStatus" AS ENUM ('OPEN', 'ASSIGNED', 'RESOLVED', 'REOPENED');

-- CreateEnum
CREATE TYPE "Provenance" AS ENUM ('SOURCE_BASED', 'DEMO_ASSUMPTION', 'BANK_APPROVED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT,
    "role" "Role" NOT NULL,
    "teamId" TEXT,
    "languages" "Language"[],
    "skills" TEXT[],
    "branchScopes" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isServiceAccount" BOOLEAN NOT NULL DEFAULT false,
    "identityRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ip" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TeamKind" NOT NULL,
    "branch" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentProfile" (
    "userId" TEXT NOT NULL,
    "seniority" "Seniority" NOT NULL,
    "extension" TEXT,
    "providerAgentRef" TEXT,
    "shiftStart" TEXT,
    "shiftEnd" TEXT,
    "campaignCodes" TEXT[],
    "maxConcurrentVoice" INTEGER NOT NULL DEFAULT 1,
    "autoContinueAllowed" BOOLEAN NOT NULL DEFAULT true,
    "manualDialAllowed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "cif" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "language" "Language" NOT NULL DEFAULT 'AZ',
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "segment" TEXT,
    "sourceSystem" TEXT NOT NULL DEFAULT 'CUSTOMER_MASTER_DEMO',
    "sourceAsOf" TIMESTAMP(3) NOT NULL,
    "specialHandling" BOOLEAN NOT NULL DEFAULT false,
    "specialHandlingReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactPoint" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "ContactType" NOT NULL,
    "value" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "verification" "ContactVerification" NOT NULL DEFAULT 'UNVERIFIED',
    "invalidReason" TEXT,
    "invalidatedAt" TIMESTAMP(3),
    "invalidatedByInteractionId" TEXT,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "restrictionReason" TEXT,
    "preferredWindow" TEXT,
    "sourceSystem" TEXT NOT NULL DEFAULT 'CUSTOMER_MASTER_DEMO',
    "sourceAsOf" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "coreLoanId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "product" TEXT NOT NULL DEFAULT 'CASH_LOAN_ANNUITY',
    "currency" TEXT NOT NULL DEFAULT 'AZN',
    "originationDate" DATE NOT NULL,
    "maturityDate" DATE NOT NULL,
    "firstDueDate" DATE NOT NULL,
    "principalOriginal" DECIMAL(18,2) NOT NULL,
    "nominalAnnualRate" DECIMAL(9,6) NOT NULL,
    "tenorMonths" INTEGER NOT NULL,
    "status" "LoanStatus" NOT NULL DEFAULT 'ACTIVE',
    "branch" TEXT NOT NULL,
    "principalOutstanding" DECIMAL(18,2) NOT NULL,
    "overduePrincipal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "overdueInterest" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "accruedInterestNotDue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "feesDue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unappliedFunds" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalOverdue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "dpd" INTEGER NOT NULL DEFAULT 0,
    "oldestUnpaidDueDate" DATE,
    "nextDueDate" DATE,
    "nextDueAmount" DECIMAL(18,2),
    "balanceVersion" INTEGER NOT NULL DEFAULT 1,
    "balancesAsOf" TIMESTAMP(3) NOT NULL,
    "sourceSystem" TEXT NOT NULL DEFAULT 'CORE_DEMO',
    "sourceVersion" TEXT NOT NULL DEFAULT '1',
    "lastPaymentAt" TIMESTAMP(3),
    "lastPaymentAmount" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanSnapshot" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "balanceVersion" INTEGER NOT NULL,
    "principalOutstanding" DECIMAL(18,2) NOT NULL,
    "overduePrincipal" DECIMAL(18,2) NOT NULL,
    "overdueInterest" DECIMAL(18,2) NOT NULL,
    "accruedInterestNotDue" DECIMAL(18,2) NOT NULL,
    "feesDue" DECIMAL(18,2) NOT NULL,
    "unappliedFunds" DECIMAL(18,2) NOT NULL,
    "totalOverdue" DECIMAL(18,2) NOT NULL,
    "dpd" INTEGER NOT NULL,
    "status" "LoanStatus" NOT NULL,
    "sourceEventId" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleVersion" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "source" "ScheduleSource" NOT NULL,
    "sourceRef" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "importBatchId" TEXT,
    "checksum" TEXT,
    "basis" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Installment" (
    "id" TEXT NOT NULL,
    "scheduleVersionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "openingPrincipal" DECIMAL(18,2) NOT NULL,
    "principalDue" DECIMAL(18,2) NOT NULL,
    "interestDue" DECIMAL(18,2) NOT NULL,
    "feeDue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalDue" DECIMAL(18,2) NOT NULL,
    "closingPrincipal" DECIMAL(18,2) NOT NULL,
    "paidPrincipal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paidInterest" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paidFee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Installment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceTransactionId" TEXT NOT NULL,
    "loanId" TEXT,
    "customerId" TEXT,
    "loanRef" TEXT,
    "customerRef" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AZN',
    "eventAt" TIMESTAMP(3) NOT NULL,
    "valueDate" DATE NOT NULL,
    "postingDate" DATE,
    "status" "PaymentStatus" NOT NULL,
    "reversalOfId" TEXT,
    "reconciliation" "ReconciliationStatus" NOT NULL DEFAULT 'MATCHED',
    "reconciliationNote" TEXT,
    "importBatchId" TEXT,
    "integrationEventId" TEXT,
    "allocationPolicy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "installmentId" TEXT,
    "principalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "interestAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "feeAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unappliedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "policy" TEXT NOT NULL,
    "reversed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentClaim" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "loanId" TEXT,
    "interactionId" TEXT,
    "claimedAmount" DECIMAL(18,2),
    "claimedDate" DATE,
    "channel" TEXT,
    "reference" TEXT,
    "status" "ClaimStatus" NOT NULL DEFAULT 'OPEN',
    "holdUntil" TIMESTAMP(3),
    "resolution" TEXT,
    "matchedPaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionCase" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "episodeNo" INTEGER NOT NULL DEFAULT 1,
    "status" "CaseStatus" NOT NULL DEFAULT 'OPEN',
    "portfolio" TEXT NOT NULL DEFAULT 'EARLY_ARREARS',
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "ownerUserId" TEXT,
    "teamId" TEXT,
    "maxDpd" INTEGER NOT NULL DEFAULT 0,
    "totalOverdue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "modelExposure" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "latestDecisionId" TEXT,
    "entryDpd" INTEGER,
    "entryExposure" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseLoan" (
    "caseId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseLoan_pkey" PRIMARY KEY ("caseId","loanId")
);

-- CreateTable
CREATE TABLE "ModelVersion" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelCode" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "checksum" TEXT,
    "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "observationFrequency" TEXT NOT NULL,
    "targetPopulation" TEXT NOT NULL,
    "targetEvent" TEXT NOT NULL,
    "horizon" TEXT NOT NULL,
    "rulesJson" JSONB NOT NULL,
    "featureDictionary" JSONB NOT NULL,
    "unresolvedIssues" JSONB NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureSnapshot" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "asOf" DATE NOT NULL,
    "observationMonth" TEXT NOT NULL,
    "features" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'PROMETEIA_FEATURE_FILE_DEMO',
    "isLatestComplete" BOOLEAN NOT NULL DEFAULT false,
    "qualityFlags" TEXT[],
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Score" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "featureSnapshotId" TEXT,
    "modelVersionId" TEXT,
    "segment" "DecisionSegment" NOT NULL,
    "status" "ScoreStatus" NOT NULL,
    "riskClass" INTEGER,
    "probability" DECIMAL(9,6),
    "probabilitySource" "ProbabilitySource" NOT NULL,
    "tracePath" JSONB NOT NULL,
    "reasonCodes" TEXT[],
    "featuresAsOf" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Score_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyVersion" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
    "configJson" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "activatedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactPolicyVersion" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
    "configJson" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "activatedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactPolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionRun" (
    "id" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "populationCount" INTEGER NOT NULL DEFAULT 0,
    "scoredCount" INTEGER NOT NULL DEFAULT 0,
    "unscoredCount" INTEGER NOT NULL DEFAULT 0,
    "bucketCutoffs" JSONB,
    "tieHandling" TEXT,
    "modelVersionId" TEXT,
    "strategyVersionId" TEXT,
    "policyVersionId" TEXT,
    "triggeredBy" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "DecisionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionSnapshot" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "customerId" TEXT NOT NULL,
    "caseId" TEXT,
    "decisionDpd" INTEGER NOT NULL,
    "segment" "DecisionSegment" NOT NULL,
    "exposure" DECIMAL(18,2) NOT NULL,
    "exposureDefinition" TEXT NOT NULL,
    "totalOverdue" DECIMAL(18,2) NOT NULL,
    "scoreId" TEXT,
    "probability" DECIMAL(9,6),
    "probabilitySource" "ProbabilitySource" NOT NULL,
    "riskClass" INTEGER,
    "era" DECIMAL(18,2),
    "actionBucket" INTEGER,
    "recommendedAction" TEXT NOT NULL,
    "effectiveAction" TEXT NOT NULL,
    "eligibility" JSONB NOT NULL,
    "reasonCodes" TEXT[],
    "rank" INTEGER,
    "tiebreak" JSONB,
    "requiredSkill" "Seniority",
    "modelVersionId" TEXT,
    "strategyVersionId" TEXT,
    "policyVersionId" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkItem" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "WorkItemType" NOT NULL,
    "status" "WorkItemStatus" NOT NULL DEFAULT 'QUEUED',
    "activeKey" TEXT,
    "priority" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "rank" INTEGER,
    "nextEligibleAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "deferredReasons" TEXT[],
    "requiredSkill" "Seniority",
    "language" "Language",
    "campaignCode" TEXT,
    "ownerUserId" TEXT,
    "claimedByUserId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "decisionSnapshotId" TEXT,
    "sourceInteractionId" TEXT,
    "reason" TEXT,
    "cancelReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingReservation" (
    "id" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "agentUserId" TEXT NOT NULL,
    "agentSessionId" TEXT,
    "campaignCode" TEXT NOT NULL,
    "contactPointId" TEXT NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'PENDING',
    "requiredSkill" "Seniority",
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decisionSnapshotId" TEXT,
    "strategyVersionId" TEXT,
    "policyVersionId" TEXT,
    "modelVersionId" TEXT,
    "authorizationRef" TEXT,
    "providerTicketRef" TEXT,
    "eligibilityJson" JSONB,
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,
    "withdrawalStatus" TEXT,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutingReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerAgentRef" TEXT NOT NULL,
    "extension" TEXT,
    "requestedState" "AgentState" NOT NULL DEFAULT 'NOT_READY',
    "confirmedState" "AgentState" NOT NULL DEFAULT 'OFFLINE',
    "stateSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stateReason" TEXT,
    "autoContinue" BOOLEAN NOT NULL DEFAULT true,
    "campaignCodes" TEXT[],
    "ctiConnected" BOOLEAN NOT NULL DEFAULT false,
    "ctiStatus" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "lastHeartbeatAt" TIMESTAMP(3),
    "pendingBreakAfterWrap" BOOLEAN NOT NULL DEFAULT false,
    "pendingLogoffAfterWrap" BOOLEAN NOT NULL DEFAULT false,
    "currentReservationId" TEXT,
    "currentInteractionId" TEXT,
    "lastCommandReceiptId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AgentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DialAttempt" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "contactPointId" TEXT NOT NULL,
    "providerAttemptRef" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "ringingAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "bridgedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "technicalResult" "TechnicalResult" NOT NULL DEFAULT 'UNKNOWN',
    "resultSource" TEXT NOT NULL DEFAULT 'PROVIDER',
    "correctedResult" "TechnicalResult",
    "correctionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DialAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interaction" (
    "id" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "customerId" TEXT NOT NULL,
    "caseId" TEXT,
    "loanId" TEXT,
    "workItemId" TEXT,
    "reservationId" TEXT,
    "dialAttemptId" TEXT,
    "agentUserId" TEXT,
    "channel" "Channel" NOT NULL,
    "contactPointId" TEXT,
    "providerInteractionRef" TEXT,
    "campaignCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "connectedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "acwStartedAt" TIMESTAMP(3),
    "acwEndedAt" TIMESTAMP(3),
    "talkSeconds" INTEGER,
    "ringSeconds" INTEGER,
    "acwSeconds" INTEGER,
    "technicalResult" "TechnicalResult",
    "identityStatus" "IdentityStatus",
    "businessOutcome" "BusinessOutcome",
    "nonPaymentReason" "NonPaymentReason",
    "nextAction" "NextActionKind",
    "nextActionDetail" JSONB,
    "note" TEXT,
    "flags" TEXT[],
    "status" "InteractionStatus" NOT NULL DEFAULT 'OPEN',
    "draftJson" JSONB,
    "draftSavedAt" TIMESTAMP(3),
    "savedAt" TIMESTAMP(3),
    "wrapUpStatus" "WrapUpStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "wrapUpReceiptId" TEXT,
    "wrapUpAckAt" TIMESTAMP(3),
    "providerDispositionCode" TEXT,
    "scriptVersionId" TEXT,
    "dispositionVersion" TEXT,
    "policyVersionId" TEXT,
    "isRpc" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InteractionSegment" (
    "id" TEXT NOT NULL,
    "interactionId" TEXT NOT NULL,
    "agentUserId" TEXT,
    "providerLegRef" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'PRIMARY',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "InteractionSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutcomeCorrection" (
    "id" TEXT NOT NULL,
    "interactionId" TEXT NOT NULL,
    "correctedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "beforeJson" JSONB NOT NULL,
    "afterJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutcomeCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promise" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "caseId" TEXT,
    "interactionId" TEXT,
    "createdByUserId" TEXT,
    "ownerUserId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AZN',
    "deadline" TIMESTAMP(3) NOT NULL,
    "deadlineDate" DATE NOT NULL,
    "coveredLoanIds" TEXT[],
    "coveredInstallmentIds" TEXT[],
    "scopeDescription" TEXT,
    "customerConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "status" "PromiseStatus" NOT NULL DEFAULT 'ACTIVE',
    "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "remainingAmount" DECIMAL(18,2) NOT NULL,
    "qualifyingWindowStart" TIMESTAMP(3) NOT NULL,
    "qualifyingWindowEnd" TIMESTAMP(3) NOT NULL,
    "settlementAllowanceDays" INTEGER NOT NULL DEFAULT 2,
    "suppressionUntil" TIMESTAMP(3),
    "reminderPlan" JSONB,
    "policyVersionId" TEXT,
    "cancelReason" TEXT,
    "changeReason" TEXT,
    "previousPromiseId" TEXT,
    "maturedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromisePaymentLink" (
    "id" TEXT NOT NULL,
    "promiseId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reversed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromisePaymentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromiseEvent" (
    "id" TEXT NOT NULL,
    "promiseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" "PromiseStatus",
    "toStatus" "PromiseStatus",
    "reason" TEXT,
    "actorUserId" TEXT,
    "data" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromiseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportCase" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "caseId" TEXT,
    "type" "SupportCaseType" NOT NULL,
    "status" "SupportCaseStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT NOT NULL,
    "restrictedDetails" JSONB,
    "interactionId" TEXT,
    "ownerUserId" TEXT,
    "createdBy" TEXT,
    "restrictionUntil" TIMESTAMP(3),
    "restrictsCalls" BOOLEAN NOT NULL DEFAULT true,
    "resolution" TEXT,
    "slaDueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "SupportCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Arrangement" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "caseId" TEXT,
    "supportCaseId" TEXT,
    "type" "ArrangementType" NOT NULL,
    "status" "ArrangementStatus" NOT NULL DEFAULT 'DRAFT',
    "intake" JSONB NOT NULL,
    "proposal" JSONB NOT NULL,
    "comparison" JSONB,
    "reviewerUserId" TEXT,
    "approvalId" TEXT,
    "coreReference" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Arrangement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "type" "ApprovalType" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "makerUserId" TEXT NOT NULL,
    "checkerUserId" TEXT,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "impactJson" JSONB,
    "evidenceJson" JSONB,
    "validationJson" JSONB,
    "proposedEffectiveAt" TIMESTAMP(3),
    "rollbackTargetId" TEXT,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandoverPacket" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "status" "HandoverStatus" NOT NULL DEFAULT 'DRAFT',
    "packet" JSONB NOT NULL,
    "ownerUserId" TEXT,
    "receivingTeam" TEXT NOT NULL,
    "deadline" TIMESTAMP(3),
    "approvalId" TEXT,
    "acknowledgedBy" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "returnReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HandoverPacket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "kind" "TemplateKind" NOT NULL,
    "language" "Language" NOT NULL,
    "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "variables" TEXT[],
    "channelScope" TEXT[],
    "effectiveFrom" TIMESTAMP(3),
    "approvedBy" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "strategyVersionId" TEXT,
    "templateId" TEXT,
    "audienceSnapshot" JSONB,
    "exclusions" JSONB,
    "scheduledAt" TIMESTAMP(3),
    "approverUserId" TEXT,
    "approvalId" TEXT,
    "requiredSkill" "Seniority",
    "languages" "Language"[],
    "costEstimate" DECIMAL(18,2),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundMessage" (
    "id" TEXT NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "campaignId" TEXT,
    "customerId" TEXT NOT NULL,
    "contactPointId" TEXT,
    "templateId" TEXT,
    "language" "Language" NOT NULL,
    "body" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "blockReason" TEXT,
    "providerRef" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failureReason" TEXT,

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "quarantinedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "controlTotals" JSONB,
    "columnMapping" JSONB,
    "sourceAsOf" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),
    "rolledBackAt" TIMESTAMP(3),
    "summary" JSONB,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataIssue" (
    "id" TEXT NOT NULL,
    "importBatchId" TEXT,
    "severity" "IssueSeverity" NOT NULL,
    "code" TEXT NOT NULL,
    "rowNumber" INTEGER,
    "message" TEXT NOT NULL,
    "rowJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceWatermark" (
    "id" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "health" "SourceHealth" NOT NULL DEFAULT 'UNKNOWN',
    "lastSuccessfulRunAt" TIMESTAMP(3),
    "sourceAsOf" TIMESTAMP(3),
    "lagSeconds" INTEGER,
    "freshnessThresholdSeconds" INTEGER NOT NULL DEFAULT 900,
    "queueDepth" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "deadLetterCount" INTEGER NOT NULL DEFAULT 0,
    "schemaVersion" TEXT NOT NULL DEFAULT '1.0',
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceWatermark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationEvent" (
    "id" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "sourceVersion" TEXT NOT NULL DEFAULT '1',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "businessDate" DATE,
    "customerRef" TEXT,
    "loanRef" TEXT,
    "payload" JSONB NOT NULL,
    "status" "IntegrationEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "resultJson" JSONB,
    "errorMessage" TEXT,
    "correlationId" TEXT,
    "replayOfId" TEXT,

    CONSTRAINT "IntegrationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxMessage" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "detail" JSONB,
    "error" TEXT,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "version" TEXT,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "providerAgentRef" TEXT,
    "providerInteractionRef" TEXT,
    "correlationId" TEXT,
    "sequence" INTEGER,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "status" "ProviderEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "note" TEXT,

    CONSTRAINT "ProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommandReceipt" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "commandType" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestJson" JSONB NOT NULL,
    "responseJson" JSONB,
    "correlationId" TEXT,
    "actorUserId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "CommandReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExceptionCase" (
    "id" TEXT NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "type" "ExceptionType" NOT NULL,
    "severity" "IssueSeverity" NOT NULL DEFAULT 'WARNING',
    "customerId" TEXT,
    "caseId" TEXT,
    "loanId" TEXT,
    "paymentId" TEXT,
    "title" TEXT NOT NULL,
    "evidence" JSONB,
    "affectedOutreach" JSONB,
    "status" "ExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "ownerUserId" TEXT,
    "slaDueAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "resolution" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ExceptionCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,
    "actorService" TEXT,
    "action" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT,
    "customerId" TEXT,
    "caseId" TEXT,
    "reason" TEXT,
    "changes" JSONB,
    "versionIds" JSONB,
    "sourceEventId" TEXT,
    "correlationId" TEXT,
    "ip" TEXT,
    "blocked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "provenance" "Provenance" NOT NULL DEFAULT 'DEMO_ASSUMPTION',
    "owner" TEXT NOT NULL DEFAULT 'collections-product',
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMP(3),
    "description" TEXT NOT NULL,
    "editableRoles" "Role"[],
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "screen" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentAssignment" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "experiment" TEXT NOT NULL,
    "arm" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperimentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricDefinition" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "numerator" TEXT NOT NULL,
    "denominator" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "asOf" DATE NOT NULL,
    "notes" TEXT,

    CONSTRAINT "MetricDefinition_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_name_key" ON "Team"("name");

-- CreateIndex
CREATE UNIQUE INDEX "AgentProfile_providerAgentRef_key" ON "AgentProfile"("providerAgentRef");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_cif_key" ON "Customer"("cif");

-- CreateIndex
CREATE INDEX "ContactPoint_customerId_idx" ON "ContactPoint"("customerId");

-- CreateIndex
CREATE INDEX "ContactPoint_value_idx" ON "ContactPoint"("value");

-- CreateIndex
CREATE UNIQUE INDEX "Loan_coreLoanId_key" ON "Loan"("coreLoanId");

-- CreateIndex
CREATE INDEX "Loan_customerId_idx" ON "Loan"("customerId");

-- CreateIndex
CREATE INDEX "Loan_dpd_idx" ON "Loan"("dpd");

-- CreateIndex
CREATE INDEX "LoanSnapshot_loanId_asOf_idx" ON "LoanSnapshot"("loanId", "asOf");

-- CreateIndex
CREATE INDEX "ScheduleVersion_loanId_isCurrent_idx" ON "ScheduleVersion"("loanId", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleVersion_loanId_versionNo_source_key" ON "ScheduleVersion"("loanId", "versionNo", "source");

-- CreateIndex
CREATE INDEX "Installment_dueDate_idx" ON "Installment"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Installment_scheduleVersionId_seq_key" ON "Installment"("scheduleVersionId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_reversalOfId_key" ON "Payment"("reversalOfId");

-- CreateIndex
CREATE INDEX "Payment_loanId_idx" ON "Payment"("loanId");

-- CreateIndex
CREATE INDEX "Payment_customerId_idx" ON "Payment"("customerId");

-- CreateIndex
CREATE INDEX "Payment_valueDate_idx" ON "Payment"("valueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_sourceSystem_sourceTransactionId_key" ON "Payment"("sourceSystem", "sourceTransactionId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_installmentId_idx" ON "PaymentAllocation"("installmentId");

-- CreateIndex
CREATE INDEX "PaymentClaim_customerId_idx" ON "PaymentClaim"("customerId");

-- CreateIndex
CREATE INDEX "CollectionCase_customerId_status_idx" ON "CollectionCase"("customerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ModelVersion_modelCode_version_key" ON "ModelVersion"("modelCode", "version");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureSnapshot_customerId_observationMonth_key" ON "FeatureSnapshot"("customerId", "observationMonth");

-- CreateIndex
CREATE INDEX "Score_customerId_createdAt_idx" ON "Score"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyVersion_code_version_key" ON "StrategyVersion"("code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ContactPolicyVersion_code_version_key" ON "ContactPolicyVersion"("code", "version");

-- CreateIndex
CREATE INDEX "DecisionSnapshot_customerId_isCurrent_idx" ON "DecisionSnapshot"("customerId", "isCurrent");

-- CreateIndex
CREATE INDEX "DecisionSnapshot_runId_idx" ON "DecisionSnapshot"("runId");

-- CreateIndex
CREATE INDEX "DecisionSnapshot_businessDate_rank_idx" ON "DecisionSnapshot"("businessDate", "rank");

-- CreateIndex
CREATE INDEX "WorkItem_status_nextEligibleAt_idx" ON "WorkItem"("status", "nextEligibleAt");

-- CreateIndex
CREATE INDEX "WorkItem_customerId_type_status_idx" ON "WorkItem"("customerId", "type", "status");

-- CreateIndex
CREATE INDEX "WorkItem_ownerUserId_status_idx" ON "WorkItem"("ownerUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RoutingReservation_correlationId_key" ON "RoutingReservation"("correlationId");

-- CreateIndex
CREATE INDEX "RoutingReservation_customerId_status_idx" ON "RoutingReservation"("customerId", "status");

-- CreateIndex
CREATE INDEX "RoutingReservation_agentUserId_status_idx" ON "RoutingReservation"("agentUserId", "status");

-- CreateIndex
CREATE INDEX "AgentSession_userId_isActive_idx" ON "AgentSession"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "DialAttempt_providerAttemptRef_key" ON "DialAttempt"("providerAttemptRef");

-- CreateIndex
CREATE INDEX "DialAttempt_reservationId_idx" ON "DialAttempt"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "Interaction_correlationId_key" ON "Interaction"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "Interaction_idempotencyKey_key" ON "Interaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Interaction_customerId_startedAt_idx" ON "Interaction"("customerId", "startedAt");

-- CreateIndex
CREATE INDEX "Interaction_agentUserId_startedAt_idx" ON "Interaction"("agentUserId", "startedAt");

-- CreateIndex
CREATE INDEX "Interaction_status_wrapUpStatus_idx" ON "Interaction"("status", "wrapUpStatus");

-- CreateIndex
CREATE INDEX "Promise_customerId_status_idx" ON "Promise"("customerId", "status");

-- CreateIndex
CREATE INDEX "Promise_deadlineDate_status_idx" ON "Promise"("deadlineDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PromisePaymentLink_promiseId_paymentId_key" ON "PromisePaymentLink"("promiseId", "paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PromisePaymentLink_paymentId_key" ON "PromisePaymentLink"("paymentId");

-- CreateIndex
CREATE INDEX "SupportCase_customerId_status_idx" ON "SupportCase"("customerId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_status_type_idx" ON "ApprovalRequest"("status", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Template_code_version_language_key" ON "Template"("code", "version", "language");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_code_key" ON "Campaign"("code");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundMessage_dedupKey_key" ON "OutboundMessage"("dedupKey");

-- CreateIndex
CREATE INDEX "OutboundMessage_customerId_requestedAt_idx" ON "OutboundMessage"("customerId", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_dataset_checksum_key" ON "ImportBatch"("dataset", "checksum");

-- CreateIndex
CREATE UNIQUE INDEX "SourceWatermark_sourceSystem_key" ON "SourceWatermark"("sourceSystem");

-- CreateIndex
CREATE INDEX "IntegrationEvent_status_receivedAt_idx" ON "IntegrationEvent"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationEvent_sourceSystem_sourceEventId_eventType_key" ON "IntegrationEvent"("sourceSystem", "sourceEventId", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxMessage_idempotencyKey_key" ON "OutboxMessage"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OutboxMessage_status_nextAttemptAt_idx" ON "OutboxMessage"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "JobRun_name_startedAt_idx" ON "JobRun"("name", "startedAt");

-- CreateIndex
CREATE INDEX "ProviderEvent_correlationId_idx" ON "ProviderEvent"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderEvent_provider_providerEventId_key" ON "ProviderEvent"("provider", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "CommandReceipt_idempotencyKey_key" ON "CommandReceipt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CommandReceipt_correlationId_idx" ON "CommandReceipt"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "ExceptionCase_dedupKey_key" ON "ExceptionCase"("dedupKey");

-- CreateIndex
CREATE INDEX "ExceptionCase_status_severity_idx" ON "ExceptionCase"("status", "severity");

-- CreateIndex
CREATE INDEX "ExceptionCase_customerId_idx" ON "ExceptionCase"("customerId");

-- CreateIndex
CREATE INDEX "AuditEvent_customerId_at_idx" ON "AuditEvent"("customerId", "at");

-- CreateIndex
CREATE INDEX "AuditEvent_action_at_idx" ON "AuditEvent"("action", "at");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_at_idx" ON "AuditEvent"("actorUserId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "SavedView_userId_screen_name_key" ON "SavedView"("userId", "screen", "name");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentAssignment_customerId_experiment_key" ON "ExperimentAssignment"("customerId", "experiment");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentProfile" ADD CONSTRAINT "AgentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactPoint" ADD CONSTRAINT "ContactPoint_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanSnapshot" ADD CONSTRAINT "LoanSnapshot_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleVersion" ADD CONSTRAINT "ScheduleVersion_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_scheduleVersionId_fkey" FOREIGN KEY ("scheduleVersionId") REFERENCES "ScheduleVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "Installment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentClaim" ADD CONSTRAINT "PaymentClaim_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentClaim" ADD CONSTRAINT "PaymentClaim_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionCase" ADD CONSTRAINT "CollectionCase_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionCase" ADD CONSTRAINT "CollectionCase_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionCase" ADD CONSTRAINT "CollectionCase_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseLoan" ADD CONSTRAINT "CaseLoan_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CollectionCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseLoan" ADD CONSTRAINT "CaseLoan_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureSnapshot" ADD CONSTRAINT "FeatureSnapshot_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Score" ADD CONSTRAINT "Score_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Score" ADD CONSTRAINT "Score_featureSnapshotId_fkey" FOREIGN KEY ("featureSnapshotId") REFERENCES "FeatureSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Score" ADD CONSTRAINT "Score_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionSnapshot" ADD CONSTRAINT "DecisionSnapshot_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DecisionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionSnapshot" ADD CONSTRAINT "DecisionSnapshot_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionSnapshot" ADD CONSTRAINT "DecisionSnapshot_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CollectionCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionSnapshot" ADD CONSTRAINT "DecisionSnapshot_scoreId_fkey" FOREIGN KEY ("scoreId") REFERENCES "Score"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionSnapshot" ADD CONSTRAINT "DecisionSnapshot_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionSnapshot" ADD CONSTRAINT "DecisionSnapshot_strategyVersionId_fkey" FOREIGN KEY ("strategyVersionId") REFERENCES "StrategyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionSnapshot" ADD CONSTRAINT "DecisionSnapshot_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "ContactPolicyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CollectionCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_claimedByUserId_fkey" FOREIGN KEY ("claimedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_decisionSnapshotId_fkey" FOREIGN KEY ("decisionSnapshotId") REFERENCES "DecisionSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingReservation" ADD CONSTRAINT "RoutingReservation_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingReservation" ADD CONSTRAINT "RoutingReservation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingReservation" ADD CONSTRAINT "RoutingReservation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CollectionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingReservation" ADD CONSTRAINT "RoutingReservation_agentUserId_fkey" FOREIGN KEY ("agentUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingReservation" ADD CONSTRAINT "RoutingReservation_agentSessionId_fkey" FOREIGN KEY ("agentSessionId") REFERENCES "AgentSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingReservation" ADD CONSTRAINT "RoutingReservation_contactPointId_fkey" FOREIGN KEY ("contactPointId") REFERENCES "ContactPoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingReservation" ADD CONSTRAINT "RoutingReservation_decisionSnapshotId_fkey" FOREIGN KEY ("decisionSnapshotId") REFERENCES "DecisionSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSession" ADD CONSTRAINT "AgentSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DialAttempt" ADD CONSTRAINT "DialAttempt_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "RoutingReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DialAttempt" ADD CONSTRAINT "DialAttempt_contactPointId_fkey" FOREIGN KEY ("contactPointId") REFERENCES "ContactPoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CollectionCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "RoutingReservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_dialAttemptId_fkey" FOREIGN KEY ("dialAttemptId") REFERENCES "DialAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_agentUserId_fkey" FOREIGN KEY ("agentUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_contactPointId_fkey" FOREIGN KEY ("contactPointId") REFERENCES "ContactPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InteractionSegment" ADD CONSTRAINT "InteractionSegment_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "Interaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutcomeCorrection" ADD CONSTRAINT "OutcomeCorrection_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "Interaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promise" ADD CONSTRAINT "Promise_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promise" ADD CONSTRAINT "Promise_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CollectionCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promise" ADD CONSTRAINT "Promise_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "Interaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promise" ADD CONSTRAINT "Promise_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromisePaymentLink" ADD CONSTRAINT "PromisePaymentLink_promiseId_fkey" FOREIGN KEY ("promiseId") REFERENCES "Promise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromisePaymentLink" ADD CONSTRAINT "PromisePaymentLink_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromiseEvent" ADD CONSTRAINT "PromiseEvent_promiseId_fkey" FOREIGN KEY ("promiseId") REFERENCES "Promise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CollectionCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Arrangement" ADD CONSTRAINT "Arrangement_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Arrangement" ADD CONSTRAINT "Arrangement_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CollectionCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Arrangement" ADD CONSTRAINT "Arrangement_supportCaseId_fkey" FOREIGN KEY ("supportCaseId") REFERENCES "SupportCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_makerUserId_fkey" FOREIGN KEY ("makerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_checkerUserId_fkey" FOREIGN KEY ("checkerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverPacket" ADD CONSTRAINT "HandoverPacket_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CollectionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_strategyVersionId_fkey" FOREIGN KEY ("strategyVersionId") REFERENCES "StrategyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_contactPointId_fkey" FOREIGN KEY ("contactPointId") REFERENCES "ContactPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataIssue" ADD CONSTRAINT "DataIssue_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionCase" ADD CONSTRAINT "ExceptionCase_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionCase" ADD CONSTRAINT "ExceptionCase_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CollectionCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionCase" ADD CONSTRAINT "ExceptionCase_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionCase" ADD CONSTRAINT "ExceptionCase_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionCase" ADD CONSTRAINT "ExceptionCase_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentAssignment" ADD CONSTRAINT "ExperimentAssignment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ------------------------------------------------------------------
-- Hand-written constraints beyond the Prisma schema language
-- ------------------------------------------------------------------

-- One open collection case per customer (CURED/CLOSED episodes remain as history).
CREATE UNIQUE INDEX "CollectionCase_one_open_per_customer"
  ON "CollectionCase" ("customerId")
  WHERE "status" IN ('OPEN', 'HANDOVER');

-- One active work item per unique action key (customer + type) while it is still actionable.
CREATE UNIQUE INDEX "WorkItem_activeKey_unique"
  ON "WorkItem" ("activeKey")
  WHERE "activeKey" IS NOT NULL
    AND "status" IN ('QUEUED', 'ELIGIBLE', 'DEFERRED', 'CLAIMED', 'IN_PROGRESS');

-- One active outbound voice reservation per customer across all campaigns.
CREATE UNIQUE INDEX "RoutingReservation_one_active_per_customer"
  ON "RoutingReservation" ("customerId")
  WHERE "status" IN ('PENDING', 'AUTHORIZED', 'DIALING', 'CONNECTED', 'WRAP_UP');

-- One active voice reservation per agent.
CREATE UNIQUE INDEX "RoutingReservation_one_active_per_agent"
  ON "RoutingReservation" ("agentUserId")
  WHERE "status" IN ('PENDING', 'AUTHORIZED', 'DIALING', 'CONNECTED', 'WRAP_UP');

-- One active agent session per user.
CREATE UNIQUE INDEX "AgentSession_one_active_per_user"
  ON "AgentSession" ("userId")
  WHERE "isActive" = true;

-- One active promise per customer per covered scope is enforced in the service layer (array scopes);
-- this index keeps the common single-scope case cheap to check.
CREATE INDEX "Promise_active_by_customer" ON "Promise" ("customerId") WHERE "status" IN ('ACTIVE', 'PENDING_RECONCILIATION', 'PARTIALLY_PAID');

-- Audit events are append-only through ordinary application permissions.
CREATE OR REPLACE FUNCTION audit_event_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent rows are append-only (attempted %)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditEvent_append_only"
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_event_append_only();
