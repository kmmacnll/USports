import type { AddressInfo } from 'node:net';

import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { createApp, createDeps, type AppDeps } from '../src/app.js';
import { provisionSubject } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import { bestAvailable, openSlots, pickOrder, sideForPick, slotFor, totalPicks } from '../src/battles/draft.js';
import { simulate } from '../src/battles/sim/index.js';

let db: Db;
let app: ReturnType<typeof createApp>;
let deps: AppDeps;
let clock = Date.now();
const as = (s: string) => ({ 'X-Dev-User': s });
const advance = (ms: number) => { clock += ms; };

/** Signs the user in once, which creates their account. */
export async function ensureUser(a: ReturnType<typeof createApp>, subject: string) {
  await request(a).get('/api/v1/me').set(as(subject)).expect(200);
}

beforeAll(() => {
  const cfg = loadConfig({ NODE_ENV: 'test', DATABASE_URL: process.env.TEST_BATTLES_DATABASE_URL!, AUTH_DEV_HEADER: 'true' });
  db = createPool(cfg.DATABASE_URL, 6);
  deps = createDeps(cfg, db, pino({ level: process.env.TEST_LOG ?? 'silent' }), { now: () => new Date(clock), aiPickDelayMs: 1000, startLeadMs: 3000 });
  app = createApp(cfg, db, pino({ level: process.env.TEST_LOG ?? 'silent' }), () => true, deps);
});
afterAll(async () => {
  deps.battles.stop();
  await db.end();
});

describe('draft rules', () => {
  it('snake order: A B B A A B ...', () => {
    expect(pickOrder('A', 'hockey')).toEqual(['A', 'B', 'B', 'A', 'A', 'B', 'B', 'A', 'A', 'B', 'B', 'A']);
    expect(sideForPick('B', 0)).toBe('B');
    expect(sideForPick('B', 1)).toBe('A');
    expect(totalPicks('football')).toBe(12);
    expect(totalPicks('soccer')).toBe(14);
  });

  it('positions must fill open slots', () => {
    expect(openSlots('hockey', ['F', 'F'])).toEqual({ F: 1, D: 2, G: 1 });
    expect(slotFor('hockey', ['G'], 'G')).toBeNull();
    expect(slotFor('football', ['DEF'], 'DEF')).toBe('DEF');
    expect(slotFor('football', ['DEF', 'DEF'], 'DEF')).toBeNull();
    const pool = [{ athleteId: '1', position: 'G', ovr: 95 }, { athleteId: '2', position: 'F', ovr: 90 }, { athleteId: '3', position: 'F', ovr: 90 }];
    expect(bestAvailable('hockey', pool, new Set(), ['G'])!.athleteId).toBe('2');     // goalie slot full; tie -> lowest id
    expect(bestAvailable('hockey', pool, new Set(['2']), ['G'])!.athleteId).toBe('3');
  });
});

describe('GET /players', () => {
  it('lists the rated pool with OVR + sub-ratings, by sport + gender, without photos or logos', async () => {
    const res = await request(app).get('/api/v1/players?sport=hockey&gender=women&position=G').expect(200);
    expect(res.body.sport_id).toBe('usports_whk');
    expect(res.body.lineup.map((s: { slot: string }) => s.slot)).toEqual(['F', 'D', 'G']);
    const p = res.body.data[0];
    expect(p).toMatchObject({ position: 'G', school: expect.any(String), jersey_number: expect.any(String) });
    expect(p.ovr).toBeGreaterThanOrEqual(40);
    expect(Object.keys(p.sub_ratings).sort()).toEqual(['HND', 'POS', 'REF', 'STA']);
    expect(JSON.stringify(res.body)).not.toMatch(/logo|photo|headshot|image/i);
    // Ranked by fantasy points per game; players without a scored game this season come last.
    expect(p).toHaveProperty('fppg');
    expect(p).toHaveProperty('fppg_change');
    const fppg = res.body.data.map((x: { fppg: number | null }) => x.fppg ?? -Infinity);
    expect([...fppg].sort((a, b) => b - a)).toEqual(fppg);
    await request(app).get('/api/v1/players?sport_id=usports_fb&position=QB').expect(200);
    const bad = await request(app).get('/api/v1/players?sport=curling&gender=men').expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });
});

