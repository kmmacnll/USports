-- =============================================================================
-- 0010_ladder.up.sql
-- Draft Battles phase 6: Elo on ranked battles and weekly division ladders.
--
--   battles.elo_*            each side's Elo before/after a ranked battle
--   ladder_cohorts           weekly groups of up to 30 players in one division
--   ladder_memberships       a player's cohort, weekly wins/losses and, after
--                            the reset, their final rank and outcome
--   ladder_resets            weeks already closed (the reset is idempotent)
-- Weeks start Monday 00:00 America/Toronto; week_start is that local date.
-- =============================================================================
BEGIN;

ALTER TABLE battles
  ADD COLUMN elo_a_before INTEGER, ADD COLUMN elo_a_after INTEGER,
  ADD COLUMN elo_b_before INTEGER, ADD COLUMN elo_b_after INTEGER;

CREATE TABLE ladder_cohorts (
  id          BIGINT          GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  week_start  DATE            NOT NULL,
  division    battle_division NOT NULL,
  created_at  TIMESTAMPTZ     NOT NULL DEFAULT now()
);
CREATE INDEX ladder_cohorts_week_idx ON ladder_cohorts (week_start, division);

CREATE TABLE ladder_memberships (
  week_start    DATE            NOT NULL,
  user_id       BIGINT          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  cohort_id     BIGINT          NOT NULL REFERENCES ladder_cohorts (id) ON DELETE CASCADE,
  division      battle_division NOT NULL,
  wins          INTEGER         NOT NULL DEFAULT 0,
  losses        INTEGER         NOT NULL DEFAULT 0,
  elo_at_start  INTEGER         NOT NULL,
  final_rank    INTEGER,
  outcome       TEXT            CHECK (outcome IN ('promoted', 'relegated', 'stayed')),
  joined_at     TIMESTAMPTZ     NOT NULL DEFAULT now(),
  PRIMARY KEY (week_start, user_id)
);
CREATE INDEX ladder_memberships_cohort_idx ON ladder_memberships (cohort_id);

CREATE TABLE ladder_resets (
  week_start    DATE        PRIMARY KEY,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  cohorts       INTEGER     NOT NULL,
  promoted      INTEGER     NOT NULL,
  relegated     INTEGER     NOT NULL
);

COMMIT;
