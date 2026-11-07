"""Parser tests against a synthetic page. These pin the header-driven parsing
logic; they do not prove the live en.usports.ca markup matches."""
from usports_pipeline.rosters import parse_roster_html, roster_url

PAGE = """
<html><body>
<table><tr><th>Date</th><th>Opponent</th></tr><tr><td>Nov 7</td><td>Ottawa</td></tr></table>
<table class="roster">
  <thead><tr><th>No.</th><th>Name</th><th>Pos.</th><th>Ht.</th><th>Yr.</th><th>Hometown / Previous School</th></tr></thead>
  <tbody>
    <tr><td>00</td><td><a href="/sports/mbkb/2026-27/players?id=abc">Alex&nbsp;Guard</a></td><td>G</td><td>6-4</td><td>3</td><td>Ottawa, ON</td></tr>
    <tr><td>12</td><td>Sam Wing</td><td>G/F</td><td>193cm</td><td>1</td><td></td></tr>
  </tbody>
</table></body></html>
"""


def test_parse_roster_finds_roster_table_by_headers():
    rows = parse_roster_html(PAGE)
    assert [r.full_name for r in rows] == ["Alex Guard", "Sam Wing"]
    a, b = rows
    assert (a.player_id, a.season_segment, a.position, a.height_cm, a.class_year, a.hometown) == \
           ("abc", "2026-27", "G", 193, "3", "Ottawa, ON")
    assert a.jersey_number == "00"
    assert b.player_id is None and b.position == "G/F" and b.hometown is None


def test_roster_url_keeps_team_id():
    assert roster_url("https://en.usports.ca/sports/mbkb/2026-27/teams?id=ott") == \
           "https://en.usports.ca/sports/mbkb/2026-27/teams?id=ott&view=roster"


# ------------------------------------------------------------------ teams index discovery
import os
import pathlib
import subprocess

import psycopg
import pytest

from usports_pipeline import rosters
from usports_pipeline.rosters import RosterSyncFailed, match_university, parse_team_links, sync_rosters

INDEX = """
<html><body><nav><a href="/sports/fball/2026-27/teams">Teams</a><a href="/sports/fball/2026-27/schedule">Schedule</a></nav>
<table>
 <tr><td><a href="/sports/fball/2026-27/teams?id=lav01">Laval</a></td><td><a href="/sports/fball/2026-27/teams?id=lav01&view=roster">Roster</a></td></tr>
 <tr><td><a href="https://en.usports.ca/sports/fball/2026-27/teams/saintmarys?view=schedule">Saint Mary's Huskies</a></td></tr>
 <tr><td><a href="/sports/fball/2026-27/teams?id=tor99">University of Toronto</a></td></tr>
 <tr><td><a href="/sports/fball/2026-27/teams?id=x1">Some Exhibition College</a></td></tr>
</table></body></html>
"""
UNIS = [(1, "Laval", "laval", []), (2, "Saint Mary's", "saintmarys", ["smu"]), (3, "Toronto", "toronto", []),
        (4, "Toronto Metropolitan", "tmu", ["torontometropolitan"])]


def test_parse_team_links_accepts_both_url_styles_and_skips_nav():
    links = dict((u, n) for n, u in parse_team_links(INDEX, "https://en.usports.ca/"))
    assert links == {
        "https://en.usports.ca/sports/fball/2026-27/teams?id=lav01": "Laval",
        "https://en.usports.ca/sports/fball/2026-27/teams/saintmarys": "Saint Mary's Huskies",
        "https://en.usports.ca/sports/fball/2026-27/teams?id=tor99": "University of Toronto",
        "https://en.usports.ca/sports/fball/2026-27/teams?id=x1": "Some Exhibition College",
    }


def test_match_university_by_url_slug_name_and_alias():
    base = "https://en.usports.ca/sports/fball/2026-27/teams"
    assert match_university("Laval", f"{base}?id=lav01", UNIS) == 1
    assert match_university("Saint Mary's Huskies", f"{base}/saintmarys", UNIS) == 2
    assert match_university("University of Toronto", f"{base}?id=tor99", UNIS) == 3
    assert match_university("Toronto Metropolitan", f"{base}?id=t2", UNIS) == 4
    assert match_university("Some Exhibition College", f"{base}?id=x1", UNIS) is None


ROSTER = """<table><thead><tr><th>#</th><th>Name</th><th>Pos</th><th>Yr</th></tr></thead><tbody>
<tr><td>7</td><td>Jean Passeur</td><td>QB</td><td>3</td></tr><tr><td>22</td><td>Max Coureur</td><td>RB</td><td>2</td></tr>
<tr><td>44</td><td>Leo Plaqueur</td><td>LB</td><td>4</td></tr></tbody></table>"""

ADMIN_URL = os.environ.get("PIPELINE_TEST_DATABASE_URL")
ROOT = pathlib.Path(__file__).resolve().parents[2]


