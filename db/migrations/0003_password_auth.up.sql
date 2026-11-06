-- Email + password sign-in. password_hash is NULL for users who sign in
-- through an identity provider (JWKS) instead. Format:
-- scrypt$<N>$<r>$<p>$<salt b64>$<key b64>
BEGIN;
ALTER TABLE users ADD COLUMN password_hash TEXT;
COMMIT;
