-- Reference data: U Sports disciplines. Idempotent.
-- is_active = TRUE marks the sports we support for fantasy at launch;
-- the rest are catalogued so the pipeline can map them later.
INSERT INTO sports (name, gender, code, is_active) VALUES
  ('Basketball',        'MEN',   'MBB',  TRUE),
  ('Basketball',        'WOMEN', 'WBB',  TRUE),
  ('Ice Hockey',        'MEN',   'MIH',  TRUE),
  ('Ice Hockey',        'WOMEN', 'WIH',  TRUE),
  ('Football',          'MEN',   'FB',   TRUE),
  ('Volleyball',        'MEN',   'MVB',  FALSE),
  ('Volleyball',        'WOMEN', 'WVB',  FALSE),
  ('Soccer',            'MEN',   'MSOC', FALSE),
  ('Soccer',            'WOMEN', 'WSOC', FALSE),
  ('Rugby',             'WOMEN', 'WRUG', FALSE)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      gender = EXCLUDED.gender,
      is_active = EXCLUDED.is_active;
