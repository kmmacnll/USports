"""Integration test against a real Postgres: the CLI must COMMIT each sport,
and a second run must write nothing. (Regression: an implicit outer
transaction once turned every sport into a savepoint that was rolled back.)

Runs only when PIPELINE_TEST_DATABASE_URL points at a server whose role can
create databases; the test creates and drops its own database.
"""
import os
import pathlib
import subprocess

import psycopg
import pytest

import ingest_usports

ADMIN_URL = os.environ.get("PIPELINE_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not ADMIN_URL, reason="set PIPELINE_TEST_DATABASE_URL to run DB tests")
ROOT = pathlib.Path(__file__).resolve().parents[2]
FIXTURES = pathlib.Path(__file__).parent / "fixtures"


@pytest.fixture
def db_url():
    name = "usports_pipeline_test"
    base = ADMIN_URL.rsplit("/", 1)[0]
    with psycopg.connect(ADMIN_URL, autocommit=True) as c:
        c.execute(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")
        c.execute(f"CREATE DATABASE {name}")
    url = f"{base}/{name}"
    env = {**os.environ, "DATABASE_URL": url}
    for step in ("up", "seed"):
        subprocess.run([str(ROOT / "db" / "migrate.sh"), step], env=env, check=True, capture_output=True)
    # Only the fixture sport is active, so `--sport all` (the cron's path, which
    # queries the database before any sport runs) resolves to it alone.
    with psycopg.connect(url, autocommit=True) as c:
        c.execute("UPDATE sports SET is_active = (code = 'usports_mbk')")
    yield url
    with psycopg.connect(ADMIN_URL, autocommit=True) as c:
        c.execute(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")


def _counts(url):
    with psycopg.connect(url) as c:
        return c.execute("SELECT (SELECT count(*) FROM athletes), (SELECT count(*) FROM game_stats),"
                         " (SELECT count(*) FROM games)").fetchone()


def test_cli_commits_each_sport_and_reruns_are_noops(db_url, monkeypatch, capsys):
    monkeypatch.setenv("DATABASE_URL", db_url)
    argv = ["--sport", "all", "--season", "2026-27", "--source-dir", str(FIXTURES)]
    assert ingest_usports.main(argv) == 0
    assert _counts(db_url) == (2, 2, 1)          # persisted after the process's connection closed
    capsys.readouterr()
    assert ingest_usports.main(argv) == 0
    out = capsys.readouterr().out
    assert '"stat_lines_inserted": 0' in out and '"athletes_new": 0' in out
    assert _counts(db_url) == (2, 2, 1)


def test_dry_run_writes_nothing(db_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", db_url)
    assert ingest_usports.main(["--sport", "all", "--season", "2026-27",
                                "--source-dir", str(FIXTURES), "--dry-run"]) == 0
    assert _counts(db_url) == (0, 0, 0)
