"""Football box scores -> PlayerLines.

usportspy splits a football box score across four frames. One athlete's game
line is merged from all of them, keyed by (game, team, normalised name):

  offence            passing / rushing / receiving / fumbles   (team + team_status)
  kicking            PATs, FG made/attempted                   (team + team_status; action_type kicking)
  scoring_summaries  each FG's distance and each single/rouge  (team label only)
  defence            tackles, sacks, ...                       (team_name only)

Canonical stat keys are "<group>_<stat>" so the grouped Half-PPR ruleset
({"passing": {"yards": 0.04}}) scores them directly (passing_yards).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

import pandas as pd

from .normalize import (
    is_missing, jersey_text, normalize_person_name, player_id_from_link, slugify, split_name, to_number,
)
from .transform import GameRecord, LinesResult, PlayerLine, drop_unreliable_player_ids

OFFENCE = {
    "passing_completions": "passing_completions",
    "passing_attempts": "passing_attempts",
    "passing_yards": "passing_yards",
    "passing_touchdowns": "passing_touchdown",
    "passing_interceptions": "passing_interception",
    "rushing_attempts": "rushing_attempts",
    "rushing_yards": "rushing_yards",
    "rushing_touchdowns": "rushing_touchdown",
    "receiving_receptions": "receiving_receptions",
    "receiving_yards": "receiving_yards",
    "receiving_touchdowns": "receiving_touchdown",
    "fumbles_lost": "misc_fumble_lost",
}
DEFENCE = {
    "solo": "defence_solo_tackles",
    "total": "defence_tackles",
    "sacks": "defence_sacks",
    "tackles_for_loss": "defence_tackles_for_loss",
    "forced_fumbles": "defence_forced_fumbles",
    "fumble_recovery": "defence_fumble_recoveries",
    "interceptions": "defence_interceptions",
    "passes_broken_up": "defence_passes_defended",
    "blocked_kicks": "defence_blocked_kicks",
}
NOT_A_PLAYER = {"team", "totals", "total", ""}
_YARDS = re.compile(r"(\d+)\s*yd", re.I)


@dataclass
class _Acc:
    game: GameRecord
    team_slug: str
    opponent_slug: str
    full_name: str
    name_norm: str
    player_id: str | None = None
    segment: str | None = None
    jersey: str | None = None
    stats: dict[str, float] = field(default_factory=dict)

    def add(self, key: str, value) -> None:
        v = to_number(value)
        if v is not None:
            self.stats[key] = self.stats.get(key, 0) + v


def fg_bucket(yards: int) -> str:
    if yards >= 50:
        return "kicking_fg_50_plus"
    if yards >= 40:
        return "kicking_fg_40_49"
    return "kicking_fg_0_39"


def build_football_lines(frames: dict[str, pd.DataFrame], games: list[GameRecord]) -> LinesResult:
    by_game = {g.source_game_id: g for g in games}
    counts = {"rows": 0, "no_game": 0, "no_team": 0, "not_a_player": 0, "did_not_play": 0,
              "fg_distance_unknown": 0, "kept": 0}
    hints: dict[str, str] = {}
    acc: dict[tuple[str, str, str], _Acc] = {}

    def sides(game: GameRecord, label, status) -> tuple[str, str] | None:
        st = "" if is_missing(status) else str(status).lower()
        if st in ("home", "away"):
            team = game.home_slug if st == "home" else game.away_slug
        else:
            slug = slugify(str(label)) if not is_missing(label) else ""
            if slug == game.home_slug:
                team = game.home_slug
            elif slug == game.away_slug:
                team = game.away_slug
            else:
                return None
        if not is_missing(label):
            hints.setdefault(team, str(label))
        return team, (game.away_slug if team == game.home_slug else game.home_slug)

    def line_for(r: dict, name_col: str, team_col: str, status_col: str | None) -> _Acc | None:
        counts["rows"] += 1
        game = by_game.get(str(r.get("game_id")))
        if game is None:
            counts["no_game"] += 1
            return None
        name = r.get(name_col)
        if is_missing(name) or str(name).strip().lower() in NOT_A_PLAYER or "field goal" in str(name).lower():
            counts["not_a_player"] += 1
            return None
        s = sides(game, r.get(team_col), r.get(status_col) if status_col else None)
        if s is None:
            counts["no_team"] += 1
            return None
        full = " ".join(str(name).split())
        key = (game.source_game_id, s[0], normalize_person_name(full))
        a = acc.get(key)
        if a is None:
            a = acc[key] = _Acc(game, s[0], s[1], full, key[2])
        pid, seg = player_id_from_link(r.get("player_links"))
        if pid and not a.player_id:
            a.player_id, a.segment = pid, seg
        return a

    for r in frames.get("offence", pd.DataFrame()).to_dict("records"):
        if a := line_for(r, "player", "team", "team_status"):
            for col, k in OFFENCE.items():
                a.add(k, r.get(col))

    for r in frames.get("kicking", pd.DataFrame()).to_dict("records"):
        if str(r.get("action_type", "")).lower() != "kicking":
            continue
        if a := line_for(r, "player", "team", "team_status"):
            made, att = to_number(r.get("field_goals_made")), to_number(r.get("field_goals_attempted"))
            a.add("kicking_fg_made", made)
            a.add("kicking_fg_attempted", att)
            if made is not None and att is not None:
                a.add("kicking_fg_missed", max(att - made, 0))
            a.add("kicking_pat", r.get("extra_points_made"))

    for r in frames.get("scoring_summaries", pd.DataFrame()).to_dict("records"):
        play = str(r.get("play_type", "")).lower()
        if play not in ("field goal", "rouge point"):
            continue
        if a := line_for(r, "player", "team", None):
            if play == "rouge point":
                a.add("kicking_single_rouge", 1)
            else:
                m = _YARDS.search(str(r.get("yards", "")))
                if m:
                    a.add(fg_bucket(int(m.group(1))), 1)

    defence = frames.get("defence", pd.DataFrame())
    # The 2026-27 export names the column team_name; 2025-26 calls it team.
    defence_team_col = "team_name" if "team_name" in defence.columns else "team"
    for r in defence.to_dict("records"):
        if a := line_for(r, "player", defence_team_col, None):
            for col, k in DEFENCE.items():
                a.add(k, r.get(col))
            if not a.jersey:
                a.jersey = jersey_text(r.get("number"))

    lines: list[PlayerLine] = []
    for a in acc.values():
        # Made FGs the summaries didn't list get the lowest tier (3 pts), not dropped.
        made = int(a.stats.get("kicking_fg_made", 0))
        bucketed = int(sum(a.stats.get(k, 0) for k in ("kicking_fg_0_39", "kicking_fg_40_49", "kicking_fg_50_plus")))
        if made > bucketed:
            a.stats["kicking_fg_0_39"] = a.stats.get("kicking_fg_0_39", 0) + (made - bucketed)
            counts["fg_distance_unknown"] += made - bucketed
        if not any(v for v in a.stats.values()):
            counts["did_not_play"] += 1
            continue
        first, last = split_name(a.full_name)
        lines.append(PlayerLine(
            source_game_id=a.game.source_game_id, team_slug=a.team_slug, opponent_slug=a.opponent_slug,
            full_name=a.full_name, first_name=first, last_name=last, name_norm=a.name_norm,
            player_id=a.player_id, season_segment=a.segment or a.game.season_segment,
            jersey_number=a.jersey, is_starter=None, game_date=a.game.game_date,
            stats={k: (int(v) if float(v).is_integer() else v) for k, v in a.stats.items()},
        ))
        counts["kept"] += 1

    counts["unreliable_player_ids"] = drop_unreliable_player_ids(lines)
    lines.sort(key=lambda l: (l.game_date, l.source_game_id))
    return LinesResult(lines, [], counts, hints)
