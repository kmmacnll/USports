-- =============================================================================
-- 0001_init_schema.up.sql
-- U Sports Fantasy — core multi-sport schema (PostgreSQL 14+)
--
-- Design notes
--   * Sport-agnostic: nothing in this schema knows what a "rebound" or a
--     "save" is. Box-score lines live in game_stats.raw_stats_json (JSONB) and
--     are scored by each competition's scoring_rules_json via
--     fantasy_score(). Rules are {"stat": weight} or grouped
--     {"group": {"stat": weight}}; a grouped rule scores the stat key
--     "group_stat" (passing.yards -> passing_yards). Roster shape is data
--     too: {"G":2, "F":2, "C":1, "BENCH":6}.
--   * Real-world data (universities, sports, team_seasons, athletes, games,
--     game_stats) is owned by the Python ingestion pipeline and upserted on
--     natural keys. U Sports has no stable cross-season athlete id, so athlete
--     identity is resolved through athlete_source_ids.
--   * Fantasy data (users, competitions, leagues, fantasy_teams, roster_spots)
--     is owned by the Node API.
--   * Terms & Conditions §Athlete Eligibility: a user who is a U Sports
--     athlete may play fantasy in any sport EXCEPT their own. Enforced here by
--     assert_user_may_play_sport().
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;

-- -----------------------------------------------------------------------------
-- Enumerations
-- -----------------------------------------------------------------------------
CREATE TYPE sport_gender           AS ENUM ('MEN', 'WOMEN', 'MIXED');
CREATE TYPE conference_code        AS ENUM ('AUS', 'RSEQ', 'OUA', 'CW');
CREATE TYPE athlete_status         AS ENUM ('ACTIVE', 'INJURED', 'REDSHIRT', 'INACTIVE');
CREATE TYPE athlete_source_id_type AS ENUM ('usports_player', 'name_key');
CREATE TYPE game_status            AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'FINAL', 'POSTPONED', 'CANCELLED');
CREATE TYPE league_status          AS ENUM ('PRE_DRAFT', 'DRAFTING', 'IN_SEASON', 'COMPLETE');
CREATE TYPE roster_slot_type       AS ENUM ('STARTER', 'BENCH', 'INJURED_RESERVE');
CREATE TYPE athlete_declaration_source AS ENUM ('SELF_DECLARED', 'VERIFIED', 'ADMIN');

-- -----------------------------------------------------------------------------
-- Generic helpers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- TRUE when j is an object whose values are all JSON numbers.
CREATE OR REPLACE FUNCTION jsonb_is_number_map(j JSONB) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT jsonb_typeof(j) = 'object'
     AND NOT EXISTS (SELECT 1 FROM jsonb_each(j) e WHERE jsonb_typeof(e.value) <> 'number');
$$;

-- TRUE when j is a non-empty object whose values are all non-negative integers.
CREATE OR REPLACE FUNCTION jsonb_is_count_map(j JSONB) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT jsonb_typeof(j) = 'object'
     AND EXISTS (SELECT 1 FROM jsonb_each(j))
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_each(j) e
        WHERE jsonb_typeof(e.value) <> 'number' OR e.value::text !~ '^\d+$');
$$;

CREATE OR REPLACE FUNCTION jsonb_numeric_sum(j JSONB) RETURNS NUMERIC
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(sum(e.value::text::numeric), 0) FROM jsonb_each(j) e;
$$;

-- Valid scoring rules: a non-empty object whose values are numbers, or
-- non-empty objects of numbers (one level of grouping).
CREATE OR REPLACE FUNCTION jsonb_is_scoring_rules(j JSONB) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT jsonb_typeof(j) = 'object'
     AND EXISTS (SELECT 1 FROM jsonb_each(j))
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_each(j) e
        WHERE NOT (jsonb_typeof(e.value) = 'number'
                   OR (jsonb_typeof(e.value) = 'object'
                       AND e.value <> '{}'::jsonb
                       AND jsonb_is_number_map(e.value))));
$$;

-- Flatten a ruleset into (stat_key, weight) rows:
--   {"points":1}                     -> ("points", 1)
--   {"passing":{"yards":0.04}}       -> ("passing_yards", 0.04)
CREATE OR REPLACE FUNCTION scoring_weights(rules JSONB)
RETURNS TABLE (stat_key TEXT, weight NUMERIC)
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT r.key, r.value::text::numeric
    FROM jsonb_each(rules) r
   WHERE jsonb_typeof(r.value) = 'number'
  UNION ALL
  SELECT r.key || '_' || n.key, n.value::text::numeric
    FROM jsonb_each(rules) r
   CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(r.value) = 'object' THEN r.value ELSE '{}'::jsonb END) n
   WHERE jsonb_typeof(n.value) = 'number';
