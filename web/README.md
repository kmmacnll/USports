# `web/` — VarsityHQ web app

The site is Draft Battles: draft real U Sports athletes head-to-head and watch a
live simulated match. Next.js 16 (App Router), TypeScript, Tailwind CSS 4 and
lucide-react, in the Battles theme from the Claude Design handoff (navy, red
`#D93A40`, glowing tiles, Manrope and italic Barlow Condensed). Tokens live in
`app/globals.css`. It is mobile-first; on larger screens Battles sits in a
phone-width column.

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
| `/` | Draft Battles (full-screen): home pager, lobby, VS intro, a 6-pick snake draft, a live simulated match feed and the result + share card. Play vs AI works; ranked, friends, invites and the ladder say "coming soon" until the web app is wired to the Battles API. The draft pool is real U Sports hockey players rated by the API (`GET /players`); with no ratings loaded, play is disabled. No made-up athletes or users: your name comes from your session and your W–L record is kept on your device |
| `/battles` | Permanent redirect to `/` (the browser keeps the `#screen`, so old links still land on the right screen) |
| `/login` | Email + password sign-in. In local dev, also "continue as" any name |
| `/signup` | Create an account: name, email, optional university, password, confirm password |

The header has the logo (home) and sign in / sign out. The season-long fantasy
league screens (dashboard, league rosters, players, scores) were removed from
the web app; the API still serves those endpoints.

## How it talks to the API

- `lib/api.ts` is the single fetch client. It is server-only and configured by
  environment variables: `API_HOSTPORT` (set by render.yaml for the private
  network) or `API_BASE_URL`. It attaches the session's bearer token and turns
  API errors into an `ApiError` carrying the API's error `code`.
- `app/page.tsx` is a React Server Component: it reads `/me` and the rated
  player pools, then hands them to the client-side Battles app.
- Sign up, sign in and sign out are Server Actions in `lib/actions.ts`. The
  token lives in an httpOnly cookie. Browser JavaScript never sees it, and the
  browser never calls the API, so the API needs no CORS setup.

## Draft Battles

Built from the "Draft Battles" Claude Design handoff. Everything lives in
`components/battles/`, with its styles in `app/battles.css`, scoped under the
`.vb` class (the header and sign-in pages use the same palette from
`app/globals.css`).

- `data.ts`: maps the API's rated players into the draft pool (`fromApi`, `setPool`), the house AI opponent, plus
  `simulate()`, a seeded match engine that turns two drafted lineups into the
  event stream the live feed plays (`{t, period, clock, type, side, playerIds,
  text, scoreA, scoreB, momentum}`), with sudden-death OT on a tie.
- The screen is kept in the URL hash (`/#ladder`), so browser back
  works. Battle screens need in-memory state and fall back to Home on reload.
- Fonts (Manrope, Barlow Condensed, Material Symbols Rounded) load from Google
  Fonts in `app/layout.tsx`.
- `me.tsx`: the signed-in user (display name from `/me`, passed in by
  `app/page.tsx`) and your battle record, which is stored in
  `localStorage` (`vhq.battles.record`) until the UI talks to the API.
- `app/page.tsx` loads the women's and men's hockey pools from
  `GET /players` (cached 5 minutes). A battle needs at least 12 rated players;
  until the ratings job has run on real data, Play AI is disabled.
- Not built yet: wiring the UI to the backend's Battles endpoints (matchmaking,
  friend invites, Elo and the weekly ladder), so ranked, friends, the inbox and
  the ladder show "coming soon"; and sports other than hockey.


