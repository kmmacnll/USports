# `web/` — VarsityHQ web app

Next.js 16 (App Router), TypeScript, Tailwind CSS 4 and lucide-react. The
design is dark-first: `slate-900` background, electric teal accent (`#06B6D4`,
the `accent` colour token) and frosted-glass cards (`glass` utility, using
`backdrop-blur-md`).

```bash
cd web
npm ci
cp .env.example .env.local      # API_BASE_URL=http://localhost:3000/api/v1
npm run dev                     # http://localhost:3001 (the API runs on :3000)
npm run build && npm start      # production
```

## Pages

| Route | What |
|---|---|
| `/` | Dashboard: your leagues (rank, roster points, fill), create and join a league, terms acceptance, real U Sports games (last 3 days and next 4, with your rostered players' teams marked), and the top performers by FP/G |
| `/leagues/[id]` | League header and invite code; roster grid split into Starters and Bench. Drag a player onto a slot, or tap a player and then a highlighted slot; occupied slots swap. Also: player stat popovers, drop, a free-agent search to add players, and a teams list (click a team to view its roster) |
| `/players` | Player directory: search, then filter by university, conference and position; sort; paginate; click a name for the stat popover. The URL holds all filters, so views can be shared |
| `/login` | Email + password sign-in. In local dev, also "continue as" any name |
| `/signup` | Create an account: name, email, optional university, password, confirm password |
| `/battles` | Draft Battles (mobile-first, its own navy/red theme): home pager, lobby, play a friend, inbox, ranked ladder, matchmaking, VS intro, a 6-pick snake draft, a live simulated match feed and the result + share card. **Demo only:** fictional Women's Hockey athletes and users, no backend yet. See `components/battles/` |
| `/mobile` | VarsityHQ phone app (mobile-first, navy/red theme): onboarding with athlete eligibility, Home (live matchup card, my leagues, top performers), League (live matchup with a play-by-play feed, standings, roster with tap-to-swap lineup), Players (search, position filter, add/drop), Scores, player card and create/join sheets, and a snake draft room. **Demo only:** fictional athletes and teams, no backend yet. See `components/mobile/` |

## How it talks to the API

- `lib/api.ts` is the single fetch client. It is server-only and configured by
  environment variables: `API_HOSTPORT` (set by render.yaml for the private
  network) or `API_BASE_URL`. It attaches the session's bearer token and turns
  API errors into an `ApiError` carrying the API's error `code`.
- Pages are React Server Components that call the API directly. Mutations
  (swap, add, drop, create, join, terms) are Server Actions in `lib/actions.ts`.
  They return `{ ok, error }`, so the UI can show the API's message (e.g. "not
  eligible for slot G"), and they revalidate the page.
- The token lives in an httpOnly cookie. Browser JavaScript never sees it, and
  the browser never calls the API, so the API needs no CORS setup.
- Eligibility highlighting in the roster grid mirrors the API's rule, but
  the database still has the final say. A rejected move rolls back the
  optimistic update and shows the reason.

## Data notes

- Season stats and FP/G exclude exhibition games.
- The conference filter stays disabled ("Not available yet") until
  `universities.conference` is populated; no data source fills it yet.
- Fantasy head-to-head matchups don't exist in the backend yet, so the
  dashboard shows real U Sports games instead of fantasy matchups.

## Draft Battles (`/battles`)

Built from the "Draft Battles" Claude Design handoff. Everything lives in
`components/battles/` and `app/battles/`, scoped under the `.vb` class so it
doesn't touch the rest of the app's teal theme.

- `data.ts`: the fictional player pool, friends, inbox and ladder, plus
  `simulate()`, a seeded match engine that turns two drafted lineups into the
  event stream the live feed plays (`{t, period, clock, type, side, playerIds,
  text, scoreA, scoreB, momentum}`), with sudden-death OT on a tie.
- The screen is kept in the URL hash (`/battles#ladder`), so browser back
  works. Battle screens need in-memory state and fall back to Home on reload.
- Fonts (Manrope, Barlow Condensed, Material Symbols Rounded) load from Google
  Fonts in `app/battles/layout.tsx`.
- Not built yet: real matchmaking, invites, Elo and ladder persistence (no API
  endpoints exist), real U Sports athletes in the draft pool, and sports other
  than hockey (the lobby shows them as "coming soon").


## VarsityHQ phone app (`/mobile`)

Built from the "VarsityHQ App" Claude Design handoff (an iOS prototype). The
phone frame, status bar and the prototype's "jump to" list are not part of the
build; the screens are deep-linkable instead (`/mobile#onboarding`, `#matchup`,
`#standings`, `#roster`, `#players`, `#scores`, `#draft`), and browser back works.
Everything lives in `components/mobile/` and `app/mobile/`, scoped under the
`.vhq` class.

- `data.ts`: the fictional football pool (OUA Diehards), today's game states,
  the basketball draft pool (Snow Bowl Hoops), scores, sports and slot rules.
  `elig()` mirrors the API's slot eligibility (FLEX takes RB/WR, bench takes anyone).
- `store.tsx`: one state object plus actions (swap, add, drop, draft pick), the
  live-scoring ticker (a random play every 2.4 s for a starter whose game is
  live) and the draft clock (other teams pick each second; your 30 s clock
  auto-picks your top queued player, else the best available).
- Not built yet: wiring to the real API (leagues, rosters, players, games),
  fantasy matchups (no backend endpoint), trades, and the Frozen Four league.