$$;

-- Fantasy points for one stat line under one ruleset.
--   fantasy_score('{"points":20,"rebounds":5}', '{"points":1,"rebounds":1.2}') = 26.00
--   fantasy_score('{"passing_yards":300}', '{"passing":{"yards":0.04}}')     = 12.00
-- Stats missing from the line, or non-numeric, count as 0.
CREATE OR REPLACE FUNCTION fantasy_score(stats JSONB, rules JSONB) RETURNS NUMERIC(8,2)
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(sum(
           w.weight *
           CASE WHEN jsonb_typeof(stats -> w.stat_key) = 'number'
                THEN (stats ->> w.stat_key)::numeric ELSE 0 END
         ), 0)::numeric(8,2)
    FROM scoring_weights(rules) w;
$$;

-- Current U Sports season label, e.g. '2026-27'. Rolls over on July 1 (the
-- feeds start with summer exhibition tours); matches the pipeline's
-- seasons.current_season().
CREATE OR REPLACE FUNCTION usports_current_season(at DATE DEFAULT current_date) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT y::text || '-' || lpad(((y + 1) % 100)::text, 2, '0')
    FROM (SELECT CASE WHEN extract(month FROM at) >= 7 THEN extract(year FROM at)::int
                      ELSE extract(year FROM at)::int - 1 END AS y) t;
$$;

-- =============================================================================
-- REFERENCE / REAL-WORLD DATA  (written by the ingestion pipeline)
-- =============================================================================

-- 1. universities -------------------------------------------------------------
-- Every team that appears in a U Sports schedule, including non-member
-- exhibition opponents (NCAA, colleges). is_usports_member is derived from the
-- data (the team played a conference game); conference is filled from the
-- usports.ca standings when available.
CREATE TABLE universities (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name               TEXT            NOT NULL,          -- display name as published, "Carleton"
  short_name         TEXT,
  slug               TEXT            NOT NULL,          -- upsert key, "carleton", "saintmarys"
  conference         conference_code,                   -- NULL until known
  is_usports_member  BOOLEAN         NOT NULL DEFAULT FALSE,
  logo_url           TEXT,
  created_at         TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ     NOT NULL DEFAULT now(),
  CONSTRAINT universities_slug_key UNIQUE (slug),
  CONSTRAINT universities_slug_format CHECK (slug ~ '^[a-z0-9-]+$')
);

-- Alternate spellings seen in source data ("TMU" vs "Toronto Metropolitan").
CREATE TABLE university_aliases (
  alias_slug     TEXT   PRIMARY KEY CHECK (alias_slug ~ '^[a-z0-9-]+$'),
  university_id  BIGINT NOT NULL REFERENCES universities (id) ON DELETE CASCADE
);

-- 2. sports -------------------------------------------------------------------
CREATE TABLE sports (
  id          SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        TEXT         NOT NULL,                  -- public id, "usports_mbk"
  name        TEXT         NOT NULL,                  -- "Men's Basketball"
  gender      sport_gender NOT NULL,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,     -- exposed by GET /sports
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT sports_code_key   UNIQUE (code),
  CONSTRAINT sports_name_key   UNIQUE (name),
  CONSTRAINT sports_code_format CHECK (code ~ '^usports_[a-z]+$')
);

-- team_seasons ----------------------------------------------------------------
-- A university's program in one sport for one season, with the usports.ca
-- team page used by the roster scraper.
CREATE TABLE team_seasons (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  university_id    BIGINT      NOT NULL REFERENCES universities (id) ON DELETE CASCADE,
  sport_id         SMALLINT    NOT NULL REFERENCES sports (id)       ON DELETE CASCADE,
  season           TEXT        NOT NULL,
  usports_team_id  TEXT,
  team_url         TEXT,
  roster_synced_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT team_seasons_key UNIQUE (sport_id, season, university_id),
  CONSTRAINT team_seasons_season_format CHECK (season ~ '^\d{4}(-\d{2})?$')
);

