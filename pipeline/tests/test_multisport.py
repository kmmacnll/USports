import datetime as dt

import pandas as pd
import pytest

import ingest_usports
from usports_pipeline.normalize import fix_mojibake, player_id_from_link, position_tokens
from usports_pipeline.sports import (
    ADAPTERS, HOCKEY_BOX, HOCKEY_POSITIONS, SOCCER_BOX, SOCCER_POSITIONS, VOLLEYBALL_BOX,
)
from usports_pipeline.transform import (
    GameRecord, PlayerLine, SchemaDriftError, build_player_lines, drop_unreliable_player_ids, game_date,
)

GAME = GameRecord("g1", "2026-27", "2026-27", dt.date(2026, 10, 30), "montreal", "dalhousie", 3, 1,
                  "FINAL", False, True, False, None)


def test_all_game_based_sports_have_adapters():
    assert set(ADAPTERS) == {"usports_mbk", "usports_wbk", "usports_fb", "usports_mhk", "usports_whk",
                             "usports_mvb", "usports_wvb", "usports_msoc", "usports_wsoc"}


def test_new_player_link_format_and_mojibake():
    assert player_id_from_link("https://en.usports.ca/sports/mvball/2026-27/players/owenharrisi76j") == \
        ("owenharrisi76j", "2026-27")
    assert player_id_from_link("https://en.usports.ca/sports/mice/2026-27/players?id=abc123") == ("abc123", "2026-27")
    assert fix_mojibake("MontrÃ©al") == "Montréal" and fix_mojibake("Montréal") == "Montréal"


def test_epoch_day_dates():
    # Verified against the feed: the row dated 20684 has game id 20260819_el0d.
    assert game_date("20684", "20260819_el0d") == dt.date(2026, 8, 19)
    assert game_date("20674", None) == dt.date(2026, 8, 9)


def test_hockey_index_labels_positions_and_goalie_stats():
    box = pd.DataFrame([
        {"team": "1", "jersey_number": "2", "player": "Sean James", "position": "lw", "goals": "0", "assists": "2",
         "plus_minus": "2", "shots": "2", "saves": None, "goals_allowed": None, "starter_status": "starter",
         "player_links": "https://en.usports.ca/sports/mice/2026-27/players?id=s1", "game_id": "g1"},
        {"team": "Montreal", "jersey_number": "30", "player": "Goalie Guy", "position": "g", "goals": None,
         "assists": None, "saves": "31", "goals_allowed": "1", "starter_status": "starter",
         "player_links": None, "game_id": "g1"},
    ])
    res = build_player_lines(box, HOCKEY_BOX, [GAME])
    james, goalie = res.lines
    assert (james.team_slug, james.opponent_slug, james.is_starter, james.position) == ("dalhousie", "montreal", True, "lw")
    assert james.stats == {"goals": 0, "assists": 2, "plus_minus": 2, "shots": 2}
    assert goalie.team_slug == "montreal" and goalie.stats == {"saves": 31, "goals_allowed": 1}
    assert position_tokens("lw", HOCKEY_POSITIONS) == ["LW"]


def test_volleyball_matches_team_by_name_despite_mojibake():
    box = pd.DataFrame([
        {"player": "Owen Harris", "player_links": "https://en.usports.ca/sports/mvball/2026-27/players/owenharrisi76j",
         "jersey": "2", "starter_status": "TRUE", "sets_played": "3", "kills": "3", "errors": "3", "digs": "3",
         "block_stuffs": "0", "team": "MontrÃ©al", "game_id": "g1"},
        {"player": "Bench Warmer", "player_links": None, "jersey": "9", "starter_status": "FALSE",
         "sets_played": "0", "kills": "0", "digs": "0", "team": "Dalhousie", "game_id": "g1"},
    ])
    res = build_player_lines(box, VOLLEYBALL_BOX, [GAME])
    assert [l.full_name for l in res.lines] == ["Owen Harris"]
    owen = res.lines[0]
    assert (owen.team_slug, owen.player_id, owen.is_starter) == ("montreal", "owenharrisi76j", True)
    assert owen.stats == {"sets_played": 3, "kills": 3, "attack_errors": 3, "digs": 3, "block_solos": 0}
    assert res.counts["did_not_play"] == 1 and res.counts["no_team"] == 0


