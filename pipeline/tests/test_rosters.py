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