-- 3. athletes -----------------------------------------------------------------
CREATE TABLE athletes (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- public id: usports_ath_<id>
  usports_id     TEXT,                                -- most recent usports.ca player id (changes per season)
  first_name     TEXT           NOT NULL,
  last_name      TEXT           NOT NULL,
  university_id  BIGINT         NOT NULL REFERENCES universities (id) ON DELETE RESTRICT,
  sport_id       SMALLINT       NOT NULL REFERENCES sports (id)       ON DELETE RESTRICT,
  position       TEXT,                                -- raw source position, "G", "F/C"
  positions      TEXT[]         NOT NULL DEFAULT '{}', -- normalised tokens used for slot eligibility, {G,F}
  jersey_number  TEXT,                                -- text: "00" != "0"
  height         TEXT,                                -- raw source value, "6-4" / "193cm"
  height_cm      SMALLINT,
  class_year     TEXT,
  hometown       TEXT,
  status         athlete_status NOT NULL DEFAULT 'ACTIVE',
  last_seen_at   TIMESTAMPTZ    NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ    NOT NULL DEFAULT now(),
  CONSTRAINT athletes_height_cm_range CHECK (height_cm IS NULL OR height_cm BETWEEN 120 AND 240)
);

CREATE INDEX athletes_sport_university_idx ON athletes (sport_id, university_id);
CREATE INDEX athletes_university_idx       ON athletes (university_id);
CREATE INDEX athletes_name_search_idx ON athletes
  USING gin (to_tsvector('simple', first_name || ' ' || last_name));

-- Identity resolution. Every external identifier ever seen for an athlete
-- maps to one athletes row:
--   usports_player : usports.ca player id. Changes each season, and again for
--                    playoffs ("2025-26p") and championships ("2025-26c").
--   name_key       : "<university_id>|<normalised full name>"; used when the
--                    source row has no player id (common early in a season).
CREATE TABLE athlete_source_ids (
  sport_id        SMALLINT               NOT NULL REFERENCES sports (id) ON DELETE CASCADE,
  id_type         athlete_source_id_type NOT NULL,
  id_value        TEXT                   NOT NULL,
  athlete_id      BIGINT                 NOT NULL REFERENCES athletes (id) ON DELETE CASCADE,
  season_segment  TEXT,                  -- "2025-26", "2025-26p" (usports_player only)
  first_seen_at   TIMESTAMPTZ            NOT NULL DEFAULT now(),
  PRIMARY KEY (sport_id, id_type, id_value)
);

CREATE INDEX athlete_source_ids_athlete_idx ON athlete_source_ids (athlete_id);

-- games -----------------------------------------------------------------------
CREATE TABLE games (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport_id            SMALLINT    NOT NULL REFERENCES sports (id) ON DELETE RESTRICT,
  source_game_id      TEXT        NOT NULL,           -- usports.ca game id, "20261024_wgcg"
  season              TEXT        NOT NULL,           -- "2026-27" (the feeds label fall sports this way too)
  season_segment      TEXT        NOT NULL,           -- raw source season incl. suffix, "2026-27p"
  game_date           DATE        NOT NULL,
  start_time          TIMESTAMPTZ,
  home_university_id  BIGINT      NOT NULL REFERENCES universities (id) ON DELETE RESTRICT,
  away_university_id  BIGINT      NOT NULL REFERENCES universities (id) ON DELETE RESTRICT,
  home_score          SMALLINT,
  away_score          SMALLINT,
  status              game_status NOT NULL DEFAULT 'SCHEDULED',
  is_exhibition       BOOLEAN     NOT NULL DEFAULT FALSE,
  is_conference_game  BOOLEAN     NOT NULL DEFAULT FALSE,
  is_playoff          BOOLEAN     NOT NULL DEFAULT FALSE,
  box_score_url       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT games_sport_source_key UNIQUE (sport_id, source_game_id),
  CONSTRAINT games_distinct_teams CHECK (home_university_id <> away_university_id),
  CONSTRAINT games_season_format CHECK (season ~ '^\d{4}(-\d{2})?$')
);

CREATE INDEX games_sport_season_date_idx ON games (sport_id, season, game_date);

