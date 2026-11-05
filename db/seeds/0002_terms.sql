-- Current Terms & Conditions version. Users must accept it (and answer the
-- U Sports athlete question) before they can commission or join a league.
-- See docs/terms/athlete-eligibility.md for the clause text.
INSERT INTO terms_versions (version, document_url, is_current)
VALUES ('2026-11-01', NULL, TRUE)
ON CONFLICT (version) DO NOTHING;
