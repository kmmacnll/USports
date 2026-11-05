"""Per-sport adapters: how to fetch a sport from usportspy and how to map its
columns onto our sport-agnostic schema.

Adding a sport = adding a SportAdapter here (plus a sports row and a default
competition whose scoring keys match `stat_columns` values).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import pandas as pd


@dataclass(frozen=True)
class SportAdapter:
    code: str                                   # sports.code, e.g. "usports_mbk"
    usports_path: str                           # usports.ca URL segment, e.g. "mbkb"
    fetch_schedule: Callable[[], pd.DataFrame]
    fetch_player_box: Callable[[list[int]], pd.DataFrame]
    # box-score column -> canonical raw_stats_json key (scoring rules use these keys)
    stat_columns: dict[str, str]
    name_column: str = "name"
    team_column: str = "team"
    team_side_column: str = "team_status"        # "home" / "away"
    role_column: str | None = "role"             # STARTER / RESERVE / TEAM
    team_row_role: str | None = "TEAM"           # role value of the team-totals row
    starter_role: str | None = "STARTER"
    # activity check: a line counts as "played" if any of these is > 0
    activity_columns: tuple[str, ...] = ()
    # raw roster position token -> normalised token
    position_aliases: dict[str, str] = field(default_factory=dict)


def _basketball(gender: str, code: str, path: str) -> SportAdapter:
    # Imported lazily so unit tests don't need network-capable usportspy.
    def schedule() -> pd.DataFrame:
        from usportspy import basketball_get_schedule
        return basketball_get_schedule(gender)

    def player_box(seasons: list[int]) -> pd.DataFrame:
        from usportspy import basketball_get_player_box_score
        return basketball_get_player_box_score(gender, seasons)

    return SportAdapter(
        code=code,
        usports_path=path,
        fetch_schedule=schedule,
        fetch_player_box=player_box,
        stat_columns={
            "points": "points",
            "total_rebounds": "rebounds",
            "assists": "assists",
            "steals": "steals",
            "blocks": "blocks",
            "turnovers": "turnovers",
            "minutes_played": "minutes",
            "field_goals_made": "field_goals_made",
            "field_goals_attempted": "field_goals_attempted",
            "three_pointers_made": "three_pointers_made",
            "three_pointers_attempted": "three_pointers_attempted",
            "free_throws_made": "free_throws_made",
            "free_throws_attempted": "free_throws_attempted",
            "offensive_rebounds": "offensive_rebounds",
            "defensive_rebounds": "defensive_rebounds",
            "personal_fouls": "personal_fouls",
        },
        activity_columns=("minutes_played", "points", "total_rebounds", "assists",
                          "steals", "blocks", "turnovers", "field_goals_attempted",
                          "free_throws_attempted", "personal_fouls"),
        position_aliases={
            "GUARD": "G", "POINT": "PG", "FORWARD": "F", "WING": "F",
            "CENTER": "C", "CENTRE": "C", "POST": "C",
        },
    )


ADAPTERS: dict[str, SportAdapter] = {
    a.code: a
    for a in (
        _basketball("m", "usports_mbk", "mbkb"),
        _basketball("w", "usports_wbk", "wbkb"),
    )
}


def get_adapter(code: str) -> SportAdapter:
    try:
        return ADAPTERS[code]
    except KeyError:
        raise SystemExit(
            f"No ingestion adapter for sport {code!r}. Available: {', '.join(sorted(ADAPTERS))}"
        ) from None
