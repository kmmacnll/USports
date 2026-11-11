import { SignJWT } from 'jose';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';

const JWT_SECRET = 'test-secret-test-secret-test-secret-0123';
let db: Db;
let app: ReturnType<typeof createApp>;

const as = (subject: string) => ({ 'X-Dev-User': subject });

beforeAll(() => {
  const cfg = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL!,
    AUTH_DEV_HEADER: 'true',
    JWT_SECRET,
  });
  db = createPool(cfg.DATABASE_URL, 4);
  app = createApp(cfg, db, pino({ level: 'silent' }));
});

afterAll(async () => {
  await db.end();
});

async function athleteId(lastName: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>('SELECT id FROM athletes WHERE last_name = $1', [lastName]);
  return `usports_ath_${rows[0]!.id}`;
}

/** Signs the user in once, which creates their account. Nothing else is needed to play. */
async function ensureUser(subject: string) {
  await request(app).get('/api/v1/me').set(as(subject)).expect(200);
}

describe('GET /api/v1/sports', () => {
  it('lists active sports with ordered roster positions and scoring, without auth', async () => {
    const res = await request(app).get('/api/v1/sports').expect(200);
    const mbk = res.body.data.find((s: { sport_id: string }) => s.sport_id === 'usports_mbk');
    expect(mbk).toMatchObject({
      sport_name: "Men's Basketball",
      season: '2026-27',
      ruleset_id: 'usports_mbk_standard',
      roster_positions: ['G', 'G', 'F', 'F', 'C', 'BENCH', 'BENCH', 'BENCH', 'BENCH', 'BENCH', 'BENCH'],
      roster_limits: { G: 2, F: 2, C: 1, BENCH: 6 },
      scoring_rules: { points: 1, rebounds: 1.2, assists: 1.5, steals: 3, blocks: 3, turnovers: -1 },
    });
    expect(Object.keys(mbk.roster_limits)).toEqual(['G', 'F', 'C', 'BENCH']);

    const fb = res.body.data.find((s: { sport_id: string }) => s.sport_id === 'usports_fb');
    expect(fb).toMatchObject({
      ruleset_id: 'usports_football_half_ppr',
      ruleset_name: 'Half-PPR Scoring',
      roster_limits: { QB: 2, RB: 3, WR: 4, K: 1, DEF: 1, BENCH: 4 },
      scoring_rules: {
        passing: { yards: 0.04, touchdown: 4, interception: -2, two_point: 2 },
        kicking: { fg_0_39: 3, fg_40_49: 4, fg_50_plus: 5, pat: 1, single_rouge: 1, fg_missed: -1 },
        misc: { fumble_lost: -2 },
      },
    });
    expect(Object.keys(fb.roster_limits)).toEqual(['QB', 'RB', 'WR', 'K', 'DEF', 'BENCH']);
    expect(res.body.data.map((s: { sport_id: string }) => s.sport_id)).not.toContain('usports_mtf');
  });

  it('includes inactive sports on request', async () => {
    const res = await request(app).get('/api/v1/sports?include_inactive=true').expect(200);
    expect(res.body.data.map((s: { sport_id: string }) => s.sport_id)).toContain('usports_mtf');
  });
});

