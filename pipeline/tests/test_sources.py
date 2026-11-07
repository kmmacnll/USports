"""Phase 1 ingestion: polite HTTP (robots, rate limit, raw cache), the
StatsSource interface, the 2025-26 floor and the in-season filter."""
import datetime as dt
import os
import time
from pathlib import Path

import pandas as pd
import pytest
import requests

import ingest_usports
from usports_pipeline.polite_http import MemoryResponseCache, PoliteHttpClient, RobotsDisallowed
from usports_pipeline.seasons import MIN_SEASON, SeasonTooOld, in_season, seasons_since_floor, validate_season
from usports_pipeline.sources import (
    CONFERENCE_SITES, CachingSource, CsvDirSource, SourceNotAllowed, check_sources, conference_source,
)
from usports_pipeline.sports import get_adapter
from usports_pipeline.sync import load_frames

FIXTURES = Path(__file__).parent / "fixtures"


class FakeResponse:
    def __init__(self, status=200, text="", headers=None):
        self.status_code, self.text, self.headers = status, text, headers or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(str(self.status_code), response=self)


class FakeSession:
    def __init__(self, routes):
        self.routes = routes            # url -> FakeResponse | callable(headers) -> FakeResponse
        self.headers = {}
        self.calls = []

    def get(self, url, timeout=None, headers=None):
        self.calls.append((url, dict(headers or {})))
        r = self.routes.get(url)
        if r is None:
            return FakeResponse(404)
        if isinstance(r, Exception):
            raise r
        return r(headers or {}) if callable(r) else r


class FakeClock:
    def __init__(self):
        self.t = 1000.0
        self.slept = []

    def __call__(self):
        return self.t

    def sleep(self, s):
        self.slept.append(s)
        self.t += s


def client(routes, **kw):
    clock = FakeClock()
    c = PoliteHttpClient(source="test", session=FakeSession(routes), sleep=clock.sleep, clock=clock, **kw)
    return c, clock


ROBOTS = "User-agent: *\nDisallow: /private/\n"


def test_robots_disallowed_url_is_never_requested():
    c, _ = client({"https://x.ca/robots.txt": FakeResponse(200, ROBOTS),
                   "https://x.ca/private/stats": FakeResponse(200, "secret")})
    with pytest.raises(RobotsDisallowed):
        c.get("https://x.ca/private/stats")
    assert [u for u, _ in c.session.calls] == ["https://x.ca/robots.txt"]
    assert c.stats["robots_blocked"] == 1


def test_robots_unreachable_means_disallowed_but_404_means_allowed():
    c, _ = client({"https://down.ca/robots.txt": FakeResponse(503)})
    assert c.robots_status("https://down.ca/page") == "unreachable"
    assert not c.allowed("https://down.ca/page")
    c2, _ = client({"https://open.ca/page": FakeResponse(200, "ok")})   # robots.txt 404
    assert c2.get("https://open.ca/page") == "ok"


def test_rate_limit_and_crawl_delay_per_host():
    routes = {"https://x.ca/robots.txt": FakeResponse(200, "User-agent: *\nCrawl-delay: 5\n"),
              "https://x.ca/a": FakeResponse(200, "a"), "https://x.ca/b": FakeResponse(200, "b")}
    c, clock = client(routes, min_interval_s=2)
    c.get("https://x.ca/a")
    c.get("https://x.ca/b")
    # robots -> a waits min interval (2s); a -> b waits the 5s crawl delay
    assert clock.slept and max(clock.slept) == pytest.approx(5)


def test_raw_cache_hit_and_conditional_refetch():
    cache = MemoryResponseCache()
    seen = {}

    def page(headers):
        seen["inm"] = headers.get("If-None-Match")
        return FakeResponse(304) if headers.get("If-None-Match") == '"v1"' else FakeResponse(200, "body", {"ETag": '"v1"'})

    c, _ = client({"https://x.ca/robots.txt": FakeResponse(200, ""), "https://x.ca/p": page}, cache=cache)
    assert c.get("https://x.ca/p") == "body"
    assert cache.get("test", "https://x.ca/p").body == "body"          # raw body kept
    assert c.get("https://x.ca/p", max_age_s=3600) == "body"           # fresh: no request
    assert c.stats["cache_hits"] == 1
    cache.get("test", "https://x.ca/p").fetched_at = time.time() - 7200
    assert c.get("https://x.ca/p", max_age_s=3600) == "body"           # stale: conditional GET -> 304
    assert seen["inm"] == '"v1"' and c.stats["not_modified"] == 1


