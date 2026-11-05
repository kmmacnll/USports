-- =============================================================================
-- 0002_multi_sport.up.sql
-- Multi-sport metadata and naming for every U Sports discipline.
--
--   * sports.season_type (FALL / WINTER / SPRING)
--   * game_stats.raw_stats_json -> stat_payload_json (the per-sport JSONB stat
--     line; same data, clearer name). athletes, game_stats and roster_spots
--     carry no sport-specific columns.
--   * '*' wildcard in a ruleset's position_eligibility: a starter slot that
--     any athlete of the sport may fill (for sports with no published positions).
--
-- Safe on a live database: one transaction; the rename is metadata-only.
-- =============================================================================

BEGIN;

CREATE TYPE season_type AS ENUM ('FALL', 'WINTER', 'SPRING');

ALTER TABLE sports ADD COLUMN season_type season_type NOT NULL DEFAULT 'WINTER';
UPDATE sports SET season_type = 'FALL'
 WHERE code IN ('usports_fb', 'usports_msoc', 'usports_wsoc', 'usports_wfh', 'usports_wrug',
                'usports_mxc', 'usports_wxc');
CREATE INDEX sports_season_type_idx ON sports (season_type) WHERE is_active;

-- Rename the stat payload column (the view depends on it, so rebuild the view).
DROP VIEW athlete_season_stats;
ALTER TABLE game_stats RENAME COLUMN raw_stats_json TO stat_payload_json;
ALTER TABLE game_stats RENAME CONSTRAINT game_stats_raw_is_object TO game_stats_payload_is_object;
COMMENT ON COLUMN game_stats.stat_payload_json IS
  'Sport-specific stat line, canonical keys per sport (points/rebounds, goals/saves, kills/digs, passing_yards, ...). Scored by fantasy_score().';

-- Per-athlete season totals and per-game averages for every numeric stat key,
-- excluding exhibitions.
CREATE VIEW athlete_season_stats AS
WITH lines AS (
  SELECT gs.athlete_id, g.season, gs.stat_payload_json, gs.fantasy_points_calculated
    FROM game_stats gs
    JOIN games g ON g.id = gs.game_id
   WHERE NOT g.is_exhibition
),
totals AS (
  SELECT l.athlete_id, l.season, kv.key, sum(kv.value::text::numeric) AS total
    FROM lines l
    CROSS JOIN LATERAL jsonb_each(l.stat_payload_json) kv
   WHERE jsonb_typeof(kv.value) = 'number'
   GROUP BY l.athlete_id, l.season, kv.key
),
games_played AS (
  SELECT athlete_id, season, count(*) AS games_played,
         coalesce(sum(fantasy_points_calculated), 0)::numeric(10,2) AS fantasy_points_total
    FROM lines GROUP BY athlete_id, season
)
SELECT gp.athlete_id,
       gp.season,
       gp.games_played,
       gp.fantasy_points_total,
       round(gp.fantasy_points_total / gp.games_played, 2) AS fantasy_points_avg,
       coalesce(jsonb_object_agg(t.key, t.total) FILTER (WHERE t.key IS NOT NULL), '{}'::jsonb) AS stat_totals,
       coalesce(jsonb_object_agg(t.key, round(t.total / gp.games_played, 1)) FILTER (WHERE t.key IS NOT NULL), '{}'::jsonb) AS stat_averages
  FROM games_played gp
  LEFT JOIN totals t ON t.athlete_id = gp.athlete_id AND t.season = gp.season
 GROUP BY gp.athlete_id, gp.season, gp.games_played, gp.fantasy_points_total;

CREATE OR REPLACE FUNCTION roster_spots_before_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_league_sport   SMALLINT;
  v_limits         JSONB;
  v_eligibility    JSONB;
  v_athlete_sport  SMALLINT;
  v_positions      TEXT[];
  v_allowed        TEXT[];
BEGIN
  SELECT c.sport_id, l.roster_limits_json, c.roster_config_json -> 'position_eligibility'
    INTO v_league_sport, v_limits, v_eligibility
    FROM leagues l JOIN competitions c ON c.id = l.competition_id
   WHERE l.id = NEW.league_id;

  SELECT sport_id, positions INTO v_athlete_sport, v_positions FROM athletes WHERE id = NEW.athlete_id;

  -- The rostered athlete must play the league's sport.
  IF v_league_sport IS DISTINCT FROM v_athlete_sport THEN
    RAISE EXCEPTION 'athlete % plays a different sport than league %', NEW.athlete_id, NEW.league_id
      USING ERRCODE = 'check_violation', HINT = 'WRONG_SPORT';
  END IF;

  IF NOT v_limits ? NEW.position_assigned
     OR NEW.slot_index > (v_limits ->> NEW.position_assigned)::int THEN
    RAISE EXCEPTION 'slot %#% does not exist in league % roster %', NEW.position_assigned, NEW.slot_index,
      NEW.league_id, v_limits
      USING ERRCODE = 'check_violation', HINT = 'INVALID_SLOT';
  END IF;

  IF NEW.position_assigned NOT IN ('BENCH', 'IR') THEN
    v_allowed := coalesce(
      ARRAY(SELECT jsonb_array_elements_text(v_eligibility -> NEW.position_assigned)), '{}');
    IF NOT NEW.position_assigned = ANY (v_allowed) THEN
      v_allowed := v_allowed || NEW.position_assigned;
    END IF;
    -- '*' in a slot's eligibility list means any athlete of the sport
    -- (sports whose feeds publish no positions, e.g. volleyball).
    IF NOT ('*' = ANY (v_allowed) OR v_positions && v_allowed) THEN
      RAISE EXCEPTION 'athlete % (positions %) is not eligible for slot % (needs one of %)',
        NEW.athlete_id, v_positions, NEW.position_assigned, v_allowed
        USING ERRCODE = 'check_violation', HINT = 'INELIGIBLE_POSITION';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
