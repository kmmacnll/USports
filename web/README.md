# `web/` — VarsityHQ web app

Next.js 16 (App Router), TypeScript, Tailwind CSS 4 and lucide-react. The
whole app uses the Draft Battles theme from the Claude Design handoffs: navy
background with diagonal stripes, red primary (`#D93A40`), glowing tiles
(`tile`, `tile-primary`, `tile-blue`, `tile-live`, `tile-gold` utilities),
Manrope for text and italic Barlow Condensed for headings and numbers. The
tokens live in `app/globals.css`. It is mobile-first: phones get a bottom tab
bar (Home, League, Players, Scores, Battles), larger screens get the links in
the header, and player cards and the create/join forms open as bottom sheets.

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
| `/` | Home. Signed out: the welcome hero. Signed in: first-run eligibility + terms, your first league as the featured card (rank, roster points, roster fill), My leagues, a Draft Battles shortcut, top performers by FP/G and this week's scores for the chosen sport (your rostered players' teams marked). The "+" and "Join with code" buttons open the create/join sheet |
| `/leagues/[id]` | League header and invite (copy league ID and code), then Roster / Standings / Add players. Roster: tap a player, then a highlighted slot, to swap (or drag on desktop); the selection bar offers the player card and Drop. Standings: teams by roster points; tap one to view its roster. Add players: free agents, loaded straight away, with search and position chips |
| `/players` | Player directory: sport chips, search, university/conference filters, sort, position chips, paginate; tap a row for the player card. The URL holds all filters, so views can be shared |
| `/scores` | Scores by sport and day (from 3 days back to 4 ahead), grouped Live / Upcoming / Final, with your rostered players' teams marked |
| `/login` | Email + password sign-in. In local dev, also "continue as" any name |
| `/signup` | Create an account: name, email, optional university, password, confirm password |
| `/battles` | Draft Battles (full-screen, mobile-first): home pager, lobby, play a friend, inbox, ranked ladder, matchmaking, VS intro, a 6-pick snake draft, a live simulated match feed and the result + share card. **Demo only:** fictional Women's Hockey athletes and users, no backend yet. See `components/battles/` |

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
- Fantasy head-to-head matchups don't exist in the backend yet, so Home
  features your league standing and real U Sports games instead, and the
  league page says matchups are coming. The prototype's draft room isn't
  built either: leagues have no draft yet (players are added as free agents).

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


