"""Per-sport adapters: how to fetch a sport from usportspy and turn its
frames into PlayerLines for the sport-agnostic schema.

Adding a sport = a SportAdapter here, a sports row, and a default
competition whose scoring keys match the stat keys the adapter writes.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Callable

import pandas as pd

if TYPE_CHECKING:
    from .transform import GameRecord, LinesResult


@dataclass(frozen=True)
class BoxScoreSpec:
    """Column layout of a single-file player box score (basketball style)."""
    stat_columns: dict[str, str]                 # source column -> canonical stat key
    name_column: str = "name"
    team_side_column: str = "team_status"        # "home" / "away"
    role_column: str | None = "role"             # STARTER / RESERVE / TEAM
    team_row_role: str | None = "TEAM"
    starter_role: str | None = "STARTER"
    activity_columns: tuple[str, ...] = ()       # a line counts as played if any is > 0


@dataclass(frozen=True)
class SportAdapter:
    code: str                                    # sports.code, e.g. "usports_mbk"
    usports_path: str                            # usports.ca URL segment, e.g. "mbkb"
    fetch_schedule: Callable[[], pd.DataFrame]
    fetch_frames: Callable[[list[int]], dict[str, pd.DataFrame]]
    frame_names: tuple[str, ...]                 # keys of fetch_frames(); file stems for --source-dir
    build_lines: Callable[[dict[str, pd.DataFrame], "list[GameRecord]"], "LinesResult"]
    position_aliases: dict[str, str] = field(default_factory=dict)


# ----------------------------------------------------------------- basketball

BASKETBALL_BOX = BoxScoreSpec(
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
    activity_columns=("minutes_played", "points", "total_rebounds", "assists", "steals", "blocks",
                      "turnovers", "field_goals_attempted", "free_throws_attempted", "personal_fouls"),
)


def _basketball(gender: str, code: str, path: str) -> SportAdapter:
    # usportspy imported lazily so unit tests don't need the network.
    def schedule() -> pd.DataFrame:
        from usportspy import basketball_get_schedule
        return basketball_get_schedule(gender)

    def frames(seasons: list[int]) -> dict[str, pd.DataFrame]:
        from usportspy import basketball_get_player_box_score
        return {"player_box": basketball_get_player_box_score(gender, seasons)}

    def build(fr, games):
        from .transform import build_player_lines
        return build_player_lines(fr["player_box"], BASKETBALL_BOX, games)

    return SportAdapter(
        code=code, usports_path=path, fetch_schedule=schedule, fetch_frames=frames,
        frame_names=("player_box",), build_lines=build,
        position_aliases={"GUARD": "G", "POINT": "PG", "FORWARD": "F", "WING": "F",
                          "CENTER": "C", "CENTRE": "C", "POST": "C"},
    )


# ----------------------------------------------------------------- football

def _football() -> SportAdapter:
    def schedule() -> pd.DataFrame:
        from usportspy import fb_get_schedule
        return fb_get_schedule("m")

    def frames(seasons: list[int]) -> dict[str, pd.DataFrame]:
        from usportspy import fb_get_defence, fb_get_kicking, fb_get_offence, fb_get_scoring_summaries
        return {
            "offence": fb_get_offence("m", seasons),
            "defence": fb_get_defence("m", seasons),
            "kicking": fb_get_kicking("m", seasons),
            "scoring_summaries": fb_get_scoring_summaries("m", seasons),
        }

    def build(fr, games):
        from .football import build_football_lines
        return build_football_lines(fr, games)

    return SportAdapter(
        code="usports_fb", usports_path="fball", fetch_schedule=schedule, fetch_frames=frames,
        frame_names=("offence", "defence", "kicking", "scoring_summaries"), build_lines=build,
        position_aliases={"QUARTERBACK": "QB", "RUNNINGBACK": "RB", "SLOTBACK": "SB", "RECEIVER": "WR",
                          "KICKER": "K", "PUNTER": "P", "LINEBACKER": "LB", "SAFETY": "S",
                          "CORNERBACK": "CB", "DEFENSIVEBACK": "DB"},
    )


ADAPTERS: dict[str, SportAdapter] = {
    a.code: a
    for a in (
        _basketball("m", "usports_mbk", "mbkb"),
        _basketball("w", "usports_wbk", "wbkb"),
        _football(),
    )
}


def get_adapter(code: str) -> SportAdapter:
    try:
        return ADAPTERS[code]
    except KeyError:
        raise SystemExit(
            f"No ingestion adapter for sport {code!r}. Available: {', '.join(sorted(ADAPTERS))}"
        ) from None
