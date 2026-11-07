/**
 * Draft Battles: battle lifecycle, draft picks, match simulation and the
 * real-time event stream.
 *
 *   queued ──(invite accepted)──> drafting ──(last pick)──> simulating ──(t ≥ duration)──> complete
 *      └──(declined / cancelled)──> cancelled      └──(invite expired)──> expired
 *
 * All deadlines (pick timer, AI think time, match end) are stored in the
 * database, and tick() — called every second by the scheduler — acts on any
 * that have passed. A restart therefore loses nothing: overdue picks are
 * auto-picked, finished matches completed, and running matches' event
 * streams resumed on the next tick.
 *
 * Realtime messages are collected in an outbox during a transaction and
 * published only after it commits.
 */
import { randomInt } from 'node:crypto';

import type pg from 'pg';
import type { Logger } from 'pino';

import type { Db, Queryable } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import { encodeId } from '../ids.js';
import { BATTLES } from './config.js';
import { bestAvailable, openPositions, pickOrder, sideForPick, slotFor, totalPicks } from './draft.js';
import { battleChannel, type RealtimeHub } from './realtime.js';
import { simulate } from './sim/index.js';
import { BY_CODE, SPORTS } from './sports/index.js';
import type { BattleSport, Gender } from './sports/types.js';
import type { Lineup, MatchEvent, MatchResult, Side } from './types.js';

export type BattleState = 'queued' | 'drafting' | 'simulating' | 'complete' | 'cancelled' | 'expired';
export type BattleMode = 'AI' | 'FRIEND' | 'RANDOM';
export const ACTIVE_STATES: BattleState[] = ['queued', 'drafting', 'simulating'];
export const AI_NAME = 'VarsityHQ AI';

export interface BattleRow {
  id: string;
  mode: BattleMode;
  ranked: boolean;
  sport_id: number;
  sport_code: string;
  state: BattleState;
  user_a: string;
  user_b: string | null;
  first_pick: Side | null;
  pick_number: number;
  pick_deadline: Date | null;
  seed: string | null;
  result: MatchResult | null;
  sim_started_at: Date | null;
  completes_at: Date | null;
  winner: Side | null;
  score_a: number | null;
  score_b: number | null;
  went_to_ot: boolean | null;
  end_reason: string | null;
  created_at: Date;
  completed_at: Date | null;
}

export interface PlayerSnapshot {
  athlete_id: string;
  first_name: string;
  last_name: string;
  school: string;
  jersey_number: string | null;
  class_year: string | null;
  position: string;
  ovr: number;
  sub_ratings: Record<string, number>;
  is_new: boolean;
}

type Outbox = Array<[channel: string, type: string, data: unknown]>;
export type TxFn<T> = (client: pg.PoolClient, outbox: Outbox) => Promise<T>;

export interface BattleServiceOptions {
  now?: () => Date;
  pickSeconds?: number;
  aiPickDelayMs?: number;
  startLeadMs?: number;
}

/** Outbox pseudo-channel: start streaming a match after commit (type = battle id). */
const STREAM = '__stream__';
const SELECT_BATTLE = `SELECT b.*, s.code AS sport_code FROM battles b JOIN sports s ON s.id = b.sport_id`;

export class BattleService {
  readonly now: () => Date;
  readonly pickSeconds: number;
  readonly aiPickDelayMs: number;
  readonly startLeadMs: number;
  /** Called inside the completing transaction (Elo, ladder: phase 6). */
  readonly onComplete: Array<(client: pg.PoolClient, b: BattleRow, outbox: Outbox) => Promise<void>> = [];
  /** Extra work for every tick (invite expiry, queue matching, weekly reset...). */
  readonly tickHooks: Array<{ name: string; run: () => Promise<void> }> = [];
  private streams = new Map<string, NodeJS.Timeout>();
  private ticking = false;