-- 4. game_stats ---------------------------------------------------------------
-- One row per athlete per game. raw_stats_json uses canonical stat keys that
-- match scoring rules ("points", "rebounds", ...) plus any extra source stats.
-- fantasy_points_calculated = score under the sport's default competition.
CREATE TABLE game_stats (
  id                         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  athlete_id                 BIGINT       NOT NULL REFERENCES athletes (id)     ON DELETE CASCADE,
  game_id                    BIGINT       NOT NULL REFERENCES games (id)        ON DELETE CASCADE,
  game_date                  DATE         NOT NULL,
  university_id              BIGINT       NOT NULL REFERENCES universities (id),
  opponent_id                BIGINT       NOT NULL REFERENCES universities (id),
  is_starter                 BOOLEAN,
  raw_stats_json             JSONB        NOT NULL DEFAULT '{}'::jsonb,
  fantasy_points_calculated  NUMERIC(8,2),
  created_at                 TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT game_stats_athlete_game_key UNIQUE (athlete_id, game_id),  -- upsert key
  CONSTRAINT game_stats_raw_is_object CHECK (jsonb_typeof(raw_stats_json) = 'object'),
  CONSTRAINT game_stats_distinct_teams CHECK (university_id <> opponent_id)
);

CREATE INDEX game_stats_athlete_date_idx ON game_stats (athlete_id, game_date DESC);
CREATE INDEX game_stats_game_idx         ON game_stats (game_id);
CREATE INDEX game_stats_date_idx         ON game_stats (game_date);

-- =============================================================================
-- USERS & TERMS
-- =============================================================================

CREATE TABLE terms_versions (
  version       TEXT        PRIMARY KEY,              -- "2026-11-01"
  published_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  document_url  TEXT,
  is_current    BOOLEAN     NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX terms_versions_one_current ON terms_versions ((TRUE)) WHERE is_current;

CREATE TABLE users (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- public id: usr_<id>
  auth_subject            TEXT        NOT NULL,
  email                   CITEXT,
  display_name            TEXT        NOT NULL,
  terms_version_accepted  TEXT        REFERENCES terms_versions (version),
  terms_accepted_at       TIMESTAMPTZ,
  is_usports_athlete      BOOLEAN,    -- answer to the T&C athlete question; NULL = not yet answered
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_auth_subject_key UNIQUE (auth_subject),
  CONSTRAINT users_email_key        UNIQUE (email),
  CONSTRAINT users_terms_pair CHECK ((terms_version_accepted IS NULL) = (terms_accepted_at IS NULL)),
  CONSTRAINT users_terms_answers_athlete CHECK (terms_version_accepted IS NULL OR is_usports_athlete IS NOT NULL)
);

-- The sports a user competes in as a U Sports athlete. Keyed by sport so the
-- rule holds even if we have not ingested that athlete's roster entry yet;
-- athlete_id links the real record when known.
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

-- =============================================================================
-- FANTASY DATA  (written by the Node API)
-- =============================================================================

-- 5. competitions -------------------------------------------------------------
-- One sport + season + ruleset. Leagues are created under a competition.
--
-- roster_config_json:
--   {"slot_order":           ["G","F","C","BENCH"],   -- display order
--    "roster_limits":        {"G":2,"F":2,"C":1,"BENCH":6},
--    "position_eligibility": {"G":["G","PG","SG"], "F":["F","SF","PF"], "C":["C"]}}
--   BENCH (and IR, if present) accept any athlete of the sport. Any other
--   slot accepts athletes whose positions[] overlap its eligibility list
--   (or contain the slot name, if the slot has no list).
--
-- scoring_rules_json, flat:    {"points":1.0,"rebounds":1.2,"assists":1.5,
--                                "steals":3.0,"blocks":3.0,"turnovers":-1.0}
--                    grouped: {"passing":{"yards":0.04,"touchdown":4.0}, "misc":{"fumble_lost":-2.0}}
--
-- code is the public ruleset id ("usports_football_half_ppr").
CREATE TABLE competitions (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code                TEXT        NOT NULL,
  name                TEXT        NOT NULL,
  sport_id            SMALLINT    NOT NULL REFERENCES sports (id) ON DELETE RESTRICT,
  season              TEXT        NOT NULL,
  starts_on           DATE,
  ends_on             DATE,
  roster_config_json  JSONB       NOT NULL,
  scoring_rules_json  JSONB       NOT NULL,
  count_exhibitions   BOOLEAN     NOT NULL DEFAULT FALSE,
  is_default          BOOLEAN     NOT NULL DEFAULT FALSE, -- drives game_stats.fantasy_points_calculated
  is_public           BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT competitions_sport_season_name_key UNIQUE (sport_id, season, name),
  CONSTRAINT competitions_code_season_key UNIQUE (code, season),
  CONSTRAINT competitions_code_format CHECK (code ~ '^[a-z0-9_]{3,64}$'),
  CONSTRAINT competitions_season_format CHECK (season ~ '^\d{4}(-\d{2})?$'),
  CONSTRAINT competitions_dates CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT competitions_roster_shape CHECK (
    jsonb_is_count_map(roster_config_json -> 'roster_limits')
    AND jsonb_typeof(coalesce(roster_config_json -> 'position_eligibility', '{}'::jsonb)) = 'object'
  ),
  CONSTRAINT competitions_scoring_shape CHECK (
    jsonb_is_scoring_rules(scoring_rules_json)
  )
);

CREATE UNIQUE INDEX competitions_one_default_per_season
  ON competitions (sport_id, season) WHERE is_default;

CREATE TABLE game_stat_fantasy_points (
  game_stat_id    BIGINT       NOT NULL REFERENCES game_stats (id)   ON DELETE CASCADE,
  competition_id  BIGINT       NOT NULL REFERENCES competitions (id) ON DELETE CASCADE,
  points          NUMERIC(8,2) NOT NULL,
  calculated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (game_stat_id, competition_id)
);

CREATE INDEX game_stat_fantasy_points_competition_idx ON game_stat_fantasy_points (competition_id);

-- 6. leagues ------------------------------------------------------------------
-- roster_limits_json defaults to the competition's limits and may be
-- customised per league, e.g. {"QB":2,"RB":3,"WR":4,"K":1,"DEF":1,"BENCH":4}.
-- roster_size must equal the sum of the limits.
CREATE TABLE leagues (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- public id: lg_<id>
  competition_id      BIGINT        NOT NULL REFERENCES competitions (id) ON DELETE RESTRICT,
  commissioner_id     BIGINT        NOT NULL REFERENCES users (id)        ON DELETE RESTRICT,
  name                TEXT          NOT NULL,
  max_teams           SMALLINT      NOT NULL DEFAULT 10,
  roster_limits_json  JSONB         NOT NULL,          -- filled from competition when omitted
  roster_size         SMALLINT      NOT NULL,          -- filled from roster_limits_json when omitted
  status              league_status NOT NULL DEFAULT 'PRE_DRAFT',
  is_private          BOOLEAN       NOT NULL DEFAULT TRUE,
  invite_code         TEXT          NOT NULL DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 8),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT leagues_invite_code_key UNIQUE (invite_code),
  CONSTRAINT leagues_max_teams_range CHECK (max_teams BETWEEN 2 AND 20),
  CONSTRAINT leagues_name_length     CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT leagues_roster_limits_shape CHECK (jsonb_is_count_map(roster_limits_json)),
  CONSTRAINT leagues_roster_size_matches CHECK (roster_size = jsonb_numeric_sum(roster_limits_json)),
  CONSTRAINT leagues_roster_size_range   CHECK (roster_size BETWEEN 1 AND 40)
);

