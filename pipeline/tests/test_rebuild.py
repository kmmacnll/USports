import datetime as dt

import pandas as pd

from usports_pipeline.rebuild import rebuild_missing_games
from usports_pipeline.transform import GameRecord, TeamRecord

TEAMS = [TeamRecord("laval", "Laval", True), TeamRecord("montreal", "Montréal", True),
         TeamRecord("ubc", "UBC", True), TeamRecord("ncaa-tech", "NCAA Tech", False)]
# First conference game of the season: 2025-09-05.
SCHEDULED = [GameRecord("20250905_aaaa", "2025-26", "2025-26", dt.date(2025, 9, 5), "laval", "montreal", 1, 0,
                        "FINAL", False, True, False, None)]
LINK = "https://en.usports.ca/sports/msoc/{seg}/players?id={pid}"
BOX = "https://en.usports.ca/sports/msoc/2025-26/boxscores/{gid}.xml"


def row(gid, team, side, name, ga=None, seg="2025-26p", pid="x"):
    return {"game_id": gid, "team": team, "team_status": side, "name": name, "goals_against": ga,
            "player_links": LINK.format(seg=seg, pid=pid), "link": BOX.format(gid=gid)}


def test_rebuilds_a_missing_playoff_game_with_score_from_keepers():
    box = pd.DataFrame([
        row("20251108_pqvz", "Laval", "home", "Keeper A", ga=1),
        row("20251108_pqvz", "Laval", "home", "Striker A"),
        row("20251108_pqvz", "Montréal", "away", "Keeper B", ga=2),
        row("20250905_aaaa", "Laval", "home", "Already Scheduled"),
    ])
    games, counts = rebuild_missing_games({"player_box": box}, SCHEDULED, TEAMS, "2025-26")
    assert counts == {"games_rebuilt": 1, "games_unresolved": 0}
    g = games[0]
    assert (g.source_game_id, g.game_date, g.home_slug, g.away_slug) == ("20251108_pqvz", dt.date(2025, 11, 8), "laval", "montreal")
    # Laval's keeper let in 1 -> Montréal scored 1; Montréal's keeper let in 2 -> Laval scored 2.
    assert (g.home_score, g.away_score, g.status) == (2, 1, "FINAL")
    assert g.is_playoff and g.season_segment == "2025-26p" and not g.is_exhibition
    assert g.box_score_url == BOX.format(gid="20251108_pqvz")


def test_preseason_game_is_an_exhibition_and_football_has_no_score():
    offence = pd.DataFrame([
        {"game_id": "20250821_mqgl", "team": "UBC", "team_status": "home", "player": "Q B",
         "player_links": LINK.format(seg="2025-26", pid="1")},
        {"game_id": "20250821_mqgl", "team": "Laval", "team_status": "away", "player": "R B",
         "player_links": LINK.format(seg="2025-26", pid="2")},
    ])
    games, _ = rebuild_missing_games({"offence": offence, "defence": pd.DataFrame()}, SCHEDULED, TEAMS, "2025-26")
    g = games[0]
    assert g.is_exhibition and not g.is_playoff
    assert (g.home_score, g.away_score) == (None, None)


def test_skips_games_it_cannot_place():
    box = pd.DataFrame([
        row("20251001_unkn", "Laval", "home", "A"), row("20251001_unkn", "Nowhere U", "away", "B"),  # unknown team
        row("20251002_half", "Laval", "home", "C"),                                                # one side only
        row("20251003_ncaa", "NCAA Tech", "home", "D"), row("20251003_ncaa", "NCAA Tech", "away", "E"),
    ])
    games, counts = rebuild_missing_games({"player_box": box}, SCHEDULED, TEAMS, "2025-26")
    assert games == [] and counts == {"games_rebuilt": 0, "games_unresolved": 3}


def test_strips_championship_seeds_from_team_names():
    box = pd.DataFrame([row("20251106_7k9f", "(8) Laval", "away", "A"), row("20251106_7k9f", "(1) UBC", "home", "B")])
    games, counts = rebuild_missing_games({"player_box": box}, SCHEDULED, TEAMS, "2025-26")
    assert counts["games_rebuilt"] == 1 and (games[0].home_slug, games[0].away_slug) == ("ubc", "laval")
