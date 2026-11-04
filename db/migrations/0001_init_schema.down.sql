-- Reverts 0001_init_schema.up.sql. DESTRUCTIVE: drops all data.
BEGIN;

DROP VIEW  IF EXISTS athlete_season_stats;

DROP TABLE IF EXISTS roster_spots;
DROP TABLE IF EXISTS fantasy_teams;
DROP TABLE IF EXISTS leagues;
DROP TABLE IF EXISTS game_stat_fantasy_points;
DROP TABLE IF EXISTS competitions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS game_stats;
DROP TABLE IF EXISTS games;
DROP TABLE IF EXISTS athletes;
DROP TABLE IF EXISTS sports;
DROP TABLE IF EXISTS universities;

DROP FUNCTION IF EXISTS enforce_roster_sport_match();
DROP FUNCTION IF EXISTS enforce_league_capacity();
DROP FUNCTION IF EXISTS set_updated_at();

DROP TYPE IF EXISTS roster_slot_type;
DROP TYPE IF EXISTS league_status;
DROP TYPE IF EXISTS game_status;
DROP TYPE IF EXISTS athlete_status;
DROP TYPE IF EXISTS conference_code;
DROP TYPE IF EXISTS sport_gender;

COMMIT;
