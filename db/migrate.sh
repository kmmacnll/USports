#!/usr/bin/env bash
# Minimal, dependency-free migration runner (psql only).
#
#   DATABASE_URL=postgres://... ./db/migrate.sh up      # apply pending *.up.sql
#   DATABASE_URL=postgres://... ./db/migrate.sh down    # revert latest migration
#   DATABASE_URL=postgres://... ./db/migrate.sh seed    # run db/seeds/*.sql (idempotent)
#   DATABASE_URL=postgres://... ./db/migrate.sh status
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${DATABASE_URL:?DATABASE_URL must be set}"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -q)

"${PSQL[@]}" -c "CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());"

applied() { "${PSQL[@]}" -At -c "SELECT version FROM schema_migrations ORDER BY version"; }

case "${1:-up}" in
  up)
    done_list="$(applied)"
    for f in "$DIR"/migrations/*.up.sql; do
      v="$(basename "$f" .up.sql)"
      grep -qxF "$v" <<<"$done_list" && continue
      echo "→ applying $v"
      "${PSQL[@]}" -f "$f"
      "${PSQL[@]}" -c "INSERT INTO schema_migrations (version) VALUES ('$v')"
    done
    echo "✓ up to date"
    ;;
  down)
    v="$(applied | tail -n1)"
    [[ -z "$v" ]] && { echo "nothing to revert"; exit 0; }
    echo "← reverting $v"
    "${PSQL[@]}" -f "$DIR/migrations/$v.down.sql"
    "${PSQL[@]}" -c "DELETE FROM schema_migrations WHERE version = '$v'"
    ;;
  seed)
    for f in "$DIR"/seeds/*.sql; do echo "→ seeding $(basename "$f")"; "${PSQL[@]}" -f "$f"; done
    ;;
  status)
    applied
    ;;
  *) echo "usage: $0 {up|down|seed|status}" >&2; exit 2 ;;
esac
