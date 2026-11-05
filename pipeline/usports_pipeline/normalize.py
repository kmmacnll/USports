"""Pure transformation helpers (no I/O) — unit tested in tests/test_normalize.py."""
from __future__ import annotations

import math
import re
import unicodedata
from typing import Any

import pandas as pd

_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_NON_ALPHA = re.compile(r"[^a-z]+")
# Old form: /players?id=abc123 ; newer feeds: /players/owenharrisi76j
_PLAYER_ID = re.compile(r"/players(?:\?id=|/)([A-Za-z0-9]+)")
_TEAM_ID = re.compile(r"/teams\?id=([A-Za-z0-9]+)")
_LINK_SEGMENT = re.compile(r"/sports/[a-z]+/([0-9]{4}-[0-9]{2}[a-z]?)/")


def fix_mojibake(s: str) -> str:
    """Repair UTF-8 text that was decoded as Latin-1 ("MontrÃ©al" -> "Montréal").
    Some usportspy feeds carry it; left as-is it breaks team and name matching."""
    if "Ã" in s or "Â" in s:
        try:
            return s.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            return s
    return s


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def slugify(name: str) -> str:
    """'Saint Mary's' -> 'saintmarys'; 'UMaine Fort-Kent' -> 'umainefortkent'.

    Hyphens and spaces are dropped (not kept as '-') because the source feeds
    are inconsistent about them ("Ontario Tech" vs "ontariotech").
    """
    return _NON_ALNUM.sub("", strip_accents(fix_mojibake(name)).lower())


def normalize_person_name(name: str) -> str:
    """Name key used for identity matching: accent-free, lower-case, letters only."""
    s = strip_accents(fix_mojibake(name)).lower().replace("'", "")
    return " ".join(_NON_ALPHA.sub(" ", s).split())


def split_name(full: str) -> tuple[str, str]:
    """'CJ Evans' -> ('CJ', 'Evans'); 'Evans, CJ' -> ('CJ', 'Evans')."""
    full = " ".join(fix_mojibake(str(full)).split())
    if "," in full:
        last, _, first = full.partition(",")
        return first.strip(), last.strip()
    first, _, last = full.partition(" ")
    return first, last or first


def player_id_from_link(link: Any) -> tuple[str | None, str | None]:
    """usports.ca player URL -> (player_id, season_segment)."""
    if not isinstance(link, str):
        return None, None
    m = _PLAYER_ID.search(link)
    if not m:
        return None, None
    seg = _LINK_SEGMENT.search(link)
    return m.group(1), seg.group(1) if seg else None


def team_id_from_link(link: Any) -> str | None:
    if not isinstance(link, str):
        return None
    m = _TEAM_ID.search(link)
    return m.group(1) if m else None


def is_missing(v: Any) -> bool:
    if v is None:
        return True
    try:
        return bool(pd.isna(v))
    except (TypeError, ValueError):  # list-likes
        return False


def to_number(v: Any) -> int | float | None:
    """CSV cell -> int/float, or None for blanks/NA/non-numeric ('26:30' -> 26.5)."""
    if is_missing(v):
        return None
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, (int, float)):
        f = float(v)
    else:
        s = str(v).strip()
        if not s or s.upper() in {"NA", "NAN", "-", "DNP"}:
            return None
        if re.fullmatch(r"\d+:\d{2}", s):
            mm, ss = s.split(":")
            return round(int(mm) + int(ss) / 60, 2)
        try:
            f = float(s)
        except ValueError:
            return None
    return int(f) if f.is_integer() else f


def jersey_text(v: Any) -> str | None:
    """usportspy parses jerseys as floats (so '00' arrives as 0.0); keep a clean string."""
    n = to_number(v)
    if n is None:
        s = None if is_missing(v) else str(v).strip()
        return s or None
    return str(int(n)) if float(n).is_integer() else str(n)


def to_bool(v: Any) -> bool:
    if is_missing(v):
        return False
    if isinstance(v, bool):
        return v
    return str(v).strip().upper() in {"TRUE", "T", "1", "YES", "Y"}


_HEIGHT_FT_IN = re.compile(r"^\s*(\d)\s*(?:-|'|’|ft|\s)\s*(\d{1,2})?\s*(?:\"|”|in)?\s*$")
_HEIGHT_CM = re.compile(r"^\s*(\d{3})\s*cm\s*$", re.I)
_HEIGHT_M = re.compile(r"^\s*([12][.,]\d{2})\s*m\s*$", re.I)


def height_to_cm(raw: Any) -> int | None:
    """'6-4' / 6'4\" / '193cm' / '1.93m' -> centimetres."""
    if is_missing(raw):
        return None
    s = str(raw).strip()
    if m := _HEIGHT_CM.match(s):
        cm = int(m.group(1))
    elif m := _HEIGHT_M.match(s):
        cm = round(float(m.group(1).replace(",", ".")) * 100)
    elif m := _HEIGHT_FT_IN.match(s):
        cm = round((int(m.group(1)) * 12 + int(m.group(2) or 0)) * 2.54)
    else:
        return None
    return cm if 120 <= cm <= 240 else None


def position_tokens(raw: Any, aliases: dict[str, str]) -> list[str]:
    """'G/F' -> ['G','F']; 'Guard' -> ['G'] (via aliases). Order kept, de-duplicated."""
    if is_missing(raw):
        return []
    out: list[str] = []
    for part in re.split(r"[/,\-\s]+", strip_accents(str(raw)).upper()):
        part = part.strip(".")
        if not part:
            continue
        tok = aliases.get(part, part)
        if tok not in out:
            out.append(tok)
    return out
