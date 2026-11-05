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
