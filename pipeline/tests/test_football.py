import datetime as dt

import pandas as pd

from usports_pipeline.football import build_football_lines, fg_bucket
from usports_pipeline.transform import GameRecord

GAME = GameRecord("g1", "2026-27", "2026-27", dt.date(2026, 10, 9), "mcmaster", "toronto", 30, 20,
                  "FINAL", False, True, False, None)
LINK = "https://en.usports.ca/sports/fball/2026-27/players?id="


def frames():
    offence = pd.DataFrame([
        {"player": "Lucas Barresi", "team": "McMaster", "team_status": "home", "passing_yards": 316,
         "passing_touchdowns": 2, "passing_interceptions": 4, "rushing_yards": 8, "rushing_touchdowns": 0,
         "receiving_receptions": None, "fumbles_lost": 0, "player_links": LINK + "qb1", "game_id": "g1"},
        {"player": "Team", "team": "McMaster", "team_status": "home", "rushing_yards": -5,
         "player_links": None, "game_id": "g1"},
        {"player": "Wide Out", "team": "Toronto", "team_status": "away", "receiving_receptions": 5,
         "receiving_yards": 80, "receiving_touchdowns": 1, "fumbles_lost": 1, "player_links": None, "game_id": "g1"},
    ])
    kicking = pd.DataFrame([
        {"player": "Michael Horvat", "team": "McMaster", "team_status": "home", "action_type": "kicking",
         "field_goals_made": 4, "field_goals_attempted": 5, "extra_points_made": 2,
         "player_links": LINK + "k1", "game_id": "g1"},
        {"player": "Michael Horvat", "team": "McMaster", "team_status": "home", "action_type": "punting",
         "field_goals_made": None, "field_goals_attempted": None, "player_links": LINK + "k1", "game_id": "g1"},
    ])
    summaries = pd.DataFrame([
        {"team": "McMaster", "player": "Michael Horvat", "yards": "19 yd", "play_type": "field goal", "game_id": "g1"},
        {"team": "McMaster", "player": "Michael Horvat", "yards": "44 yd", "play_type": "field goal", "game_id": "g1"},
        {"team": "McMaster", "player": "Michael Horvat", "yards": "52 yd", "play_type": "field goal", "game_id": "g1"},
        {"team": "McMaster", "player": "Michael Horvat", "yards": None, "play_type": "rouge point", "game_id": "g1"},
        {"team": "McMaster", "player": "Team", "yards": None, "play_type": "safety", "game_id": "g1"},
    ])
    defence = pd.DataFrame([
        {"number": 8, "player": "Devon Crenshaw", "solo": 7, "total": 7.5, "sacks": 0, "interceptions": 1,
         "team_name": "Toronto", "player_links": LINK + "d1", "game_id": "g1"},
        {"number": 9, "player": "Nobody Played", "solo": 0, "total": 0, "team_name": "Toronto",
         "player_links": None, "game_id": "g1"},
        {"number": 1, "player": "Lost Soul", "solo": 1, "team_name": "Elsewhere U", "player_links": None, "game_id": "g1"},
    ])
    return {"offence": offence, "kicking": kicking, "scoring_summaries": summaries, "defence": defence}


def test_fg_buckets():
    assert [fg_bucket(y) for y in (19, 39, 40, 49, 50, 61)] == [
        "kicking_fg_0_39", "kicking_fg_0_39", "kicking_fg_40_49", "kicking_fg_40_49",
        "kicking_fg_50_plus", "kicking_fg_50_plus"]


def test_merges_files_into_one_line_per_player_with_grouped_stat_keys():
    res = build_football_lines(frames(), [GAME])
    by_name = {l.full_name: l for l in res.lines}
    assert set(by_name) == {"Lucas Barresi", "Wide Out", "Michael Horvat", "Devon Crenshaw"}

    qb = by_name["Lucas Barresi"]
    assert (qb.team_slug, qb.opponent_slug, qb.player_id) == ("mcmaster", "toronto", "qb1")
    assert qb.stats["passing_yards"] == 316 and qb.stats["passing_touchdown"] == 2
    assert qb.stats["passing_interception"] == 4

    k = by_name["Michael Horvat"].stats
    # 4 made: 3 from summaries by distance, 1 unlisted -> lowest tier
    assert (k["kicking_fg_0_39"], k["kicking_fg_40_49"], k["kicking_fg_50_plus"]) == (2, 1, 1)
    assert (k["kicking_fg_missed"], k["kicking_pat"], k["kicking_single_rouge"]) == (1, 2, 1)

    d = by_name["Devon Crenshaw"]
    assert d.team_slug == "toronto" and d.jersey_number == "8" and d.stats["defence_interceptions"] == 1

    assert res.counts["fg_distance_unknown"] == 1
    assert res.counts["no_team"] == 1          # "Elsewhere U" isn't in this game
    assert res.counts["did_not_play"] == 1     # all-zero defence line
    assert res.name_hints == {"mcmaster": "McMaster", "toronto": "Toronto"}


def test_half_ppr_score_of_a_receiver():
    # receptions 5*0.5 + yards 80*0.1 + TD 6 + fumble lost -2 = 14.5 (scored in SQL; mirrored here)
    rules = {"receiving": {"receptions": 0.5, "yards": 0.1, "touchdown": 6.0}, "misc": {"fumble_lost": -2.0}}
    weights = {f"{g}_{k}": w for g, ks in rules.items() for k, w in ks.items()}
    wr = next(l for l in build_football_lines(frames(), [GAME]).lines if l.full_name == "Wide Out")
    assert sum(wr.stats.get(k, 0) * w for k, w in weights.items()) == 14.5
