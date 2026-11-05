"""DataFrame (usportspy) -> plain records ready for the database. No I/O."""
from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass, field

import pandas as pd

from .normalize import (
    fix_mojibake, is_missing, jersey_text, normalize_person_name, player_id_from_link, slugify,
    split_name, team_id_from_link, to_bool, to_number,
)
from .seasons import split_segment
from .sports import BoxScoreSpec


@dataclass
class TeamRecord:
    slug: str
    name: str
    is_member: bool


@dataclass
class GameRecord:
    source_game_id: str
    season: str
    season_segment: str
    game_date: dt.date
    home_slug: str
    away_slug: str
    home_score: int | None
    away_score: int | None
    status: str
    is_exhibition: bool
    is_conference_game: bool
    is_playoff: bool
    box_score_url: str | None


@dataclass
class PlayerLine:
    source_game_id: str
    team_slug: str
    opponent_slug: str
    full_name: str
    first_name: str
    last_name: str
    name_norm: str
    player_id: str | None
    season_segment: str | None
    jersey_number: str | None
    is_starter: bool | None
    game_date: dt.date
    stats: dict[str, int | float] = field(default_factory=dict)
    position: str | None = None          # raw position from the box score, when the feed has one


@dataclass
class TeamSeasonRecord:
    slug: str
    usports_team_id: str
    team_url: str


@dataclass
class LinesResult:
    lines: list[PlayerLine]
    team_seasons: list[TeamSeasonRecord]
    counts: dict[str, int]
    # slug -> display name seen in box scores ("Queen's"), used when the
    # schedule only has a slug-like spelling ("queens")
    name_hints: dict[str, str] = field(default_factory=dict)


def _display_name_preference(name: str) -> tuple[int, int]:
    """Prefer the published display form ('Ontario Tech') over slug-like
    variants ('ontariotech') when the feed contains both."""
    return (any(c.isupper() for c in name), name.count(" "))


_GAME_ID_DATE = re.compile(r"^(\d{8})_")


def game_date(raw_date, game_id) -> dt.date | None:
    """Schedule date, falling back to the date encoded in the usports.ca game
    id ("20260822_qaam" -> 2026-08-22); some feeds leave the date blank."""
    if not is_missing(raw_date) and re.fullmatch(r"\d{4,6}", str(raw_date).strip()):
        # R exports some dates as days since 1970-01-01 ("20674" -> 2026-08-08).
        return dt.date(1970, 1, 1) + dt.timedelta(days=int(str(raw_date).strip()))
    if not is_missing(raw_date):
        parsed = pd.to_datetime(raw_date, errors="coerce")
        if not pd.isna(parsed):
            return parsed.date()
    m = _GAME_ID_DATE.match(str(game_id))
    return dt.datetime.strptime(m.group(1), "%Y%m%d").date() if m else None


def build_schedule(df: pd.DataFrame, season: str, today: dt.date | None = None
                   ) -> tuple[list[TeamRecord], list[GameRecord]]:
    """Games for `season` that involve at least one U Sports member.

    Membership is derived from the data: a team is a U Sports member if it
    plays at least one conference game in the season. Exhibition-only
    opponents (NCAA, colleges, all-star teams) are kept as non-members so
    exhibition games still have both sides.
    """
    today = today or dt.date.today()
    rows = df[df["season"].astype(str).str.startswith(season)].copy()
    rows = rows[rows["home_team"].notna() & rows["away_team"].notna() & rows["game_id"].notna()]

    conf = rows[rows["conference"].map(to_bool)]
    member_slugs = {slugify(t) for t in pd.concat([conf["home_team"], conf["away_team"]])}

    names: dict[str, str] = {}
    games: list[GameRecord] = []
    for r in rows.itertuples(index=False):
        home, away = slugify(r.home_team), slugify(r.away_team)
        if home == away or (home not in member_slugs and away not in member_slugs):
            continue
        for slug, name in ((home, r.home_team), (away, r.away_team)):
            if slug not in names or _display_name_preference(name) > _display_name_preference(names[slug]):
                names[slug] = name

        date = game_date(r.date, r.game_id)
        if date is None:
            continue
        base, suffix = split_segment(str(r.season))
        hs, as_ = to_number(r.home_score), to_number(r.away_score)
        final = hs is not None and as_ is not None
        games.append(GameRecord(
            source_game_id=str(r.game_id),
            season=base,
            season_segment=str(r.season),
            game_date=date,
            home_slug=home,
            away_slug=away,
            home_score=int(hs) if final else None,
            away_score=int(as_) if final else None,
            status="FINAL" if final else "SCHEDULED",
            is_exhibition=to_bool(r.exhibition),
            is_conference_game=to_bool(r.conference),
            is_playoff=bool(suffix) or to_bool(getattr(r, "playoffs", False))
                       or to_bool(getattr(r, "championship", False)),
            box_score_url=None if is_missing(r.game_link) else str(r.game_link),
        ))

    teams = [TeamRecord(slug=s, name=n, is_member=s in member_slugs) for s, n in names.items()]
    return teams, games


class SchemaDriftError(RuntimeError):
    """A feed no longer has the columns its adapter expects (layout changed)."""