CREATE INDEX leagues_competition_idx  ON leagues (competition_id);
CREATE INDEX leagues_commissioner_idx ON leagues (commissioner_id);

-- 7. fantasy_teams ------------------------------------------------------------
CREATE TABLE fantasy_teams (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  league_id   BIGINT      NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
  user_id     BIGINT      NOT NULL REFERENCES users (id)   ON DELETE CASCADE,
  team_name   TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fantasy_teams_league_user_key UNIQUE (league_id, user_id),
  CONSTRAINT fantasy_teams_league_name_key UNIQUE (league_id, team_name),
  CONSTRAINT fantasy_teams_id_league_key   UNIQUE (id, league_id),
  CONSTRAINT fantasy_teams_name_length     CHECK (char_length(team_name) BETWEEN 1 AND 60)
);

CREATE INDEX fantasy_teams_user_idx ON fantasy_teams (user_id);

-- 8. roster_spots -------------------------------------------------------------
-- position_assigned is a key of the league's roster_limits_json ("PG",
-- "BENCH", "QB", ...); slot_index runs 1..limit. slot_type is derived from it.
CREATE TABLE roster_spots (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fantasy_team_id    BIGINT           NOT NULL,
  league_id          BIGINT           NOT NULL,
  athlete_id         BIGINT           NOT NULL REFERENCES athletes (id) ON DELETE RESTRICT,
  position_assigned  TEXT             NOT NULL,
  slot_index         SMALLINT         NOT NULL DEFAULT 1,
  slot_type          roster_slot_type GENERATED ALWAYS AS (
                       CASE position_assigned
                         WHEN 'BENCH' THEN 'BENCH'::roster_slot_type
                         WHEN 'IR'    THEN 'INJURED_RESERVE'::roster_slot_type
                         ELSE 'STARTER'::roster_slot_type
                       END) STORED,
  acquired_at        TIMESTAMPTZ      NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ      NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ      NOT NULL DEFAULT now(),
  CONSTRAINT roster_spots_team_fk FOREIGN KEY (fantasy_team_id, league_id)
    REFERENCES fantasy_teams (id, league_id) ON DELETE CASCADE,
  CONSTRAINT roster_spots_league_athlete_key UNIQUE (league_id, athlete_id),
  CONSTRAINT roster_spots_slot_key
    UNIQUE (fantasy_team_id, position_assigned, slot_index)
    DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT roster_spots_slot_index_positive CHECK (slot_index >= 1)
);

