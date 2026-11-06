-- The university a user says they attend (optional, chosen at sign-up).
BEGIN;
ALTER TABLE users ADD COLUMN university_id BIGINT REFERENCES universities (id) ON DELETE SET NULL;
COMMIT;
