-- Clear the condition flag on any score that carries no written condition.
--
-- The previous migration added "flagNote" empty, so every score already flagged
-- ended up with flag = true and flagNote = NULL. The service now refuses that
-- combination ("say what the condition is, in one line"), and the capture control
-- resends the flag on every score press — so those rows became impossible to
-- re-score at all until the PM wrote a condition they may not even remember.
--
-- Clearing the flag is the honest repair rather than inventing a note: an
-- unwritten condition was never actionable, and the PM can re-tick the box and
-- write one. No score value is touched.
UPDATE "SubDimensionScore"
SET flag = false
WHERE flag = true AND ("flagNote" IS NULL OR btrim("flagNote") = '');
