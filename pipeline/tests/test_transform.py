import datetime as dt

import pandas as pd

from usports_pipeline.sports import BASKETBALL_BOX
from usports_pipeline.transform import build_player_lines, build_schedule

SCHEDULE = pd.DataFrame([
    # season, game_id, date, exhibition, conference, playoffs, championship, home, away, hs, as
    ["mbkb", "2026-27", "g1", "2026-11-07", False, True, False, False, "Carleton", "Ottawa", 80, 70, "u1", None, None],
    ["mbkb", "2026-27", "g2", "2026-08-01", True, False, False, False, "Carleton", "Bucknell", 60, 90, "u2", None, None],
    ["mbkb", "2026-27", "g3", "2027-01-10", False, True, False, False, "ottawa", "Carleton", None, None, "u3", None, None],
    ["mbkb", "2026-27p", "g4", "2027-02-20", False, False, True, False, "Ottawa", "Carleton", 75, 72, "u4", None, None],
    ["mbkb", "2025-26", "old", "2026-01-10", False, True, False, False, "Carleton", "Ottawa", 1, 2, "u5", None, None],
    ["mbkb", "2026-27", "g5", "2026-08-02", True, False, False, False, "Baylor", "Purdue", 1, 2, "u6", None, None],
], columns=["league", "season", "game_id", "date", "exhibition", "conference", "playoffs", "championship",
            "home_team", "away_team", "home_score", "away_score", "game_link", "event_id", "event_hash"])


def test_schedule_membership_and_filters():
    teams, games = build_schedule(SCHEDULE, "2026-27", today=dt.date(2026, 11, 4))
    by_slug = {t.slug: t for t in teams}
    assert {g.source_game_id for g in games} == {"g1", "g2", "g3", "g4"}  # season filter, member filter
    assert by_slug["carleton"].is_member and by_slug["ottawa"].is_member
    assert not by_slug["bucknell"].is_member
    assert by_slug["ottawa"].name == "Ottawa"  # display form preferred over 'ottawa'
    g = {g.source_game_id: g for g in games}
    assert g["g3"].status == "SCHEDULED" and g["g3"].home_score is None
    assert g["g4"].is_playoff and g["g4"].season == "2026-27" and g["g4"].season_segment == "2026-27p"
    assert g["g2"].is_exhibition


def _box(rows):
    cols = ["period", "team", "team_status", "role", "jersey_number", "name", "minutes_played",
            "points", "total_rebounds", "assists", "steals", "blocks", "turnovers", "player_links", "game_id"]
    return pd.DataFrame(rows, columns=cols)


def test_player_lines_map_team_from_schedule_and_drop_dnp_and_team_rows():
    _, games = build_schedule(SCHEDULE, "2026-27")
    box = _box([
        ["game", "CarletonRavens", "home", "STARTER", 3.0, "Alex Guard", 30, 20, 5, 4, 1, 0, 2,
         "https://en.usports.ca/sports/mbkb/2026-27/players?id=p1", "g1"],
        ["game", "Ottawa", "away", "RESERVE", 9.0, "Benchy McBench", 0, 0, 0, 0, 0, 0, 0, None, "g1"],
        ["game", "Ottawa", "away", "TEAM", None, "TEAM", 200, 70, 30, 10, 5, 2, 12,
         "https://en.usports.ca/sports/mbkb/2026-27/teams?id=ott", "g1"],
        ["game", "X", "home", "STARTER", 1.0, "Ghost", 10, 2, 0, 0, 0, 0, 0, None, "not-in-schedule"],
    ])
    res = build_player_lines(box, BASKETBALL_BOX, games)
    lines, team_seasons, counts = res.lines, res.team_seasons, res.counts
    assert len(lines) == 1
    ln = lines[0]
    assert (ln.team_slug, ln.opponent_slug, ln.player_id, ln.is_starter) == ("carleton", "ottawa", "p1", True)
    assert ln.stats == {"points": 20, "rebounds": 5, "assists": 4, "steals": 1, "blocks": 0, "turnovers": 2, "minutes": 30}
    assert [t.usports_team_id for t in team_seasons] == ["ott"]
    assert counts["did_not_play"] == 1 and counts["no_game"] == 1 and counts["team_rows"] == 1


def test_game_date_falls_back_to_game_id():
    from usports_pipeline.transform import game_date
    assert game_date(None, "20260822_qaam") == dt.date(2026, 8, 22)
    assert game_date("2026-08-23", "20260822_qaam") == dt.date(2026, 8, 23)
    assert game_date(float("nan"), float("nan")) is None
