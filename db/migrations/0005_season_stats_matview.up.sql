-- athlete_season_stats was a plain view: every request that showed player
-- stats re-aggregated every box-score line of every sport and season
-- (expanding each JSON stat key), even to show 8 players. It is now a
-- materialized view, indexed on (athlete_id, season), that the ingestion
-- pipeline refreshes at the end of each sync. Same name and columns.
BEGIN;
DROP VIEW athlete_season_stats;
CREATE MATERIALIZED VIEW athlete_season_stats AS
WITH lines AS (
  SELECT gs.athlete_id, g.season, gs.stat_payload_json, gs.fantasy_points_calculated
    FROM game_stats gs
    JOIN games g ON g.id = gs.game_id
   WHERE NOT g.is_exhibition
),
totals AS (
  SELECT l.athlete_id, l.season, kv.key, sum(kv.value::text::numeric) AS total
    FROM lines l
    CROSS JOIN LATERAL jsonb_each(l.stat_payload_json) kv
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
-- Unique index: needed for REFRESH ... CONCURRENTLY, and serves the API's lookups.
CREATE UNIQUE INDEX athlete_season_stats_key ON athlete_season_stats (athlete_id, season);
COMMIT;
