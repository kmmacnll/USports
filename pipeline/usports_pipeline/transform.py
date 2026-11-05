"""DataFrame (usportspy) -> plain records ready for the database. No I/O."""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

import pandas as pd

from .normalize import (
    is_missing, jersey_text, normalize_person_name, player_id_from_link, slugify,
    split_name, team_id_from_link, to_bool, to_number,
)
from .seasons import split_segment
from .sports import SportAdapter


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


@dataclass
class TeamSeasonRecord:
    slug: str
    usports_team_id: str
    team_url: str


def _display_name_preference(name: str) -> tuple[int, int]:
    """Prefer the published display form ('Ontario Tech') over slug-like
    variants ('ontariotech') when the feed contains both."""
    return (any(c.isupper() for c in name), name.count(" "))


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

        base, suffix = split_segment(str(r.season))
        hs, as_ = to_number(r.home_score), to_number(r.away_score)
        date = pd.to_datetime(r.date).date()
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


def build_player_lines(df: pd.DataFrame, adapter: SportAdapter, games: list[GameRecord]
                       ) -> tuple[list[PlayerLine], list[TeamSeasonRecord], dict[str, int]]:
    """Box-score rows -> PlayerLine per athlete per game.

    The box score's own team label is not trusted for identity (it differs
    from the schedule: "TorontoMetropolitan" vs "TMU"); each row is mapped to
    the schedule's home/away team through (game_id, team_status).
    """
    by_game = {g.source_game_id: g for g in games}
    counts = {"rows": len(df), "no_game": 0, "team_rows": 0, "did_not_play": 0, "kept": 0}
    lines: list[PlayerLine] = []
    team_seasons: dict[str, TeamSeasonRecord] = {}

    if "period" in df.columns:  # basketball feeds can carry per-period rows; keep game totals
        df = df[df["period"].astype(str).str.lower().isin(["game", "nan", ""])]

    for r in df.to_dict("records"):
        game = by_game.get(str(r.get("game_id")))
        if game is None:
            counts["no_game"] += 1
            continue
        side = str(r.get(adapter.team_side_column, "")).lower()
        if side not in ("home", "away"):
            counts["no_game"] += 1
            continue
        team_slug = game.home_slug if side == "home" else game.away_slug
        opp_slug = game.away_slug if side == "home" else game.home_slug

        role = str(r.get(adapter.role_column, "")).upper() if adapter.role_column else ""
        if adapter.team_row_role and role == adapter.team_row_role:
            counts["team_rows"] += 1
            tid = team_id_from_link(r.get("player_links"))
            if tid:
                team_seasons[team_slug] = TeamSeasonRecord(team_slug, tid, str(r["player_links"]))
            continue

        name = r.get(adapter.name_column)
        if is_missing(name) or not str(name).strip():
            continue
        if adapter.activity_columns and not any(
            (to_number(r.get(c)) or 0) > 0 for c in adapter.activity_columns
        ):
            counts["did_not_play"] += 1
            continue

        stats = {}
        for col, key in adapter.stat_columns.items():
            v = to_number(r.get(col))
            if v is not None:
                stats[key] = v

        pid, seg = player_id_from_link(r.get("player_links"))
        first, last = split_name(str(name))
        lines.append(PlayerLine(
            source_game_id=game.source_game_id,
            team_slug=team_slug,
            opponent_slug=opp_slug,
            full_name=" ".join(str(name).split()),
            first_name=first,
            last_name=last,
            name_norm=normalize_person_name(str(name)),
            player_id=pid,
            season_segment=seg or game.season_segment,
            jersey_number=jersey_text(r.get("jersey_number")),
            is_starter=(role == adapter.starter_role) if adapter.starter_role else None,
            game_date=game.game_date,
            stats=stats,
        ))
        counts["kept"] += 1

    lines.sort(key=lambda l: (l.game_date, l.source_game_id))
    return lines, list(team_seasons.values()), counts
