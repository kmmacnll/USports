-- Default rulesets for the current season (usports_current_season(), which
-- rolls over each July 1, so every deploy after that creates next season's
-- rows). Idempotent: re-running updates the current season's rules in place;
-- past seasons keep the rules they were played under.
--
-- slot_order keeps the display order (jsonb objects don't preserve key order).
-- position_eligibility maps each starter slot to the normalised position
-- tokens (athletes.positions) that may fill it. BENCH accepts anyone.
-- Scoring keys must match the stat keys the pipeline writes into
-- game_stats.raw_stats_json (grouped rules score "group_stat").
--
-- The U Sports feeds label every sport's season "YYYY-YY", football included.

-- Basketball (men's and women's share a ruleset for now):
--   starters G, G, F, F, C + 6 bench = 11 players per team.
INSERT INTO competitions (code, name, sport_id, season, roster_config_json, scoring_rules_json, is_default)
SELECT s.code || '_standard', 'Standard', s.id, usports_current_season(),
       '{"slot_order":           ["G","F","C","BENCH"],
         "roster_limits":        {"G":2,"F":2,"C":1,"BENCH":6},
         "position_eligibility": {"G":["G","PG","SG"], "F":["F","SF","PF"], "C":["C"]}}'::jsonb,
       '{"points":1.0,"rebounds":1.2,"assists":1.5,"steals":3.0,"blocks":3.0,"turnovers":-1.0}'::jsonb,
       TRUE
  FROM sports s
 WHERE s.code IN ('usports_mbk', 'usports_wbk')
ON CONFLICT (sport_id, season, name) DO UPDATE
  SET code               = EXCLUDED.code,
      roster_config_json = EXCLUDED.roster_config_json,
      scoring_rules_json = EXCLUDED.scoring_rules_json,
      is_default         = EXCLUDED.is_default;

-- Football: Half-PPR (product ruleset "usports_football_half_ppr").
--   Roster: QB 2, RB 3, WR 4, K 1, DEF 1 + 4 bench = 15.
--   DEF has no scoring rules yet, so it scores 0 until defensive rules are defined.
INSERT INTO competitions (code, name, sport_id, season, roster_config_json, scoring_rules_json, is_default)
SELECT 'usports_football_half_ppr', 'Half-PPR Scoring', s.id, usports_current_season(),
       '{"slot_order":           ["QB","RB","WR","K","DEF","BENCH"],
         "roster_limits":        {"QB":2,"RB":3,"WR":4,"K":1,"DEF":1,"BENCH":4},
         "position_eligibility": {"QB":["QB"], "RB":["RB","FB"], "WR":["WR","SB","TE"], "K":["K"],
                                  "DEF":["DL","DT","DE","LB","DB","CB","S"]}}'::jsonb,
       '{"passing":   {"yards":0.04, "touchdown":4.0, "interception":-2.0, "two_point":2.0},
         "rushing":   {"yards":0.1,  "touchdown":6.0, "two_point":2.0},
         "receiving": {"receptions":0.5, "yards":0.1, "touchdown":6.0, "two_point":2.0},
         "kicking":   {"fg_0_39":3.0, "fg_40_49":4.0, "fg_50_plus":5.0, "pat":1.0,
                       "single_rouge":1.0, "fg_missed":-1.0},
         "misc":      {"fumble_lost":-2.0}}'::jsonb,
       TRUE
  FROM sports s
 WHERE s.code = 'usports_fb'
ON CONFLICT (sport_id, season, name) DO UPDATE
  SET code               = EXCLUDED.code,
      roster_config_json = EXCLUDED.roster_config_json,
      scoring_rules_json = EXCLUDED.scoring_rules_json,
      is_default         = EXCLUDED.is_default;
