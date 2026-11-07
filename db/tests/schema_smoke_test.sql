-- Smoke test for schema invariants. Uses synthetic rows inside a transaction
-- and rolls back, so it is safe against a database that already holds real
-- ingested data.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/schema_smoke_test.sql
-- Requires migrations + seeds. Exits non-zero on the first failed assertion.
\o /dev/null
BEGIN;

-- Helper: assert that a statement fails with a given SQLSTATE (and HINT, if given).
CREATE FUNCTION pg_temp.expect_error(sql TEXT, state TEXT, hint TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE v_state TEXT; v_hint TEXT;
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_hint = PG_EXCEPTION_HINT;
    IF v_state <> state OR (hint IS NOT NULL AND v_hint IS DISTINCT FROM hint) THEN
      RAISE EXCEPTION 'FAIL: expected % / % but got % / % for: %', state, hint, v_state, v_hint, sql;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: expected % (%) but statement succeeded: %', state, hint, sql;
END $$;

-- ---------------------------------------------------------------- scoring
DO $$ BEGIN
  ASSERT fantasy_score('{"points":20,"rebounds":5,"assists":4,"steals":1,"blocks":2,"turnovers":3,"minutes":"31:10"}',
                       (SELECT scoring_rules_json FROM competitions c JOIN sports s ON s.id = c.sport_id
                         WHERE s.code = 'usports_mbk' AND c.is_default)) = 38.00,
    'MBK default scoring wrong: expected 20 + 6 + 6 + 3 + 6 - 3 = 38';
END $$;

-- ---------------------------------------------------------------- real-world data
INSERT INTO universities (name, slug, conference, is_usports_member) VALUES
  ('Test U A', 'zz-test-a', 'OUA', TRUE), ('Test U B', 'zz-test-b', 'CW', TRUE);

INSERT INTO athletes (first_name, last_name, university_id, sport_id, position, positions)
SELECT v.f, v.l, u.id, s.id, v.pos, v.toks
  FROM (VALUES ('Pat',  'Point',  'zz-test-a', 'usports_mbk', 'G', '{G}'::text[]),
               ('Cam',  'Centre', 'zz-test-a', 'usports_mbk', 'C', '{C}'),
               ('Nopo', 'Sition', 'zz-test-b', 'usports_mbk', NULL, '{}'),
               ('Quinn','Back',   'zz-test-b', 'usports_fb',  'QB', '{QB}')) v(f, l, uslug, scode, pos, toks)
  JOIN universities u ON u.slug = v.uslug
  JOIN sports s ON s.code = v.scode;

-- Identity keys are unique per sport.
INSERT INTO athlete_source_ids (sport_id, id_type, id_value, athlete_id)
SELECT sport_id, 'name_key', 'zz|pat point', id FROM athletes WHERE last_name = 'Point';
SELECT pg_temp.expect_error($q$
  INSERT INTO athlete_source_ids (sport_id, id_type, id_value, athlete_id)
  SELECT sport_id, 'name_key', 'zz|pat point', id FROM athletes WHERE last_name = 'Centre'$q$, '23505');

-- Game + stat line upsert, season view.
INSERT INTO games (sport_id, source_game_id, season, season_segment, game_date,
                   home_university_id, away_university_id, status)
SELECT s.id, 'zz-g1', '2026-27', '2026-27', '2026-11-07', a.id, b.id, 'FINAL'
  FROM sports s, universities a, universities b
 WHERE s.code = 'usports_mbk' AND a.slug = 'zz-test-a' AND b.slug = 'zz-test-b';

INSERT INTO game_stats (athlete_id, game_id, game_date, university_id, opponent_id, stat_payload_json)
SELECT at.id, g.id, g.game_date, g.home_university_id, g.away_university_id, '{"points":10}'
  FROM athletes at, games g WHERE at.last_name = 'Point' AND g.source_game_id = 'zz-g1';
INSERT INTO game_stats (athlete_id, game_id, game_date, university_id, opponent_id, stat_payload_json)
SELECT at.id, g.id, g.game_date, g.home_university_id, g.away_university_id, '{"points":20,"rebounds":5}'
  FROM athletes at, games g WHERE at.last_name = 'Point' AND g.source_game_id = 'zz-g1'
ON CONFLICT (athlete_id, game_id) DO UPDATE SET stat_payload_json = EXCLUDED.stat_payload_json;
UPDATE game_stats SET fantasy_points_calculated = fantasy_score(stat_payload_json, '{"points":1,"rebounds":1.2}')
 WHERE athlete_id = (SELECT id FROM athletes WHERE last_name = 'Point');
REFRESH MATERIALIZED VIEW athlete_season_stats;  -- the pipeline does this after each sync
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM game_stats gs JOIN athletes a ON a.id = gs.athlete_id WHERE a.last_name = 'Point') = 1,
    'game_stats upsert duplicated';
  ASSERT (SELECT stat_averages->>'points' FROM athlete_season_stats s JOIN athletes a ON a.id = s.athlete_id
           WHERE a.last_name = 'Point') = '20.0', 'season view averages wrong';
  ASSERT (SELECT fantasy_points_avg FROM athlete_season_stats s JOIN athletes a ON a.id = s.athlete_id
           WHERE a.last_name = 'Point') = 26.00, 'season view fantasy avg wrong';
