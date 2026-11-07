"""Season helpers.

U Sports labels winter seasons "2026-27". Box-score and schedule feeds also
use segment suffixes: "2026-27p" (playoffs) and "2026-27c" (championship).
"""
from __future__ import annotations

import datetime as dt
import re

_SEGMENT = re.compile(r"^(\d{4})-(\d{2})([a-z]?)$")

# Winter-sport feeds start in July with exhibition tours.
SEASON_ROLLOVER_MONTH = 7


def current_season(today: dt.date | None = None) -> str:
    today = today or dt.date.today()
    start = today.year if today.month >= SEASON_ROLLOVER_MONTH else today.year - 1
    return season_label(start)


def season_label(start_year: int) -> str:
    return f"{start_year}-{(start_year + 1) % 100:02d}"


def season_start_year(season: str) -> int:
    m = _SEGMENT.match(season)
    if not m:
        raise ValueError(f"not a season label: {season!r}")
    return int(m.group(1))


def split_segment(segment: str) -> tuple[str, str]:
    """'2025-26p' -> ('2025-26', 'p'); '2025-26' -> ('2025-26', '')."""
    m = _SEGMENT.match(segment.strip())
    if not m:
        raise ValueError(f"not a season segment: {segment!r}")
    return f"{m.group(1)}-{m.group(2)}", m.group(3)


# ------------------------------------------------------------------ data floor
# Only 2025-26 onward is ever ingested or rated (product decision for Draft
# Battles: older seasons describe rosters that have graduated).
MIN_SEASON = "2025-26"


class SeasonTooOld(ValueError):
    pass


def validate_season(season: str) -> str:
    """Reject anything before MIN_SEASON (and anything that isn't a season label)."""
    if season_start_year(season) < season_start_year(MIN_SEASON):
        raise SeasonTooOld(f"season {season} is before {MIN_SEASON}; only {MIN_SEASON} onward is ingested")
    return season


def seasons_since_floor(today: dt.date | None = None) -> list[str]:
    """MIN_SEASON .. current season, oldest first."""
    first = season_start_year(MIN_SEASON)
    last = season_start_year(current_season(today))
    return [season_label(y) for y in range(first, last + 1)]


# ------------------------------------------------------------------ in season
# Ingestion windows by sports.season_type, as (month, day) inclusive. Wide
# enough to cover exhibitions and national championships; outside them the
# nightly job skips the sport (--in-season-only).
SEASON_WINDOWS: dict[str, tuple[tuple[int, int], tuple[int, int]]] = {
    "FALL":   ((8, 1), (12, 15)),     # football to the Vanier Cup, soccer to nationals
    "WINTER": ((9, 15), (4, 15)),     # hockey, basketball, volleyball incl. March championships
    "SPRING": ((3, 1), (6, 30)),
}


def in_season(season_type: str, today: dt.date | None = None) -> bool:
    today = today or dt.date.today()
    (sm, sd), (em, ed) = SEASON_WINDOWS[season_type]
    md = (today.month, today.day)
    if (sm, sd) <= (em, ed):
        return (sm, sd) <= md <= (em, ed)
    return md >= (sm, sd) or md <= (em, ed)       # window wraps the new year
