-- Reverts 0003_password_auth.up.sql.
BEGIN;
ALTER TABLE users DROP COLUMN IF EXISTS password_hash;
COMMIT;