describe('GET /api/v1/athletes', () => {
  it('requires a sport', async () => {
    const res = await request(app).get('/api/v1/athletes').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns season stats in the athlete schema, excluding exhibitions, sorted by fantasy points', async () => {
    const res = await request(app).get('/api/v1/athletes?sport=usports_mbk').expect(200);
    expect(res.body.pagination).toEqual({ page: 1, page_size: 25, total: 5 });
    // Centre: one game, 4 + 10*1.2 + 2*3 = 22. Guard: (26 + 16) / 2 = 21; the 50-point exhibition is ignored.
    expect(res.body.data.slice(0, 2).map((a: { last_name: string }) => a.last_name)).toEqual(['Centre', 'Guard']);
    const top = res.body.data[1];
    expect(top).toMatchObject({
      first_name: 'Gary', last_name: 'Guard', university: 'Alpha U', conference: 'OUA',
      sport: 'usports_mbk', position: 'G',
      stats: { games_played: 2, ppg: 15, rpg: 5, fantasy_points_avg: 21, fantasy_points_total: 42 },
    });
    expect(top.athlete_id).toMatch(/^usports_ath_\d+$/);
    const nora = res.body.data.find((a: { last_name: string }) => a.last_name === 'Noposition');
    expect(nora.stats).toEqual({ games_played: 0, fantasy_points_avg: null, fantasy_points_total: 0 });
  });

  it('filters by university, name prefix and position, and paginates', async () => {
    const byUni = await request(app).get('/api/v1/athletes?sport=usports_mbk&university=beta&sort=name').expect(200);
    expect(byUni.body.data.map((a: { last_name: string }) => a.last_name)).toEqual(['Centre', 'Forward', 'Noposition']);

    const byName = await request(app).get('/api/v1/athletes?sport=usports_mbk&q=gin%20guar').expect(200);
    expect(byName.body.data.map((a: { first_name: string }) => a.first_name)).toEqual(['Gina']);

    const byPos = await request(app).get('/api/v1/athletes?sport=usports_mbk&position=g').expect(200);
    expect(byPos.body.pagination.total).toBe(2);

    const page2 = await request(app).get('/api/v1/athletes?sport=usports_mbk&page=2&page_size=2&sort=name').expect(200);
    expect(page2.body.data).toHaveLength(2);
    expect(page2.body.pagination.total).toBe(5);
  });

  it('rejects an unknown sport', async () => {
    const res = await request(app).get('/api/v1/athletes?sport=usports_curling').expect(404);
    expect(res.body.error.code).toBe('UNKNOWN_SPORT');
  });
});

describe('reference endpoints', () => {
  it('returns one athlete with season stats and a game log (exhibitions unscored)', async () => {
    const res = await request(app).get(`/api/v1/athletes/${await athleteId('Guard')}`).expect(200);
    expect(res.body).toMatchObject({ last_name: 'Guard', season: '2026-27', stats: { games_played: 2, ppg: 15 } });
    expect(res.body.games.map((g: { date: string }) => g.date)).toEqual(['2026-11-03', '2026-11-01', '2026-08-01']);
    expect(res.body.games[0]).toMatchObject({ opponent: 'Beta U', home: true, result: 'W 80-70', fantasy_points: 16 });
    expect(res.body.games[2]).toMatchObject({ exhibition: true, fantasy_points: null });
    await request(app).get('/api/v1/athletes/usports_ath_999999').expect(404);
  });

  it('lists member universities for a sport', async () => {
    const res = await request(app).get('/api/v1/universities?sport=usports_mbk').expect(200);
    expect(res.body.data).toEqual([
      { university_id: 'alpha', name: 'Alpha U', conference: 'OUA' },
      { university_id: 'beta', name: 'Beta U', conference: 'CW' },
    ]);
  });

  it('filters athletes by conference', async () => {
    const res = await request(app).get('/api/v1/athletes?sport=usports_mbk&conference=cw&sort=name').expect(200);
    expect(res.body.data.map((a: { last_name: string }) => a.last_name)).toEqual(['Centre', 'Forward', 'Noposition']);
  });

  it('lists games in a date window', async () => {
    const res = await request(app).get('/api/v1/games?sport=usports_mbk&from=2026-10-30&to=2026-11-05').expect(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({
      date: '2026-11-01', status: 'FINAL', home: { name: 'Alpha U', score: 80 }, away: { name: 'Beta U', score: 70 },
    });
  });

  it('describes stat columns per sport', async () => {
    const res = await request(app).get('/api/v1/sports').expect(200);
    const mbk = res.body.data.find((s: { sport_id: string }) => s.sport_id === 'usports_mbk');
    expect(mbk.stat_columns.season[0]).toEqual({ key: 'ppg', label: 'PPG' });
    expect(mbk.stat_columns.game.map((c: { key: string }) => c.key)).toContain('points');
  });
});

describe('auth', () => {
  it('requires authentication for user endpoints', async () => {
    await request(app).get('/api/v1/me').expect(401);
  });

  it('accepts HS256 bearer tokens and rejects bad ones', async () => {
    const token = await new SignJWT({ name: 'Token User' }).setProtectedHeader({ alg: 'HS256' })
      .setSubject('jwt-user').setExpirationTime('5m').sign(new TextEncoder().encode(JWT_SECRET));
    const res = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body).toMatchObject({ display_name: 'Token User' });
    expect(res.body).not.toHaveProperty('terms');
    expect(res.body).not.toHaveProperty('athlete_sports');
    const bad = await request(app).get('/api/v1/me').set('Authorization', 'Bearer nope').expect(401);
    expect(bad.body.error.code).toBe('INVALID_TOKEN');
  });

  it('lets a brand-new user create a league straight away (no terms step)', async () => {
    await request(app).post('/api/v1/leagues').set(as('no-terms'))
      .send({ league_name: 'Day One', sport: 'usports_mbk' }).expect(201);
    await request(app).put('/api/v1/me/terms').set(as('no-terms')).send({}).expect(404);
  });
});

