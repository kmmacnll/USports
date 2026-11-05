import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';

let db: Db;
let app: ReturnType<typeof createApp>;
const as = (s: string) => ({ 'X-Dev-User': s });

beforeAll(() => {
  const cfg = loadConfig({ NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL!, AUTH_DEV_HEADER: 'true' });
  db = createPool(cfg.DATABASE_URL, 2);
  app = createApp(cfg, db, pino({ level: 'silent' }));
});
afterAll(() => db.end());

describe('sport_id across endpoints', () => {
  it('GET /sports lists every active sport with season_type', async () => {
    const res = await request(app).get('/api/v1/sports').expect(200);
    const byId = Object.fromEntries(res.body.data.map((s: { sport_id: string }) => [s.sport_id, s]));
    expect(Object.keys(byId).sort()).toEqual(['usports_fb', 'usports_mbk', 'usports_mhk', 'usports_msoc',
      'usports_mvb', 'usports_wbk', 'usports_whk', 'usports_wsoc', 'usports_wvb']);
    expect(byId.usports_mhk).toMatchObject({ season_type: 'WINTER', ruleset_name: 'Standard (provisional)',
      roster_limits: { F: 3, D: 2, G: 1, BENCH: 4 } });
    expect(byId.usports_fb.season_type).toBe('FALL');
    expect(byId.usports_mvb.stat_columns.game.map((c: { key: string }) => c.key)).toContain('kills');
  });

  it('GET /sports?sport_id= returns one sport, including inactive catalogued ones', async () => {
    const hockey = await request(app).get('/api/v1/sports?sport_id=usports_whk').expect(200);
    expect(hockey.body.data.map((s: { sport_id: string }) => s.sport_id)).toEqual(['usports_whk']);
    const tf = await request(app).get('/api/v1/sports?sport_id=usports_mtf').expect(200);
    expect(tf.body.data[0]).toMatchObject({ sport_name: "Men's Track & Field", is_active: false, ruleset_id: null });
    const unknown = await request(app).get('/api/v1/sports?sport_id=usports_lax').expect(404);
    expect(unknown.body.error.code).toBe('UNKNOWN_SPORT');
  });

  it('GET /sports?season_type= filters', async () => {
    const fall = await request(app).get('/api/v1/sports?season_type=fall').expect(200);
    expect(fall.body.data.map((s: { sport_id: string }) => s.sport_id).sort()).toEqual(['usports_fb', 'usports_msoc', 'usports_wsoc']);
  });

  it('GET /athletes accepts sport_id (and still accepts sport)', async () => {
    const vb = await request(app).get('/api/v1/athletes?sport_id=usports_mvb&sort=name').expect(200);
    expect(vb.body.data.map((a: { last_name: string; sport: string }) => [a.last_name, a.sport]))
      .toEqual([['Setter', 'usports_mvb'], ['Spiker', 'usports_mvb']]);
    const legacy = await request(app).get('/api/v1/athletes?sport=usports_mvb').expect(200);
    expect(legacy.body.pagination.total).toBe(2);
    const missing = await request(app).get('/api/v1/athletes').expect(400);
    expect(missing.body.error.details[0].message).toMatch(/sport_id is required/);
  });

  it('a volleyball league lets position-less athletes start (wildcard slot)', async () => {
    const me = await request(app).get('/api/v1/me').set(as('vb-commish')).expect(200);
    await request(app).put('/api/v1/me/terms').set(as('vb-commish'))
      .send({ terms_version: me.body.terms.current_version, is_usports_athlete: false }).expect(200);
    const league = await request(app).post('/api/v1/leagues').set(as('vb-commish'))
      .send({ league_name: 'Spike League', sport: 'usports_mvb', team_name: 'Diggers' }).expect(201);
    expect(league.body.position_eligibility).toEqual({ PLAYER: ['*'] });
    const athletes = await request(app).get('/api/v1/athletes?sport_id=usports_mvb').expect(200);
    const added = await request(app).post(`/api/v1/leagues/${league.body.league_id}/roster`).set(as('vb-commish'))
      .send({ athlete_id: athletes.body.data[0].athlete_id }).expect(201);
    const slot = added.body.slots.find((s: { athlete: unknown }) => s.athlete);
    expect(slot).toMatchObject({ slot: 'PLAYER', slot_type: 'STARTER' });
  });
});

describe('position filter follows slot eligibility', () => {
  it('basketball G matches G/PG/SG tokens; a wildcard slot does not filter', async () => {
    const g = await request(app).get('/api/v1/athletes?sport_id=usports_mbk&position=G').expect(200);
    expect(g.body.data.map((a: { last_name: string }) => a.last_name).sort()).toEqual(['Guard', 'Guardson']);
    const anyone = await request(app).get('/api/v1/athletes?sport_id=usports_mvb&position=PLAYER').expect(200);
    expect(anyone.body.pagination.total).toBe(2);
    const sports = await request(app).get('/api/v1/sports?sport_id=usports_mhk').expect(200);
    expect(sports.body.data[0].position_eligibility.F).toEqual(['F', 'C', 'LW', 'RW']);
  });
});