class FakeFetcher:
    def __init__(self, pages):
        self.pages = pages
        self.seen = []

    def get(self, url):
        self.seen.append(url)
        if url not in self.pages:
            import requests
            r = requests.Response()
            r.status_code = 403
            raise requests.HTTPError("403", response=r)
        return self.pages[url]

    def close(self):
        pass


@pytest.fixture
def roster_db(monkeypatch):
    if not ADMIN_URL:
        pytest.skip("set PIPELINE_TEST_DATABASE_URL to run DB tests")
    name = "usports_rosters_test"
    with psycopg.connect(ADMIN_URL, autocommit=True) as c:
        c.execute(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")
        c.execute(f"CREATE DATABASE {name}")
    url = f"{ADMIN_URL.rsplit('/', 1)[0]}/{name}"
    env = {**os.environ, "DATABASE_URL": url}
    for step in ("up", "seed"):
        subprocess.run([str(ROOT / "db" / "migrate.sh"), step], env=env, check=True, capture_output=True)
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setattr(rosters, "_cache_connection", lambda: None)
    with psycopg.connect(url, autocommit=True) as c:
        c.execute("INSERT INTO universities (name, slug, is_usports_member) VALUES ('Laval', 'laval', TRUE), ('Toronto', 'toronto', TRUE)")
    yield url
    with psycopg.connect(ADMIN_URL, autocommit=True) as c:
        c.execute(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")


def test_football_rosters_are_found_through_the_teams_index(roster_db, monkeypatch):
    base = "https://en.usports.ca/sports/fball/2026-27/teams"
    fake = FakeFetcher({base: INDEX, f"{base}?id=lav01&view=roster": ROSTER})   # Toronto's page answers 403
    monkeypatch.setattr(rosters, "Fetcher", lambda **kw: fake)
    with psycopg.connect(roster_db, autocommit=True) as conn:
        res = sync_rosters("usports_fb", "2026-27", conn=conn)
        assert res["discovery"] == {"index_links": 4, "discovered": 2, "unmatched": 2, "feed_links_dropped": 0}   # Saint Mary's isn't in this DB; the college isn't a member
        assert res["teams_synced"] == 1 and res["errors"] == {"HTTP 403": 1}
        rows = conn.execute("SELECT last_name, position, positions FROM athletes ORDER BY jersey_number::int").fetchall()
        assert rows == [("Passeur", "QB", ["QB"]), ("Coureur", "RB", ["RB"]), ("Plaqueur", "LB", ["LB"])]


def test_a_run_that_syncs_nothing_fails_loudly(roster_db, monkeypatch):
    monkeypatch.setattr(rosters, "Fetcher", lambda **kw: FakeFetcher({}))
    with psycopg.connect(roster_db, autocommit=True) as conn, pytest.raises(RosterSyncFailed, match="teams index: HTTP 403"):
        sync_rosters("usports_fb", "2026-27", conn=conn)


def test_describe_page_says_what_is_there():
    from usports_pipeline.rosters import describe_page
    shell = "<html><head><title>Carleton Ravens - Roster</title>" + "<script></script>" * 8 + "</head><body><div id=app></div></body></html>"
    d = describe_page(shell)
    assert "title 'Carleton Ravens - Roster'" in d and "0 table(s)" in d and "looks client-rendered" in d
    assert "headers ['No.|Name|Pos.|Ht.|Yr.|" in describe_page(PAGE.replace("<table><tr><th>Date", "<div><tr><th>Date").replace("</td></tr></table>\n<table", "</td></tr></div>\n<table"))


def test_feed_links_shared_by_several_schools_are_replaced_by_the_index(roster_db, monkeypatch):
    base = "https://en.usports.ca/sports/fball/2026-27/teams"
    with psycopg.connect(roster_db, autocommit=True) as conn:
        conn.execute("""INSERT INTO team_seasons (university_id, sport_id, season, team_url)
                        SELECT u.id, s.id, '2026-27', 'https://en.usports.ca/sports/fball/2026-27/teams?id=WRONG'
                          FROM universities u, sports s WHERE s.code = 'usports_fb'""")
        fake = FakeFetcher({base: INDEX, f"{base}?id=lav01&view=roster": ROSTER})
        monkeypatch.setattr(rosters, "Fetcher", lambda **kw: fake)
        res = sync_rosters("usports_fb", "2026-27", conn=conn)
        assert res["discovery"]["feed_links_dropped"] == 2
        urls = dict(conn.execute("SELECT u.slug, ts.team_url FROM team_seasons ts JOIN universities u ON u.id = ts.university_id").fetchall())
        assert urls == {"laval": f"{base}?id=lav01", "toronto": f"{base}?id=tor99"}
        assert all("WRONG" not in u for u in fake.seen)
