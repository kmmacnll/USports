"""Where stats come from, behind one interface.

sync_athletes_and_stats() never calls a data provider directly: it asks a
StatsSource for a sport's schedule and box-score frames (pandas DataFrames in
the layout the BoxScoreSpecs in sports.py describe). Replacing the scrapers
with a licensed feed later means writing one class with these two methods
that returns the same frames; nothing downstream changes.

Implementations:
  UsportspySource   usportspy (open U Sports data published as GitHub release
                    CSVs). The default.
  CsvDirSource      the same CSVs from a local directory (offline replays, tests).
  CachingSource     wraps another source and keeps a raw copy of every frame it
                    returns on disk (CsvDirSource layout), reusing it while it is
                    younger than max_age_s.

Conference sites (OUA, Canada West, RSEQ, AUS) are listed in
CONFERENCE_SITES. None of them is wired up as a stats source yet: each one
needs (1) its robots.txt checked for the stats paths (`ingest_usports.py
--check-sources` does this through PoliteHttpClient) and (2) a person to read
its terms of use and set `terms_reviewed=True`. conference_source() refuses
to build a source until both are true.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import pandas as pd

from .seasons import season_start_year, validate_season
from .sports import SportAdapter

log = logging.getLogger(__name__)


class StatsSource(Protocol):
    name: str

    def schedule(self, adapter: SportAdapter, season: str) -> pd.DataFrame: ...

    def box_frames(self, adapter: SportAdapter, season: str) -> dict[str, pd.DataFrame]: ...


class UsportspySource:
    name = "usportspy"

    def __init__(self, fetch=None) -> None:
        from .sync import fetch_with_retries
        self._fetch = fetch or fetch_with_retries

    def schedule(self, adapter: SportAdapter, season: str) -> pd.DataFrame:
        return self._fetch(f"{adapter.code} schedule", adapter.fetch_schedule)

    def box_frames(self, adapter: SportAdapter, season: str) -> dict[str, pd.DataFrame]:
        year = season_start_year(validate_season(season))
        return self._fetch(f"{adapter.code} box scores", lambda: adapter.fetch_frames([year]))


class CsvDirSource:
    """<dir>/<code>/schedule_<season>.csv (or schedule.csv) and
    <dir>/<code>/<frame>_<season>.csv for each of adapter.frame_names."""
    name = "csv"

    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def _schedule_path(self, adapter: SportAdapter, season: str) -> Path:
        base = self.root / adapter.code
        per_season = base / f"schedule_{season}.csv"
        return per_season if per_season.exists() else base / "schedule.csv"

    def schedule(self, adapter: SportAdapter, season: str) -> pd.DataFrame:
        return pd.read_csv(self._schedule_path(adapter, season))

    def box_frames(self, adapter: SportAdapter, season: str) -> dict[str, pd.DataFrame]:
        base = self.root / adapter.code
        return {n: pd.read_csv(base / f"{n}_{season}.csv") for n in adapter.frame_names}

    def has(self, adapter: SportAdapter, season: str) -> bool:
        base = self.root / adapter.code
        return (base / f"schedule_{season}.csv").exists() and all(
            (base / f"{n}_{season}.csv").exists() for n in adapter.frame_names)

    def age_s(self, adapter: SportAdapter, season: str) -> float:
        """Age of the OLDEST file in the set, so one refreshed file can't make
        the rest look fresh."""
        base = self.root / adapter.code
        files = [base / f"schedule_{season}.csv", *(base / f"{n}_{season}.csv" for n in adapter.frame_names)]
        return time.time() - min(f.stat().st_mtime for f in files)


class CachingSource:
    """Raw copy of everything `inner` returns, reused while fresh."""

    def __init__(self, inner: StatsSource, cache_dir: Path, max_age_s: float = 6 * 3600) -> None:
        self.inner = inner
        self.cache = CsvDirSource(cache_dir)
        self.max_age_s = max_age_s
        self.name = f"cached({inner.name})"
        self.hits = 0

    def _fresh(self, adapter: SportAdapter, season: str) -> bool:
        return self.cache.has(adapter, season) and self.cache.age_s(adapter, season) < self.max_age_s

    def schedule(self, adapter: SportAdapter, season: str) -> pd.DataFrame:
        if self._fresh(adapter, season):
            self.hits += 1
            return self.cache.schedule(adapter, season)
        df = self.inner.schedule(adapter, season)
        self._write(adapter, f"schedule_{season}.csv", df)
        return df

    def box_frames(self, adapter: SportAdapter, season: str) -> dict[str, pd.DataFrame]:
        if self._fresh(adapter, season):
            self.hits += 1
            return self.cache.box_frames(adapter, season)
        frames = self.inner.box_frames(adapter, season)
        for name, df in frames.items():
            self._write(adapter, f"{name}_{season}.csv", df)
        return frames

    def _write(self, adapter: SportAdapter, filename: str, df: pd.DataFrame) -> None:
        path = self.cache.root / adapter.code / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        df.to_csv(tmp, index=False)
        tmp.replace(path)


# ------------------------------------------------------------------ conferences

@dataclass(frozen=True)
class ConferenceSite:
    code: str                    # conference_code enum value
    name: str
    base_url: str
    # Paths to check against robots.txt before writing a parser. Placeholders
    # until someone confirms the real stats URLs on each site.
    probe_paths: tuple[str, ...] = ("/", "/sports/")
    terms_url: str | None = None
    terms_reviewed: bool = False         # a PERSON read the terms and allows automated access
    parser: str | None = None            # name of an implemented parser; none exist yet


CONFERENCE_SITES: dict[str, ConferenceSite] = {
    "OUA":  ConferenceSite("OUA", "Ontario University Athletics", "https://oua.ca"),
    "CW":   ConferenceSite("CW", "Canada West", "https://canadawest.org"),
    "RSEQ": ConferenceSite("RSEQ", "Réseau du sport étudiant du Québec", "https://rseq.ca"),
    "AUS":  ConferenceSite("AUS", "Atlantic University Sport", "https://www.atlanticuniversitysport.com"),
    # usports.ca itself: roster pages are scraped by rosters.py through the same client.
    "USPORTS": ConferenceSite("USPORTS", "U SPORTS", "https://en.usports.ca", probe_paths=("/", "/sports/")),
}


class SourceNotAllowed(RuntimeError):
    pass


def conference_source(code: str) -> StatsSource:
    site = CONFERENCE_SITES[code]
    if not site.terms_reviewed:
        raise SourceNotAllowed(f"{site.name}: terms of use not reviewed yet (sources.CONFERENCE_SITES)")
    if not site.parser:
        raise SourceNotAllowed(f"{site.name}: no stats parser implemented yet")
    raise SourceNotAllowed(f"{site.name}: parser {site.parser!r} is not registered")


def check_sources(client_factory) -> list[dict]:
    """robots.txt status of every registered site's probe paths.
    client_factory(source_code) -> PoliteHttpClient."""
    out = []
    for site in CONFERENCE_SITES.values():
        client = client_factory(site.code.lower())
        paths = {}
        for p in site.probe_paths:
            url = site.base_url.rstrip("/") + p
            try:
                paths[p] = client.robots_status(url)
            except Exception as e:  # noqa: BLE001
                paths[p] = f"error: {e}"
        out.append({"source": site.code, "base_url": site.base_url, "robots": paths,
                    "terms_reviewed": site.terms_reviewed, "parser": site.parser,
                    "usable": site.terms_reviewed and bool(site.parser)
                              and all(v == "allowed" for v in paths.values())})
    return out
