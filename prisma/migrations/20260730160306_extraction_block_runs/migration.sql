-- The per-block run record (KTD16): what one extraction run did to one
-- macro-dimension block of one call, durable across a refresh. Until now the
-- only trace of a run was Call."extracted" — one boolean — and the failure list
-- lived in a React useState, so a partial run stopped being legible the moment
-- the page reloaded (R24). "extracted" stays and is derived from the run's
-- failures, so nothing that reads it breaks.
--
-- Additive only: a new enum, a new table, and one nullable column on Call.

-- CreateEnum
CREATE TYPE "ExtractionOutcome" AS ENUM ('read', 'failed-retryable', 'failed-terminal');

-- "extractionClaimedAt" is U7's lease column (KTD17), folded in here so the
-- plan carries one migration rather than two. The claim/release logic ships in
-- the same change: a conditional update claims the call before the fan-out and
-- a finally releases it, with a 60s takeover expiry.

-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "extractionClaimedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ExtractionBlockRun" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "rubricKey" TEXT NOT NULL,
    "outcome" "ExtractionOutcome" NOT NULL,
    "reason" TEXT,
    "droppedQuotes" INTEGER NOT NULL DEFAULT 0,
    "droppedClaims" INTEGER NOT NULL DEFAULT 0,
    "mergedSpans" INTEGER NOT NULL DEFAULT 0,
    "configVersion" INTEGER,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractionBlockRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExtractionBlockRun_callId_idx" ON "ExtractionBlockRun"("callId");

-- One row per block per call, not one per run: a re-run REPLACES the rows for
-- the blocks it attempted and leaves the other blocks' rows standing — the same
-- scoping the re-extract's observation delete uses, so the record and the
-- evidence move together. History is not kept; the question this table answers
-- is "where does this call stand now", per block.

-- CreateIndex
CREATE UNIQUE INDEX "ExtractionBlockRun_callId_rubricKey_key" ON "ExtractionBlockRun"("callId", "rubricKey");

-- AddForeignKey
ALTER TABLE "ExtractionBlockRun" ADD CONSTRAINT "ExtractionBlockRun_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;
