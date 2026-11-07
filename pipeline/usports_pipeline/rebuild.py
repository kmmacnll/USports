"""Rebuild games the schedule feed is missing, from their box scores.

usportspy's schedule CSVs occasionally leave out games whose box scores they
do publish (2025-26: 28 men's soccer games, 7 football games, mostly playoff
dates). Without a GameRecord every player line from those games was dropped
as `no_game`. Box-score rows carry the team name, `team_status` (home/away),
the game id (which encodes the date) and the box-score link, which is enough
to rebuild the game.

A game is only rebuilt when both teams are known from this season's schedule
(so both universities exist) and at least one is a U Sports member. Scores are
filled where the box score makes them reliable (soccer: goals against
recorded by each side's keepers, which includes own goals); otherwise they
stay NULL. Games dated before the season's first conference game are treated
as exhibitions, like preseason games in the schedule.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict

import pandas as pd

from .normalize import is_missing, player_id_from_link, slugify, to_number
from .seasons import split_segment
from .transform import GameRecord, TeamRecord, game_date

LABEL_COLUMNS = ("team", "team_name")
# Championship box scores prefix tournament seeds: "(8) Guelph".
_SEED = re.compile(r"^\s*\(\d+\)\s*")


def rebuild_missing_games(frames: dict[str, pd.DataFrame], games: list[GameRecord], teams: list[TeamRecord],
                          season: str) -> tuple[list[GameRecord], dict[str, int]]:
    """GameRecords for box-score game ids the schedule doesn't have, plus counts."""
    have = {g.source_game_id for g in games}
    known = {t.slug for t in teams}
    members = {t.slug for t in teams if t.is_member}
    conference_dates = [g.game_date for g in games if g.is_conference_game]
    season_start = min(conference_dates) if conference_dates else None

    sides: dict[str, dict[str, Counter]] = defaultdict(lambda: {"home": Counter(), "away": Counter()})
    segments: dict[str, Counter] = defaultdict(Counter)
    links: dict[str, str] = {}
    goals_against: dict[str, dict[str, float]] = defaultdict(lambda: {"home": 0.0, "away": 0.0})
    has_ga: set[str] = set()

    for frame in frames.values():
        if frame is None or frame.empty or "game_id" not in frame.columns or "team_status" not in frame.columns:
            continue
        label_col = next((c for c in LABEL_COLUMNS if c in frame.columns), None)
        if label_col is None:
            continue
        missing = frame[~frame["game_id"].astype(str).isin(have)]
        for r in missing.to_dict("records"):
            gid, side = str(r["game_id"]), str(r.get("team_status", "")).strip().lower()
            if side not in ("home", "away") or is_missing(r.get(label_col)):
                continue
            sides[gid][side][slugify(_SEED.sub("", str(r[label_col])))] += 1
            _, seg = player_id_from_link(r.get("player_links"))
            if seg:
                segments[gid][seg] += 1
            if not is_missing(r.get("link")):
                links.setdefault(gid, str(r["link"]))
            ga = to_number(r.get("goals_against"))
            if ga is not None and "goals_against" in frame.columns:
                goals_against[gid][side] += ga
                has_ga.add(gid)

    rebuilt: list[GameRecord] = []
    counts = {"games_rebuilt": 0, "games_unresolved": 0}
    for gid, s in sides.items():
        home = s["home"].most_common(1)[0][0] if s["home"] else None
        away = s["away"].most_common(1)[0][0] if s["away"] else None
        date = game_date(None, gid)
        if (not home or not away or home == away or home not in known or away not in known
                or not ({home, away} & members) or date is None):
            counts["games_unresolved"] += 1
            continue
        segment = segments[gid].most_common(1)[0][0] if segments[gid] else season
        try:
            base, suffix = split_segment(segment)
        except ValueError:
            base, suffix = season, ""
        if base != season:
            segment, suffix = season, ""
        # A side's keepers' goals-against is the other side's score.
        home_score = away_score = None
        if gid in has_ga:
            home_score, away_score = int(goals_against[gid]["away"]), int(goals_against[gid]["home"])
        rebuilt.append(GameRecord(
            source_game_id=gid, season=season, season_segment=segment, game_date=date,
            home_slug=home, away_slug=away, home_score=home_score, away_score=away_score,
            status="FINAL",                     # it has a box score, so it was played
            is_exhibition=season_start is not None and date < season_start and not suffix,
            is_conference_game=False, is_playoff=bool(suffix),
            box_score_url=links.get(gid),
        ))
        counts["games_rebuilt"] += 1
    return rebuilt, counts
