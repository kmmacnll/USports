-- =============================================================================
-- 0001_init_schema.up.sql
-- U Sports Fantasy — core multi-sport schema (PostgreSQL 14+)
--
-- Design notes
--   * Sport-agnostic: nothing in this schema knows what a "rebound" or a
--     "save" is. Raw box-score lines live in game_stats.raw_stats (JSONB) and
--     are interpreted by each competition's scoring_rules (JSONB). Roster shape
--     is likewise data (competitions.roster_config), not columns.
--   * Real-world data (universities, sports, athletes, games, game_stats) is
--     owned by the Python ingestion pipeline and is upserted on natural keys
--     (see the UNIQUE constraints marked "upsert key").
--   * Fantasy data (competitions, leagues, fantasy_teams, roster_spots) is
--     owned by the Node API.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;

-- -----------------------------------------------------------------------------
-- Enumerations
-- -----------------------------------------------------------------------------
CREATE TYPE sport_gender     AS ENUM ('MEN', 'WOMEN', 'MIXED');
CREATE TYPE conference_code  AS ENUM ('AUS', 'RSEQ', 'OUA', 'CW');
CREATE TYPE athlete_status   AS ENUM ('ACTIVE', 'INJURED', 'REDSHIRT', 'INACTIVE');
CREATE TYPE game_status      AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'FINAL', 'POSTPONED', 'CANCELLED');
CREATE TYPE league_status    AS ENUM ('PRE_DRAFT', 'DRAFTING', 'IN_SEASON', 'COMPLETE');
CREATE TYPE roster_slot_type AS ENUM ('STARTER', 'BENCH', 'INJURED_RESERVE');

-- -----------------------------------------------------------------------------
-- Shared trigger: maintain updated_at
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- =============================================================================
-- REFERENCE / REAL-WORLD DATA  (written by the ingestion pipeline)
-- =============================================================================

-- 1. universities -------------------------------------------------------------
CREATE TABLE universities (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT            NOT NULL,
  short_name  TEXT,                                   -- e.g. "UBC", "McGill"
  slug        TEXT            NOT NULL,               -- upsert key, e.g. "ubc"
  conference  conference_code NOT NULL,
  logo_url    TEXT,
  created_at  TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ     NOT NULL DEFAULT now(),
  CONSTRAINT universities_slug_key UNIQUE (slug),
  CONSTRAINT universities_name_key UNIQUE (name),
  CONSTRAINT universities_slug_format CHECK (slug ~ '^[a-z0-9-]+$')
);

-- 2. sports -------------------------------------------------------------------
CREATE TABLE sports (
  id          SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT         NOT NULL,                  -- "Basketball"
  gender      sport_gender NOT NULL,
  code        TEXT         NOT NULL,                  -- upsert key, "MBB", "WIH"
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,     -- exposed by GET /sports
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT sports_code_key UNIQUE (code),
  CONSTRAINT sports_name_gender_key UNIQUE (name, gender),
  CONSTRAINT sports_code_format CHECK (code ~ '^[A-Z]{2,6}$')
);

-- 3. athletes -----------------------------------------------------------------
CREATE TABLE athletes (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usports_id     TEXT           NOT NULL,             -- source-system player id
  first_name     TEXT           NOT NULL,
  last_name      TEXT           NOT NULL,
  university_id  BIGINT         NOT NULL REFERENCES universities (id) ON DELETE RESTRICT,
  sport_id       SMALLINT       NOT NULL REFERENCES sports (id)       ON DELETE RESTRICT,
  position       TEXT,                                -- raw source position, "G", "F/C", "D"
  jersey_number  TEXT,                                -- text: "00" != "0"
  height         TEXT,                                -- raw source value, e.g. "6-4" / "193cm"
  height_cm      SMALLINT,                            -- normalised by pipeline when parseable
  class_year     TEXT,                                -- "1", "2", ... / "RS"
  hometown       TEXT,
  status         athlete_status NOT NULL DEFAULT 'ACTIVE',
  last_seen_at   TIMESTAMPTZ    NOT NULL DEFAULT now(), -- last time a roster sync saw this athlete
  created_at     TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ    NOT NULL DEFAULT now(),
  -- upsert key: source ids are only guaranteed unique within a sport's feed
  CONSTRAINT athletes_sport_usports_id_key UNIQUE (sport_id, usports_id),
  CONSTRAINT athletes_height_cm_range CHECK (height_cm IS NULL OR height_cm BETWEEN 120 AND 240)
);

