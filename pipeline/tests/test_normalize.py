import datetime as dt

import pytest

from usports_pipeline.normalize import (
    height_to_cm, jersey_text, normalize_person_name, player_id_from_link, position_tokens,
    slugify, split_name, to_number,
)
from usports_pipeline.seasons import current_season, split_segment

ALIASES = {"GUARD": "G", "FORWARD": "F", "CENTRE": "C", "CENTER": "C"}


@pytest.mark.parametrize("raw,slug", [
    ("Saint Mary's", "saintmarys"), ("Ontario Tech", "ontariotech"), ("ontariotech", "ontariotech"),
    ("UMaine Fort-Kent", "umainefortkent"), ("Bishop's", "bishops"), ("Université Laval", "universitelaval"),
])
def test_slugify(raw, slug):
    assert slugify(raw) == slug


def test_person_name_normalisation():
    assert normalize_person_name("Maxime  Louis-Jean") == "maxime louis jean"
    assert normalize_person_name("Zoë O'Neil") == "zoe oneil"
    assert split_name("CJ Evans") == ("CJ", "Evans")
    assert split_name("Evans, CJ") == ("CJ", "Evans")
    assert split_name("Mononym") == ("Mononym", "Mononym")


def test_player_link():
    assert player_id_from_link("https://en.usports.ca/sports/mbkb/2025-26p/players?id=abc123") == ("abc123", "2025-26p")
    assert player_id_from_link(float("nan")) == (None, None)
    assert player_id_from_link("https://en.usports.ca/sports/mbkb/2026-27/teams?id=x") == (None, None)


@pytest.mark.parametrize("raw,val", [(26, 26), ("26:30", 26.5), ("NA", None), (float("nan"), None), ("3.0", 3), ("", None)])
def test_to_number(raw, val):
    assert to_number(raw) == val


def test_jersey_text():
    assert jersey_text(4.0) == "4"
    assert jersey_text("00") == "0"  # usportspy reads jerseys as numbers; roster sync restores "00"
    assert jersey_text(float("nan")) is None


@pytest.mark.parametrize("raw,cm", [("6-4", 193), ("6'4\"", 193), ("193cm", 193), ("1.93m", 193), ("6-0", 183), ("tall", None)])
def test_height(raw, cm):
    assert height_to_cm(raw) == cm


def test_position_tokens():
    assert position_tokens("G/F", ALIASES) == ["G", "F"]
    assert position_tokens("Guard", ALIASES) == ["G"]
    assert position_tokens("F-C", ALIASES) == ["F", "C"]
    assert position_tokens(None, ALIASES) == []


def test_seasons():
    assert current_season(dt.date(2026, 11, 4)) == "2026-27"
    assert current_season(dt.date(2027, 3, 1)) == "2026-27"
    assert current_season(dt.date(2027, 7, 15)) == "2027-28"
    assert split_segment("2025-26c") == ("2025-26", "c")
