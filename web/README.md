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
| `/login` | Paste an API token (until real sign-in exists). In local dev, you can also "continue as" any name |

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
