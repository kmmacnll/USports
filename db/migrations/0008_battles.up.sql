-- =============================================================================
-- 0008_battles.up.sql
-- Draft Battles phase 4: 1v1 snake drafts and their simulated matches.
--
--   battles       one row per battle; state machine
--                 queued -> drafting -> simulating -> complete  (+ cancelled / expired)
--                 user_b NULL = the AI. result = the full MatchResult (JSON),
--                 written when the draft ends; the API streams its events by
--                 their t offsets from sim_started_at and never serves events
--                 whose time hasn't come yet.
--   battle_picks  every pick, with a snapshot of the player's rating at pick
--                 time (ratings can be recomputed mid-battle; the match uses
--                 the snapshot).
-- =============================================================================
BEGIN;

CREATE TYPE battle_state AS ENUM ('queued', 'drafting', 'simulating', 'complete', 'cancelled', 'expired');
CREATE TYPE battle_mode  AS ENUM ('AI', 'FRIEND', 'RANDOM');

CREATE TABLE battles (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,   -- public id: bt_<id>
  mode             battle_mode  NOT NULL,
  ranked           BOOLEAN      NOT NULL DEFAULT FALSE,
  sport_id         SMALLINT     NOT NULL REFERENCES sports (id),
  state            battle_state NOT NULL DEFAULT 'queued',
  user_a           BIGINT       NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_b           BIGINT       REFERENCES users (id) ON DELETE CASCADE,   -- NULL = AI opponent
  first_pick       CHAR(1)      CHECK (first_pick IN ('A', 'B')),
  pick_number      SMALLINT     NOT NULL DEFAULT 0,                   -- picks made so far
  pick_deadline    TIMESTAMPTZ,
  seed             BIGINT,
  result           JSONB,
  sim_started_at   TIMESTAMPTZ,
  completes_at     TIMESTAMPTZ,
  winner           CHAR(1)      CHECK (winner IN ('A', 'B')),
  score_a          SMALLINT,
  score_b          SMALLINT,
  went_to_ot       BOOLEAN,
  end_reason       TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ,
  CONSTRAINT battles_two_users CHECK (user_b IS NULL OR user_b <> user_a),
  CONSTRAINT battles_ai_unranked CHECK (user_b IS NOT NULL OR (mode = 'AI' AND NOT ranked)),
  CONSTRAINT battles_ranked_random CHECK (ranked = (mode = 'RANDOM'))
);
CREATE INDEX battles_user_a_idx ON battles (user_a, created_at DESC);
CREATE INDEX battles_user_b_idx ON battles (user_b, created_at DESC);
CREATE INDEX battles_drafting_idx ON battles (pick_deadline) WHERE state = 'drafting';
CREATE INDEX battles_simulating_idx ON battles (completes_at) WHERE state = 'simulating';
CREATE TRIGGER battles_set_updated_at BEFORE UPDATE ON battles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE battle_picks (
  battle_id    BIGINT      NOT NULL REFERENCES battles (id) ON DELETE CASCADE,
  pick_number  SMALLINT    NOT NULL,         -- 1-based
  side         CHAR(1)     NOT NULL CHECK (side IN ('A', 'B')),
  athlete_id   BIGINT      NOT NULL REFERENCES athletes (id) ON DELETE CASCADE,
  slot         TEXT        NOT NULL,
  auto         BOOLEAN     NOT NULL DEFAULT FALSE,   -- picked by the server: timeout or the AI
  rating       JSONB       NOT NULL,                 -- snapshot: ovr, sub_ratings, position, names, school
  picked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (battle_id, pick_number),
  CONSTRAINT battle_picks_no_duplicates UNIQUE (battle_id, athlete_id)
);

COMMIT;
