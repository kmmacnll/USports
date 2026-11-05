"""Per-sport adapters: how to fetch a sport from usportspy and how to
normalise its box score into the sport-agnostic stat payload.

Single-file box scores (basketball, hockey, volleyball, soccer) are fully
declarative: a BoxScoreSpec describes the feed's columns, and the generic
transform.build_player_lines does the rest. Football's box score is split
across four files, so it has its own builder (football.py).

Adding a sport = a spec + adapter here, an active `sports` row, and a default
competition whose scoring keys match the canonical stat keys below.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Callable

import pandas as pd

if TYPE_CHECKING:
    from .transform import GameRecord, LinesResult


@dataclass(frozen=True)
class BoxScoreSpec:
    """Column layout of a single-file player box score."""
    stat_columns: dict[str, str]                       # source column -> canonical stat key
    name_column: str = "name"
    team_label_column: str | None = "team"             # team name as printed in the box score
    team_side_column: str | None = "team_status"       # "home" / "away", when the feed has one
    team_index_sides: dict[str, str] = field(default_factory=dict)  # e.g. hockey {"1": "away", "2": "home"}
    jersey_column: str = "jersey_number"
    link_column: str = "player_links"
    position_column: str | None = None
    starter_column: str | None = None
    starter_values: tuple[str, ...] = ("STARTER",)     # upper-cased values meaning "started"
    team_row_column: str | None = None                 # rows holding team totals (+ team page link)
    team_row_values: tuple[str, ...] = ("TEAM",)
    activity_columns: tuple[str, ...] = ()             # played if any > 0; empty = every listed player played
    derived: Callable[[dict[str, Any]], dict[str, float]] | None = None
    row_filter: Callable[[pd.DataFrame], pd.DataFrame] | None = None
    required: tuple[str, ...] = ()                     # stat columns whose absence means the layout changed

    def required_columns(self) -> list[str]:
        cols = ["game_id", self.name_column, *self.required]
        cols += [c for c in (self.team_label_column, self.team_side_column) if c]
        return list(dict.fromkeys(cols))


@dataclass(frozen=True)
class SportAdapter:
    code: str                                    # sports.code, e.g. "usports_mbk"
    usports_path: str                            # usports.ca URL segment, e.g. "mbkb"
    fetch_schedule: Callable[[], pd.DataFrame]
    fetch_frames: Callable[[list[int]], dict[str, pd.DataFrame]]
    frame_names: tuple[str, ...]                 # keys of fetch_frames(); file stems for --source-dir
    build_lines: Callable[[dict[str, pd.DataFrame], "list[GameRecord]"], "LinesResult"]
    position_aliases: dict[str, str] = field(default_factory=dict)


def _single_file(code: str, path: str, spec: BoxScoreSpec, schedule_fn: str, box_fn: str, gender: str,
                 position_aliases: dict[str, str] | None = None) -> SportAdapter:
    """Adapter for a sport whose usportspy box score is one frame."""
    def schedule() -> pd.DataFrame:
        import usportspy
        return getattr(usportspy, schedule_fn)(gender)

    def frames(seasons: list[int]) -> dict[str, pd.DataFrame]:
        import usportspy
        return {"player_box": getattr(usportspy, box_fn)(gender, seasons)}

    def build(fr, games):
        from .transform import build_player_lines
        return build_player_lines(fr["player_box"], spec, games)

    return SportAdapter(code=code, usports_path=path, fetch_schedule=schedule, fetch_frames=frames,
                        frame_names=("player_box",), build_lines=build, position_aliases=position_aliases or {})


# ----------------------------------------------------------------- basketball

def _game_totals_only(df: pd.DataFrame) -> pd.DataFrame:
    """Basketball feeds can carry per-period rows; keep game totals."""
    if "period" not in df.columns:
        return df
    return df[df["period"].astype(str).str.lower().isin(["game", "nan", ""])]


BASKETBALL_BOX = BoxScoreSpec(
    stat_columns={
        "points": "points", "total_rebounds": "rebounds", "assists": "assists", "steals": "steals",
        "blocks": "blocks", "turnovers": "turnovers", "minutes_played": "minutes",
        "field_goals_made": "field_goals_made", "field_goals_attempted": "field_goals_attempted",
        "three_pointers_made": "three_pointers_made", "three_pointers_attempted": "three_pointers_attempted",
        "free_throws_made": "free_throws_made", "free_throws_attempted": "free_throws_attempted",
        "offensive_rebounds": "offensive_rebounds", "defensive_rebounds": "defensive_rebounds",
        "personal_fouls": "personal_fouls",
    },
    team_side_column="team_status",
    starter_column="role", team_row_column="role",
    activity_columns=("minutes_played", "points", "total_rebounds", "assists", "steals", "blocks",
                      "turnovers", "field_goals_attempted", "free_throws_attempted", "personal_fouls"),
    row_filter=_game_totals_only,
    required=("points", "total_rebounds", "assists"),
)
BASKETBALL_POSITIONS = {"GUARD": "G", "POINT": "PG", "FORWARD": "F", "WING": "F",
                        "CENTER": "C", "CENTRE": "C", "POST": "C"}

# ----------------------------------------------------------------- ice hockey
# The feed labels teams by name in some games and "1"/"2" (away/home,
# verified against final scores) in others. Positions (c/lw/rw/d/g) are
# published for starters.

HOCKEY_BOX = BoxScoreSpec(
    stat_columns={
        "goals": "goals", "assists": "assists", "plus_minus": "plus_minus", "shots": "shots",
        "faceoffs_won": "faceoffs_won", "faceoffs_total": "faceoffs_total",
        "penalty_minutes": "penalty_minutes", "minutes_played": "minutes",
        "saves": "saves", "goals_allowed": "goals_allowed", "shots_against": "shots_against",
    },
    name_column="player", team_side_column=None, team_index_sides={"1": "away", "2": "home"},
    position_column="position", starter_column="starter_status", starter_values=("STARTER",),
    activity_columns=(),          # the box score lists dressed players only; all of them played
    required=("goals", "assists", "saves"),
)
HOCKEY_POSITIONS = {"CENTER": "C", "CENTRE": "C", "WING": "F", "FORWARD": "F", "DEFENCE": "D",
                    "DEFENSE": "D", "GOALIE": "G", "GOALTENDER": "G", "LD": "D", "RD": "D"}

# ----------------------------------------------------------------- volleyball
# No home/away column and no positions: teams resolve by name against the
# schedule; rulesets use a wildcard starter slot.

VOLLEYBALL_BOX = BoxScoreSpec(
    stat_columns={
        "sets_played": "sets_played", "kills": "kills", "errors": "attack_errors",
        "total_attacks": "total_attacks", "attack_efficiency": "attack_efficiency", "assists": "assists",
        "service_aces": "service_aces", "service_errors": "service_errors", "receive_errors": "reception_errors",
        "digs": "digs", "block_stuffs": "block_solos", "block_assists": "block_assists",
        "block_errors": "block_errors", "ball_handling_errors": "ball_handling_errors", "points": "points",
    },
    name_column="player", team_side_column=None, jersey_column="jersey",
    starter_column="starter_status", starter_values=("TRUE",),
    activity_columns=("sets_played",),
    required=("kills", "digs", "sets_played"),
)

# ----------------------------------------------------------------- soccer

def _soccer_cards(row: dict[str, Any]) -> dict[str, float]:
    cards = [str(row.get(c) or "").strip().lower() for c in ("card_type", "card_two_type", "card_three_type")]
    return {"yellow_cards": sum(c == "yellow" for c in cards), "red_cards": sum(c == "red" for c in cards)}


SOCCER_BOX = BoxScoreSpec(
    stat_columns={
        "goals": "goals", "assists": "assists", "shots": "shots", "shots_on_goal": "shots_on_goal",
        "saves": "saves", "goals_against": "goals_against", "shots_on_goal_against": "shots_on_goal_against",
        "minutes_played": "minutes",
    },
    name_column="name", team_side_column="team_status", jersey_column="jersey", position_column="position",
    activity_columns=("minutes_played",),
    derived=_soccer_cards,
    required=("goals", "assists", "minutes_played"),
)
SOCCER_POSITIONS = {
    "G": "GK", "GK": "GK", "GOALKEEPER": "GK", "KEEPER": "GK",
    "D": "D", "DEF": "D", "DF": "D", "CB": "D", "FB": "D", "LB": "D", "RB": "D", "DEFENDER": "D",
    "M": "M", "MF": "M", "MID": "M", "CM": "M", "DM": "M", "AM": "M", "CDM": "M", "CAM": "M", "MIDFIELDER": "M",
    "F": "F", "FW": "F", "FOR": "F", "ST": "F", "S": "F", "W": "F", "STRIKER": "F", "FORWARD": "F",
}

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
        _single_file("usports_mbk", "mbkb", BASKETBALL_BOX, "basketball_get_schedule",
                     "basketball_get_player_box_score", "m", BASKETBALL_POSITIONS),
        _single_file("usports_wbk", "wbkb", BASKETBALL_BOX, "basketball_get_schedule",
                     "basketball_get_player_box_score", "w", BASKETBALL_POSITIONS),
        _single_file("usports_mhk", "mice", HOCKEY_BOX, "ice_hockey_get_schedule",
                     "ice_hockey_get_player_box_score", "m", HOCKEY_POSITIONS),
        _single_file("usports_whk", "wice", HOCKEY_BOX, "ice_hockey_get_schedule",
                     "ice_hockey_get_player_box_score", "w", HOCKEY_POSITIONS),
        _single_file("usports_mvb", "mvball", VOLLEYBALL_BOX, "volleyball_get_schedule",
                     "volleyball_get_player_box_score", "m"),
        _single_file("usports_wvb", "wvball", VOLLEYBALL_BOX, "volleyball_get_schedule",
                     "volleyball_get_player_box_score", "w"),
        _single_file("usports_msoc", "msoc", SOCCER_BOX, "soccer_get_schedule",
                     "soccer_get_player_box_score", "m", SOCCER_POSITIONS),
        _single_file("usports_wsoc", "wsoc", SOCCER_BOX, "soccer_get_schedule",
                     "soccer_get_player_box_score", "w", SOCCER_POSITIONS),
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