END $$;

-- ---------------------------------------------------------------- users
INSERT INTO users (auth_subject, display_name) VALUES
  ('zz-commish', 'Commish'), ('zz-rival', 'Rival'), ('zz-late', 'Late'),
  ('zz-mbk-athlete', 'Hooper'), ('zz-no-terms', 'Skipper');

-- ---------------------------------------------------------------- leagues
-- Defaults: roster limits + size copied from the competition.
INSERT INTO leagues (competition_id, commissioner_id, name, max_teams)
SELECT c.id, u.id, 'ZZ Hoops', 2
  FROM competitions c JOIN sports s ON s.id = c.sport_id, users u
 WHERE s.code = 'usports_mbk' AND c.is_default AND u.auth_subject = 'zz-commish';
DO $$ BEGIN
  ASSERT (SELECT roster_size FROM leagues WHERE name = 'ZZ Hoops') = 11, 'roster_size not derived';
  ASSERT (SELECT roster_limits_json FROM leagues WHERE name = 'ZZ Hoops')
         = '{"G":2,"F":2,"C":1,"BENCH":6}', 'roster limits not copied';
END $$;

-- Football league on the seeded Half-PPR ruleset, with the product's example limits.
DO $$ BEGIN
  -- grouped rules: 300*0.04 + 2*4 - 2 + 5 - 2 + 1 (rouge) = 22
  ASSERT fantasy_score('{"passing_yards":300,"passing_touchdown":2,"passing_interception":1,
                         "kicking_fg_50_plus":1,"misc_fumble_lost":1,"kicking_single_rouge":1}',
                       (SELECT scoring_rules_json FROM competitions WHERE code = 'usports_football_half_ppr')) = 22.00,
    'Half-PPR grouped scoring wrong';
END $$;
SELECT pg_temp.expect_error($q$
  INSERT INTO competitions (code, name, sport_id, season, roster_config_json, scoring_rules_json)
  SELECT 'zz_bad', 'Bad', id, '2026-27', '{"roster_limits":{"QB":1}}', '{"passing":{"yards":"lots"}}'
    FROM sports WHERE code = 'usports_fb'$q$, '23514');
INSERT INTO leagues (competition_id, commissioner_id, name, max_teams, roster_size, roster_limits_json)
SELECT c.id, u.id, 'Vanier Cup Chasers', 10, 15, '{"QB":2,"RB":3,"WR":4,"K":1,"DEF":1,"BENCH":4}'
  FROM competitions c, users u WHERE c.code = 'usports_football_half_ppr' AND u.auth_subject = 'zz-commish';

-- roster_size must match the limits; unknown slots are rejected.
SELECT pg_temp.expect_error($q$
  INSERT INTO leagues (competition_id, commissioner_id, name, roster_size, roster_limits_json)
  SELECT c.id, u.id, 'Bad Size', 14, '{"QB":2,"RB":3,"WR":4,"K":1,"DEF":1,"BENCH":4}'
    FROM competitions c, users u WHERE c.code = 'usports_football_half_ppr' AND u.auth_subject = 'zz-commish'$q$, '23514');
