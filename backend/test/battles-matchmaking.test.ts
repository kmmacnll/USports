import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp, createDeps, type AppDeps } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import { findMatches, tolerance, type QueueEntry } from '../src/battles/matchmaking.js';

let db: Db;
let app: ReturnType<typeof createApp>;
let deps: AppDeps;
let clock = Date.now() + 86_400_000;      // a day ahead of the other test files' clocks
const as = (s: string) => ({ 'X-Dev-User': s });
const advance = (ms: number) => { clock += ms; };
const online = new Set<string>();

async function user(subject: string, username?: string): Promise<string> {
  const me = await request(app).get('/api/v1/me').set(as(subject)).expect(200);
  if (username) await request(app).put('/api/v1/me/username').set(as(subject)).send({ username }).expect(200);
  return me.body.user_id.slice(4);
}
const setDivision = (id: string, division: string) =>
  db.query(`INSERT INTO battle_profiles (user_id, division) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET division = $2`, [id, division]);
const endBattle = (battleId: string) => db.query(`UPDATE battles SET state = 'cancelled', end_reason = 'test' WHERE id = $1`, [battleId.slice(3)]);

beforeAll(() => {
  const cfg = loadConfig({ NODE_ENV: 'test', DATABASE_URL: process.env.TEST_BATTLES_DATABASE_URL!, AUTH_DEV_HEADER: 'true' });
  db = createPool(cfg.DATABASE_URL, 6);
  deps = createDeps(cfg, db, pino({ level: 'silent' }), { now: () => new Date(clock) });
  deps.hub.isOnline = (id: string) => online.has(id);
  app = createApp(cfg, db, pino({ level: 'silent' }), () => true, deps);
});
afterAll(async () => {
  deps.battles.stop();
  await db.end();
});

describe('queue rules (pure)', () => {
  const e = (userId: string, division: string, waitedS: number, sportId = 1): QueueEntry =>
    ({ userId, division, sportId, enqueuedAt: 100_000 - waitedS * 1000 });
  const pairs = (entries: QueueEntry[]) => findMatches(entries, 100_000).map(([a, b]) => [a.userId, b.userId]);

  it('same division at once, adjacent after 20 s, anyone after 40 s', () => {
    expect(tolerance(0)).toBe(0);
    expect(tolerance(20_000)).toBe(1);
    expect(tolerance(40_000)).toBe(Infinity);
    expect(pairs([e('1', 'BENCH', 5), e('2', 'BENCH', 1)])).toEqual([['1', '2']]);
    expect(pairs([e('1', 'BENCH', 19), e('2', 'STARTER', 1)])).toEqual([]);
    expect(pairs([e('1', 'BENCH', 21), e('2', 'STARTER', 1)])).toEqual([['1', '2']]);
    expect(pairs([e('1', 'BENCH', 39), e('2', 'CAPTAIN', 1)])).toEqual([]);
    expect(pairs([e('1', 'WALK_ON', 41), e('2', 'HALL_OF_FAME', 1)])).toEqual([['1', '2']]);
  });

  it('FIFO, never the same user, never across sports', () => {
    expect(pairs([e('3', 'BENCH', 1), e('1', 'BENCH', 9), e('2', 'BENCH', 5)])).toEqual([['1', '2']]);
    expect(pairs([e('1', 'BENCH', 50), e('2', 'BENCH', 50, 2)])).toEqual([]);
    expect(pairs([e('1', 'BENCH', 50), e('1', 'BENCH', 50)])).toEqual([]);
    // the oldest player is matched first even if a same-division pair exists further back
    expect(pairs([e('1', 'BENCH', 45), e('2', 'CAPTAIN', 3), e('3', 'CAPTAIN', 2)])).toEqual([['1', '2']]);
  });
});

describe('users', () => {
  it('usernames are unique and searchable', async () => {
    await user('mm-alice', 'alice_mm');
    await user('mm-bob', 'bob_mm');
    const taken = await request(app).put('/api/v1/me/username').set(as('mm-bob')).send({ username: 'ALICE_MM' }).expect(409);
    expect(taken.body.error.code).toBe('USERNAME_TAKEN');
    await request(app).put('/api/v1/me/username').set(as('mm-bob')).send({ username: 'no spaces!' }).expect(400);
    const found = await request(app).get('/api/v1/users/search?q=ali').set(as('mm-bob')).expect(200);
    expect(found.body.data[0]).toMatchObject({ username: 'alice_mm', online: false });
    const self = await request(app).get('/api/v1/users/search?q=bob_mm').set(as('mm-bob')).expect(200);
    expect(self.body.data).toEqual([]);
  });
});

