-- Per-rubric extraction tuning (KTD13–KTD15): six personas, six guidance notes,
-- six temperatures, one row per rubric — and an absent row is the default shape,
-- because production runs migrations and never the seed. The observation gains a
-- nullable configVersion stamp mirroring the score's rubricVersion, so a later
-- tuning edit stays traceable to the text that drafted a row.
--
-- Additive only: a new table and one nullable column on Observation.

-- AlterTable
ALTER TABLE "Observation" ADD COLUMN     "configVersion" INTEGER;

-- CreateTable
CREATE TABLE "RubricExtractionConfig" (
    "id" TEXT NOT NULL,
    "rubricKey" TEXT NOT NULL,
    "persona" TEXT NOT NULL DEFAULT '',
    "guidance" TEXT NOT NULL DEFAULT '',
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RubricExtractionConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RubricExtractionConfig_rubricKey_key" ON "RubricExtractionConfig"("rubricKey");

-- CreateIndex
CREATE INDEX "RubricExtractionConfig_updatedById_idx" ON "RubricExtractionConfig"("updatedById");

-- AddForeignKey
ALTER TABLE "RubricExtractionConfig" ADD CONSTRAINT "RubricExtractionConfig_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Domain integrity Prisma cannot express in the schema language.

-- The cap is absolute: above 0.4 the verbatim guard's drop rate rises — raising temperature buys silence.
ALTER TABLE "RubricExtractionConfig"
  ADD CONSTRAINT "rubric_extraction_config_temperature_range" CHECK (
    "temperature" >= 0 AND "temperature" <= 0.4
  );
