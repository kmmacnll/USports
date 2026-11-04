# USports
U Sports fantasy league app built on real data from current Canadian university varsity athletics.

## Repository layout

| Path        | What                                                         | Status |
|-------------|--------------------------------------------------------------|--------|
| `db/`       | PostgreSQL schema, migrations, seeds, smoke test             | ✅ Phase 1 |
| `pipeline/` | Python 3.11+ ingestion (`usportspy` → Postgres upserts)      | Phase 2 |
| `backend/`  | Node.js / Express / TypeScript REST API (`/api/v1`)          | Phase 3 |

## Local database

```bash
docker compose up -d db
cp .env.example .env
export DATABASE_URL=postgres://usports:usports@localhost:5432/usports_fantasy
./db/migrate.sh up && ./db/migrate.sh seed
```

See [`db/README.md`](db/README.md) for the data model.