describe('Play a Friend', () => {
  it('offline friend: inbox notification (24 h), accept starts an unranked draft for both', async () => {
    const carol = await user('mm-carol', 'carol_mm');
    const dave = await user('mm-dave', 'dave_mm');
    const inv = await request(app).post('/api/v1/battles/invite').set(as('mm-carol'))
      .send({ username: 'dave_mm', sport: 'basketball', gender: 'women' }).expect(201);
    expect(inv.body).toMatchObject({ status: 'pending', delivery: 'inbox', sport_id: 'usports_wbk', to: { username: 'dave_mm' } });
    expect(new Date(inv.body.expires_at).getTime() - clock).toBe(24 * 3600 * 1000);
    const inbox = await request(app).get('/api/v1/notifications').set(as('mm-dave')).expect(200);
    expect(inbox.body.unread).toBe(1);
    expect(inbox.body.data[0]).toMatchObject({ kind: 'battle_invite', payload: { invite_id: inv.body.invite_id } });
    // the inviter sees it as pending
    const out = await request(app).get('/api/v1/battles/invites').set(as('mm-carol')).expect(200);
    expect(out.body.outgoing[0]).toMatchObject({ invite_id: inv.body.invite_id, status: 'pending' });
    // only the invitee can answer
    await request(app).post(`/api/v1/battles/invite/${inv.body.invite_id}/respond`).set(as('mm-carol')).send({ accept: true }).expect(404);
    const ok = await request(app).post(`/api/v1/battles/invite/${inv.body.invite_id}/respond`).set(as('mm-dave')).send({ accept: true }).expect(200);
    expect(ok.body.status).toBe('accepted');
    const battle = await request(app).get(`/api/v1/battles/${ok.body.battle_id}`).set(as('mm-dave')).expect(200);
    expect(battle.body).toMatchObject({ mode: 'FRIEND', ranked: false, state: 'drafting', you: 'B', sides: { A: { name: 'carol_mm' }, B: { name: 'dave_mm' } } });
    expect(deps.hub.recent.some((m) => m.channel === `user:usr_${carol}` && m.type === 'invite.updated'
      && (m.data as { status: string }).status === 'accepted')).toBe(true);
    expect(dave).toBeTruthy();
    await endBattle(ok.body.battle_id);
  });

  it('online friend: realtime invite that expires after 60 s; decline; no self-invites', async () => {
    const erin = await user('mm-erin', 'erin_mm');
    const frank = await user('mm-frank', 'frank_mm');
    online.add(frank);
    const inv = await request(app).post('/api/v1/battles/invite').set(as('mm-erin')).send({ username: 'frank_mm', sport: 'hockey', gender: 'men' }).expect(201);
    expect(inv.body.delivery).toBe('realtime');
    expect(deps.hub.recent.some((m) => m.channel === `user:usr_${frank}` && m.type === 'invite.received')).toBe(true);
    // the inviter is waiting: they can't start something else meanwhile
    expect((await request(app).post('/api/v1/battles/ai').set(as('mm-erin')).send({ sport: 'hockey', gender: 'men' }).expect(409)).body.error.code)
      .toBe('ALREADY_IN_BATTLE');
    // ...but the invitee isn't blocked by an invite they received
    advance(61_000);
    await deps.battles.tick();
    const expired = await request(app).get('/api/v1/battles/invites').set(as('mm-erin')).expect(200);
    expect(expired.body.outgoing[0].status).toBe('expired');
    expect((await request(app).get(`/api/v1/battles/${inv.body.battle_id}`).set(as('mm-erin'))).body.state).toBe('expired');
    const late = await request(app).post(`/api/v1/battles/invite/${inv.body.invite_id}/respond`).set(as('mm-frank')).send({ accept: true }).expect(409);
    expect(late.body.error.code).toBe('INVITE_NOT_PENDING');

    const inv2 = await request(app).post('/api/v1/battles/invite').set(as('mm-erin')).send({ username: 'frank_mm', sport: 'hockey', gender: 'men' }).expect(201);
    const no = await request(app).post(`/api/v1/battles/invite/${inv2.body.invite_id}/respond`).set(as('mm-frank')).send({ accept: false }).expect(200);
    expect(no.body.status).toBe('declined');
    expect((await request(app).get(`/api/v1/battles/${inv2.body.battle_id}`).set(as('mm-erin'))).body.state).toBe('cancelled');

    const self = await request(app).post('/api/v1/battles/invite').set(as('mm-erin')).send({ username: 'erin_mm', sport: 'hockey', gender: 'men' }).expect(422);
    expect(self.body.error.code).toBe('CANNOT_INVITE_SELF');
    await request(app).post('/api/v1/battles/invite').set(as('mm-erin')).send({ username: 'nobody_here', sport: 'hockey', gender: 'men' }).expect(404);
    online.delete(frank);
    expect(erin).toBeTruthy();
  });
});

