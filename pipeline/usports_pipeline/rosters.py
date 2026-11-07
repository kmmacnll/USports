"""usports.ca roster scraper (BeautifulSoup, optional Playwright).

usportspy has no roster endpoint for team sports, so positions, heights and
class years come from the team pages on en.usports.ca. Team page URLs come
from the box-score feed's team links when it has them (basketball only:
team_seasons.team_url, written by sync_athletes_and_stats). For every other
sport, and any team the feed missed, they are discovered from the sport's
teams index page (en.usports.ca/sports/<path>/<season>/teams) and matched
to our universities by slug / name / alias.

A run that syncs no team at all raises RosterSyncFailed with the reasons
(no team pages, HTTP errors, robots.txt, no roster table), so the cron job
shows as failed instead of silently succeeding.

Parsing is header-driven (find the table whose header row has a name column
and a position column), so it doesn't depend on CSS class names.

STATUS: this module has unit tests against a synthetic page only. It has not
yet been run against live en.usports.ca pages (not reachable from the
environment it was written in). Run `--rosters --dry-run` once before
relying on it.
"""
from __future__ import annotations

import logging
import re
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


TEAMS_INDEX = "https://en.usports.ca/sports/{path}/{season}/teams"
_TEAM_HREF = re.compile(r"/sports/[a-z]+/[0-9]{4}-[0-9]{2}[a-z]?/teams(?:\?id=[A-Za-z0-9]+|/[A-Za-z0-9-]+)")
_GENERIC = re.compile(r"\b(university|universite|universit[eé]|of|de|du|the|college|u)\b")


class RosterSyncFailed(RuntimeError):
    pass


def parse_team_links(html: str, base_url: str) -> list[tuple[str, str]]:
    """Teams index page -> [(team name, absolute team URL)], de-duplicated.
    Accepts both Presto URL styles: /teams?id=<id> and /teams/<slug>."""
    soup = BeautifulSoup(html, "html.parser")
    out: dict[str, str] = {}
    for a in soup.find_all("a", href=True):
        href = urljoin(base_url, a["href"])
        m = _TEAM_HREF.search(urlparse(href).path + ("?" + urlparse(href).query if urlparse(href).query else ""))
        if not m:
            continue
        parts = urlparse(href)
        q = {k: v for k, v in parse_qsl(parts.query) if k == "id"}
        url = urlunparse(parts._replace(query=urlencode(q), fragment=""))
        name = _clean(a.get_text(" "))
        if not name or name.lower() in ("roster", "schedule", "stats", "teams"):
            name = out.get(url, "")
        if url not in out or (name and not out[url]):
            out[url] = name
    return [(n, u) for u, n in out.items() if n or "/teams/" in u]


def _name_key(s: str) -> str:
    from .normalize import slugify, strip_accents
    t = strip_accents(s).lower().replace("'", "")
    return slugify(_GENERIC.sub(" ", t))


def match_university(name: str, url: str, unis: list[tuple[int, str, str, list[str]]]) -> int | None:
    """unis: (id, name, slug, alias slugs). Matches the URL slug, then the name."""
    from .normalize import slugify
    tail = urlparse(url).path.rstrip("/").rsplit("/", 1)[-1]
    slug_from_url = slugify(tail) if "/teams/" in urlparse(url).path else None
    keys = {slugify(name), _name_key(name)} - {""}
    for uid, uname, uslug, aliases in unis:
        candidates = {uslug, *aliases}
        if slug_from_url and slug_from_url in candidates:
            return uid
        if keys & (candidates | {slugify(uname), _name_key(uname)}):
            return uid
    return None