def test_soccer_cards_and_positions():
    box = pd.DataFrame([{"jersey": "9", "position": "mf", "name": "Mid Fielder", "team": "Dalhousie",
                         "team_status": "away", "goals": "1", "assists": "0", "shots": "3", "shots_on_goal": "2",
                         "minutes_played": "90", "card_type": "Yellow", "card_two_type": "Red", "game_id": "g1"}])
    ln = build_player_lines(box, SOCCER_BOX, [GAME]).lines[0]
    assert ln.stats["yellow_cards"] == 1 and ln.stats["red_cards"] == 1 and ln.stats["minutes"] == 90
    assert position_tokens("mf", SOCCER_POSITIONS) == ["M"] and position_tokens("gk", SOCCER_POSITIONS) == ["GK"]


def test_schema_drift_is_detected():
    with pytest.raises(SchemaDriftError, match="kills"):
        build_player_lines(pd.DataFrame([{"player": "x", "team": "y", "game_id": "g1", "digs": 1,
                                          "sets_played": 1}]), VOLLEYBALL_BOX, [GAME])


def _line(name: str, pid: str | None) -> PlayerLine:
    return PlayerLine("g1", "a", "b", name, name.split()[0], name.split()[-1], name.lower(), pid, "2026-27",
                      None, None, dt.date(2026, 10, 1))


def test_shared_player_ids_are_dropped_except_for_the_matching_name():
    lines = [_line("aaron john", "aaronjohnz50a"), _line("sam young", "aaronjohnz50a"),
             _line("ann lee", "rand0mid"), _line("bo kim", "rand0mid"), _line("cy fox", "cyfox12ab")]
    assert drop_unreliable_player_ids(lines) == 3
    assert [l.player_id for l in lines] == ["aaronjohnz50a", None, None, None, "cyfox12ab"]


class _FakeCursor:
    def __init__(self, rows): self.rows = rows
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def execute(self, *a): pass
    def fetchall(self): return self.rows


class _FakeConn:
    def __init__(self, active): self.active = active
    def cursor(self): return _FakeCursor([(c,) for c in self.active])
    def transaction(self):
        import contextlib
        return contextlib.nullcontext()
    def close(self): pass


def test_one_failing_sport_does_not_stop_the_others(monkeypatch, capsys):
    conn = _FakeConn(["usports_mbk", "usports_mvb", "usports_fb", "usports_wtf"])
    monkeypatch.setattr(ingest_usports.db, "connect", lambda: conn)

    def fake_sync(code, season, **_):
        if code == "usports_mvb":
            raise SchemaDriftError("box score is missing required column(s) ['kills']")
        return {"sport": code}
    monkeypatch.setattr(ingest_usports, "sync_athletes_and_stats", fake_sync)

    assert ingest_usports.main(["--sport", "all", "--season", "2026-27"]) == 0
    out = capsys.readouterr().out
    assert '"usports_mvb stats": "SchemaDriftError' in out
    assert '"sport": "usports_mbk"' in out and '"sport": "usports_fb"' in out
    assert ingest_usports.main(["--sport", "all", "--season", "2026-27", "--strict"]) == 1


def test_exit_1_when_every_sport_fails(monkeypatch):
    monkeypatch.setattr(ingest_usports.db, "connect", lambda: _FakeConn(["usports_mbk"]))
    monkeypatch.setattr(ingest_usports, "sync_athletes_and_stats",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("feed down")))
    assert ingest_usports.main(["--sport", "all"]) == 1


def test_downloads_retry_transient_errors_but_not_404():
    from usports_pipeline.sync import fetch_with_retries
    calls = []

    def flaky():
        calls.append(1)
        if len(calls) < 3:
            raise RuntimeError("Error making request\nHTTPError('504 Server Error: Gateway Time-out')")
        return "ok"
    assert fetch_with_retries("x", flaky, sleep=lambda s: None) == "ok" and len(calls) == 3

    missing = []
    def gone():
        missing.append(1)
        raise RuntimeError("HTTPError('404 Client Error: Not Found')")
    with pytest.raises(RuntimeError, match="404"):
        fetch_with_retries("x", gone, sleep=lambda s: None)
    assert len(missing) == 1
