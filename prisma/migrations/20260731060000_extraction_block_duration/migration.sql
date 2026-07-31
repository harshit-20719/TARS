-- How long one block took, across every attempt it was given.
--
-- The run record already says what a block did and why it failed, but not how
-- long it spent doing it — and on the failure that matters most those are the
-- same row. A block cut off on its time bound and a block that finished just
-- inside it are one step apart, and which of the two is happening decides
-- whether the fix is more time per block or less work in one. Without this
-- every answer to that is inferred from a status code.
--
-- Additive and nullable: rows written before this column existed have no
-- honest value to backfill, and a null reads as "not measured" rather than as
-- an instant run.

-- AlterTable
ALTER TABLE "ExtractionBlockRun" ADD COLUMN     "durationMs" INTEGER;