async function draftToEnd(subject: string, id: string) {
  for (let guard = 0; guard < 40; guard++) {
    const v = (await request(app).get(`/api/v1/battles/${id}`).set(as(subject)).expect(200)).body;
    if (v.state !== 'drafting') return v;
    if (v.draft.on_the_clock === v.you) {
      const mine = v.picks.filter((p: { side: string }) => p.side === v.you).map((p: { slot: string }) => p.slot);
      const open = Object.keys(openSlots(v.sport, mine));
      const position = v.lineup.find((s: { slot: string }) => s.slot === open[0]).position;
      const pool = await request(app).get(`/api/v1/players?sport_id=${v.sport_id}&position=${position}&battle_id=${id}&page_size=1`).expect(200);
      await request(app).post(`/api/v1/battles/${id}/pick`).set(as(subject)).send({ athlete_id: pool.body.data[0].athlete_id }).expect(200);
    } else {
      advance(1100);
      await deps.battles.tick();
    }
  }
  throw new Error('draft did not finish');
}

describe('Play AI: draft -> simulate -> complete', () => {
  it('runs a whole battle', async () => {
    await ensureUser(app, 'ai-player');
    const created = await request(app).post('/api/v1/battles/ai').set(as('ai-player')).send({ sport: 'hockey', gender: 'men' }).expect(201);
    const id = created.body.battle_id;
    expect(created.body).toMatchObject({ mode: 'AI', ranked: false, state: 'drafting', you: 'A', sport: 'hockey', gender: 'MEN',
      sides: { B: { is_ai: true, user_id: null } } });
    expect(['A', 'B']).toContain(created.body.draft.first_pick);          // coin flip
    expect(created.body.draft.total_picks).toBe(12);

    // a second battle while this one is active is refused
    const busy = await request(app).post('/api/v1/battles/ai').set(as('ai-player')).send({ sport: 'basketball', gender: 'men' }).expect(409);
    expect(busy.body.error.code).toBe('ALREADY_IN_BATTLE');

    // picking out of turn is refused
    if (created.body.draft.on_the_clock === 'B') {
      const pool = await request(app).get(`/api/v1/players?sport_id=usports_mhk&battle_id=${id}&page_size=1`).expect(200);
      const r = await request(app).post(`/api/v1/battles/${id}/pick`).set(as('ai-player')).send({ athlete_id: pool.body.data[0].athlete_id }).expect(409);
      expect(r.body.error.code).toBe('NOT_YOUR_TURN');
      advance(1100);
      await deps.battles.tick();                                         // the AI picks
    }
    let v = (await request(app).get(`/api/v1/battles/${id}`).set(as('ai-player')).expect(200)).body;
    expect(v.draft.on_the_clock).toBe('A');
    if (v.picks.length) {
      // the AI took the best player available
      const best = await request(app).get('/api/v1/players?sport_id=usports_mhk&page_size=1').expect(200);
      expect(v.picks[0].player.ovr).toBe(best.body.data[0].ovr);
      expect(v.picks[0].auto).toBe(true);
      // a drafted player can't be picked again
      const dup = await request(app).post(`/api/v1/battles/${id}/pick`).set(as('ai-player')).send({ athlete_id: v.picks[0].player.athlete_id }).expect(409);
      expect(dup.body.error.code).toBe('ALREADY_PICKED');
    }
    // a goalie for the goalie slot, then a second goalie has nowhere to go
    const goalies = await request(app).get(`/api/v1/players?sport_id=usports_mhk&position=G&battle_id=${id}&page_size=2`).expect(200);
    await request(app).post(`/api/v1/battles/${id}/pick`).set(as('ai-player')).send({ athlete_id: goalies.body.data[0].athlete_id }).expect(200);
    v = (await request(app).get(`/api/v1/battles/${id}`).set(as('ai-player')).expect(200)).body;
    while (v.draft.on_the_clock !== 'A') { advance(1100); await deps.battles.tick(); v = (await request(app).get(`/api/v1/battles/${id}`).set(as('ai-player'))).body; }
    const second = await request(app).post(`/api/v1/battles/${id}/pick`).set(as('ai-player')).send({ athlete_id: goalies.body.data[1].athlete_id });
    if (second.status !== 409) {           // unless the AI already took that goalie
      expect(second.status).toBe(422);
      expect(second.body.error.code).toBe('NO_OPEN_SLOT');
    }

    v = await draftToEnd('ai-player', id);
    expect(v.state).toBe('simulating');
    expect(v.picks).toHaveLength(12);
    expect(new Set(v.picks.map((p: { player: { athlete_id: string } }) => p.player.athlete_id)).size).toBe(12);
    for (const side of ['A', 'B']) {
      const slots = v.picks.filter((p: { side: string }) => p.side === side).map((p: { slot: string }) => p.slot).sort();
      expect(slots).toEqual(['D', 'D', 'F', 'F', 'F', 'G']);
    }
    // before kick-off (3 s lead) nothing has happened; events appear only as their time comes
    expect(v.match.events).toEqual([]);
    expect(v.match.final).toBeUndefined();
    advance(3000 + 60_000);
    v = (await request(app).get(`/api/v1/battles/${id}`).set(as('ai-player')).expect(200)).body;
    expect(v.match.events.length).toBeGreaterThan(0);
    expect(v.match.events.every((e: { t: number }) => e.t <= 60_000)).toBe(true);
    expect(v.match.events.some((e: { type: string }) => e.type === 'final')).toBe(false);
    // finish
    advance(v.match.duration_ms);
    await deps.battles.tick();
    v = (await request(app).get(`/api/v1/battles/${id}`).set(as('ai-player')).expect(200)).body;
    expect(v.state).toBe('complete');
    expect(v.match.events[v.match.events.length - 1].type).toBe('final');
    expect(v.match.final).toMatchObject({ winner: expect.stringMatching(/^[AB]$/) });

    // the stored match replays exactly from the pick snapshots and the seed
    const { rows: [row] } = await db.query('SELECT result, seed FROM battles WHERE id = $1', [id.slice(3)]);
    const lineup = (side: string, name: string) => ({ name, players: v.picks.filter((p: { side: string }) => p.side === side)
      .map((p: { slot: string; player: { athlete_id: string; last_name: string; position: string; ovr: number; sub_ratings: Record<string, number> } }) => ({
        id: p.player.athlete_id, name: p.player.last_name, position: p.player.position, slot: p.slot, ovr: p.player.ovr, sub: p.player.sub_ratings })) });
    expect(simulate('hockey', lineup('A', v.sides.A.name), lineup('B', v.sides.B.name), Number(row.seed), id)).toEqual(row.result);

    // free again
    await request(app).post('/api/v1/battles/ai').set(as('ai-player')).send({ sport: 'volleyball', gender: 'women' }).expect(201)
      .then((r) => request(app).post(`/api/v1/battles/${r.body.battle_id}/forfeit`).set(as('ai-player')).expect(200))
      .then((r) => expect(r.body.state).toBe('cancelled'));
  }, 60_000);

  it('auto-picks the best available eligible player when the 20 s timer runs out', async () => {
    await ensureUser(app, 'slowpoke');
    const created = await request(app).post('/api/v1/battles/ai').set(as('slowpoke')).send({ sport: 'football' }).expect(201);
    const id = created.body.battle_id;
    let v = created.body;
    if (v.draft.on_the_clock === 'B') { advance(1100); await deps.battles.tick(); }
    v = (await request(app).get(`/api/v1/battles/${id}`).set(as('slowpoke'))).body;
    expect(v.draft.on_the_clock).toBe('A');
    advance(19_000);
    await deps.battles.tick();
    expect((await request(app).get(`/api/v1/battles/${id}`).set(as('slowpoke'))).body.picks.filter((p: { side: string }) => p.side === 'A')).toHaveLength(0);
    advance(1_500);
    await deps.battles.tick();
    v = (await request(app).get(`/api/v1/battles/${id}`).set(as('slowpoke'))).body;
    const mine = v.picks.filter((p: { side: string }) => p.side === 'A');
    expect(mine).toHaveLength(1);
    expect(mine[0].auto).toBe(true);
    // best available: nobody left in the pool rates higher (every position is still open for A)
    const left = await request(app).get(`/api/v1/players?sport_id=usports_fb&battle_id=${id}&page_size=1`).expect(200);
    expect(mine[0].player.ovr).toBeGreaterThanOrEqual(left.body.data[0].ovr);
    await request(app).post(`/api/v1/battles/${id}/forfeit`).set(as('slowpoke')).expect(200);
  });

  it('other users cannot see or pick in a battle; no terms step to start one', async () => {
    await ensureUser(app, 'owner');
    const created = await request(app).post('/api/v1/battles/ai').set(as('owner')).send({ sport: 'soccer', gender: 'women' }).expect(201);
    expect((await request(app).get(`/api/v1/battles/${created.body.battle_id}`).set(as('stranger')).expect(403)).body.error.code).toBe('NOT_IN_BATTLE');
    await request(app).post(`/api/v1/battles/${created.body.battle_id}/forfeit`).set(as('owner')).expect(200);
    const fresh = await request(app).post('/api/v1/battles/ai').set(as('stranger')).send({ sport: 'soccer', gender: 'women' }).expect(201);
    await request(app).post(`/api/v1/battles/${fresh.body.battle_id}/forfeit`).set(as('stranger')).expect(200);
  });
});

