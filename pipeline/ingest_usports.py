#!/usr/bin/env python3
"""U Sports -> PostgreSQL ingestion CLI.

  python ingest_usports.py --sport usports_mbk                 # schedule + box scores, current season
  python ingest_usports.py --sport usports_mbk --rosters       # ...then scrape usports.ca rosters
  python ingest_usports.py --sport all --season 2026-27
  python ingest_usports.py --sport usports_mbk --dry-run       # run everything, roll back

Requires DATABASE_URL. Safe to re-run: all writes are upserts.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from usports_pipeline import db
from usports_pipeline.rosters import sync_rosters
from usports_pipeline.seasons import current_season
from usports_pipeline.sports import ADAPTERS
from usports_pipeline.sync import disable_usportspy_season_check, sync_athletes_and_stats


log = logging.getLogger("ingest")


class _DryRun(Exception):
    pass


def resolve_sports(conn, arg: str) -> list[str]:
    """'all' -> every active sport in the database that has an adapter;
    otherwise a comma-separated list of sport codes."""
    if arg != "all":
        return [c.strip() for c in arg.split(",") if c.strip()]
    with conn.cursor() as cur:
        cur.execute("SELECT code FROM sports WHERE is_active ORDER BY season_type, code")
        active = [r[0] for r in cur.fetchall()]
    missing = [c for c in active if c not in ADAPTERS]
    if missing:
        log.warning("active sports with no ingestion adapter (skipped): %s", ", ".join(missing))
    return [c for c in active if c in ADAPTERS]


def run_step(conn, label: str, fn, dry_run: bool) -> tuple[dict | None, str | None]:
    """Run one sport's step in its own transaction. Any failure rolls back
    only this step and is reported, so one broken feed can't stop the rest."""
    try:
        with conn.transaction():
            result = fn()
            if dry_run:
                raise _DryRun
        return result, None
    except _DryRun:
        return result, None
    except Exception as e:  # noqa: BLE001 - isolate every sport
        log.warning("%s FAILED (%s: %s) - continuing with the next sport", label, type(e).__name__, e)
        log.debug("traceback for %s", label, exc_info=True)
        return None, f"{type(e).__name__}: {e}"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--sport", required=True,
                   help=f"'all' (active sports in the database), or codes, comma-separated ({', '.join(sorted(ADAPTERS))})")
    p.add_argument("--season", default=None, help="e.g. 2026-27 (default: current season)")
    p.add_argument("--rosters", action="store_true", help="also scrape usports.ca roster pages")
    p.add_argument("--skip-stats", action="store_true", help="only run the roster scrape")
    p.add_argument("--render", action="store_true", help="render roster pages with Playwright")
    p.add_argument("--no-season-check", action="store_true",
                   help="skip usportspy's api.github.com season lookup (data downloads still go to GitHub)")
    p.add_argument("--source-dir", type=Path, help="read CSVs from a local directory instead of usportspy")
    p.add_argument("--dry-run", action="store_true", help="roll back all writes")
    p.add_argument("--strict", action="store_true", help="exit 1 if any sport fails (default: only if all fail)")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    if args.no_season_check:
        disable_usportspy_season_check()

    season = args.season or current_season()
    results: list[dict] = []
    failures: dict[str, str] = {}
    conn = db.connect()
    # Autocommit, so each sport's `with conn.transaction()` is a real, committed
    # transaction. Without it the first query (resolve_sports) implicitly opens
    # one outer transaction, every sport becomes a savepoint inside it, and
    # closing the connection rolls the whole run back.
    conn.autocommit = True
    try:
        sports = resolve_sports(conn, args.sport)
        unknown = [c for c in sports if c not in ADAPTERS]
        for code in unknown:
            failures[code] = "no ingestion adapter"
        for code in [c for c in sports if c in ADAPTERS]:
            if not args.skip_stats:
                res, err = run_step(conn, f"{code} stats",
                                    lambda: sync_athletes_and_stats(code, season, conn=conn, source_dir=args.source_dir),
                                    args.dry_run)
                if err:
                    failures[f"{code} stats"] = err
                elif res:
                    results.append(res)
            if args.rosters:
                res, err = run_step(conn, f"{code} rosters",
                                    lambda: sync_rosters(code, season, conn=conn, render=args.render), args.dry_run)
                if err:
                    failures[f"{code} rosters"] = err
                elif res:
                    results.append(res)
    finally:
        conn.close()

    print(json.dumps({"season": season, "dry_run": args.dry_run, "results": results, "failures": failures},
                     indent=2, default=str))
    ok = len(results)
    if failures:
        log.warning("%d step(s) failed, %d succeeded: %s", len(failures), ok, ", ".join(failures))
    if failures and (args.strict or ok == 0):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
