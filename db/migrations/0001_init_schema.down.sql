-- Reverts 0001_init_schema.up.sql. DESTRUCTIVE: drops all data.
BEGIN;

DROP VIEW  IF EXISTS athlete_season_stats;

DROP TABLE IF EXISTS roster_spots;
DROP TABLE IF EXISTS fantasy_teams;
DROP TABLE IF EXISTS leagues;
DROP TABLE IF EXISTS game_stat_fantasy_points;
DROP TABLE IF EXISTS competitions;
DROP TABLE IF EXISTS user_athlete_declarations;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS terms_versions;
DROP TABLE IF EXISTS game_stats;
DROP TABLE IF EXISTS games;
DROP TABLE IF EXISTS athlete_source_ids;
DROP TABLE IF EXISTS athletes;
DROP TABLE IF EXISTS team_seasons;
DROP TABLE IF EXISTS sports;
DROP TABLE IF EXISTS university_aliases;
DROP TABLE IF EXISTS universities;

DROP FUNCTION IF EXISTS roster_spots_before_write();
DROP FUNCTION IF EXISTS user_athlete_declarations_before_write();
DROP FUNCTION IF EXISTS fantasy_teams_before_write();
DROP FUNCTION IF EXISTS leagues_before_write();
DROP FUNCTION IF EXISTS league_sport_id(BIGINT);
DROP FUNCTION IF EXISTS assert_user_may_play_sport(BIGINT, SMALLINT);
DROP FUNCTION IF EXISTS fantasy_score(JSONB, JSONB);
DROP FUNCTION IF EXISTS scoring_weights(JSONB);
DROP FUNCTION IF EXISTS jsonb_is_scoring_rules(JSONB);
DROP FUNCTION IF EXISTS jsonb_numeric_sum(JSONB);
DROP FUNCTION IF EXISTS jsonb_is_count_map(JSONB);
DROP FUNCTION IF EXISTS jsonb_is_number_map(JSONB);
DROP FUNCTION IF EXISTS usports_current_season(DATE);
DROP FUNCTION IF EXISTS set_updated_at();

DROP TYPE IF EXISTS athlete_declaration_source;
DROP TYPE IF EXISTS roster_slot_type;
DROP TYPE IF EXISTS league_status;
DROP TYPE IF EXISTS game_status;
DROP TYPE IF EXISTS athlete_source_id_type;
DROP TYPE IF EXISTS athlete_status;
DROP TYPE IF EXISTS conference_code;
DROP TYPE IF EXISTS sport_gender;

COMMIT;
