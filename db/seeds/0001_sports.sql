-- Reference data: the U Sports disciplines. Idempotent.
--
-- is_active = TRUE: the ingestion pipeline has an adapter for the sport (it has
-- per-game player box scores in usportspy), a default ruleset exists, and the
-- sport is offered by GET /api/v1/sports. The rest are catalogued so they can
-- be switched on when a data source exists:
--   field hockey  - usportspy has no player box scores for the current season
--   rugby         - schedules only (no player stats)
--   track & field, cross-country, swimming, wrestling - rankings / meet results,
--                   not head-to-head games (needs a meet-based fantasy model)
--   curling       - not covered by usportspy
INSERT INTO sports (code, name, gender, season_type, is_active) VALUES
  ('usports_fb',   'Football',                 'MEN',   'FALL',   TRUE),
  ('usports_msoc', 'Men''s Soccer',            'MEN',   'FALL',   TRUE),
  ('usports_wsoc', 'Women''s Soccer',          'WOMEN', 'FALL',   TRUE),
  ('usports_wfh',  'Women''s Field Hockey',    'WOMEN', 'FALL',   FALSE),
  ('usports_wrug', 'Women''s Rugby',           'WOMEN', 'FALL',   FALSE),
  ('usports_mxc',  'Men''s Cross Country',     'MEN',   'FALL',   FALSE),
  ('usports_wxc',  'Women''s Cross Country',   'WOMEN', 'FALL',   FALSE),
  ('usports_mbk',  'Men''s Basketball',        'MEN',   'WINTER', TRUE),
  ('usports_wbk',  'Women''s Basketball',      'WOMEN', 'WINTER', TRUE),
  ('usports_mhk',  'Men''s Ice Hockey',        'MEN',   'WINTER', TRUE),
  ('usports_whk',  'Women''s Ice Hockey',      'WOMEN', 'WINTER', TRUE),
  ('usports_mvb',  'Men''s Volleyball',        'MEN',   'WINTER', TRUE),
  ('usports_wvb',  'Women''s Volleyball',      'WOMEN', 'WINTER', TRUE),
  ('usports_mtf',  'Men''s Track & Field',     'MEN',   'WINTER', FALSE),
  ('usports_wtf',  'Women''s Track & Field',   'WOMEN', 'WINTER', FALSE),
  ('usports_mswm', 'Men''s Swimming',          'MEN',   'WINTER', FALSE),
  ('usports_wswm', 'Women''s Swimming',        'WOMEN', 'WINTER', FALSE),
  ('usports_mwr',  'Men''s Wrestling',         'MEN',   'WINTER', FALSE),
  ('usports_wwr',  'Women''s Wrestling',       'WOMEN', 'WINTER', FALSE),
  ('usports_mcur', 'Men''s Curling',           'MEN',   'WINTER', FALSE),
  ('usports_wcur', 'Women''s Curling',         'WOMEN', 'WINTER', FALSE)
ON CONFLICT (code) DO UPDATE
  SET name        = EXCLUDED.name,
      gender      = EXCLUDED.gender,
      season_type = EXCLUDED.season_type,
      is_active   = EXCLUDED.is_active;
