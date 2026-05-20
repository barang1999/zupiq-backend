-- Adds optional dislike reasons to breakdown_feedback.
-- reasons is a JSONB array of short strings (e.g. ["Wrong answer", "Unclear steps"]).
-- NULL means the user did not select any reason (positive signal or skipped the reasons panel).

ALTER TABLE breakdown_feedback
  ADD COLUMN IF NOT EXISTS reasons JSONB;
