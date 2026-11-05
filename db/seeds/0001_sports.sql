-- Reference data: U Sports disciplines. Idempotent.
-- is_active = TRUE: the ingestion pipeline has an adapter for the sport and it
-- is offered in GET /api/v1/sports. Flip a sport on once its adapter and a
-- default competition exist.
INSERT INTO sports (code, name, gender, is_active) VALUES
  ('usports_mbk',  'Men''s Basketball',   'MEN',   TRUE),
  ('usports_wbk',  'Women''s Basketball', 'WOMEN', TRUE),
  ('usports_mhk',  'Men''s Ice Hockey',   'MEN',   FALSE),
  ('usports_whk',  'Women''s Ice Hockey', 'WOMEN', FALSE),
  ('usports_fb',   'Football',            'MEN',   FALSE),
  ('usports_mvb',  'Men''s Volleyball',   'MEN',   FALSE),
  ('usports_wvb',  'Women''s Volleyball', 'WOMEN', FALSE),
  ('usports_msoc', 'Men''s Soccer',       'MEN',   FALSE),
  ('usports_wsoc', 'Women''s Soccer',     'WOMEN', FALSE)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      gender = EXCLUDED.gender,
      is_active = EXCLUDED.is_active;