CREATE INDEX athletes_sport_university_idx ON athletes (sport_id, university_id);
CREATE INDEX athletes_university_idx       ON athletes (university_id);
-- name search for GET /athletes?q=
CREATE INDEX athletes_name_search_idx ON athletes
  USING gin (to_tsvector('simple', first_name || ' ' || last_name));

-- games -----------------------------------------------------------------------
-- Not in the original table list, but required: it gives box scores a stable
-- natural key (source_game_id) for idempotent upserts, handles double-headers
-- (two games vs. the same opponent on one date), and lets the API compute
-- weekly fantasy matchups without re-deriving fixtures from player rows.
CREATE TABLE games (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport_id            SMALLINT    NOT NULL REFERENCES sports (id) ON DELETE RESTRICT,
  source_game_id      TEXT        NOT NULL,           -- upsert key (with sport_id)
  season              TEXT        NOT NULL,           -- "2025-26" or "2025"
  game_date           DATE        NOT NULL,
  start_time          TIMESTAMPTZ,
  home_university_id  BIGINT      NOT NULL REFERENCES universities (id) ON DELETE RESTRICT,
  away_university_id  BIGINT      NOT NULL REFERENCES universities (id) ON DELETE RESTRICT,
  home_score          SMALLINT,
  away_score          SMALLINT,
  status              game_status NOT NULL DEFAULT 'SCHEDULED',
  is_conference_game  BOOLEAN,
  is_playoff          BOOLEAN     NOT NULL DEFAULT FALSE,
  box_score_url       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT games_sport_source_key UNIQUE (sport_id, source_game_id),
  CONSTRAINT games_distinct_teams CHECK (home_university_id <> away_university_id),
  CONSTRAINT games_season_format CHECK (season ~ '^\d{4}(-\d{2})?$')  -- "2025-26" (winter) or "2025" (fall, e.g. football)
);

CREATE INDEX games_sport_season_date_idx ON games (sport_id, season, game_date);

-- 4. game_stats ---------------------------------------------------------------
-- One row per athlete per game. raw_stats holds the box-score line exactly as
-- normalised by the pipeline (keys are sport-specific: {"pts":12,"reb":7,...}).
-- fantasy_points_calculated is the score under the sport's *default* ruleset,
-- used for sorting/browsing athletes; per-competition scores live in
-- game_stat_fantasy_points because every competition may score differently.
CREATE TABLE game_stats (
  id                         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  athlete_id                 BIGINT       NOT NULL REFERENCES athletes (id)     ON DELETE CASCADE,
  game_id                    BIGINT       NOT NULL REFERENCES games (id)        ON DELETE CASCADE,
  game_date                  DATE         NOT NULL,   -- denormalised from games for range scans
  university_id              BIGINT       NOT NULL REFERENCES universities (id), -- team the athlete played for in this game
  opponent_id                BIGINT       NOT NULL REFERENCES universities (id),
  raw_stats_json             JSONB        NOT NULL DEFAULT '{}'::jsonb,
  fantasy_points_calculated  NUMERIC(8,2),
  stats_hash                 TEXT,                    -- md5 of raw_stats_json; lets the pipeline skip no-op rescoring
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
-- FANTASY DATA  (written by the Node API)
-- =============================================================================

-- users -----------------------------------------------------------------------
-- Minimal identity table so commissioner_id / user_id have a real FK target.
-- auth_subject is the id from whatever auth provider we adopt (Sign in with
-- Apple, Auth0, Supabase, ...). Credentials are never stored here.
CREATE TABLE users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  auth_subject  TEXT        NOT NULL,
  email         CITEXT,
  display_name  TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_auth_subject_key UNIQUE (auth_subject),
  CONSTRAINT users_email_key        UNIQUE (email)
);

