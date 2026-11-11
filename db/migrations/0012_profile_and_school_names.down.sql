ALTER TABLE users DROP CONSTRAINT IF EXISTS users_avatar_shape;
ALTER TABLE users DROP COLUMN IF EXISTS avatar_data_url;
UPDATE universities SET name = 'Alberta'     WHERE name = 'UofA';
UPDATE universities SET name = 'Calgary'     WHERE name = 'UofC';
UPDATE universities SET name = 'Mount Royal' WHERE name = 'MRU';