  constructor(readonly db: Db, readonly hub: RealtimeHub, readonly logger?: Logger, opts: BattleServiceOptions = {}) {
    this.now = opts.now ?? (() => new Date());
    this.pickSeconds = opts.pickSeconds ?? BATTLES.draft.pickSeconds;
    this.aiPickDelayMs = opts.aiPickDelayMs ?? BATTLES.draft.aiPickDelayMs;
    this.startLeadMs = opts.startLeadMs ?? BATTLES.match.startLeadMs;
    hub.setPolicy({
      authorize: async (userId, channel) => {
        const id = /^battle:bt_(\d+)$/.exec(channel)?.[1];
        if (!id) return false;
        const b = await this.load(this.db, id);
        return !!b && (b.user_a === userId || b.user_b === userId);
      },
      onSubscribe: async (userId, channel) => {
        const id = /^battle:bt_(\d+)$/.exec(channel)![1]!;
        return [{ type: 'battle.sync', data: await this.view(userId, id) }];
      },
    });
  }

  // ------------------------------------------------------------------ plumbing

  async tx<T>(fn: TxFn<T>): Promise<T> {
    const client = await this.db.connect();
    const outbox: Outbox = [];
    let result: T;
    try {
      await client.query('BEGIN');
      result = await fn(client, outbox);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    for (const [ch, type, data] of outbox) {
      if (ch === STREAM) {
        const d = data as { result: MatchResult; start: Date };
        this.stream(type, d.result, d.start, 0);
      } else {
        this.hub.publish(ch, type, data);
      }
    }
    return result;
  }

  async load(q: Queryable, id: string, forUpdate = false): Promise<BattleRow | undefined> {
    const { rows } = await q.query<BattleRow>(`${SELECT_BATTLE} WHERE b.id = $1${forUpdate ? ' FOR UPDATE OF b' : ''}`, [id]);
    return rows[0];
  }

  /** Serialise everything that touches these users' "one active battle" rule. */
  async lockUsers(client: pg.PoolClient, ids: string[]) {
    for (const id of [...new Set(ids)].sort((a, b) => Number(a) - Number(b))) {
      await client.query('SELECT pg_advisory_xact_lock(727100, ($1::bigint % 2147483647)::int)', [id]);
    }
  }

  /**
   * The battle a user is busy with: drafting or simulating on either side, or
   * a queued friend battle they sent (waiting for an answer). Invites a user
   * RECEIVED don't make them busy.
   */
  async activeBattle(q: Queryable, userId: string, except?: string): Promise<string | undefined> {
    const { rows } = await q.query<{ id: string }>(
      `SELECT id FROM battles
        WHERE ((state IN ('drafting', 'simulating') AND (user_a = $1 OR user_b = $1)) OR (state = 'queued' AND user_a = $1))
          AND ($2::bigint IS NULL OR id <> $2)
        ORDER BY id DESC LIMIT 1`, [userId, except ?? null]);
    return rows[0]?.id;
  }

  /** Not in a battle (see activeBattle) and not waiting in the ranked queue. */
  async assertFree(q: Queryable, userId: string, who = 'You are', opts: { except?: string; allowQueued?: boolean } = {}) {
    const busy = await this.activeBattle(q, userId, opts.except);
    if (busy) {
      throw new HttpError(409, 'ALREADY_IN_BATTLE', `${who} already in a battle (bt_${busy})`, { battle_id: `bt_${busy}` });
    }
    if (!opts.allowQueued) {
      const { rowCount } = await q.query('SELECT 1 FROM battle_queue WHERE user_id = $1', [userId]);
      if (rowCount) throw new HttpError(409, 'ALREADY_QUEUED', `${who} waiting in the ranked queue`);
    }
  }

  sportOf(b: { sport_code: string }): { sport: BattleSport; gender: Gender } {
    const s = BY_CODE[b.sport_code];
    if (!s) throw new HttpError(422, 'UNKNOWN_SPORT', `${b.sport_code} is not a Draft Battles sport`);
    return s;
  }

  sideOf(b: BattleRow, userId: string): Side | null {
    return b.user_a === userId ? 'A' : b.user_b === userId ? 'B' : null;
  }

  private userOfSide(b: BattleRow, side: Side) { return side === 'A' ? b.user_a : b.user_b; }

  // ------------------------------------------------------------------ create

  /** The pool must be able to fill both lineups. */
  async assertPool(q: Queryable, sportCode: string) {
    const { sport } = BY_CODE[sportCode]!;
    const { rows } = await q.query<{ position: string; n: number }>(
      `SELECT pr.position, count(*)::int AS n FROM player_ratings pr JOIN sports s ON s.id = pr.sport_id
        WHERE s.code = $1 GROUP BY 1`, [sportCode]);
    const have = Object.fromEntries(rows.map((r) => [r.position, r.n]));
    const short = SPORTS[sport].lineup.filter((s) => (have[s.position] ?? 0) < 2 * s.count).map((s) => s.position);
    if (short.length) {
      throw new HttpError(422, 'POOL_TOO_SMALL', `Not enough rated players for ${sportCode} (${short.join(', ')}) — ratings may not have run yet`);
    }
  }

  async createTx(client: pg.PoolClient, outbox: Outbox, input: {
    mode: BattleMode; sportCode: string; userA: string; userB: string | null; state: 'queued' | 'drafting';
    /** queue matches: both users are still in battle_queue while the battle is created */
    fromQueue?: boolean;
  }): Promise<string> {
    await this.lockUsers(client, [input.userA, ...(input.userB ? [input.userB] : [])]);
    await this.assertFree(client, input.userA, 'You are', { allowQueued: input.fromQueue });
    // A friend invite (queued) only checks the friend when they accept.
    if (input.userB && input.state === 'drafting') {
      await this.assertFree(client, input.userB, 'Your opponent is', { allowQueued: input.fromQueue });
    }
    await this.assertPool(client, input.sportCode);
    // Same T&C rule as leagues: terms accepted, and an athlete can't play their own sport.
    for (const u of [input.userA, input.state === 'drafting' ? input.userB : null]) {
      if (u) await client.query('SELECT assert_user_may_play_sport($1, (SELECT id FROM sports WHERE code = $2))', [u, input.sportCode]);
    }
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO battles (mode, ranked, sport_id, state, user_a, user_b)
       SELECT $1::battle_mode, $1::battle_mode = 'RANDOM', s.id, 'queued', $3, $4 FROM sports s WHERE s.code = $2 RETURNING id`,
      [input.mode, input.sportCode, input.userA, input.userB]);
    const id = rows[0]!.id;
    for (const u of [input.userA, input.userB]) if (u) outbox.push([`user:${encodeId('user', u)}`, 'battle.created', { battle_id: `bt_${id}`, mode: input.mode }]);
    if (input.state === 'drafting') await this.startDraftTx(client, outbox, id);
    return id;
  }

  async startDraftTx(client: pg.PoolClient, outbox: Outbox, id: string) {
    const b = (await this.load(client, id, true))!;
    if (b.state !== 'queued') throw new HttpError(409, 'BATTLE_NOT_QUEUED', `Battle is ${b.state}`);
    const first: Side = randomInt(2) === 0 ? 'A' : 'B';         // coin flip
    const deadline = this.deadlineFor(b, first);
    await client.query(`UPDATE battles SET state = 'drafting', first_pick = $2, pick_number = 0, pick_deadline = $3 WHERE id = $1`,
      [id, first, deadline]);
    outbox.push([battleChannel(id), 'battle.state', { battle_id: `bt_${id}`, state: 'drafting', first_pick: first }]);
    outbox.push([battleChannel(id), 'draft.turn', this.turnPayload(id, 1, first, deadline)]);
    for (const u of [b.user_a, b.user_b]) if (u) {
      outbox.push([`user:${encodeId('user', u)}`, 'battle.state', { battle_id: `bt_${id}`, state: 'drafting', first_pick: first }]);
    }
  }

  private deadlineFor(b: BattleRow, side: Side): Date {
    const isAi = side === 'B' && b.user_b === null;
    return new Date(this.now().getTime() + (isAi ? this.aiPickDelayMs : this.pickSeconds * 1000));
  }

  private turnPayload(id: string, pickNumber: number, side: Side, deadline: Date) {
    return { battle_id: `bt_${id}`, pick_number: pickNumber, side, deadline: deadline.toISOString(), pick_seconds: this.pickSeconds };
  }

  async createAiBattle(userId: string, sportCode: string): Promise<string> {
    return this.tx((c, o) => this.createTx(c, o, { mode: 'AI', sportCode, userA: userId, userB: null, state: 'drafting' }));
  }

  // ------------------------------------------------------------------ picks

  async pick(userId: string, battleId: string, athleteId: string) {
    await this.tx(async (client, outbox) => {
      const b = await this.load(client, battleId, true);
      if (!b) throw notFound('Battle');
      const side = this.sideOf(b, userId);
      if (!side) throw new HttpError(403, 'NOT_IN_BATTLE', 'You are not in this battle');
      if (b.state !== 'drafting') throw new HttpError(409, 'DRAFT_NOT_ACTIVE', `The battle is ${b.state}`);
      const turn = sideForPick(b.first_pick!, b.pick_number);
      if (turn !== side) throw new HttpError(409, 'NOT_YOUR_TURN', 'It is not your pick');
      await this.applyPick(client, outbox, b, side, athleteId, false);
    });
    return this.view(userId, battleId);
  }

  private async applyPick(client: pg.PoolClient, outbox: Outbox, b: BattleRow, side: Side, athleteId: string, auto: boolean) {
    const { sport } = this.sportOf(b);
    const { rows: [p] } = await client.query<PlayerSnapshot & { sport_id: number }>(
      `SELECT a.id::text AS athlete_id, a.first_name, a.last_name, u.name AS school, a.jersey_number, a.class_year,
              pr.position, pr.ovr, pr.sub_ratings, pr.is_new, pr.sport_id
         FROM player_ratings pr JOIN athletes a ON a.id = pr.athlete_id JOIN universities u ON u.id = a.university_id
        WHERE pr.athlete_id = $1`, [athleteId]);
    if (!p || p.sport_id !== b.sport_id) throw new HttpError(422, 'NOT_IN_POOL', 'That player is not in this battle\'s player pool');
    const { rows: picks } = await client.query<{ side: Side; slot: string; athlete_id: string }>(
      'SELECT side, slot, athlete_id::text FROM battle_picks WHERE battle_id = $1', [b.id]);
    if (picks.some((x) => x.athlete_id === athleteId)) throw new HttpError(409, 'ALREADY_PICKED', 'That player has already been drafted');
    const slot = slotFor(sport, picks.filter((x) => x.side === side).map((x) => x.slot), p.position);
    if (!slot) throw new HttpError(422, 'NO_OPEN_SLOT', `No open ${p.position} slot in your lineup`);
    const { sport_id: _sid, ...snapshot } = p;
    const pickNumber = b.pick_number + 1;
    await client.query(
      `INSERT INTO battle_picks (battle_id, pick_number, side, athlete_id, slot, auto, rating, picked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [b.id, pickNumber, side, athleteId, slot, auto, JSON.stringify(snapshot), this.now()]);
    const total = totalPicks(sport);
    const done = pickNumber >= total;
    const nextSide = done ? null : sideForPick(b.first_pick!, pickNumber);
    const deadline = nextSide ? this.deadlineFor(b, nextSide) : null;
    await client.query('UPDATE battles SET pick_number = $2, pick_deadline = $3 WHERE id = $1', [b.id, pickNumber, deadline]);
    outbox.push([battleChannel(b.id), 'draft.pick', {
      battle_id: `bt_${b.id}`, pick_number: pickNumber, side, slot, auto, player: publicSnapshot(snapshot),
      next: nextSide ? this.turnPayload(b.id, pickNumber + 1, nextSide, deadline!) : null,
    }]);
    if (nextSide) outbox.push([battleChannel(b.id), 'draft.turn', this.turnPayload(b.id, pickNumber + 1, nextSide, deadline!)]);
    if (done) await this.finalizeTx(client, outbox, { ...b, pick_number: pickNumber });
  }

  /** Best available eligible player for `side` (the AI's pick and the timeout auto-pick). */
  private async autoPickTx(client: pg.PoolClient, outbox: Outbox, b: BattleRow) {
    const { sport } = this.sportOf(b);
    const side = sideForPick(b.first_pick!, b.pick_number);
    const { rows: mine } = await client.query<{ slot: string }>('SELECT slot FROM battle_picks WHERE battle_id = $1 AND side = $2', [b.id, side]);
    const filled = mine.map((r) => r.slot);
    const { rows } = await client.query<{ athlete_id: string; position: string; ovr: number }>(
      `SELECT pr.athlete_id::text, pr.position, pr.ovr FROM player_ratings pr
        WHERE pr.sport_id = $1 AND pr.position = ANY($2)
          AND NOT EXISTS (SELECT 1 FROM battle_picks bp WHERE bp.battle_id = $3 AND bp.athlete_id = pr.athlete_id)
        ORDER BY pr.ovr DESC, pr.games_used DESC, pr.athlete_id LIMIT 25`,
      [b.sport_id, openPositions(sport, filled), b.id]);
    const choice = bestAvailable(sport, rows.map((r) => ({ athleteId: r.athlete_id, position: r.position, ovr: r.ovr })), new Set(), filled);
    if (!choice) {
      await client.query(`UPDATE battles SET state = 'cancelled', end_reason = 'pool_exhausted', pick_deadline = NULL WHERE id = $1`, [b.id]);
      outbox.push([battleChannel(b.id), 'battle.state', { battle_id: `bt_${b.id}`, state: 'cancelled', reason: 'pool_exhausted' }]);
      return;
    }
    await this.applyPick(client, outbox, b, side, choice.athleteId, true);
  }

  // ------------------------------------------------------------------ match

  private async finalizeTx(client: pg.PoolClient, outbox: Outbox, b: BattleRow) {
    const { sport } = this.sportOf(b);
    const { rows: picks } = await client.query<{ side: Side; slot: string; rating: PlayerSnapshot }>(
      'SELECT side, slot, rating FROM battle_picks WHERE battle_id = $1 ORDER BY pick_number', [b.id]);
    const names = await this.sideNames(client, b);
    const lineup = (side: Side): Lineup => ({
      name: names[side],
      players: picks.filter((p) => p.side === side).map((p) => ({
        id: encodeId('athlete', p.rating.athlete_id), name: p.rating.last_name, position: p.rating.position, slot: p.slot,
        ovr: p.rating.ovr, sub: p.rating.sub_ratings,
      })),
    });
    const seed = randomInt(2 ** 31);
    const result = simulate(sport, lineup('A'), lineup('B'), seed, `bt_${b.id}`);
    const start = new Date(this.now().getTime() + this.startLeadMs);
    const end = new Date(start.getTime() + result.durationMs);
    await client.query(
      `UPDATE battles SET state = 'simulating', seed = $2, result = $3, sim_started_at = $4, completes_at = $5, pick_deadline = NULL
        WHERE id = $1`, [b.id, seed, JSON.stringify(result), start, end]);
    const data = { battle_id: `bt_${b.id}`, state: 'simulating', starts_at: start.toISOString(), duration_ms: result.durationMs };
    outbox.push([battleChannel(b.id), 'battle.state', data]);
    for (const u of [b.user_a, b.user_b]) if (u) outbox.push([`user:${encodeId('user', u)}`, 'battle.state', data]);
    outbox.push([STREAM, b.id, { result, start }]);
  }

  async sideNames(q: Queryable, b: BattleRow): Promise<Record<Side, string>> {
    const { rows } = await q.query<{ id: string; name: string }>(
      'SELECT id, coalesce(username::text, display_name) AS name FROM users WHERE id = ANY($1)', [[b.user_a, b.user_b].filter(Boolean)]);
    const n = Object.fromEntries(rows.map((r) => [r.id, r.name]));
    const a = n[b.user_a] ?? 'Player A';
    let bb = b.user_b ? n[b.user_b] ?? 'Player B' : AI_NAME;
    if (bb === a) bb = `${bb} (2)`;
    return { A: a, B: bb };
  }

  /**
   * Emit each match event to the battle channel when its time comes. A new
   * match streams from event 0; a stream resumed after a restart starts at the
   * first event not yet due (clients that missed some get them in battle.sync).
   */
  stream(battleId: string, result: MatchResult, start: Date, fromIndex?: number) {
    if (this.streams.has(battleId)) return;
    const startMs = start.getTime();
    let i = fromIndex ?? result.events.findIndex((e) => startMs + e.t > this.now().getTime());
    if (i < 0) return;
    const next = () => {
      while (i < result.events.length && startMs + result.events[i]!.t <= this.now().getTime()) {
        this.hub.publish(battleChannel(battleId), 'match.event', { battle_id: `bt_${battleId}`, index: i, event: result.events[i] });
        i++;
      }
      if (i >= result.events.length) {
        this.streams.delete(battleId);
        return;
      }
      const wait = Math.max(0, startMs + result.events[i]!.t - this.now().getTime());
      this.streams.set(battleId, setTimeout(next, wait));
    };
    this.streams.set(battleId, setTimeout(next, Math.max(0, startMs + result.events[i]!.t - this.now().getTime())));
  }

  // ------------------------------------------------------------------ tick

  /** Act on every deadline that has passed. Safe to call any time, from any number of processes. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.duePicks();
      await this.dueCompletions();
      await this.resumeStreams();
      for (const h of this.tickHooks) {
        await h.run().catch((err) => this.logger?.error({ err, hook: h.name }, 'battle tick hook failed'));
      }
    } finally {
      this.ticking = false;
    }
  }

  private async duePicks() {
    for (let guard = 0; guard < 500; guard++) {
      const done = await this.tx(async (client, outbox) => {
        const { rows: [b] } = await client.query<BattleRow>(
          `${SELECT_BATTLE} WHERE b.state = 'drafting' AND b.pick_deadline <= $1 ORDER BY b.pick_deadline
            LIMIT 1 FOR UPDATE OF b SKIP LOCKED`, [this.now()]);
        if (!b) return true;
        await this.autoPickTx(client, outbox, b);
        return false;
      });
      if (done) return;
    }
  }

  private async dueCompletions() {
    for (let guard = 0; guard < 500; guard++) {
      const done = await this.tx(async (client, outbox) => {
        const { rows: [b] } = await client.query<BattleRow>(
          `${SELECT_BATTLE} WHERE b.state = 'simulating' AND b.completes_at <= $1 ORDER BY b.completes_at
            LIMIT 1 FOR UPDATE OF b SKIP LOCKED`, [this.now()]);
        if (!b) return true;
        const r = b.result!;
        await client.query(
          `UPDATE battles SET state = 'complete', winner = $2, score_a = $3, score_b = $4, went_to_ot = $5, completed_at = $6
            WHERE id = $1`, [b.id, r.winner, r.finalScoreA, r.finalScoreB, r.wentToOT, this.now()]);
        const done: BattleRow = { ...b, state: 'complete', winner: r.winner, score_a: r.finalScoreA, score_b: r.finalScoreB };
        for (const hook of this.onComplete) await hook(client, done, outbox);
        const data = { battle_id: `bt_${b.id}`, state: 'complete', winner: r.winner, score_a: r.finalScoreA, score_b: r.finalScoreB,
          went_to_ot: r.wentToOT };
        outbox.push([battleChannel(b.id), 'battle.state', data]);
        for (const u of [b.user_a, b.user_b]) if (u) outbox.push([`user:${encodeId('user', u)}`, 'battle.state', data]);
        return false;
      });
      if (done) return;
    }
  }

  private async resumeStreams() {
    const { rows } = await this.db.query<{ id: string; result: MatchResult; sim_started_at: Date }>(
      `SELECT id, result, sim_started_at FROM battles WHERE state = 'simulating' AND id <> ALL($1::bigint[])`,
      [[...this.streams.keys()]]);
    for (const r of rows) this.stream(r.id, r.result, r.sim_started_at);
  }

  stop() {
    for (const t of this.streams.values()) clearTimeout(t);
    this.streams.clear();
  }

  // ------------------------------------------------------------------ cancel

  /** Abandon an unranked battle before the match starts. Ranked drafts can't be abandoned (the timer auto-picks). */
  async forfeit(userId: string, battleId: string) {
    await this.tx(async (client, outbox) => {
      const b = await this.load(client, battleId, true);
      if (!b) throw notFound('Battle');
      if (!this.sideOf(b, userId)) throw new HttpError(403, 'NOT_IN_BATTLE', 'You are not in this battle');
      if (b.ranked) throw new HttpError(409, 'RANKED_NO_FORFEIT', 'Ranked drafts can\'t be abandoned; the pick timer auto-picks for you');
      if (b.state !== 'queued' && b.state !== 'drafting') throw new HttpError(409, 'BATTLE_STARTED', `The battle is ${b.state}`);
      await client.query(`UPDATE battles SET state = 'cancelled', end_reason = 'forfeit', pick_deadline = NULL WHERE id = $1`, [b.id]);
      outbox.push([battleChannel(b.id), 'battle.state', { battle_id: `bt_${b.id}`, state: 'cancelled', reason: 'forfeit' }]);
      const other = this.sideOf(b, userId) === 'A' ? b.user_b : b.user_a;
      if (other) outbox.push([`user:${encodeId('user', other)}`, 'battle.state', { battle_id: `bt_${b.id}`, state: 'cancelled', reason: 'forfeit' }]);
    });
    return this.view(userId, battleId);
  }

  // ------------------------------------------------------------------ view

  /** A battle as `userId` may see it: match events only up to now. */
  async view(userId: string, battleId: string) {
    const b = await this.load(this.db, battleId);
    if (!b) throw notFound('Battle');
    const you = this.sideOf(b, userId);
    if (!you) throw new HttpError(403, 'NOT_IN_BATTLE', 'You are not in this battle');
    const { sport, gender } = this.sportOf(b);
    const cfg = SPORTS[sport];
    const names = await this.sideNames(this.db, b);
    const { rows: picks } = await this.db.query<{ pick_number: number; side: Side; slot: string; auto: boolean; rating: PlayerSnapshot; picked_at: Date }>(
      'SELECT pick_number, side, slot, auto, rating, picked_at FROM battle_picks WHERE battle_id = $1 ORDER BY pick_number', [b.id]);
    const total = totalPicks(sport);
    const onClock = b.state === 'drafting' && b.first_pick ? sideForPick(b.first_pick, b.pick_number) : null;
    const nowMs = this.now().getTime();
    let match: Record<string, unknown> | null = null;
    if (b.result && b.sim_started_at) {
      const elapsed = nowMs - b.sim_started_at.getTime();
      const complete = b.state === 'complete';
      const events: Array<MatchEvent & { index: number }> = b.result.events
        .map((e, index) => ({ ...e, index }))
        .filter((e) => complete || e.t <= elapsed);
      const lastEv = events[events.length - 1];
      match = {
        match_id: b.result.matchId,
        starts_at: b.sim_started_at.toISOString(),
        elapsed_ms: Math.max(0, Math.min(elapsed, b.result.durationMs)),
        duration_ms: b.result.durationMs,
        events,
        score_a: lastEv?.scoreA ?? 0,
        score_b: lastEv?.scoreB ?? 0,
        ...(complete ? { final: { score_a: b.result.finalScoreA, score_b: b.result.finalScoreB, winner: b.result.winner,
          went_to_ot: b.result.wentToOT, seed: b.result.seed } } : {}),
      };
    }
    return {
      battle_id: `bt_${b.id}`,
      mode: b.mode,
      ranked: b.ranked,
      sport,
      gender,
      sport_id: b.sport_code,
      state: b.state,
      end_reason: b.end_reason,
      you,
      sides: {
        A: { user_id: encodeId('user', b.user_a), name: names.A, is_ai: false },
        B: { user_id: b.user_b ? encodeId('user', b.user_b) : null, name: names.B, is_ai: b.user_b === null },
      },
      lineup: cfg.lineup.map((s) => ({ slot: s.slot, position: s.position, count: s.count, label: s.label })),
      draft: {
        first_pick: b.first_pick,
        picks_made: b.pick_number,
        total_picks: total,
        order: b.first_pick ? pickOrder(b.first_pick, sport) : null,
        on_the_clock: onClock,
        deadline: b.state === 'drafting' ? b.pick_deadline?.toISOString() ?? null : null,
        pick_seconds: this.pickSeconds,
      },
      picks: picks.map((p) => ({ pick_number: p.pick_number, side: p.side, slot: p.slot, auto: p.auto,
        picked_at: p.picked_at.toISOString(), player: publicSnapshot(p.rating) })),
      match,
      created_at: b.created_at.toISOString(),
      completed_at: b.completed_at?.toISOString() ?? null,
    };
  }
}

export function publicSnapshot(p: PlayerSnapshot) {
  return { ...p, athlete_id: encodeId('athlete', p.athlete_id) };
}
