# USports
U Sports fantasy league app built on real data from current Canadian university varsity athletics.

## Repository layout

| Path        | What                                                         | Status |
|-------------|--------------------------------------------------------------|--------|
| `db/`       | PostgreSQL schema, migrations, seeds, smoke test             | ✅ Phase 1 |
| `pipeline/` | Python 3.11+ ingestion (`usportspy` + usports.ca → Postgres) | ✅ Phase 2 (basketball) |
| `backend/`  | Node.js / Express / TypeScript REST API (`/api/v1`)          | Phase 3 |
| `docs/`     | Product rules, e.g. [athlete eligibility T&C](docs/terms/athlete-eligibility.md) | |

## Local setup

```bash
docker compose up -d db
cp .env.example .env
export DATABASE_URL=postgres://usports:usports@localhost:5432/usports_fantasy
./db/migrate.sh up && ./db/migrate.sh seed
cd pipeline && python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python ingest_usports.py --sport usports_mbk --rosters
```

See [`db/README.md`](db/README.md) for the data model and [`pipeline/README.md`](pipeline/README.md) for ingestion.
