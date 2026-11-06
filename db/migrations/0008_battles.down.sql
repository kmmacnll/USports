-- Reverts 0008_battles.up.sql.
BEGIN;
DROP TABLE IF EXISTS battle_picks;
DROP TABLE IF EXISTS battles;
DROP TYPE IF EXISTS battle_mode;
DROP TYPE IF EXISTS battle_state;
COMMIT;
