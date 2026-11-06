-- =============================================================================
-- 0006_stats_sources.up.sql
-- Stats ingestion v2 (Draft Battles, phase 1).
--
--   * game_stats.position: the position printed in THAT game's box score
--     (hockey prints one for starters, soccer for everyone). athletes.position
--     stays the athlete's current (roster) position; the per-game value lets
--     ratings use what a player actually played.
--   * raw_source_responses: the raw body of every HTTP page the pipeline
--     scrapes (roster pages, conference stat pages), so a parser fix can be
--     replayed without re-fetching, and fetches can be conditional
--     (ETag / Last-Modified). One row per (source, url): the latest response.
--
-- Raw stat lines (game_stats) and computed ratings (player_ratings, 0007) are
-- kept in separate tables so ratings can always be recomputed from scratch.
-- =============================================================================
BEGIN;

ALTER TABLE game_stats ADD COLUMN position TEXT;
COMMENT ON COLUMN game_stats.position IS
  'Position as printed in this game''s box score (raw), NULL when the feed has none.';

CREATE TABLE raw_source_responses (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source         TEXT        NOT NULL,        -- 'usports_roster', 'oua', 'canadawest', ...
  url            TEXT        NOT NULL,
  status_code    SMALLINT    NOT NULL,
  content_type   TEXT,
  etag           TEXT,
  last_modified  TEXT,
  body           TEXT,
  body_sha256    TEXT,
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT raw_source_responses_source_url_key UNIQUE (source, url)
);
CREATE INDEX raw_source_responses_fetched_idx ON raw_source_responses (source, fetched_at DESC);

COMMIT;