describe('realtime', () => {
  it('streams picks and match events over WebSocket and resumes after a reconnect', async () => {
    // a real server with the real clock
    const cfg = loadConfig({ NODE_ENV: 'test', DATABASE_URL: process.env.TEST_BATTLES_DATABASE_URL!, AUTH_DEV_HEADER: 'true' });
    const live = createDeps(cfg, db, pino({ level: 'silent' }), { aiPickDelayMs: 50, startLeadMs: 0 });
    const liveApp = createApp(cfg, db, pino({ level: 'silent' }), () => true, live);
    const server = liveApp.listen(0);
    live.hub.attach(server, (s) => provisionSubject(db, s));
    const port = (server.address() as AddressInfo).port;
    try {
      await ensureUser(liveApp, 'ws-player');
      // tickets: unauthenticated connections are refused
      await expect(new Promise((res, rej) => {
        const w = new WebSocket(`ws://127.0.0.1:${port}/api/v1/realtime?ticket=nope`);
        w.on('open', () => res('open'));
        w.on('error', rej);
      })).rejects.toThrow(/401/);
      const { body: t } = await request(liveApp).post('/api/v1/realtime/ticket').set(as('ws-player')).expect(201);
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/realtime?ticket=${t.ticket}`);
      const msgs: Array<{ channel: string; type: string; data: any }> = [];
      ws.on('message', (raw) => msgs.push(JSON.parse(String(raw))));
      await new Promise((r) => ws.on('open', r));
      const wait = async (pred: (m: { type: string; data: any }) => boolean, ms = 5000) => {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          const m = msgs.find(pred);
          if (m) return m;
          await new Promise((r) => setTimeout(r, 20));
        }
        throw new Error(`timed out; got ${msgs.map((m) => m.type).join(',')}`);
      };
      await wait((m) => m.type === 'hello');

      const created = await request(liveApp).post('/api/v1/battles/ai').set(as('ws-player')).send({ sport: 'basketball', gender: 'women' }).expect(201);
      const id = created.body.battle_id;
      await wait((m) => m.type === 'battle.created');
      ws.send(JSON.stringify({ op: 'subscribe', channel: `battle:${id}` }));
      const sync = await wait((m) => m.type === 'battle.sync');
      expect(sync.data.battle_id).toBe(id);
      // someone else's battle channel is refused
      ws.send(JSON.stringify({ op: 'subscribe', channel: 'battle:bt_999999' }));
      await wait((m) => m.type === 'error' && /not allowed/.test(m.data.message));

      // draft with the scheduler-free tick loop
      for (let guard = 0; guard < 60; guard++) {
        await live.battles.tick();
        const v = (await request(liveApp).get(`/api/v1/battles/${id}`).set(as('ws-player'))).body;
        if (v.state !== 'drafting') break;
        if (v.draft.on_the_clock === 'A') {
          const mine = v.picks.filter((p: { side: string }) => p.side === 'A').map((p: { slot: string }) => p.slot);
          const pos = v.lineup.find((s: { slot: string }) => s.slot === Object.keys(openSlots('basketball', mine))[0]).position;
          const pool = await request(liveApp).get(`/api/v1/players?sport_id=usports_wbk&position=${pos}&battle_id=${id}&page_size=1`);
          await request(liveApp).post(`/api/v1/battles/${id}/pick`).set(as('ws-player')).send({ athlete_id: pool.body.data[0].athlete_id }).expect(200);
        } else {
          await new Promise((r) => setTimeout(r, 60));
        }
      }
      expect(msgs.filter((m) => m.type === 'draft.pick')).toHaveLength(10);
      expect(msgs.some((m) => m.type === 'draft.turn')).toBe(true);
      await wait((m) => m.type === 'battle.state' && m.data.state === 'simulating');
      const first = await wait((m) => m.type === 'match.event');
      expect(first.data).toMatchObject({ index: 0, event: { t: 0, type: 'period_start' } });

      // reconnect: the sync snapshot carries every event already due
      ws.close();
      await new Promise((r) => setTimeout(r, 1500));
      const { body: t2 } = await request(liveApp).post('/api/v1/realtime/ticket').set(as('ws-player')).expect(201);
      const ws2 = new WebSocket(`ws://127.0.0.1:${port}/api/v1/realtime?ticket=${t2.ticket}`);
      const msgs2: Array<{ type: string; data: any }> = [];
      ws2.on('message', (raw) => msgs2.push(JSON.parse(String(raw))));
      await new Promise((r) => ws2.on('open', r));
      ws2.send(JSON.stringify({ op: 'subscribe', channel: `battle:${id}` }));
      const end = Date.now() + 3000;
      while (!msgs2.some((m) => m.type === 'battle.sync') && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
      const resync = msgs2.find((m) => m.type === 'battle.sync')!;
      expect(resync.data.state).toBe('simulating');
      const { rows: [stored] } = await db.query('SELECT result FROM battles WHERE id = $1', [id.slice(3)]);
      const due = stored.result.events.filter((e: { t: number }) => e.t <= resync.data.match.elapsed_ms);
      expect(resync.data.match.events.length).toBeGreaterThanOrEqual(1);
      expect(resync.data.match.events.map((e: { text: string }) => e.text)).toEqual(due.map((e: { text: string }) => e.text));
      expect(resync.data.match.events.length).toBeLessThan(stored.result.events.length);   // nothing from the future
      ws2.close();
      await db.query(`UPDATE battles SET state = 'cancelled', end_reason = 'test' WHERE id = $1`, [id.slice(3)]);
    } finally {
      live.battles.stop();
      live.hub.close();
      await new Promise((r) => server.close(r));
    }
  }, 60_000);
});