SELECT pg_temp.expect_error($q$
  INSERT INTO leagues (competition_id, commissioner_id, name, roster_limits_json)
  SELECT c.id, u.id, 'Bad Slot', '{"QB":1,"GOALIE":1}'
    FROM competitions c, users u WHERE c.code = 'usports_football_half_ppr' AND u.auth_subject = 'zz-commish'$q$, '23514');

-- No terms or athlete-eligibility step: a brand-new user can commission a
-- league in any sport, and anyone can join any league with room.
INSERT INTO leagues (competition_id, commissioner_id, name)
SELECT c.id, u.id, 'No Terms' FROM competitions c JOIN sports s ON s.id = c.sport_id, users u
 WHERE s.code = 'usports_mbk' AND c.is_default AND u.auth_subject = 'zz-no-terms';
INSERT INTO fantasy_teams (league_id, user_id, team_name)
SELECT l.id, u.id, 'Hooper Plays Football' FROM leagues l, users u
 WHERE l.name = 'Vanier Cup Chasers' AND u.auth_subject = 'zz-mbk-athlete';

-- ---------------------------------------------------------------- teams & capacity
INSERT INTO fantasy_teams (league_id, user_id, team_name)
SELECT l.id, u.id, 'Team ' || u.auth_subject FROM leagues l, users u
 WHERE l.name = 'ZZ Hoops' AND u.auth_subject IN ('zz-commish', 'zz-rival');
SELECT pg_temp.expect_error($q$
  INSERT INTO fantasy_teams (league_id, user_id, team_name)
  SELECT l.id, u.id, 'Overflow' FROM leagues l, users u
   WHERE l.name = 'ZZ Hoops' AND u.auth_subject = 'zz-late'$q$, '23514', 'LEAGUE_FULL');

-- ---------------------------------------------------------------- roster spots
CREATE TEMP VIEW t AS SELECT id, league_id, team_name FROM fantasy_teams WHERE team_name LIKE 'Team zz-%';

-- Guard in G: ok. Centre in BENCH: ok. Position-less athlete on BENCH: ok.
INSERT INTO roster_spots (fantasy_team_id, league_id, athlete_id, position_assigned)
SELECT t.id, t.league_id, a.id, 'G' FROM t, athletes a WHERE t.team_name = 'Team zz-commish' AND a.last_name = 'Point';
INSERT INTO roster_spots (fantasy_team_id, league_id, athlete_id, position_assigned)
SELECT t.id, t.league_id, a.id, 'BENCH' FROM t, athletes a WHERE t.team_name = 'Team zz-commish' AND a.last_name = 'Centre';
INSERT INTO roster_spots (fantasy_team_id, league_id, athlete_id, position_assigned)
SELECT t.id, t.league_id, a.id, 'BENCH' FROM t, athletes a WHERE t.team_name = 'Team zz-rival' AND a.last_name = 'Sition';

DO $$ BEGIN
  ASSERT (SELECT slot_type FROM roster_spots rs JOIN athletes a ON a.id = rs.athlete_id WHERE a.last_name = 'Point') = 'STARTER',
    'slot_type not derived';
END $$;

-- Same athlete twice in a league.
SELECT pg_temp.expect_error($q$
  INSERT INTO roster_spots (fantasy_team_id, league_id, athlete_id, position_assigned)
  SELECT t.id, t.league_id, a.id, 'G' FROM t, athletes a WHERE t.team_name = 'Team zz-rival' AND a.last_name = 'Point'$q$, '23505');
-- Wrong sport.
SELECT pg_temp.expect_error($q$
  INSERT INTO roster_spots (fantasy_team_id, league_id, athlete_id, position_assigned)
  SELECT t.id, t.league_id, a.id, 'BENCH' FROM t, athletes a WHERE t.team_name = 'Team zz-rival' AND a.last_name = 'Back'$q$,
  '23514', 'WRONG_SPORT');
-- Slot not in the league's roster, and slot index beyond the limit.
SELECT pg_temp.expect_error($q$
  UPDATE roster_spots SET position_assigned = 'UTIL'
   WHERE athlete_id = (SELECT id FROM athletes WHERE last_name = 'Sition')$q$, '23514', 'INVALID_SLOT');
SELECT pg_temp.expect_error($q$
  UPDATE roster_spots SET slot_index = 7
   WHERE athlete_id = (SELECT id FROM athletes WHERE last_name = 'Sition')$q$, '23514', 'INVALID_SLOT');