-- 5. competitions -------------------------------------------------------------
-- A competition = one sport + one season + one ruleset. Leagues are created
-- under a competition, so all leagues in it share roster shape and scoring.
--
-- roster_config_json example (basketball):
--   {"slots": [{"position":"G","count":2,"eligible":["G","PG","SG"]},
--              {"position":"F","count":2,"eligible":["F","SF","PF"]},
--              {"position":"C","count":1,"eligible":["C"]},
--              {"position":"UTIL","count":1,"eligible":["*"]}],
--    "bench": 4, "injured_reserve": 1}
--
-- scoring_rules_json example (basketball):
--   {"version":1, "stats": {"pts":1, "reb":1.2, "ast":1.5, "stl":3, "blk":3, "to":-1},
--    "bonuses": [{"name":"double_double","value":5}]}
CREATE TABLE competitions (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                TEXT        NOT NULL,
  sport_id            SMALLINT    NOT NULL REFERENCES sports (id) ON DELETE RESTRICT,
  season              TEXT        NOT NULL,
  starts_on           DATE,
  ends_on             DATE,
  roster_config_json  JSONB       NOT NULL,
  scoring_rules_json  JSONB       NOT NULL,
  is_default          BOOLEAN     NOT NULL DEFAULT FALSE, -- ruleset used for game_stats.fantasy_points_calculated
  is_public           BOOLEAN     NOT NULL DEFAULT TRUE,  -- selectable when creating a league
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT competitions_sport_season_name_key UNIQUE (sport_id, season, name),
  CONSTRAINT competitions_season_format CHECK (season ~ '^\d{4}(-\d{2})?$'),
  CONSTRAINT competitions_dates CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT competitions_roster_shape CHECK (
    jsonb_typeof(roster_config_json) = 'object'
    AND jsonb_typeof(roster_config_json -> 'slots') = 'array'
  ),
  CONSTRAINT competitions_scoring_shape CHECK (
    jsonb_typeof(scoring_rules_json) = 'object'
    AND jsonb_typeof(scoring_rules_json -> 'stats') = 'object'
  )
);

-- At most one default ruleset per sport+season.
CREATE UNIQUE INDEX competitions_one_default_per_season
  ON competitions (sport_id, season) WHERE is_default;

-- Per-competition fantasy score for each box-score line.
CREATE TABLE game_stat_fantasy_points (
  game_stat_id    BIGINT       NOT NULL REFERENCES game_stats (id)   ON DELETE CASCADE,
  competition_id  BIGINT       NOT NULL REFERENCES competitions (id) ON DELETE CASCADE,
  points          NUMERIC(8,2) NOT NULL,
  breakdown       JSONB,                               -- {"pts":12,"reb":8.4,...} for UI explainers
  calculated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (game_stat_id, competition_id)
);

CREATE INDEX game_stat_fantasy_points_competition_idx
  ON game_stat_fantasy_points (competition_id);

-- 6. leagues ------------------------------------------------------------------
CREATE TABLE leagues (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  competition_id   BIGINT        NOT NULL REFERENCES competitions (id) ON DELETE RESTRICT,
  commissioner_id  BIGINT        NOT NULL REFERENCES users (id)        ON DELETE RESTRICT,
  name             TEXT          NOT NULL,
  max_teams        SMALLINT      NOT NULL DEFAULT 10,
  status           league_status NOT NULL DEFAULT 'PRE_DRAFT',
  is_private       BOOLEAN       NOT NULL DEFAULT TRUE,
  invite_code      TEXT          NOT NULL DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 8),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT leagues_invite_code_key UNIQUE (invite_code),
  CONSTRAINT leagues_max_teams_range CHECK (max_teams BETWEEN 2 AND 20),
  CONSTRAINT leagues_name_length     CHECK (char_length(name) BETWEEN 1 AND 80)
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
  CONSTRAINT fantasy_teams_league_user_key UNIQUE (league_id, user_id),   -- one team per user per league
  CONSTRAINT fantasy_teams_league_name_key UNIQUE (league_id, team_name),
  CONSTRAINT fantasy_teams_id_league_key   UNIQUE (id, league_id),        -- target for roster_spots composite FK
  CONSTRAINT fantasy_teams_name_length     CHECK (char_length(team_name) BETWEEN 1 AND 60)
);

CREATE INDEX fantasy_teams_user_idx ON fantasy_teams (user_id);

-- Enforce leagues.max_teams at the DB level (serialised per league via row lock).
CREATE OR REPLACE FUNCTION enforce_league_capacity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_max   SMALLINT;
  v_count INTEGER;
BEGIN
  SELECT max_teams INTO v_max FROM leagues WHERE id = NEW.league_id FOR UPDATE;
  SELECT count(*)  INTO v_count FROM fantasy_teams WHERE league_id = NEW.league_id;
  IF v_count >= v_max THEN
    RAISE EXCEPTION 'league % is full (max_teams = %)', NEW.league_id, v_max
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER fantasy_teams_capacity
  BEFORE INSERT ON fantasy_teams
  FOR EACH ROW EXECUTE FUNCTION enforce_league_capacity();