def resolve_side(game: GameRecord, label, status=None, index_sides: dict[str, str] | None = None
                 ) -> tuple[str, str] | None:
    """Which schedule team a box-score row belongs to -> (team_slug, opponent_slug).

    Tries, in order: an explicit home/away column; an index label the feed
    uses instead of a name (hockey writes "1"/"2" for away/home); and finally
    the team label matched against the schedule's two teams.
    """
    side = "" if is_missing(status) else str(status).strip().lower()
    if side not in ("home", "away") and index_sides and not is_missing(label):
        side = index_sides.get(str(label).strip(), "")
    if side not in ("home", "away") and not is_missing(label):
        slug = slugify(str(label))
        side = "home" if slug == game.home_slug else "away" if slug == game.away_slug else ""
    if side == "home":
        return game.home_slug, game.away_slug
    if side == "away":
        return game.away_slug, game.home_slug
    return None


def build_player_lines(df: pd.DataFrame, spec: BoxScoreSpec, games: list[GameRecord]) -> LinesResult:
    """Normalise one sport's player box score into PlayerLines.

    Generic over sports: everything sport-specific (column names, how the team
    is identified, starter flag, stat columns) comes from the BoxScoreSpec.
    The stat line becomes a flat {canonical_key: number} payload.

    Raises SchemaDriftError if required columns are missing (the source layout
    changed); missing optional stat columns are only counted, not fatal.
    """
    missing = [c for c in spec.required_columns() if c not in df.columns]
    if missing:
        raise SchemaDriftError(f"box score is missing required column(s) {missing}; "
                               f"columns present: {sorted(df.columns)[:40]}")

    by_game = {g.source_game_id: g for g in games}
    counts = {"rows": len(df), "no_game": 0, "no_team": 0, "team_rows": 0, "did_not_play": 0, "kept": 0,
              "missing_stat_columns": len([c for c in spec.stat_columns if c not in df.columns])}
    lines: list[PlayerLine] = []
    team_seasons: dict[str, TeamSeasonRecord] = {}
    hints: dict[str, str] = {}

    if spec.row_filter:
        df = spec.row_filter(df)

    for r in df.to_dict("records"):
        game = by_game.get(str(r.get("game_id")))
        if game is None:
            counts["no_game"] += 1
            continue
        label = r.get(spec.team_label_column) if spec.team_label_column else None
        status = r.get(spec.team_side_column) if spec.team_side_column else None
        sides = resolve_side(game, label, status, spec.team_index_sides)
        if sides is None:
            counts["no_team"] += 1
            continue
        team_slug, opp_slug = sides
        if not is_missing(label) and str(label).strip() not in spec.team_index_sides:
            hints.setdefault(team_slug, fix_mojibake(str(label)))

        if spec.team_row_column and str(r.get(spec.team_row_column, "")).upper() in spec.team_row_values:
            counts["team_rows"] += 1
            tid = team_id_from_link(r.get(spec.link_column))
            if tid:
                team_seasons[team_slug] = TeamSeasonRecord(team_slug, tid, str(r[spec.link_column]))
            continue

        name = r.get(spec.name_column)
        if is_missing(name) or not str(name).strip() or str(name).strip().lower() in ("team", "totals"):
            continue
        if spec.activity_columns and not any((to_number(r.get(c)) or 0) > 0 for c in spec.activity_columns):
            counts["did_not_play"] += 1
            continue

        stats: dict[str, int | float] = {}
        for col, key in spec.stat_columns.items():
            v = to_number(r.get(col))
            if v is not None:
                stats[key] = v
        if spec.derived:
            stats.update({k: v for k, v in spec.derived(r).items() if v is not None})

        starter = None
        if spec.starter_column:
            raw = r.get(spec.starter_column)
            starter = None if is_missing(raw) else str(raw).strip().upper() in spec.starter_values
        position = r.get(spec.position_column) if spec.position_column else None

        pid, seg = player_id_from_link(r.get(spec.link_column))
        first, last = split_name(str(name))
        lines.append(PlayerLine(
            source_game_id=game.source_game_id,
            team_slug=team_slug,
            opponent_slug=opp_slug,
            full_name=" ".join(fix_mojibake(str(name)).split()),
            first_name=first,
            last_name=last,
            name_norm=normalize_person_name(str(name)),
            player_id=pid,
            season_segment=seg or game.season_segment,
            jersey_number=jersey_text(r.get(spec.jersey_column)),
            is_starter=starter,
            game_date=game.game_date,
            stats=stats,
            position=None if is_missing(position) else str(position).strip() or None,
        ))
        counts["kept"] += 1

    counts["unreliable_player_ids"] = drop_unreliable_player_ids(lines)
    lines.sort(key=lambda l: (l.game_date, l.source_game_id))
    return LinesResult(lines, list(team_seasons.values()), counts, hints)


def drop_unreliable_player_ids(lines: list[PlayerLine]) -> int:
    """Guard against feeds that repeat one player's link on other players'
    rows (seen in 2026-27 soccer: 357 of 615 ids pointed at several names).

    A player id shared by more than one name is unreliable. Newer usports.ca
    ids embed the name ("aaronjohnz50a"), so the id stays with the matching
    name; otherwise it's dropped from every row sharing it, and those rows
    fall back to name-key identity. Returns how many lines lost their id.
    """
    names: dict[str, set[str]] = {}
    for ln in lines:
        if ln.player_id:
            names.setdefault(ln.player_id, set()).add(ln.name_norm)
    shared = {pid for pid, ns in names.items() if len(ns) > 1}
    dropped = 0
    for ln in lines:
        if ln.player_id in shared:
            compact = ln.name_norm.replace(" ", "")
            if not (compact and ln.player_id.lower().startswith(compact)):
                ln.player_id = None
                dropped += 1
    return dropped