-- Positional eligibility: a position-less athlete can't start.
SELECT pg_temp.expect_error($q$
  UPDATE roster_spots SET position_assigned = 'F'
   WHERE athlete_id = (SELECT id FROM athletes WHERE last_name = 'Sition')$q$, '23514', 'INELIGIBLE_POSITION');

-- Team/league mismatch rejected by composite FK.
SELECT pg_temp.expect_error($q$
  INSERT INTO roster_spots (fantasy_team_id, league_id, athlete_id, position_assigned)
  SELECT t.id, (SELECT id FROM leagues WHERE name = 'Vanier Cup Chasers'), a.id, 'BENCH'
    FROM t, athletes a WHERE t.team_name = 'Team zz-rival' AND a.last_name = 'Back'$q$, '23503');

-- Swaps run with the slot constraint deferred. Swapping G <-> BENCH fails here
-- because the bench player (a C) is not G-eligible.
SET CONSTRAINTS roster_spots_slot_key DEFERRED;
SELECT pg_temp.expect_error($q$
  UPDATE roster_spots rs SET position_assigned = o.position_assigned, slot_index = o.slot_index
    FROM roster_spots o
   WHERE rs.fantasy_team_id = o.fantasy_team_id AND rs.id <> o.id
     AND rs.fantasy_team_id = (SELECT id FROM t WHERE team_name = 'Team zz-commish')$q$, '23514', 'INELIGIBLE_POSITION');
-- Valid move in one transaction: the C goes BENCH -> C, the guard goes G -> BENCH.
UPDATE roster_spots SET position_assigned = 'C'
 WHERE athlete_id = (SELECT id FROM athletes WHERE last_name = 'Centre');
UPDATE roster_spots SET position_assigned = 'BENCH'
 WHERE athlete_id = (SELECT id FROM athletes WHERE last_name = 'Point');
SET CONSTRAINTS roster_spots_slot_key IMMEDIATE;
DO $$ BEGIN
  ASSERT (SELECT position_assigned FROM roster_spots rs JOIN athletes a ON a.id = rs.athlete_id
           WHERE a.last_name = 'Centre') = 'C', 'swap failed';
END $$;

-- ---------------------------------------------------------------- multi-sport (0002)
DO $$ BEGIN
  ASSERT (SELECT season_type FROM sports WHERE code = 'usports_fb') = 'FALL', 'football should be FALL';
  ASSERT (SELECT season_type FROM sports WHERE code = 'usports_mhk') = 'WINTER', 'hockey should be WINTER';
  ASSERT NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'game_stats' AND column_name = 'raw_stats_json'), 'old column still present';
END $$;

-- '*' eligibility: a position-less volleyball athlete can start in a PLAYER slot.
INSERT INTO athletes (first_name, last_name, university_id, sport_id)
SELECT 'Vic', 'Volley', u.id, s.id FROM universities u, sports s WHERE u.slug = 'zz-test-a' AND s.code = 'usports_mvb';
INSERT INTO leagues (competition_id, commissioner_id, name)
SELECT c.id, u.id, 'ZZ Volley' FROM competitions c JOIN sports s ON s.id = c.sport_id, users u
 WHERE s.code = 'usports_mvb' AND c.is_default AND u.auth_subject = 'zz-rival';
INSERT INTO fantasy_teams (league_id, user_id, team_name)
SELECT l.id, u.id, 'ZZ Volley Team' FROM leagues l, users u WHERE l.name = 'ZZ Volley' AND u.auth_subject = 'zz-rival';
INSERT INTO roster_spots (fantasy_team_id, league_id, athlete_id, position_assigned)
SELECT t.id, t.league_id, a.id, 'PLAYER' FROM fantasy_teams t, athletes a
 WHERE t.team_name = 'ZZ Volley Team' AND a.last_name = 'Volley';
DO $$ BEGIN
  ASSERT (SELECT slot_type FROM roster_spots rs JOIN athletes a ON a.id = rs.athlete_id WHERE a.last_name = 'Volley')
         = 'STARTER', 'wildcard slot should accept a position-less athlete';
END $$;

\echo 'schema smoke test: ALL PASSED'
ROLLBACK;
