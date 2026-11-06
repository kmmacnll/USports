-- =============================================================================
-- 0007_player_ratings.up.sql
-- Draft Battles phase 2: computed player ratings, kept apart from the raw stat
-- lines in game_stats so they can be recomputed at any time.
--
--   rating_runs            one row per recompute (the API's ratings job)
--   player_ratings         latest OVR + sub-ratings per athlete (the draft pool)
--   player_rating_history  every recompute's value, for "rating up/down" badges
-- =============================================================================
BEGIN;

CREATE TABLE rating_runs (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ,
  status           TEXT        NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'complete', 'failed')),
  seasons          TEXT[]      NOT NULL,
  params           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- fingerprint of the inputs (game_stats + athletes); unchanged inputs skip a run
  stats_watermark  TEXT,
  players_rated    INTEGER     NOT NULL DEFAULT 0,
  error            TEXT
);

CREATE TABLE player_ratings (
  athlete_id       BIGINT      PRIMARY KEY REFERENCES athletes (id) ON DELETE CASCADE,
  sport_id         SMALLINT    NOT NULL REFERENCES sports (id) ON DELETE CASCADE,
  position         TEXT        NOT NULL,           -- battle position: F/D/G, G/F/C, GK/DEF/MID/FWD, ...
  position_source  TEXT        NOT NULL CHECK (position_source IN ('roster', 'box', 'inferred')),
  ovr              SMALLINT    NOT NULL CHECK (ovr BETWEEN 40 AND 99),
  sub_ratings      JSONB       NOT NULL CHECK (jsonb_typeof(sub_ratings) = 'object'),
  games_used       INTEGER     NOT NULL DEFAULT 0,
  is_new           BOOLEAN     NOT NULL DEFAULT FALSE,   -- no qualifying games yet: baseline rating
  run_id           BIGINT      NOT NULL REFERENCES rating_runs (id),
  computed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX player_ratings_pool_idx ON player_ratings (sport_id, position, ovr DESC);
CREATE INDEX player_ratings_sport_ovr_idx ON player_ratings (sport_id, ovr DESC);

CREATE TABLE player_rating_history (
  id               BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  athlete_id       BIGINT      NOT NULL REFERENCES athletes (id) ON DELETE CASCADE,
  run_id           BIGINT      NOT NULL REFERENCES rating_runs (id) ON DELETE CASCADE,
  position         TEXT        NOT NULL,
  ovr              SMALLINT    NOT NULL,
  sub_ratings      JSONB       NOT NULL,
  games_used       INTEGER     NOT NULL,
  is_new           BOOLEAN     NOT NULL,
  computed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX player_rating_history_athlete_idx ON player_rating_history (athlete_id, run_id DESC);

COMMIT;
