-- Reverts 0009_matchmaking.up.sql.
BEGIN;
ALTER TABLE battles DROP COLUMN IF EXISTS queue_wait_ms;
DROP TABLE IF EXISTS battle_queue;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS battle_invites;
DROP TYPE IF EXISTS battle_invite_status;
DROP TABLE IF EXISTS battle_profiles;
DROP TYPE IF EXISTS battle_division;
DROP INDEX IF EXISTS users_username_key;
ALTER TABLE users DROP COLUMN IF EXISTS username;
COMMIT;
