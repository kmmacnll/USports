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


class _DryRun(Exception):
    pass


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--sport", required=True, help=f"sport code or 'all' ({', '.join(sorted(ADAPTERS))})")
    p.add_argument("--season", default=None, help="e.g. 2026-27 (default: current season)")
    p.add_argument("--rosters", action="store_true", help="also scrape usports.ca roster pages")
    p.add_argument("--skip-stats", action="store_true", help="only run the roster scrape")
    p.add_argument("--render", action="store_true", help="render roster pages with Playwright")
    p.add_argument("--no-season-check", action="store_true",
                   help="skip usportspy's api.github.com season lookup (data downloads still go to GitHub)")
    p.add_argument("--source-dir", type=Path, help="read CSVs from a local directory instead of usportspy")
    p.add_argument("--dry-run", action="store_true", help="roll back all writes at the end")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    if args.no_season_check:
        disable_usportspy_season_check()

    sports = sorted(ADAPTERS) if args.sport == "all" else [args.sport]
    season = args.season or current_season()
    results = []
    conn = db.connect()
    try:
        try:
            with conn.transaction():
                for code in sports:
                    if not args.skip_stats:
                        results.append(sync_athletes_and_stats(code, season, conn=conn,
                                                               source_dir=args.source_dir))
                    if args.rosters:
                        results.append(sync_rosters(code, season, conn=conn, render=args.render))
                if args.dry_run:
                    raise _DryRun
        except _DryRun:
            logging.info("dry run: rolled back")
    finally:
        conn.close()
    print(json.dumps(results, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
