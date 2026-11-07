-- Remove Terms & Conditions acceptance and the U Sports athlete-eligibility
-- rule (the "athletes can't play their own sport" clause), plus columns no
-- code reads or writes.
--
-- Season-long fantasy leagues stay: only the eligibility check is taken out of
-- their triggers. Kept on purpose although nothing reads them yet:
-- universities.logo_url / short_name (team logos) and roster_spots.acquired_at
-- (for league transactions).

-- leagues / fantasy_teams triggers without the eligibility check --------------
CREATE OR REPLACE FUNCTION leagues_before_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_config JSONB;
  v_bad    TEXT;
BEGIN
  SELECT roster_config_json INTO v_config FROM competitions WHERE id = NEW.competition_id;

  IF NEW.roster_limits_json IS NULL THEN
    NEW.roster_limits_json := v_config -> 'roster_limits';
  END IF;
  IF NEW.roster_size IS NULL THEN
    NEW.roster_size := jsonb_numeric_sum(NEW.roster_limits_json);
  END IF;

  -- Custom limits may only use slots the competition knows how to fill.
  SELECT string_agg(k, ', ') INTO v_bad
    FROM jsonb_object_keys(NEW.roster_limits_json) k
   WHERE k NOT IN ('BENCH', 'IR')
     AND NOT (v_config -> 'roster_limits') ? k
     AND NOT coalesce(v_config -> 'position_eligibility', '{}'::jsonb) ? k;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'roster slot(s) % are not defined for competition %', v_bad, NEW.competition_id
      USING ERRCODE = 'check_violation', HINT = 'INVALID_SLOT';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fantasy_teams_before_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_max   SMALLINT;
  v_count INTEGER;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.league_id <> OLD.league_id THEN
    SELECT max_teams INTO v_max FROM leagues WHERE id = NEW.league_id FOR UPDATE;
    SELECT count(*)  INTO v_count FROM fantasy_teams WHERE league_id = NEW.league_id;
    IF v_count >= v_max THEN
      RAISE EXCEPTION 'league % is full (max_teams = %)', NEW.league_id, v_max
        USING ERRCODE = 'check_violation', HINT = 'LEAGUE_FULL';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- terms + athlete declarations -------------------------------------------------
DROP TABLE user_athlete_declarations;                      -- drops its trigger too
DROP FUNCTION user_athlete_declarations_before_write();
DROP FUNCTION assert_user_may_play_sport(BIGINT, SMALLINT);
DROP FUNCTION league_sport_id(BIGINT);
DROP TYPE athlete_declaration_source;

ALTER TABLE users
  DROP CONSTRAINT users_terms_answers_athlete,
  DROP CONSTRAINT users_terms_pair,
  DROP COLUMN terms_version_accepted,
  DROP COLUMN terms_accepted_at,
  DROP COLUMN is_usports_athlete;
DROP TABLE terms_versions;

-- never written or read ------------------------------------------------------
ALTER TABLE games DROP COLUMN start_time;
ALTER TABLE competitions DROP CONSTRAINT competitions_dates, DROP COLUMN starts_on, DROP COLUMN ends_on;
ALTER TABLE athlete_source_ids DROP COLUMN first_seen_at;
