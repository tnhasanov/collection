-- AlterTable
ALTER TABLE "ImportBatch" ADD COLUMN     "payloadJson" JSONB;

-- AlterTable
ALTER TABLE "StrategyVersion" ADD COLUMN     "simulatedAt" TIMESTAMP(3),
ADD COLUMN     "simulationJson" JSONB;
