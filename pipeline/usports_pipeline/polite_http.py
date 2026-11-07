"""Polite HTTP for every page the pipeline scrapes.

PoliteHttpClient is the only way pipeline code fetches HTML:

  * robots.txt: each host's robots.txt is read once per run and every URL is
    checked against it for our User-Agent. A disallowed URL raises
    RobotsDisallowed and is never requested. If robots.txt can't be read
    because of a 5xx or network error, the host is treated as disallowed
    (conservative); a 404 means "no rules" (allowed), as robots.txt specifies.
  * rate limit: at most one request per `min_interval_s` per host (default 2s),
    plus the host's Crawl-delay if it asks for more.
  * raw response cache: every successful body is stored (raw_source_responses
    in Postgres, or memory in tests). A cached body younger than `max_age_s` is
    returned without a request; older ones are re-fetched conditionally
    (If-None-Match / If-Modified-Since), so an unchanged page costs a 304.
  * retries: 429 / 502 / 503 / 504 and network errors, with backoff.

Terms of use are a human decision, not something code can verify: sources
that need one are gated in sources.CONFERENCE_SITES (`terms_reviewed`).
"""
from __future__ import annotations

import hashlib
import logging
import time
from dataclasses import dataclass
from typing import Callable, Protocol
from urllib import robotparser
from urllib.parse import urlparse

import requests

log = logging.getLogger(__name__)

USER_AGENT = "VarsityHQ-ingest/0.2 (+fantasy stats sync; contact via repository)"
DEFAULT_MIN_INTERVAL_S = 2.0
RETRY_STATUSES = (429, 502, 503, 504)


class RobotsDisallowed(Exception):
    """robots.txt forbids this URL for our User-Agent."""


@dataclass
class CachedResponse:
    url: str
    status_code: int
    body: str
    fetched_at: float           # epoch seconds
    etag: str | None = None
    last_modified: str | None = None
    content_type: str | None = None


class ResponseCache(Protocol):
    def get(self, source: str, url: str) -> CachedResponse | None: ...
    def put(self, source: str, resp: CachedResponse) -> None: ...
    def touch(self, source: str, url: str) -> None: ...


class MemoryResponseCache:
    def __init__(self) -> None:
        self.rows: dict[tuple[str, str], CachedResponse] = {}

    def get(self, source: str, url: str) -> CachedResponse | None:
        return self.rows.get((source, url))

    def put(self, source: str, resp: CachedResponse) -> None:
        self.rows[(source, resp.url)] = resp

    def touch(self, source: str, url: str) -> None:
        row = self.rows.get((source, url))
        if row:
            row.fetched_at = time.time()