describe('Play Random', () => {
  it('matches two waiting players in the same division at once, ranked', async () => {
    const g = await user('mm-gina');
    const h = await user('mm-hank');
    await setDivision(g, 'BENCH');
    await setDivision(h, 'BENCH');
    const first = await request(app).post('/api/v1/queue/random').set(as('mm-gina')).send({ sport: 'soccer', gender: 'men' }).expect(202);
    expect(first.body).toMatchObject({ status: 'queued', matching: 'same_division', estimated_wait_seconds: expect.any(Number) });
    // can't queue twice, or start another battle while queued
    expect((await request(app).post('/api/v1/queue/random').set(as('mm-gina')).send({ sport: 'soccer', gender: 'men' }).expect(409)).body.error.code)
      .toBe('ALREADY_QUEUED');
    expect((await request(app).post('/api/v1/battles/ai').set(as('mm-gina')).send({ sport: 'soccer', gender: 'men' }).expect(409)).body.error.code)
      .toBe('ALREADY_QUEUED');
    advance(2000);
    const second = await request(app).post('/api/v1/queue/random').set(as('mm-hank')).send({ sport: 'soccer', gender: 'men' }).expect(201);
    expect(second.body.status).toBe('matched');
    const b = await request(app).get(`/api/v1/battles/${second.body.battle_id}`).set(as('mm-gina')).expect(200);
    expect(b.body).toMatchObject({ mode: 'RANDOM', ranked: true, state: 'drafting' });
    expect(deps.hub.recent.some((m) => m.channel === `user:usr_${g}` && m.type === 'queue.matched')).toBe(true);
    expect((await request(app).get('/api/v1/queue/random').set(as('mm-gina'))).body).toMatchObject({ status: 'matched' });
    // someone already in a match can't be matched
    expect((await request(app).post('/api/v1/queue/random').set(as('mm-hank')).send({ sport: 'soccer', gender: 'men' }).expect(409)).body.error.code)
      .toBe('ALREADY_IN_BATTLE');
    await endBattle(second.body.battle_id);
  });

  it('widens to adjacent divisions after 20 s and to anyone after 40 s; cancel any time', async () => {
    const [i, j, k] = await Promise.all([user('mm-ivy'), user('mm-jay'), user('mm-kim')]);
    await setDivision(i, 'VARSITY');
    await setDivision(j, 'STARTER');
    await setDivision(k, 'HALL_OF_FAME');
    await request(app).post('/api/v1/queue/random').set(as('mm-ivy')).send({ sport: 'volleyball', gender: 'men' }).expect(202);
    await request(app).post('/api/v1/queue/random').set(as('mm-jay')).send({ sport: 'volleyball', gender: 'men' }).expect(202);
    advance(15_000);
    await deps.battles.tick();
    expect((await request(app).get('/api/v1/queue/random').set(as('mm-ivy'))).body.status).toBe('queued');
    advance(6_000);
    await deps.battles.tick();
    const ivy = (await request(app).get('/api/v1/queue/random').set(as('mm-ivy'))).body;
    expect(ivy.status).toBe('matched');
    await endBattle(ivy.battle_id);

    // Hall of Fame vs Walk-On only after 40 s
    const l = await user('mm-lou');
    await setDivision(l, 'WALK_ON');
    await request(app).post('/api/v1/queue/random').set(as('mm-kim')).send({ sport: 'volleyball', gender: 'men' }).expect(202);
    await request(app).post('/api/v1/queue/random').set(as('mm-lou')).send({ sport: 'volleyball', gender: 'men' }).expect(202);
    advance(25_000);
    await deps.battles.tick();
    const waiting = (await request(app).get('/api/v1/queue/random').set(as('mm-kim'))).body;
    expect(waiting).toMatchObject({ status: 'queued', matching: 'adjacent_divisions' });
    expect(deps.hub.recent.some((m) => m.channel === `user:usr_${k}` && m.type === 'queue.status')).toBe(true);
    advance(16_000);
    await deps.battles.tick();
    const kim = (await request(app).get('/api/v1/queue/random').set(as('mm-kim'))).body;
    expect(kim.status).toBe('matched');
    await endBattle(kim.battle_id);

    // cancel
    await request(app).post('/api/v1/queue/random').set(as('mm-jay')).send({ sport: 'football' }).expect(202);
    await request(app).delete('/api/v1/queue/random').set(as('mm-jay')).expect(200);
    expect((await request(app).get('/api/v1/queue/random').set(as('mm-jay'))).body.status).toBe('idle');
    await request(app).delete('/api/v1/queue/random').set(as('mm-jay')).expect(404);
  });
});
