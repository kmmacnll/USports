-- Default rulesets for the 2025-26 season. Idempotent.
-- These drive game_stats.fantasy_points_calculated and are the templates
-- users pick from when creating a league. Stat keys must match the keys the
-- ingestion pipeline writes into game_stats.raw_stats_json.

INSERT INTO competitions (name, sport_id, season, roster_config_json, scoring_rules_json, is_default)
SELECT v.name, s.id, v.season, v.roster::jsonb, v.scoring::jsonb, TRUE
FROM (VALUES
  ('Standard', 'MBB', '2025-26',
   '{"slots":[{"position":"G","count":2,"eligible":["G"]},
              {"position":"F","count":2,"eligible":["F"]},
              {"position":"C","count":1,"eligible":["C"]},
              {"position":"UTIL","count":1,"eligible":["*"]}],
     "bench":4,"injured_reserve":1}',
   '{"version":1,
     "stats":{"pts":1,"reb":1.2,"ast":1.5,"stl":3,"blk":3,"to":-1,"fg3m":0.5},
     "bonuses":[{"name":"double_double","value":5},{"name":"triple_double","value":10}]}'),
  ('Standard', 'WBB', '2025-26',
   '{"slots":[{"position":"G","count":2,"eligible":["G"]},
              {"position":"F","count":2,"eligible":["F"]},
              {"position":"C","count":1,"eligible":["C"]},
              {"position":"UTIL","count":1,"eligible":["*"]}],
     "bench":4,"injured_reserve":1}',
   '{"version":1,
     "stats":{"pts":1,"reb":1.2,"ast":1.5,"stl":3,"blk":3,"to":-1,"fg3m":0.5},
     "bonuses":[{"name":"double_double","value":5},{"name":"triple_double","value":10}]}'),
  ('Standard', 'MIH', '2025-26',
   '{"slots":[{"position":"F","count":4,"eligible":["F","C","LW","RW"]},
              {"position":"D","count":2,"eligible":["D"]},
              {"position":"G","count":1,"eligible":["G"]}],
     "bench":3,"injured_reserve":1}',
   '{"version":1,
     "stats":{"g":3,"a":2,"pm":0.5,"sog":0.4,"pim":-0.25,"ppp":0.5,
              "gk_w":4,"gk_sv":0.2,"gk_ga":-1,"gk_so":3}}'),
  ('Standard', 'WIH', '2025-26',
   '{"slots":[{"position":"F","count":4,"eligible":["F","C","LW","RW"]},
              {"position":"D","count":2,"eligible":["D"]},
              {"position":"G","count":1,"eligible":["G"]}],
     "bench":3,"injured_reserve":1}',
   '{"version":1,
     "stats":{"g":3,"a":2,"pm":0.5,"sog":0.4,"pim":-0.25,"ppp":0.5,
              "gk_w":4,"gk_sv":0.2,"gk_ga":-1,"gk_so":3}}'),
  ('Standard', 'FB', '2025',
   '{"slots":[{"position":"QB","count":1,"eligible":["QB"]},
              {"position":"RB","count":1,"eligible":["RB"]},
              {"position":"REC","count":3,"eligible":["WR","SB","TE"]},
              {"position":"FLEX","count":1,"eligible":["RB","WR","SB","TE"]},
              {"position":"K","count":1,"eligible":["K","P"]},
              {"position":"DEF","count":2,"eligible":["DL","LB","DB"]}],
     "bench":5,"injured_reserve":1}',
   '{"version":1,
     "stats":{"pass_yds":0.04,"pass_td":4,"int_thrown":-2,
              "rush_yds":0.1,"rush_td":6,"rec":0.5,"rec_yds":0.1,"rec_td":6,
              "fum_lost":-2,"fg_made":3,"pat_made":1,"rouge":1,
              "tkl":1,"sack":3,"def_int":4,"ff":2,"fr":2,"def_td":6}}')
) AS v(name, code, season, roster, scoring)
JOIN sports s ON s.code = v.code
ON CONFLICT (sport_id, season, name) DO UPDATE
  SET roster_config_json = EXCLUDED.roster_config_json,
      scoring_rules_json = EXCLUDED.scoring_rules_json,
      is_default         = EXCLUDED.is_default;
