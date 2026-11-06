-- Reverts 0010_ladder.up.sql.
BEGIN;
DROP TABLE IF EXISTS ladder_resets;
DROP TABLE IF EXISTS ladder_memberships;
DROP TABLE IF EXISTS ladder_cohorts;
ALTER TABLE battles DROP COLUMN IF EXISTS elo_a_before, DROP COLUMN IF EXISTS elo_a_after,
  DROP COLUMN IF EXISTS elo_b_before, DROP COLUMN IF EXISTS elo_b_after;
COMMIT;