describe('GET /universities', () => {
  it('lists a school once even when duplicate rows share its name', async () => {
    await db.query(`INSERT INTO universities (name, slug, is_usports_member) VALUES ('UofA', 'alberta-dup-a', TRUE), ('UofA', 'alberta-dup-b', TRUE)`);
    try {
      const res = await request(app).get('/api/v1/universities').expect(200);
      const names = res.body.data.map((u: { name: string }) => u.name);
      expect(names.filter((n: string) => n === 'UofA')).toHaveLength(1);
      expect(new Set(names).size).toBe(names.length);
    } finally {
      await db.query(`DELETE FROM universities WHERE slug IN ('alberta-dup-a', 'alberta-dup-b')`);
    }
  });
});

describe('PATCH /me', () => {
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('changes the display name and profile picture, and removes the picture with null', async () => {
    await ensureUser('settings-user');
    const res = await request(app).patch('/api/v1/me').set(as('settings-user'))
      .send({ display_name: '  New Name ', avatar_data_url: pixel }).expect(200);
    expect(res.body).toMatchObject({ display_name: 'New Name', avatar_url: pixel });
    const me = await request(app).get('/api/v1/me').set(as('settings-user')).expect(200);
    expect(me.body).toMatchObject({ display_name: 'New Name', avatar_url: pixel });
    const cleared = await request(app).patch('/api/v1/me').set(as('settings-user')).send({ avatar_data_url: null }).expect(200);
    expect(cleared.body).toMatchObject({ display_name: 'New Name', avatar_url: null });
  });

  it('rejects blank names, non-image pictures, unknown fields and anonymous callers', async () => {
    await ensureUser('settings-bad');
    for (const body of [{ display_name: '   ' }, { avatar_data_url: 'data:text/html;base64,PHA+' }, { email: 'x@y.z' }]) {
      const res = await request(app).patch('/api/v1/me').set(as('settings-bad')).send(body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    await request(app).patch('/api/v1/me').send({ display_name: 'Nobody' }).expect(401);
  });
});

describe('leagues', () => {
  let hoops: string;
  let inviteCode: string;

  beforeAll(async () => {
    await ensureUser('commish');
    await ensureUser('rival');
    await ensureUser('third');
    await ensureUser('hooper');
  });

  it('creates a league with the default ruleset and the commissioner\'s team', async () => {
    const res = await request(app).post('/api/v1/leagues').set(as('commish'))
      .send({ league_name: 'Hoops League', sport: 'usports_mbk', max_teams: 2, team_name: 'Commish Five' })
      .expect(201);
    expect(res.body).toMatchObject({
      league_name: 'Hoops League', sport: 'usports_mbk', season: '2026-27', max_teams: 2, roster_size: 11,
      ruleset_id: 'usports_mbk_standard', team_count: 1, status: 'PRE_DRAFT', is_private: true,
    });
    expect(Object.keys(res.body.roster_limits)).toEqual(['G', 'F', 'C', 'BENCH']);
    expect(res.body.league_id).toMatch(/^lg_\d+$/);
    expect(res.body.commissioner_id).toMatch(/^usr_\d+$/);
    expect(res.headers.location).toBe(`/api/v1/leagues/${res.body.league_id}`);
    hoops = res.body.league_id;
    inviteCode = res.body.invite_code;
  });

  it('creates a football league with custom roster limits (product example)', async () => {
    const res = await request(app).post('/api/v1/leagues').set(as('commish')).send({
      league_name: 'Vanier Cup Chasers', sport: 'usports_fb', max_teams: 10, roster_size: 15,
      roster_limits: { QB: 2, RB: 3, WR: 4, K: 1, DEF: 1, BENCH: 4 },
    }).expect(201);
    expect(res.body.roster_limits).toEqual({ QB: 2, RB: 3, WR: 4, K: 1, DEF: 1, BENCH: 4 });
    expect(res.body).toMatchObject({ roster_size: 15, ruleset_id: 'usports_football_half_ppr', season: '2026-27' });
  });

  it('selects a ruleset by ruleset_id', async () => {
    await request(app).post('/api/v1/leagues').set(as('commish'))
      .send({ league_name: 'By Id', sport: 'usports_fb', ruleset_id: 'usports_football_half_ppr' }).expect(201);
    const res = await request(app).post('/api/v1/leagues').set(as('commish'))
      .send({ league_name: 'Wrong Sport', sport: 'usports_fb', ruleset_id: 'usports_mbk_standard' }).expect(422);
    expect(res.body.error.code).toBe('UNKNOWN_RULESET');
  });

  it('validates roster limits', async () => {
    const mismatch = await request(app).post('/api/v1/leagues').set(as('commish')).send({
      league_name: 'Bad', sport: 'usports_fb', roster_size: 14, roster_limits: { QB: 2, RB: 3, WR: 4, K: 1, DEF: 1, BENCH: 4 },
    }).expect(422);
    expect(mismatch.body.error.code).toBe('ROSTER_SIZE_MISMATCH');
    const unknownSlot = await request(app).post('/api/v1/leagues').set(as('commish')).send({
      league_name: 'Bad', sport: 'usports_fb', roster_limits: { QB: 1, GOALIE: 1 },
    }).expect(422);
    expect(unknownSlot.body.error.code).toBe('INVALID_SLOT');
    const inactive = await request(app).post('/api/v1/leagues').set(as('commish'))
      .send({ league_name: 'Track', sport: 'usports_mtf' }).expect(422);
    expect(inactive.body.error.code).toBe('SPORT_INACTIVE');
  });

  it('has no athlete-eligibility rule: anyone can create or join a league in any sport', async () => {
    await request(app).post('/api/v1/leagues').set(as('hooper'))
      .send({ league_name: 'Hooper Hoops', sport: 'usports_mbk' }).expect(201);
    await request(app).post('/api/v1/leagues').set(as('hooper'))
      .send({ league_name: 'Hooper Plays Football', sport: 'usports_fb' }).expect(201);
  });

  it('hides private leagues without the invite code and enforces max_teams', async () => {
    await request(app).get(`/api/v1/leagues/${hoops}`).set(as('rival')).expect(404);
    await request(app).post(`/api/v1/leagues/${hoops}/teams`).set(as('rival'))
      .send({ team_name: 'Rivals' }).expect(404);
    const joined = await request(app).post(`/api/v1/leagues/${hoops}/teams`).set(as('rival'))
      .send({ team_name: 'Rivals', invite_code: inviteCode }).expect(201);
    expect(joined.body.team_id).toMatch(/^tm_\d+$/);

    const again = await request(app).post(`/api/v1/leagues/${hoops}/teams`).set(as('rival'))
      .send({ team_name: 'Rivals 2', invite_code: inviteCode }).expect(409);
    expect(again.body.error.code).toBe('ALREADY_IN_LEAGUE');

    const full = await request(app).post(`/api/v1/leagues/${hoops}/teams`).set(as('third'))
      .send({ team_name: 'Third', invite_code: inviteCode }).expect(409);
    expect(full.body.error.code).toBe('LEAGUE_FULL');

    const view = await request(app).get(`/api/v1/leagues/${hoops}`).set(as('rival')).expect(200);
    expect(view.body).toMatchObject({ team_count: 2, my_team_id: joined.body.team_id });
  });

  describe('rosters', () => {
    const roster = async (subject = 'commish') =>
      (await request(app).get(`/api/v1/leagues/${hoops}/roster`).set(as(subject)).expect(200)).body;
    type RosterBody = { slots: { slot: string; slot_index: number; athlete: { last_name: string } | null }[] };
    const spotOf = (body: RosterBody, last: string) => {
      const s = body.slots.find((x) => x.athlete?.last_name === last);
      return s ? `${s.slot}#${s.slot_index}` : undefined;
    };

    it('adds athletes to the first eligible open slot (G, G, F, F, C, then bench)', async () => {
      await request(app).post(`/api/v1/leagues/${hoops}/roster`).set(as('commish'))
        .send({ athlete_id: await athleteId('Guard') }).expect(201);
      await request(app).post(`/api/v1/leagues/${hoops}/roster`).set(as('commish'))
        .send({ athlete_id: await athleteId('Centre') }).expect(201);
      const res = await request(app).post(`/api/v1/leagues/${hoops}/roster`).set(as('commish'))
        .send({ athlete_id: await athleteId('Noposition') }).expect(201);
      expect(spotOf(res.body, 'Guard')).toBe('G#1');
      expect(spotOf(res.body, 'Centre')).toBe('C#1');
      expect(spotOf(res.body, 'Noposition')).toBe('BENCH#1');
    });

    it('rejects an athlete already on another team, and an ineligible explicit slot', async () => {
      const taken = await request(app).post(`/api/v1/leagues/${hoops}/roster`).set(as('rival'))
        .send({ athlete_id: await athleteId('Guard') }).expect(409);
      expect(taken.body.error.code).toBe('ATHLETE_ALREADY_ROSTERED');

      const ineligible = await request(app).post(`/api/v1/leagues/${hoops}/roster`).set(as('commish'))
        .send({ athlete_id: await athleteId('Guardson'), slot: 'F' }).expect(422);
      expect(ineligible.body.error.code).toBe('INELIGIBLE_POSITION');

      const g2 = await request(app).post(`/api/v1/leagues/${hoops}/roster`).set(as('commish'))
        .send({ athlete_id: await athleteId('Guardson') }).expect(201);
      expect(spotOf(g2.body, 'Guardson')).toBe('G#2');
      const f1 = await request(app).post(`/api/v1/leagues/${hoops}/roster`).set(as('commish'))
        .send({ athlete_id: await athleteId('Forward') }).expect(201);
      expect(spotOf(f1.body, 'Forward')).toBe('F#1');
    });

    it('shows all 11 slots in order with season fantasy points for this ruleset', async () => {
      const body = await roster();
      expect(body.slots.map((s: { slot: string }) => s.slot)).toEqual(
        ['G', 'G', 'F', 'F', 'C', 'BENCH', 'BENCH', 'BENCH', 'BENCH', 'BENCH', 'BENCH']);
      expect(body).toMatchObject({ roster_size: 11, filled: 5 });
      const guard = body.slots.find((s: { athlete: { last_name: string } | null }) => s.athlete?.last_name === 'Guard');
      expect(guard).toMatchObject({ slot_type: 'STARTER', athlete: { season_fantasy_points: 42, games_played: 2 } });
      expect(body.slots.filter((s: { athlete: unknown }) => s.athlete === null)).toHaveLength(6);
    });

    it('lets league members view another team by team_id, but not outsiders', async () => {
      const me = await request(app).get('/api/v1/me').set(as('commish')).expect(200);
      const teamId = me.body.teams.find((t: { league_id: string }) => t.league_id === hoops).team_id;
      const other = await request(app).get(`/api/v1/leagues/${hoops}/roster?team_id=${teamId}`).set(as('rival')).expect(200);
      expect(other.body.team.team_name).toBe('Commish Five');
      await request(app).get(`/api/v1/leagues/${hoops}/roster`).set(as('third')).expect(404);
    });

    it('swaps starter and bench atomically and rolls back ineligible swaps', async () => {
      // Guard (G#1) <-> Noposition (BENCH#1): Noposition can't start at G -> rejected, nothing moves.
      const bad = await request(app).post(`/api/v1/leagues/${hoops}/roster/swap`).set(as('commish'))
        .send({ athlete_id: await athleteId('Guard'), target_slot: 'BENCH' }).expect(422);
      expect(bad.body.error.code).toBe('INELIGIBLE_POSITION');
      expect(spotOf(await roster(), 'Guard')).toBe('G#1');
      expect(spotOf(await roster(), 'Noposition')).toBe('BENCH#1');

      // Bench a starter into an empty bench slot.
      const benched = await request(app).post(`/api/v1/leagues/${hoops}/roster/swap`).set(as('commish'))
        .send({ athlete_id: await athleteId('Guard'), target_slot: 'BENCH', target_slot_index: 2 }).expect(200);
      expect(spotOf(benched.body, 'Guard')).toBe('BENCH#2');

      // Occupied target: Guard comes back into G#2 and Guardson drops to Guard's bench slot.
      const swapped = await request(app).post(`/api/v1/leagues/${hoops}/roster/swap`).set(as('commish'))
        .send({ athlete_id: await athleteId('Guard'), target_slot: 'G', target_slot_index: 2 }).expect(200);
      expect(spotOf(swapped.body, 'Guard')).toBe('G#2');
      expect(spotOf(swapped.body, 'Guardson')).toBe('BENCH#2');
    });

    it('validates swap requests', async () => {
      const notMine = await request(app).post(`/api/v1/leagues/${hoops}/roster/swap`).set(as('rival'))
        .send({ athlete_id: await athleteId('Guard'), target_slot: 'G' }).expect(404);
      expect(notMine.body.error.code).toBe('NOT_ON_ROSTER');
      const badSlot = await request(app).post(`/api/v1/leagues/${hoops}/roster/swap`).set(as('commish'))
        .send({ athlete_id: await athleteId('Guard'), target_slot: 'QB' }).expect(422);
      expect(badSlot.body.error.code).toBe('INVALID_SLOT');
      const pastLimit = await request(app).post(`/api/v1/leagues/${hoops}/roster/swap`).set(as('commish'))
        .send({ athlete_id: await athleteId('Guard'), target_slot: 'G', target_slot_index: 3 }).expect(422);
      expect(pastLimit.body.error.code).toBe('INVALID_SLOT');
      const noop = await request(app).post(`/api/v1/leagues/${hoops}/roster/swap`).set(as('commish'))
        .send({ athlete_id: await athleteId('Guard'), target_slot: 'G', target_slot_index: 2 }).expect(400);
      expect(noop.body.error.code).toBe('NO_CHANGE');
      const outsider = await request(app).post(`/api/v1/leagues/${hoops}/roster/swap`).set(as('third'))
        .send({ athlete_id: await athleteId('Guard'), target_slot: 'G' }).expect(404);
      expect(outsider.body.error.code).toBe('NOT_FOUND');
    });
  });

  it('lists league teams by roster points and available athletes', async () => {
    const teams = await request(app).get(`/api/v1/leagues/${hoops}/teams`).set(as('rival')).expect(200);
    expect(teams.body.data.map((t: { team_name: string }) => t.team_name)).toEqual(['Commish Five', 'Rivals']);
    expect(teams.body.data[0]).toMatchObject({ filled: 5, roster_size: 11, roster_points: 64, is_mine: false });
    expect(teams.body.data[1]).toMatchObject({ is_mine: true, roster_points: 0 });

    const league = await request(app).get(`/api/v1/leagues/${hoops}`).set(as('rival')).expect(200);
    expect(league.body.position_eligibility.G).toEqual(['G', 'PG', 'SG']);

    // Every MBK fixture athlete is rostered by the commissioner.
    const avail = await request(app).get(`/api/v1/leagues/${hoops}/available`).set(as('rival')).expect(200);
    expect(avail.body.pagination.total).toBe(0);
    await request(app).delete(`/api/v1/leagues/${hoops}/roster/${await athleteId('Forward')}`).set(as('commish')).expect(200);
    const after = await request(app).get(`/api/v1/leagues/${hoops}/available`).set(as('rival')).expect(200);
    expect(after.body.data.map((a: { last_name: string }) => a.last_name)).toEqual(['Forward']);
    await request(app).get(`/api/v1/leagues/${hoops}/available`).set(as('third')).expect(404);
  });

  it('rejects malformed ids and unknown routes', async () => {
    const bad = await request(app).get('/api/v1/leagues/lg_abc').set(as('commish')).expect(400);
    expect(bad.body.error.code).toBe('INVALID_ID');
    await request(app).get('/api/v1/leagues/lg_999999').set(as('commish')).expect(404);
    const route = await request(app).get('/api/v1/nope').set(as('commish')).expect(404);
    expect(route.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});
