-- Restores the schema from before 0011. Dropped data (terms acceptances,
-- athlete declarations) is not recoverable; columns come back empty/defaulted.

ALTER TABLE athlete_source_ids ADD COLUMN first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE competitions ADD COLUMN starts_on DATE, ADD COLUMN ends_on DATE,
  ADD CONSTRAINT competitions_dates CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on);
ALTER TABLE games ADD COLUMN start_time TIMESTAMPTZ;

CREATE TABLE terms_versions (
  version       TEXT        PRIMARY KEY,
  published_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  document_url  TEXT,
  is_current    BOOLEAN     NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX terms_versions_one_current ON terms_versions ((TRUE)) WHERE is_current;

ALTER TABLE users
  ADD COLUMN terms_version_accepted TEXT REFERENCES terms_versions (version),
  ADD COLUMN terms_accepted_at      TIMESTAMPTZ,
  ADD COLUMN is_usports_athlete     BOOLEAN,
  ADD CONSTRAINT users_terms_pair CHECK ((terms_version_accepted IS NULL) = (terms_accepted_at IS NULL)),
  ADD CONSTRAINT users_terms_answers_athlete CHECK (terms_version_accepted IS NULL OR is_usports_athlete IS NOT NULL);

CREATE TYPE athlete_declaration_source AS ENUM ('SELF_DECLARED', 'VERIFIED', 'ADMIN');
CREATE TABLE user_athlete_declarations (
  user_id        BIGINT      NOT NULL REFERENCES users (id)        ON DELETE CASCADE,
  sport_id       SMALLINT    NOT NULL REFERENCES sports (id)       ON DELETE RESTRICT,
  university_id  BIGINT      REFERENCES universities (id)          ON DELETE SET NULL,
  athlete_id     BIGINT      REFERENCES athletes (id)              ON DELETE SET NULL,
  source         athlete_declaration_source NOT NULL DEFAULT 'SELF_DECLARED',
  declared_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sport_id)
);
CREATE INDEX user_athlete_declarations_athlete_idx ON user_athlete_declarations (athlete_id);

CREATE OR REPLACE FUNCTION league_sport_id(p_league_id BIGINT) RETURNS SMALLINT
LANGUAGE sql STABLE AS $$
  SELECT c.sport_id FROM leagues l JOIN competitions c ON c.id = l.competition_id WHERE l.id = p_league_id;
$$;

CREATE OR REPLACE FUNCTION assert_user_may_play_sport(p_user_id BIGINT, p_sport_id SMALLINT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_current  TEXT;
  v_accepted TEXT;
  v_sport    TEXT;
BEGIN
  SELECT version INTO v_current FROM terms_versions WHERE is_current;
  SELECT terms_version_accepted INTO v_accepted FROM users WHERE id = p_user_id;
  IF v_current IS NOT NULL AND v_accepted IS DISTINCT FROM v_current THEN
    RAISE EXCEPTION 'user % must accept the current terms (%) before joining a league', p_user_id, v_current
      USING ERRCODE = 'check_violation', HINT = 'TERMS_NOT_ACCEPTED';
  END IF;
  SELECT s.name INTO v_sport
    FROM user_athlete_declarations d JOIN sports s ON s.id = d.sport_id
   WHERE d.user_id = p_user_id AND d.sport_id = p_sport_id;
  IF FOUND THEN
    RAISE EXCEPTION 'U Sports athletes may not play fantasy % — their own sport (Terms §Athlete Eligibility)', v_sport
      USING ERRCODE = 'check_violation', HINT = 'ATHLETE_OWN_SPORT';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION user_athlete_declarations_before_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_leagues       TEXT;
  v_athlete_sport SMALLINT;
BEGIN
  IF NEW.athlete_id IS NOT NULL THEN
    SELECT sport_id INTO v_athlete_sport FROM athletes WHERE id = NEW.athlete_id;
    IF v_athlete_sport IS DISTINCT FROM NEW.sport_id THEN
      RAISE EXCEPTION 'athlete % does not compete in sport %', NEW.athlete_id, NEW.sport_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  SELECT string_agg(DISTINCT l.id::text, ', ') INTO v_leagues
    FROM leagues l
    JOIN competitions c ON c.id = l.competition_id
    LEFT JOIN fantasy_teams t ON t.league_id = l.id AND t.user_id = NEW.user_id
   WHERE c.sport_id = NEW.sport_id
     AND (l.commissioner_id = NEW.user_id OR t.id IS NOT NULL);
  IF v_leagues IS NOT NULL THEN
    RAISE EXCEPTION 'user % must leave league(s) % before declaring this sport (Terms §Athlete Eligibility)',
      NEW.user_id, v_leagues
      USING ERRCODE = 'check_violation', HINT = 'ATHLETE_OWN_SPORT';
  END IF;
  UPDATE users SET is_usports_athlete = TRUE WHERE id = NEW.user_id AND is_usports_athlete IS DISTINCT FROM TRUE;
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_athlete_declarations_before_write
  BEFORE INSERT OR UPDATE ON user_athlete_declarations
  FOR EACH ROW EXECUTE FUNCTION user_athlete_declarations_before_write();

-- Put the eligibility checks back into the league triggers.
CREATE OR REPLACE FUNCTION leagues_before_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_sport  SMALLINT;
  v_config JSONB;
  v_bad    TEXT;
BEGIN
  SELECT sport_id, roster_config_json INTO v_sport, v_config FROM competitions WHERE id = NEW.competition_id;
  IF NEW.roster_limits_json IS NULL THEN
    NEW.roster_limits_json := v_config -> 'roster_limits';
  END IF;
  IF NEW.roster_size IS NULL THEN
    NEW.roster_size := jsonb_numeric_sum(NEW.roster_limits_json);
  END IF;
  SELECT string_agg(k, ', ') INTO v_bad
    FROM jsonb_object_keys(NEW.roster_limits_json) k
   WHERE k NOT IN ('BENCH', 'IR')
     AND NOT (v_config -> 'roster_limits') ? k
     AND NOT coalesce(v_config -> 'position_eligibility', '{}'::jsonb) ? k;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'roster slot(s) % are not defined for competition %', v_bad, NEW.competition_id
      USING ERRCODE = 'check_violation', HINT = 'INVALID_SLOT';
  END IF;
  IF TG_OP = 'INSERT' OR NEW.commissioner_id <> OLD.commissioner_id OR NEW.competition_id <> OLD.competition_id THEN
    PERFORM assert_user_may_play_sport(NEW.commissioner_id, v_sport);
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
  IF TG_OP = 'INSERT' OR NEW.league_id <> OLD.league_id OR NEW.user_id <> OLD.user_id THEN
    PERFORM assert_user_may_play_sport(NEW.user_id, league_sport_id(NEW.league_id));
  END IF;
  RETURN NEW;
END;
$$;
