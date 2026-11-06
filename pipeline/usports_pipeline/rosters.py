"""usports.ca roster scraper (BeautifulSoup, optional Playwright).

usportspy has no roster endpoint for team sports, so positions, heights and
class years come from the team pages on en.usports.ca. Team page URLs are
not guessed: they come from the box-score feed's team links
(team_seasons.team_url, written by sync_athletes_and_stats).

Parsing is header-driven (find the table whose header row has a name column
and a position column), so it doesn't depend on CSS class names.

STATUS: this module has unit tests against a synthetic page only. It has not
yet been run against live en.usports.ca pages (not reachable from the
environment it was written in). Run `--rosters --dry-run` once before
relying on it.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

import psycopg
from bs4 import BeautifulSoup, Tag

from . import db
from .polite_http import USER_AGENT as POLITE_USER_AGENT, DbResponseCache, PoliteHttpClient, RobotsDisallowed
from .normalize import (
    height_to_cm, normalize_person_name, player_id_from_link, position_tokens, split_name,
)
from .seasons import current_season
from .sports import SportAdapter, get_adapter

log = logging.getLogger(__name__)

USER_AGENT = POLITE_USER_AGENT
REQUEST_INTERVAL_S = 2.0
ROSTER_CACHE_MAX_AGE_S = 20 * 3600      # rosters change rarely; the weekly job re-fetches conditionally

HEADER_SYNONYMS: dict[str, tuple[str, ...]] = {
    "name": ("name", "player", "full name"),
    "position": ("pos", "position"),
    "jersey": ("#", "no", "number", "jersey"),
    "height": ("ht", "height"),
    "class_year": ("yr", "year", "class", "elig", "academic year", "yos"),
    "hometown": ("hometown", "home town", "hometown/high school", "hometown / previous school"),
}


@dataclass
class RosterEntry:
    full_name: str
    first_name: str
    last_name: str
    name_norm: str
    player_id: str | None
    season_segment: str | None
    jersey_number: str | None
    position: str | None
    height: str | None
    height_cm: int | None
    class_year: str | None
    hometown: str | None


def _clean(text: str) -> str:
    return " ".join(text.replace("\xa0", " ").split())


def _header_key(text: str) -> str | None:
    t = _clean(text).lower().rstrip(".:").strip()
    for key, names in HEADER_SYNONYMS.items():
        if t in names or (key == "hometown" and t.startswith("hometown")):
            return key
    return None


def _header_map(table: Tag) -> dict[str, int] | None:
    head = table.find("thead")
    row = head.find("tr") if head else table.find("tr")
    if row is None:
        return None
    cols: dict[str, int] = {}
    for i, cell in enumerate(row.find_all(["th", "td"])):
        key = _header_key(cell.get_text(" "))
        if key and key not in cols:
            cols[key] = i
    return cols if {"name", "position"} <= cols.keys() else None


def parse_roster_html(html: str, base_url: str = "https://en.usports.ca/") -> list[RosterEntry]:
    soup = BeautifulSoup(html, "html.parser")
    for table in soup.find_all("table"):
        cols = _header_map(table)
        if not cols:
            continue
        body = table.find("tbody") or table
        out: list[RosterEntry] = []
        for tr in body.find_all("tr"):
            cells = tr.find_all(["td", "th"])
            if len(cells) <= max(cols.values()) or tr.find_parent("thead"):
                continue
            get = lambda k: _clean(cells[cols[k]].get_text(" ")) if k in cols else None  # noqa: E731
            name = get("name")
            if not name or _header_key(name) == "name":
                continue
            link = cells[cols["name"]].find("a", href=True)
            pid, seg = player_id_from_link(urljoin(base_url, link["href"])) if link else (None, None)
            first, last = split_name(name)
            height = get("height") or None
            out.append(RosterEntry(
                full_name=name, first_name=first, last_name=last,
                name_norm=normalize_person_name(name),
                player_id=pid, season_segment=seg,
                jersey_number=(get("jersey") or "").lstrip("#").strip() or None,  # keep "00" as text
                position=get("position") or None,
                height=height, height_cm=height_to_cm(height),
                class_year=get("class_year") or None,
                hometown=get("hometown") or None,
            ))
        if out:
            return out
    return []


def roster_url(team_url: str) -> str:
    """Team page -> roster view (adds view=roster, keeping the team id)."""
    parts = urlparse(team_url)
    q = dict(parse_qsl(parts.query))
    q["view"] = "roster"
    return urlunparse(parts._replace(query=urlencode(q)))


class Fetcher:
    """Roster pages through PoliteHttpClient: robots.txt respected, rate
    limited per host, raw HTML cached in raw_source_responses."""

    def __init__(self, render: bool = False, cache=None, client: PoliteHttpClient | None = None):
        self.client = client or PoliteHttpClient(source="usports_roster", cache=cache,
                                                 min_interval_s=REQUEST_INTERVAL_S, user_agent=USER_AGENT)
        self.render = render
        self._browser = None

    def get(self, url: str) -> str:
        if self.render:
            if not self.client.allowed(url):
                raise RobotsDisallowed(f"robots.txt disallows {url}")
            self.client._throttle(urlparse(url).netloc, self.client.crawl_delay(url))
            return self._render(url)
        return self.client.get(url, max_age_s=ROSTER_CACHE_MAX_AGE_S)

    def _render(self, url: str) -> str:
        """Client-side rendered pages: needs `pip install playwright` and its browser."""
        if self._browser is None:
            from playwright.sync_api import sync_playwright
            self._pw = sync_playwright().start()
            self._browser = self._pw.chromium.launch()
        page = self._browser.new_page(user_agent=USER_AGENT)
        try:
            page.goto(url, wait_until="networkidle", timeout=45_000)
            return page.content()
        finally:
            page.close()

    def close(self) -> None:
        if self._browser is not None:
            self._browser.close()
            self._pw.stop()


def _cache_connection():
    """Separate autocommit connection for the raw-page cache, so cached pages
    are kept even when a team's upsert rolls back. None without DATABASE_URL."""
    try:
        c = db.connect()
        c.autocommit = True
        return c
    except SystemExit:
        return None