def test_retries_transient_status():
    attempts = iter([FakeResponse(503), FakeResponse(200, "ok")])
    c, _ = client({"https://x.ca/robots.txt": FakeResponse(200, ""), "https://x.ca/p": lambda h: next(attempts)})
    assert c.get("https://x.ca/p") == "ok"


# ------------------------------------------------------------------ seasons

def test_season_floor():
    assert MIN_SEASON == "2025-26"
    assert validate_season("2025-26") == "2025-26"
    with pytest.raises(SeasonTooOld):
        validate_season("2024-25")
    assert seasons_since_floor(dt.date(2026, 11, 6)) == ["2025-26", "2026-27"]
    assert seasons_since_floor(dt.date(2026, 3, 1)) == ["2025-26"]


def test_cli_rejects_pre_floor_season(capsys):
    with pytest.raises(SystemExit) as e:
        ingest_usports.main(["--sport", "usports_mbk", "--season", "2024-25"])
    assert e.value.code == 2
    assert "before 2025-26" in capsys.readouterr().err


def test_in_season_windows():
    assert in_season("FALL", dt.date(2026, 10, 1))
    assert not in_season("FALL", dt.date(2026, 2, 1))
    assert in_season("WINTER", dt.date(2027, 1, 15))      # wraps the new year
    assert in_season("WINTER", dt.date(2026, 11, 6))
    assert not in_season("WINTER", dt.date(2026, 7, 1))


# ------------------------------------------------------------------ StatsSource

def test_csv_source_and_caching_source(tmp_path):
    adapter = get_adapter("usports_mbk")
    calls = {"n": 0}

    class Counting:
        name = "counting"

        def __init__(self):
            self.inner = CsvDirSource(FIXTURES)

        def schedule(self, a, s):
            calls["n"] += 1
            return self.inner.schedule(a, s)

        def box_frames(self, a, s):
            calls["n"] += 1
            return self.inner.box_frames(a, s)

    src = CachingSource(Counting(), tmp_path, max_age_s=3600)
    f1 = load_frames(adapter, "2026-27", source=src)
    assert calls["n"] == 2
    assert (tmp_path / "usports_mbk" / "schedule_2026-27.csv").exists()
    assert (tmp_path / "usports_mbk" / "player_box_2026-27.csv").exists()
    f2 = load_frames(adapter, "2026-27", source=src)
    assert calls["n"] == 2 and src.hits == 2                  # served from the raw cache
    pd.testing.assert_frame_equal(f1.players["player_box"].reset_index(drop=True),
                                  f2.players["player_box"].reset_index(drop=True), check_dtype=False)
    old = time.time() - 7200
    for p in (tmp_path / "usports_mbk").iterdir():
        os.utime(p, (old, old))
    load_frames(adapter, "2026-27", source=src)
    assert calls["n"] == 4                                    # stale -> refetched


def test_load_frames_refuses_old_season():
    with pytest.raises(SeasonTooOld):
        load_frames(get_adapter("usports_mbk"), "2023-24", source_dir=FIXTURES)


def test_conference_sources_are_gated_until_terms_reviewed():
    assert set(CONFERENCE_SITES) >= {"OUA", "CW", "RSEQ", "AUS"}
    for code in ("OUA", "CW", "RSEQ", "AUS"):
        with pytest.raises(SourceNotAllowed, match="terms"):
            conference_source(code)


def test_check_sources_reports_robots_per_site():
    def factory(code):
        routes = {}
        for site in CONFERENCE_SITES.values():
            routes[site.base_url + "/robots.txt"] = FakeResponse(200, "User-agent: *\nDisallow: /sports/\n")
        c, _ = client(routes)
        return c

    report = check_sources(factory)
    oua = next(r for r in report if r["source"] == "OUA")
    assert oua["robots"] == {"/": "allowed", "/sports/": "disallowed"}
    assert oua["usable"] is False