class DbResponseCache:
    """raw_source_responses (migration 0006). Writes autocommit through their
    own connection so a cached page survives a rolled-back sport."""

    def __init__(self, conn) -> None:
        self.conn = conn

    def get(self, source: str, url: str) -> CachedResponse | None:
        with self.conn.cursor() as cur:
            cur.execute(
                """SELECT url, status_code, body, extract(epoch FROM fetched_at), etag, last_modified, content_type
                     FROM raw_source_responses WHERE source = %s AND url = %s""",
                (source, url),
            )
            row = cur.fetchone()
        return CachedResponse(row[0], row[1], row[2] or "", float(row[3]), row[4], row[5], row[6]) if row else None

    def put(self, source: str, resp: CachedResponse) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO raw_source_responses (source, url, status_code, content_type, etag, last_modified,
                                                  body, body_sha256, fetched_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now())
                ON CONFLICT (source, url) DO UPDATE SET
                  status_code = EXCLUDED.status_code, content_type = EXCLUDED.content_type,
                  etag = EXCLUDED.etag, last_modified = EXCLUDED.last_modified, body = EXCLUDED.body,
                  body_sha256 = EXCLUDED.body_sha256, fetched_at = now()
                """,
                (source, resp.url, resp.status_code, resp.content_type, resp.etag, resp.last_modified,
                 resp.body, hashlib.sha256(resp.body.encode()).hexdigest()),
            )

    def touch(self, source: str, url: str) -> None:
        with self.conn.cursor() as cur:
            cur.execute("UPDATE raw_source_responses SET fetched_at = now() WHERE source = %s AND url = %s",
                        (source, url))


class PoliteHttpClient:
    def __init__(self, *, source: str, cache: ResponseCache | None = None,
                 min_interval_s: float = DEFAULT_MIN_INTERVAL_S, user_agent: str = USER_AGENT,
                 session: requests.Session | None = None,
                 sleep: Callable[[float], None] = time.sleep, clock: Callable[[], float] = time.monotonic,
                 attempts: int = 3) -> None:
        self.source = source
        self.cache = cache
        self.min_interval_s = min_interval_s
        self.user_agent = user_agent
        self.session = session or requests.Session()
        self.session.headers["User-Agent"] = user_agent
        self.sleep = sleep
        self.clock = clock
        self.attempts = attempts
        self._robots: dict[str, robotparser.RobotFileParser | None] = {}
        self._last_request: dict[str, float] = {}
        self.stats = {"requests": 0, "cache_hits": 0, "not_modified": 0, "robots_blocked": 0}

    # -------------------------------------------------------------- robots.txt
    def _robots_for(self, url: str) -> robotparser.RobotFileParser | None:
        """None = no usable rules = disallow everything on this host."""
        parts = urlparse(url)
        host = f"{parts.scheme}://{parts.netloc}"
        if host in self._robots:
            return self._robots[host]
        rp = robotparser.RobotFileParser()
        robots_url = f"{host}/robots.txt"
        try:
            self._throttle(parts.netloc)
            r = self.session.get(robots_url, timeout=20)
            self.stats["requests"] += 1
            if r.status_code >= 500:
                log.warning("robots.txt for %s returned %s: treating host as disallowed", host, r.status_code)
                parser = None
            elif r.status_code >= 400:
                rp.parse([])            # 4xx: no robots.txt -> everything allowed
                parser = rp
            else:
                rp.parse(r.text.splitlines())
                parser = rp
        except requests.RequestException as e:
            log.warning("robots.txt for %s unreachable (%s): treating host as disallowed", host, e)
            parser = None
        self._robots[host] = parser
        return parser

    def robots_status(self, url: str) -> str:
        """'allowed' | 'disallowed' | 'unreachable' (robots.txt could not be read)."""
        rp = self._robots_for(url)
        if rp is None:
            return "unreachable"
        return "allowed" if rp.can_fetch(self.user_agent, url) else "disallowed"

    def allowed(self, url: str) -> bool:
        rp = self._robots_for(url)
        return bool(rp and rp.can_fetch(self.user_agent, url))

    def crawl_delay(self, url: str) -> float:
        rp = self._robots_for(url)
        delay = rp.crawl_delay(self.user_agent) if rp else None
        return max(self.min_interval_s, float(delay or 0))

    # -------------------------------------------------------------- throttle
    def _throttle(self, netloc: str, interval: float | None = None) -> None:
        interval = self.min_interval_s if interval is None else interval
        last = self._last_request.get(netloc)
        if last is not None:
            wait = interval - (self.clock() - last)
            if wait > 0:
                self.sleep(wait)
        self._last_request[netloc] = self.clock()

    # -------------------------------------------------------------- fetch
    def get(self, url: str, *, max_age_s: float | None = None) -> str:
        """Body of `url`. Uses the cache when younger than max_age_s."""
        cached = self.cache.get(self.source, url) if self.cache else None
        if cached and max_age_s is not None and time.time() - cached.fetched_at < max_age_s:
            self.stats["cache_hits"] += 1
            return cached.body

        if not self.allowed(url):
            self.stats["robots_blocked"] += 1
            raise RobotsDisallowed(f"robots.txt disallows {url} for {self.user_agent!r}")

        headers = {}
        if cached and cached.etag:
            headers["If-None-Match"] = cached.etag
        if cached and cached.last_modified:
            headers["If-Modified-Since"] = cached.last_modified

        netloc = urlparse(url).netloc
        for attempt in range(1, self.attempts + 1):
            self._throttle(netloc, self.crawl_delay(url))
            try:
                r = self.session.get(url, timeout=30, headers=headers)
                self.stats["requests"] += 1
                if r.status_code in RETRY_STATUSES:
                    raise requests.HTTPError(str(r.status_code), response=r)
                if r.status_code == 304 and cached:
                    self.stats["not_modified"] += 1
                    if self.cache:
                        self.cache.touch(self.source, url)
                    return cached.body
                r.raise_for_status()
                resp = CachedResponse(url=url, status_code=r.status_code, body=r.text, fetched_at=time.time(),
                                      etag=r.headers.get("ETag"), last_modified=r.headers.get("Last-Modified"),
                                      content_type=r.headers.get("Content-Type"))
                if self.cache:
                    self.cache.put(self.source, resp)
                return resp.body
            except requests.RequestException:
                if attempt == self.attempts:
                    raise
                self.sleep(2 ** attempt)
        raise AssertionError("unreachable")
