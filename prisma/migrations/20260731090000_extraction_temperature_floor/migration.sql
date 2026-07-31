-- Lift the temperature floor off zero.
--
-- Zero is greedy decoding, and greedy decoding cannot leave a repetition loop.
-- With constrained decoding against an array schema that is what made a block
-- generate filings until its forty-second bound cut it off and nothing was
-- written — six blocks landing within four hundred milliseconds of each other,
-- run after run.
--
-- Nobody chose zero. It was the column default, and it was also what the config
-- read synthesized for a rubric with no row, so every untuned run sent it while
-- the adapter's own non-greedy default sat unreachable behind a `??` that a 0
-- never triggers. A stored 0 is that same non-choice written down.
--
-- So the default moves, and the rows already holding the old default move with
-- it. A row an admin genuinely tuned to something else is untouched. The
-- adapter clamps to a floor as well, so this migration is what makes the admin
-- page agree with the model rather than what makes the model safe.

-- AlterTable
ALTER TABLE "RubricExtractionConfig" ALTER COLUMN "temperature" SET DEFAULT 0.2;

-- Lift only the rows still carrying the old default.
UPDATE "RubricExtractionConfig" SET "temperature" = 0.2 WHERE "temperature" = 0;
