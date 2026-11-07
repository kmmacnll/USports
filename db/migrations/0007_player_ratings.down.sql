-- Reverts 0007_player_ratings.up.sql.
BEGIN;
DROP TABLE IF EXISTS player_rating_history;
DROP TABLE IF EXISTS player_ratings;
DROP TABLE IF EXISTS rating_runs;
COMMIT;
