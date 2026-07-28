-- CreateEnum
CREATE TYPE "MappingConfidence" AS ENUM ('high', 'low');

-- AlterTable
ALTER TABLE "Observation" ADD COLUMN     "confidence" "MappingConfidence",
ADD COLUMN     "mappingNote" TEXT;

-- AlterTable
ALTER TABLE "Slide" ADD COLUMN     "guardConfirmed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SubDimensionScore" ADD COLUMN     "flagNote" TEXT;