-- 8. roster_spots -------------------------------------------------------------
-- league_id is denormalised (and pinned to the team's league via a composite
-- FK) so that "an athlete can only be rostered once per league" is a plain
-- UNIQUE constraint rather than application logic.
--
-- position_assigned + slot_index identify a concrete slot from roster_config,
-- e.g. ('STARTER','G',1), ('STARTER','G',2), ('BENCH','BN',3).
-- The slot uniqueness constraint is DEFERRABLE so the swap endpoint can
-- exchange two athletes inside one transaction.
CREATE TABLE roster_spots (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fantasy_team_id    BIGINT           NOT NULL,
  league_id          BIGINT           NOT NULL,
  athlete_id         BIGINT           NOT NULL REFERENCES athletes (id) ON DELETE RESTRICT,
  slot_type          roster_slot_type NOT NULL DEFAULT 'BENCH',
  position_assigned  TEXT             NOT NULL,
  slot_index         SMALLINT         NOT NULL DEFAULT 1,
  acquired_at        TIMESTAMPTZ      NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ      NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ      NOT NULL DEFAULT now(),
  CONSTRAINT roster_spots_team_fk FOREIGN KEY (fantasy_team_id, league_id)
    REFERENCES fantasy_teams (id, league_id) ON DELETE CASCADE,
  CONSTRAINT roster_spots_league_athlete_key UNIQUE (league_id, athlete_id),
  CONSTRAINT roster_spots_slot_key
    UNIQUE (fantasy_team_id, slot_type, position_assigned, slot_index)
    DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT roster_spots_slot_index_positive CHECK (slot_index >= 1)
);

CREATE INDEX roster_spots_team_idx    ON roster_spots (fantasy_team_id);
CREATE INDEX roster_spots_athlete_idx ON roster_spots (athlete_id);

-- An athlete may only be rostered in a league whose competition is for the
-- athlete's sport (no hockey players on a basketball team).
CREATE OR REPLACE FUNCTION enforce_roster_sport_match() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_league_sport  SMALLINT;
  v_athlete_sport SMALLINT;
BEGIN
  SELECT c.sport_id INTO v_league_sport
    FROM leagues l JOIN competitions c ON c.id = l.competition_id
   WHERE l.id = NEW.league_id;
  SELECT sport_id INTO v_athlete_sport FROM athletes WHERE id = NEW.athlete_id;

  IF v_league_sport IS DISTINCT FROM v_athlete_sport THEN
    RAISE EXCEPTION 'athlete % (sport %) cannot be rostered in league % (sport %)',
      NEW.athlete_id, v_athlete_sport, NEW.league_id, v_league_sport
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER roster_spots_sport_match
  BEFORE INSERT OR UPDATE OF athlete_id, league_id ON roster_spots
  FOR EACH ROW EXECUTE FUNCTION enforce_roster_sport_match();

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'universities','sports','athletes','games','game_stats',
    'users','competitions','leagues','fantasy_teams','roster_spots'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- Read model: per-athlete season totals for GET /api/v1/athletes
-- Sums every numeric key in raw_stats_json, so it works for any sport.
-- Plain view for now; promote to a MATERIALIZED VIEW refreshed by the pipeline
-- once data volume warrants it.
-- -----------------------------------------------------------------------------
CREATE VIEW athlete_season_stats AS
SELECT
  gs.athlete_id,
  g.season,
  count(*)                                   AS games_played,
  coalesce(sum(gs.fantasy_points_calculated), 0)::NUMERIC(10,2) AS fantasy_points_total,
  round(avg(gs.fantasy_points_calculated), 2) AS fantasy_points_avg,
  (
    SELECT coalesce(jsonb_object_agg(k, total), '{}'::jsonb)
    FROM (
      SELECT kv.key AS k, sum((kv.value)::text::numeric) AS total
      FROM game_stats gs2
      JOIN games g2 ON g2.id = gs2.game_id
      CROSS JOIN LATERAL jsonb_each(gs2.raw_stats_json) kv
      WHERE gs2.athlete_id = gs.athlete_id
        AND g2.season = g.season
        AND jsonb_typeof(kv.value) = 'number'
      GROUP BY kv.key
    ) totals
  )                                           AS stat_totals
FROM game_stats gs
JOIN games g ON g.id = gs.game_id
GROUP BY gs.athlete_id, g.season;

COMMIT;
