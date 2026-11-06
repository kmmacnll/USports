-- Reverts 0004_user_university.up.sql.
BEGIN;
ALTER TABLE users DROP COLUMN IF EXISTS university_id;
COMMIT;
