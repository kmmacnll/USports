# USports
U Sports fantasy league app built on real data from current Canadian university varsity athletics.

## Repository layout

| Path        | What                                                         | Status |
|-------------|--------------------------------------------------------------|--------|
| `db/`       | PostgreSQL schema, migrations, seeds, smoke test             | ✅ Phase 1 |
| `pipeline/` | Python 3.11+ ingestion (`usportspy` + usports.ca → Postgres) | ✅ Phase 2 (basketball, football) |
| `backend/`  | Node.js / Express 5 / TypeScript REST API (`/api/v1`), incl. **Draft Battles** (1v1 draft + simulated matches, realtime) | ✅ Phase 3 |
| `web/`      | VarsityHQ web app: Next.js 16 / Tailwind 4 (`web/README.md`)  | ✅ |
| `docs/`     | Product rules, e.g. [athlete eligibility T&C](docs/terms/athlete-eligibility.md) | |

## Local setup

```bash
docker compose up -d db
cp .env.example .env
export DATABASE_URL=postgres://usports:usports@localhost:5432/usports_fantasy
./db/migrate.sh up && ./db/migrate.sh seed
cd pipeline && python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python ingest_usports.py --sport usports_mbk --rosters
cd ../backend && npm ci && cp .env.example .env
npm run dev:seed      # optional: fake players for every sport so Draft Battles works locally
npm run dev           # http://localhost:3000/api/v1/sports
cd ../web && npm ci && cp .env.example .env.local && npm run dev  # http://localhost:3001
```

**Deploying:** [`docs/deploy-render.md`](docs/deploy-render.md) (Render Blueprint in `render.yaml`).

See [`db/README.md`](db/README.md) for the data model, [`pipeline/README.md`](pipeline/README.md) for ingestion, and [`backend/README.md`](backend/README.md) for the API.