def discover_team_urls(cur: psycopg.Cursor, fetcher: "Fetcher", adapter: SportAdapter, sport: int, season: str) -> dict:
    """Fill team_seasons.team_url for member teams that have none, from the
    sport's teams index page. Returns counts for the summary."""
    cur.execute(
        """SELECT u.id, u.name, u.slug, coalesce(array_agg(a.alias_slug) FILTER (WHERE a.alias_slug IS NOT NULL), '{}')
             FROM universities u LEFT JOIN university_aliases a ON a.university_id = u.id
            WHERE u.is_usports_member GROUP BY u.id""")
    unis = [(r[0], r[1], r[2], list(r[3])) for r in cur.fetchall()]
    # The box-score feed's team links are unreliable (live 2026-27 data gave
    # one team id to up to three schools): a URL shared by several schools
    # can't be right, so drop it. The teams index below is authoritative.
    cur.execute(
        """UPDATE team_seasons SET team_url = NULL
            WHERE sport_id = %s AND season = %s AND team_url IN (
                  SELECT team_url FROM team_seasons WHERE sport_id = %s AND season = %s AND team_url IS NOT NULL
                   GROUP BY team_url HAVING count(*) > 1)""", (sport, season, sport, season))
    dropped = cur.rowcount
    index = TEAMS_INDEX.format(path=adapter.usports_path, season=season)
    links = parse_team_links(fetcher.get(index), index)
    found, unmatched = {}, []
    for name, url in links:
        uid = match_university(name, url, unis)
        if uid is None:
            unmatched.append(name or url)
        elif uid not in found:
            found[uid] = url
    cur.executemany(
        """INSERT INTO team_seasons (university_id, sport_id, season, team_url) VALUES (%s, %s, %s, %s)
           ON CONFLICT (sport_id, season, university_id) DO UPDATE SET team_url = EXCLUDED.team_url""",
        [(uid, sport, season, url) for uid, url in found.items()])
    if unmatched:
        log.info("teams index %s: %d link(s) not matched to a member university: %s",
                 index, len(unmatched), ", ".join(unmatched[:10]))
    return {"index_links": len(links), "discovered": len(found), "unmatched": len(unmatched), "feed_links_dropped": dropped}


def describe_page(html: str) -> str:
    """One line on what a page actually contains, for the log when parsing finds nothing."""
    soup = BeautifulSoup(html, "html.parser")
    title = _clean(soup.title.get_text()) if soup.title else ""
    tables = soup.find_all("table")
    heads = []
    for t in tables[:4]:
        row = (t.find("thead") or t).find("tr")
        cells = [_clean(c.get_text(" "))[:15] for c in row.find_all(["th", "td"])][:8] if row else []
        heads.append("|".join(cells))
    scripts = len(soup.find_all("script"))
    text = _clean(soup.get_text(" "))
    return (f"{len(html) // 1024} KB, title {title[:60]!r}, {len(tables)} table(s)"
            + (f" headers {heads}" if heads else "")
            + f", {scripts} script tag(s), {len(text)} chars of text, mentions 'roster' {text.lower().count('roster')}x"
            + (", looks client-rendered" if len(text) < 2000 and scripts > 5 else ""))


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
               "teams_no_table": 0, "teams_synced": 0, "athletes_updated": 0, "athletes_new": 0,
               "discovery": None, "errors": {}}
    errors: dict[str, int] = summary["errors"]
    try:
        with conn.cursor() as cur:
            sport = db.sport_id(cur, sport_code)
        try:
            with conn.transaction(), conn.cursor() as cur:
                summary["discovery"] = discover_team_urls(cur, fetcher, adapter, sport, season)
        except Exception as e:  # noqa: BLE001 - the feed's links may still work
            errors[f"teams index: {_reason(e)}"] = 1
            log.warning("teams index for %s %s failed: %s", sport_code, season, e)
        with conn.cursor() as cur:
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
                html = fetcher.get(url)
                entries = parse_roster_html(html, url)
            except Exception as e:  # one bad page must not abort the run
                summary["teams_failed"] += 1
                errors[_reason(e)] = errors.get(_reason(e), 0) + 1
                log.warning("roster fetch failed for %s (%s): %s", uni_name, url, e)
                continue
            if not entries:
                summary["teams_no_table"] += 1
                errors["no roster table on page"] = errors.get("no roster table on page", 0) + 1
                log.warning("no roster table found for %s at %s (try --render) — page: %s", uni_name, url,
                            describe_page(html))
                continue
            with conn.transaction(), conn.cursor() as cur:
                new, updated = _upsert_roster(cur, sport, uid, entries, adapter)
                cur.execute("UPDATE team_seasons SET roster_synced_at = now() WHERE id = %s", (ts_id,))
            summary["athletes_new"] += new
            summary["athletes_updated"] += updated
            summary["teams_synced"] += 1
            log.info("%s: %d roster entries (%d new)", uni_name, len(entries), new)
        if summary["teams_synced"] == 0:
            why = "; ".join(f"{k} x{v}" for k, v in errors.items()) or "no team pages known"
            raise RosterSyncFailed(f"{sport_code} {season}: no roster synced ({summary['teams']} team page(s) tried; {why})")
        return summary
    finally:
        fetcher.close()
        if cache_conn:
            cache_conn.close()
        if own_conn:
            conn.close()


def _reason(e: Exception) -> str:
    """Short, groupable failure reason for the summary."""
    if isinstance(e, RobotsDisallowed):
        return "blocked by robots.txt"
    resp = getattr(e, "response", None)
    if resp is not None and getattr(resp, "status_code", None):
        return f"HTTP {resp.status_code}"
    return type(e).__name__


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