CREATE INDEX roster_spots_team_idx    ON roster_spots (fantasy_team_id);
CREATE INDEX roster_spots_athlete_idx ON roster_spots (athlete_id);

-- =============================================================================
-- RULES (triggers)
-- =============================================================================

-- Terms & Conditions §Athlete Eligibility --------------------------------------
-- A user may commission or join a league only if they have accepted the
-- current terms, and only for a sport they do not compete in themselves.
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

CREATE OR REPLACE FUNCTION league_sport_id(p_league_id BIGINT) RETURNS SMALLINT
LANGUAGE sql STABLE AS $$
  SELECT c.sport_id FROM leagues l JOIN competitions c ON c.id = l.competition_id WHERE l.id = p_league_id;
$$;

-- leagues: defaults + commissioner eligibility ---------------------------------
CREATE OR REPLACE FUNCTION leagues_before_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_sport  SMALLINT;
  v_config JSONB;
  v_bad    TEXT;
BEGIN
  SELECT sport_id, roster_config_json INTO v_sport, v_config
    FROM competitions WHERE id = NEW.competition_id;

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

  IF TG_OP = 'INSERT' OR NEW.commissioner_id <> OLD.commissioner_id OR NEW.competition_id <> OLD.competition_id THEN
    PERFORM assert_user_may_play_sport(NEW.commissioner_id, v_sport);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER leagues_before_write
  BEFORE INSERT OR UPDATE OF competition_id, commissioner_id, roster_limits_json, roster_size ON leagues
  FOR EACH ROW EXECUTE FUNCTION leagues_before_write();

-- fantasy_teams: capacity + member eligibility ----------------------------------
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

CREATE TRIGGER fantasy_teams_before_write
  BEFORE INSERT OR UPDATE OF league_id, user_id ON fantasy_teams
  FOR EACH ROW EXECUTE FUNCTION fantasy_teams_before_write();

-- user_athlete_declarations: no existing conflicts --------------------------------
-- Declaring a sport is rejected while the user still commissions or plays in
-- a league for it; the API tells them which leagues to leave first.
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

-- roster_spots: sport match, slot exists, positional eligibility -------------------
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
    IF NOT (v_positions && v_allowed) THEN
      RAISE EXCEPTION 'athlete % (positions %) is not eligible for slot % (needs one of %)',
        NEW.athlete_id, v_positions, NEW.position_assigned, v_allowed
        USING ERRCODE = 'check_violation', HINT = 'INELIGIBLE_POSITION';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER roster_spots_before_write
  BEFORE INSERT OR UPDATE OF athlete_id, league_id, position_assigned, slot_index ON roster_spots
  FOR EACH ROW EXECUTE FUNCTION roster_spots_before_write();

-- updated_at --------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'universities','sports','team_seasons','athletes','games','game_stats',
    'users','competitions','leagues','fantasy_teams','roster_spots'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END;
$$;

-- =============================================================================
-- READ MODEL
-- =============================================================================
-- Per-athlete season totals and per-game averages for every numeric stat key,
-- excluding exhibitions. Backs GET /api/v1/athletes, e.g.
--   stat_averages->>'points' = ppg, stat_averages->>'rebounds' = rpg.
CREATE VIEW athlete_season_stats AS
WITH lines AS (
  SELECT gs.athlete_id, g.season, gs.raw_stats_json, gs.fantasy_points_calculated
    FROM game_stats gs
    JOIN games g ON g.id = gs.game_id
   WHERE NOT g.is_exhibition
),
totals AS (
  SELECT l.athlete_id, l.season, kv.key, sum(kv.value::text::numeric) AS total
    FROM lines l
    CROSS JOIN LATERAL jsonb_each(l.raw_stats_json) kv
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

COMMIT;
