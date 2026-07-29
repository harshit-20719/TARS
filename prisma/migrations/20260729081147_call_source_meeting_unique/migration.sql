-- Make "one meeting, once per deal" a constraint rather than a convention.
--
-- The import path already refuses a meeting the deal holds, but it refuses it
-- from a read — and between that read and the insert it fetches a transcript
-- across the network. Two PMs importing the same meeting onto the same deal in
-- that window are each told it is absent, and both write it. The parallel rule
-- on call numbers has had a unique index behind it since the first migration;
-- this one had only the code.
--
-- Safe to add without a reconciliation step: "sourceMeetingId" was introduced by
-- the immediately preceding migration, so no row can yet hold a non-null value
-- and there is no duplicate data to repair first. That is the whole reason for
-- doing it now rather than later.
--
-- Postgres treats NULLs as distinct, so the many pasted calls on a deal — every
-- call before importing existed — are unaffected, and the same meeting stays
-- importable onto a *different* deal. Both are the behaviour R25 asks for.

-- DropIndex
DROP INDEX "Call_dealId_sourceMeetingId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Call_dealId_sourceMeetingId_key" ON "Call"("dealId", "sourceMeetingId");
