-- Default rulesets for the current season. Idempotent.
--
-- usports_mbk is the product-defined default ruleset:
--   roster_positions ["PG","SG","SF","PF","C","BENCH"]  (one slot each)
--   scoring {points 1.0, rebounds 1.2, assists 1.5, steals 3.0, blocks 3.0, turnovers -1.0}
-- usports_wbk mirrors it until a women's-specific ruleset is defined.
--
-- position_eligibility maps each starter slot to the normalised position
-- tokens (athletes.positions) that may fill it. U Sports rosters mostly list
-- generic G / F / C, so G fills PG or SG and F fills SF or PF.

INSERT INTO competitions (name, sport_id, season, roster_config_json, scoring_rules_json, is_default)
SELECT 'Standard', s.id, '2026-27',
       '{"roster_limits": {"PG":1,"SG":1,"SF":1,"PF":1,"C":1,"BENCH":1},
         "position_eligibility": {"PG":["PG","G"], "SG":["SG","G"],
                                  "SF":["SF","F"], "PF":["PF","F"], "C":["C"]}}'::jsonb,
       '{"points":1.0,"rebounds":1.2,"assists":1.5,"steals":3.0,"blocks":3.0,"turnovers":-1.0}'::jsonb,
       TRUE
  FROM sports s
 WHERE s.code IN ('usports_mbk', 'usports_wbk')
ON CONFLICT (sport_id, season, name) DO UPDATE
  SET roster_config_json = EXCLUDED.roster_config_json,
      scoring_rules_json = EXCLUDED.scoring_rules_json,
      is_default         = EXCLUDED.is_default;
