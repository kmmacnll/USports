-- =============================================================================
-- 0009_matchmaking.up.sql
-- Draft Battles phase 5: friend invites, notifications inbox, ranked queue.
--
--   users.username     optional unique handle, searched by "Play a Friend"
--   battle_profiles    per-user Elo + division (phase 6 maintains them;
--                      the queue matches on division)
--   battle_invites     friend invites: realtime (60 s) when the friend is
--                      online, otherwise inbox (24 h); the invite owns a
--                      'queued' battle that starts drafting on accept
--   notifications      in-app inbox
--   battle_queue       ranked FIFO queue, one row per waiting user
-- =============================================================================
BEGIN;

ALTER TABLE users ADD COLUMN username CITEXT
  CONSTRAINT users_username_format CHECK (username ~ '^[A-Za-z0-9_.]{3,20}$');
CREATE UNIQUE INDEX users_username_key ON users (username);

CREATE TYPE battle_division AS ENUM ('WALK_ON', 'BENCH', 'STARTER', 'VARSITY', 'ALL_STAR', 'CAPTAIN', 'HALL_OF_FAME');

CREATE TABLE battle_profiles (
  user_id        BIGINT          PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  elo            INTEGER         NOT NULL DEFAULT 1000,
  division       battle_division NOT NULL DEFAULT 'WALK_ON',
  ranked_played  INTEGER         NOT NULL DEFAULT 0,
  ranked_wins    INTEGER         NOT NULL DEFAULT 0,
  ranked_losses  INTEGER         NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ     NOT NULL DEFAULT now()
);
CREATE TRIGGER battle_profiles_set_updated_at BEFORE UPDATE ON battle_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TYPE battle_invite_status AS ENUM ('pending', 'accepted', 'declined', 'expired', 'cancelled');

CREATE TABLE battle_invites (
  id            BIGINT               GENERATED ALWAYS AS IDENTITY PRIMARY KEY,   -- public id: inv_<id>
  battle_id     BIGINT               NOT NULL REFERENCES battles (id) ON DELETE CASCADE,
  from_user     BIGINT               NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  to_user       BIGINT               NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status        battle_invite_status NOT NULL DEFAULT 'pending',
  delivery      TEXT                 NOT NULL CHECK (delivery IN ('realtime', 'inbox')),
  expires_at    TIMESTAMPTZ          NOT NULL,
  responded_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ          NOT NULL DEFAULT now(),
  CONSTRAINT battle_invites_not_self CHECK (from_user <> to_user)
);
CREATE INDEX battle_invites_to_idx ON battle_invites (to_user, created_at DESC);
CREATE INDEX battle_invites_from_idx ON battle_invites (from_user, created_at DESC);
CREATE INDEX battle_invites_pending_idx ON battle_invites (expires_at) WHERE status = 'pending';

CREATE TABLE notifications (
  id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,   -- public id: ntf_<id>
  user_id     BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind        TEXT        NOT NULL,                                    -- 'battle_invite', ...
  payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at     TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE battle_queue (
  user_id      BIGINT          PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  sport_id     SMALLINT        NOT NULL REFERENCES sports (id),
  division     battle_division NOT NULL,
  elo          INTEGER         NOT NULL,
  enqueued_at  TIMESTAMPTZ     NOT NULL
);
CREATE INDEX battle_queue_fifo_idx ON battle_queue (sport_id, enqueued_at);

-- how long ranked players waited (for the queue's wait estimate)
ALTER TABLE battles ADD COLUMN queue_wait_ms INTEGER;

COMMIT;
