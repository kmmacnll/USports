-- Smoke test for schema invariants. Runs in a transaction and rolls back.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/schema_smoke_test.sql
-- Requires migrations + seeds. Exits non-zero on the first failed assertion.
BEGIN;

INSERT INTO universities (name, short_name, slug, conference) VALUES
  ('University of British Columbia', 'UBC', 'ubc', 'CW'),
  ('Carleton University', 'Carleton', 'carleton', 'OUA');

INSERT INTO athletes (usports_id, first_name, last_name, university_id, sport_id, position, jersey_number)
SELECT 'p1', 'Alex', 'Guard', u.id, s.id, 'G', '3'  FROM universities u, sports s WHERE u.slug='ubc'      AND s.code='MBB'
UNION ALL
SELECT 'p2', 'Sam',  'Wing',  u.id, s.id, 'F', '00' FROM universities u, sports s WHERE u.slug='carleton' AND s.code='MBB'
UNION ALL
SELECT 'h1', 'Jo',   'Skate', u.id, s.id, 'D', '4'  FROM universities u, sports s WHERE u.slug='ubc'      AND s.code='WIH';

-- Upsert: re-ingesting the same athlete updates in place.
INSERT INTO athletes (usports_id, first_name, last_name, university_id, sport_id, position)
SELECT 'p1', 'Alex', 'Guard', u.id, s.id, 'G/F' FROM universities u, sports s WHERE u.slug='ubc' AND s.code='MBB'
ON CONFLICT (sport_id, usports_id) DO UPDATE SET position = EXCLUDED.position;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM athletes WHERE usports_id='p1') = 1, 'athlete upsert duplicated';
  ASSERT (SELECT position FROM athletes WHERE usports_id='p1') = 'G/F', 'athlete upsert did not update';
END $$;

-- Game + stats upsert, season view.
INSERT INTO games (sport_id, source_game_id, season, game_date, home_university_id, away_university_id, status)
SELECT s.id, 'g1', '2025-26', '2025-11-07', h.id, a.id, 'FINAL'
FROM sports s, universities h, universities a WHERE s.code='MBB' AND h.slug='ubc' AND a.slug='carleton';

INSERT INTO game_stats (athlete_id, game_id, game_date, university_id, opponent_id, raw_stats_json, fantasy_points_calculated)
SELECT at.id, g.id, g.game_date, g.home_university_id, g.away_university_id, '{"pts":10,"reb":5}', 16
FROM athletes at, games g WHERE at.usports_id='p1' AND g.source_game_id='g1';
INSERT INTO game_stats (athlete_id, game_id, game_date, university_id, opponent_id, raw_stats_json, fantasy_points_calculated)
SELECT at.id, g.id, g.game_date, g.home_university_id, g.away_university_id, '{"pts":20,"reb":5,"min":"31:10"}', 26
FROM athletes at, games g WHERE at.usports_id='p1' AND g.source_game_id='g1'
ON CONFLICT (athlete_id, game_id) DO UPDATE
  SET raw_stats_json = EXCLUDED.raw_stats_json, fantasy_points_calculated = EXCLUDED.fantasy_points_calculated;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM game_stats) = 1, 'game_stats upsert duplicated';
  ASSERT (SELECT stat_totals->>'pts' FROM athlete_season_stats) = '20', 'season view totals wrong';
  ASSERT (SELECT stat_totals ? 'min' FROM athlete_season_stats) = FALSE, 'season view summed a non-numeric stat';
END $$;

-- League + team.
INSERT INTO users (auth_subject, display_name) VALUES ('u1', 'Commish'), ('u2', 'Rival'), ('u3', 'Late');
INSERT INTO leagues (competition_id, commissioner_id, name, max_teams)
SELECT c.id, u.id, 'Test League', 2
FROM competitions c JOIN sports s ON s.id=c.sport_id, users u
WHERE s.code='MBB' AND c.is_default AND u.auth_subject='u1';
INSERT INTO fantasy_teams (league_id, user_id, team_name)
SELECT l.id, u.id, 'Team ' || u.auth_subject FROM leagues l, users u WHERE u.auth_subject IN ('u1','u2');

-- Capacity trigger.
DO $$ BEGIN
  BEGIN
    INSERT INTO fantasy_teams (league_id, user_id, team_name)
    SELECT l.id, u.id, 'Overflow' FROM leagues l, users u WHERE u.auth_subject='u3';
    RAISE EXCEPTION 'FAIL: league capacity not enforced';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- Roster: starter + bench.
INSERT INTO roster_spots (fantasy_team_id, league_id, athlete_id, slot_type, position_assigned, slot_index)
SELECT t.id, t.league_id, a.id, 'STARTER', 'G', 1 FROM fantasy_teams t, athletes a WHERE t.team_name='Team u1' AND a.usports_id='p1';
INSERT INTO roster_spots (fantasy_team_id, league_id, athlete_id, slot_type, position_assigned, slot_index)
SELECT t.id, t.league_id, a.id, 'BENCH', 'BN', 1 FROM fantasy_teams t, athletes a WHERE t.team_name='Team u1' AND a.usports_id='p2';

-- Same athlete cannot be on two teams in a league.
DO $$ BEGIN
  BEGIN
    INSERT INTO roster_spots (fantasy_team_id, league_id, athlete_id, position_assigned)
    SELECT t.id, t.league_id, a.id, 'BN' FROM fantasy_teams t, athletes a WHERE t.team_name='Team u2' AND a.usports_id='p1';
    RAISE EXCEPTION 'FAIL: athlete rostered twice in one league';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

-- Wrong sport rejected.
DO $$ BEGIN
  BEGIN
    INSERT INTO roster_spots (fantasy_team_id, league_id, athlete_id, position_assigned)
    SELECT t.id, t.league_id, a.id, 'BN' FROM fantasy_teams t, athletes a WHERE t.team_name='Team u2' AND a.usports_id='h1';
    RAISE EXCEPTION 'FAIL: hockey player rostered in basketball league';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- Team/league mismatch rejected by composite FK (second league, same sport).
INSERT INTO leagues (competition_id, commissioner_id, name)
SELECT competition_id, commissioner_id, 'Other League' FROM leagues WHERE name='Test League';
DO $$ BEGIN
  BEGIN
    INSERT INTO roster_spots (fantasy_team_id, league_id, athlete_id, position_assigned)
    SELECT t.id, (SELECT id FROM leagues WHERE name='Other League'), a.id, 'BN'
    FROM fantasy_teams t, athletes a WHERE t.team_name='Team u2' AND a.usports_id='p2';
    RAISE EXCEPTION 'FAIL: roster_spot league_id not pinned to team';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;

-- Swap starter <-> bench in one transaction via deferred slot constraint.
SET CONSTRAINTS roster_spots_slot_key DEFERRED;
UPDATE roster_spots rs
   SET slot_type = other.slot_type, position_assigned = other.position_assigned, slot_index = other.slot_index
  FROM roster_spots other
 WHERE rs.fantasy_team_id = other.fantasy_team_id AND rs.id <> other.id
   AND rs.athlete_id IN (SELECT id FROM athletes WHERE usports_id IN ('p1','p2'));
SET CONSTRAINTS roster_spots_slot_key IMMEDIATE;
DO $$ BEGIN
  ASSERT (SELECT rs.slot_type FROM roster_spots rs JOIN athletes a ON a.id=rs.athlete_id WHERE a.usports_id='p2') = 'STARTER',
    'swap failed';
END $$;

\echo 'schema smoke test: ALL PASSED'
ROLLBACK;