def sync_rosters(sport_code: str, season: str | None = None, *,
                 conn: psycopg.Connection | None = None, render: bool = False) -> dict:
    """Scrape every member team's roster page for one sport/season and upsert
    athletes (new roster-only athletes are created; existing ones get
    position, height, class year, hometown and jersey updated)."""
    adapter: SportAdapter = get_adapter(sport_code)
    season = season or current_season()
    own_conn = conn is None
    conn = conn or db.connect()
    cache_conn = _cache_connection()
    fetcher = Fetcher(render=render, cache=DbResponseCache(cache_conn) if cache_conn else None)
    summary = {"sport": sport_code, "season": season, "teams": 0, "teams_failed": 0,
               "teams_no_table": 0, "athletes_updated": 0, "athletes_new": 0}
    try:
        with conn.cursor() as cur:
            sport = db.sport_id(cur, sport_code)
            cur.execute(
                """
                SELECT ts.id, ts.university_id, ts.team_url, u.name
                  FROM team_seasons ts JOIN universities u ON u.id = ts.university_id
                 WHERE ts.sport_id = %s AND ts.season = %s AND u.is_usports_member
                   AND ts.team_url IS NOT NULL
                 ORDER BY u.name
                """,
                (sport, season),
            )
            teams = cur.fetchall()
        if not teams:
            log.warning("no team pages known for %s %s — run the stats sync first", sport_code, season)

        for ts_id, uid, team_url, uni_name in teams:
            summary["teams"] += 1
            url = roster_url(team_url)
            try:
                entries = parse_roster_html(fetcher.get(url), url)
            except Exception as e:  # one bad page must not abort the run
                summary["teams_failed"] += 1
                log.warning("roster fetch failed for %s (%s): %s", uni_name, url, e)
                continue
            if not entries:
                summary["teams_no_table"] += 1
                log.warning("no roster table found for %s at %s (try --render)", uni_name, url)
                continue
            with conn.transaction(), conn.cursor() as cur:
                new, updated = _upsert_roster(cur, sport, uid, entries, adapter)
                cur.execute("UPDATE team_seasons SET roster_synced_at = now() WHERE id = %s", (ts_id,))
            summary["athletes_new"] += new
            summary["athletes_updated"] += updated
            log.info("%s: %d roster entries (%d new)", uni_name, len(entries), new)
        return summary
    finally:
        fetcher.close()
        if cache_conn:
            cache_conn.close()
        if own_conn:
            conn.close()


def _upsert_roster(cur: psycopg.Cursor, sport: int, uid: int, entries: list[RosterEntry],
                   adapter: SportAdapter) -> tuple[int, int]:
    idx = db.load_identity(cur, sport)
    new = updated = 0
    for e in entries:
        aid, reason = idx.resolve(uid, e.name_norm, e.player_id, e.season_segment)
        if aid is None:
            aid = db.insert_athlete(cur, sport, uid, e.first_name, e.last_name, e.jersey_number, e.player_id)
            new += 1
        idx.register(aid, uid, e.name_norm, e.player_id, e.season_segment, reason)
        toks = position_tokens(e.position, adapter.position_aliases)
        cur.execute(
            """
            UPDATE athletes SET
                first_name    = %s, last_name = %s, university_id = %s,
                position      = coalesce(%s, position),
                positions     = CASE WHEN %s::text[] = '{}' THEN positions ELSE %s::text[] END,
                jersey_number = coalesce(%s, jersey_number),
                height        = coalesce(%s, height),
                height_cm     = coalesce(%s, height_cm),
                class_year    = coalesce(%s, class_year),
                hometown      = coalesce(%s, hometown),
                usports_id    = coalesce(%s, usports_id),
                last_seen_at  = now()
             WHERE id = %s
            """,
            (e.first_name, e.last_name, uid, e.position,
             toks, toks,
             e.jersey_number, e.height, e.height_cm, e.class_year, e.hometown, e.player_id, aid),
        )
        updated += 1
    db.save_identity_keys(cur, sport, idx)
    return new, updated - new
