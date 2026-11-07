-- Reverts 0006_stats_sources.up.sql.
BEGIN;
DROP TABLE IF EXISTS raw_source_responses;
ALTER TABLE game_stats DROP COLUMN IF EXISTS position;
COMMIT;
