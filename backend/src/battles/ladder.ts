/**
 * Elo + weekly divisions (Duolingo-style).
 *
 *  - Elo starts at 1000; K = 40 for a player's first 10 ranked matches, then
 *    24. Only Play Random (ranked) battles change Elo.
 *  - Divisions, low to high: Walk-On, Bench, Starter, Varsity, All-Star,
 *    Captain, Hall of Fame. A player's first ranked result of the week puts
 *    them in a cohort of up to 30 players of their division.
 *  - Cohorts rank by weekly wins (Elo breaks ties). At the weekly reset
 *    (Monday 00:00 America/Toronto) the top 5 move up and the bottom 5 down.
 *    Hall of Fame has no promotion, Walk-On no relegation. Small cohorts move
 *    at most half their members each way, and promotion needs at least one win.
 */
import type pg from 'pg';

import type { Queryable } from '../db.js';
import { encodeId } from '../ids.js';
import { BATTLES } from './config.js';
import { divisionIndex } from './matchmaking.js';
import { userChannel } from './realtime.js';
import type { BattleRow, BattleService } from './service.js';

const DIVS = BATTLES.ladder.divisions;
const TZ = BATTLES.ladder.timeZone;

// ------------------------------------------------------------------ pure rules

export const kFactor = (rankedPlayed: number) =>
  (rankedPlayed < BATTLES.elo.provisionalMatches ? BATTLES.elo.kProvisional : BATTLES.elo.k);

export const expectedScore = (ra: number, rb: number) => 1 / (1 + 10 ** ((rb - ra) / 400));

/** Elo deltas for A and B; each side uses its own K. */
export function eloDeltas(ra: number, rb: number, aWon: boolean, kA: number, kB: number): { a: number; b: number } {
  const ea = expectedScore(ra, rb);
  const sa = aWon ? 1 : 0;
  return { a: Math.round(kA * (sa - ea)), b: Math.round(kB * ((1 - sa) - (1 - ea))) };
}

function zonedParts(d: Date, tz = TZ) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), min: Number(p.minute),
    s: Number(p.second), wd: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday!) };
}

const ymd = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.toISOString().slice(0, 10);
};

/** The local Monday (YYYY-MM-DD) of the ladder week containing `at`. */
export function weekStart(at: Date, tz = TZ): string {
  const p = zonedParts(at, tz);
  return ymd(p.y, p.m, p.d - p.wd);
}

/** The UTC instant of local midnight on `date` in `tz`. */
export function zonedMidnight(date: string, tz = TZ): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  let guess = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(guess), tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
    guess -= asUtc - Date.UTC(y, m - 1, d);
  }
  return new Date(guess);
}

export function nextReset(at: Date, tz = TZ): Date {
  const [y, m, d] = weekStart(at, tz).split('-').map(Number) as [number, number, number];
  return zonedMidnight(ymd(y, m, d + 7), tz);
}

export interface Standing { userId: string; wins: number; losses: number; elo: number }

export function rankCohort(members: Standing[]): Standing[] {
  return [...members].sort((a, b) => b.wins - a.wins || b.elo - a.elo || a.losses - b.losses || Number(a.userId) - Number(b.userId));
}

export function zoneSizes(n: number) {
  const half = Math.floor(n / 2);
  return { promote: Math.min(BATTLES.ladder.promote, half), relegate: Math.min(BATTLES.ladder.relegate, half) };
}

/** userId -> outcome for one cohort at the reset. */
export function cohortOutcomes(members: Standing[], division: string): Map<string, 'promoted' | 'relegated' | 'stayed'> {
  const ranked = rankCohort(members);
  const { promote, relegate } = zoneSizes(ranked.length);
  const top = division !== 'HALL_OF_FAME';
  const bottom = division !== 'WALK_ON';
  const out = new Map<string, 'promoted' | 'relegated' | 'stayed'>();
  ranked.forEach((m, i) => {
    if (top && i < promote && m.wins > 0) out.set(m.userId, 'promoted');
    else if (bottom && i >= ranked.length - relegate) out.set(m.userId, 'relegated');
    else out.set(m.userId, 'stayed');
  });
  return out;
}

export const shiftDivision = (division: string, outcome: string) => {
  const i = divisionIndex(division);
  return DIVS[Math.max(0, Math.min(DIVS.length - 1, i + (outcome === 'promoted' ? 1 : outcome === 'relegated' ? -1 : 0)))]!;
};

// ------------------------------------------------------------------ database

export class Ladder {
  constructor(private battles: BattleService) {
    battles.onComplete.push((client, b, outbox) => this.applyRanked(client, b, outbox));
    battles.tickHooks.push({ name: 'weekly-reset', run: () => this.weeklyReset() });
  }

  private now() { return this.battles.now(); }

  private async profile(q: Queryable, userId: string, lock = false) {
    await q.query('INSERT INTO battle_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
    return (await q.query<{ elo: number; division: string; ranked_played: number }>(
      `SELECT elo, division, ranked_played FROM battle_profiles WHERE user_id = $1${lock ? ' FOR UPDATE' : ''}`, [userId])).rows[0]!;
  }

  /** The user's cohort for `week`, joining one (or opening a new one) on first sight. */
  private async membership(client: pg.PoolClient, userId: string, week: string, division: string, elo: number) {
    const existing = await client.query('SELECT 1 FROM ladder_memberships WHERE week_start = $1 AND user_id = $2', [week, userId]);
    if (existing.rowCount) return;
    await client.query('SELECT pg_advisory_xact_lock(727300, $1)', [divisionIndex(division)]);
    const { rows: [open] } = await client.query<{ id: string }>(
      `SELECT c.id FROM ladder_cohorts c
        WHERE c.week_start = $1 AND c.division = $2
          AND (SELECT count(*) FROM ladder_memberships m WHERE m.cohort_id = c.id) < $3
        ORDER BY c.id LIMIT 1`, [week, division, BATTLES.ladder.cohortSize]);
    const cohort = open?.id ?? (await client.query<{ id: string }>(
      'INSERT INTO ladder_cohorts (week_start, division) VALUES ($1, $2) RETURNING id', [week, division])).rows[0]!.id;
    await client.query(
      `INSERT INTO ladder_memberships (week_start, user_id, cohort_id, division, elo_at_start, joined_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [week, userId, cohort, division, elo, this.now()]);
  }

  /** Completion hook: ranked battles update Elo, record and the weekly ladder. */
  async applyRanked(client: pg.PoolClient, b: BattleRow, outbox: Array<[string, string, unknown]>) {
    if (!b.ranked || !b.user_b || !b.winner) return;
    const [ua, ub] = [b.user_a, b.user_b];
    const first = Number(ua) < Number(ub) ? ua : ub;           // lock in id order
    const pa0 = await this.profile(client, first, true);
    const pb0 = await this.profile(client, first === ua ? ub : ua, true);
    const pa = first === ua ? pa0 : pb0;
    const pb = first === ua ? pb0 : pa0;
    const d = eloDeltas(pa.elo, pb.elo, b.winner === 'A', kFactor(pa.ranked_played), kFactor(pb.ranked_played));
    const week = weekStart(this.now());
    for (const [uid, p, delta, won] of [[ua, pa, d.a, b.winner === 'A'], [ub, pb, d.b, b.winner === 'B']] as const) {
      await this.membership(client, uid, week, p.division, p.elo);
      await client.query(
        `UPDATE battle_profiles SET elo = elo + $2, ranked_played = ranked_played + 1,
                ranked_wins = ranked_wins + $3, ranked_losses = ranked_losses + $4 WHERE user_id = $1`,
        [uid, delta, won ? 1 : 0, won ? 0 : 1]);
      await client.query(`UPDATE ladder_memberships SET wins = wins + $3, losses = losses + $4 WHERE week_start = $1 AND user_id = $2`,
        [week, uid, won ? 1 : 0, won ? 0 : 1]);
      outbox.push([userChannel(uid), 'ladder.updated', { battle_id: `bt_${b.id}`, result: won ? 'W' : 'L', elo: p.elo + delta,
        elo_change: delta, division: p.division }]);
    }
    await client.query(`UPDATE battles SET elo_a_before = $2, elo_a_after = $3, elo_b_before = $4, elo_b_after = $5 WHERE id = $1`,
      [b.id, pa.elo, pa.elo + d.a, pb.elo, pb.elo + d.b]);
  }

  /** Close every finished week not closed yet (idempotent; safe across processes). */
  async weeklyReset() {
    const current = weekStart(this.now());
    const { rows: weeks } = await this.battles.db.query<{ week: string }>(
      `SELECT DISTINCT to_char(m.week_start, 'YYYY-MM-DD') AS week FROM ladder_memberships m
        WHERE m.week_start < $1 AND NOT EXISTS (SELECT 1 FROM ladder_resets r WHERE r.week_start = m.week_start)
        ORDER BY 1`, [current]);
    for (const { week } of weeks) {
      await this.battles.tx(async (client, outbox) => {
        const { rows: [l] } = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_xact_lock(727301) AS ok');
        if (!l!.ok) return;
        if ((await client.query('SELECT 1 FROM ladder_resets WHERE week_start = $1', [week])).rowCount) return;
        const { rows } = await client.query<{ cohort_id: string; division: string; user_id: string; wins: number; losses: number; elo: number }>(
          `SELECT m.cohort_id, m.division, m.user_id, m.wins, m.losses, p.elo
             FROM ladder_memberships m JOIN battle_profiles p ON p.user_id = m.user_id WHERE m.week_start = $1`, [week]);
        const cohorts = new Map<string, typeof rows>();
        for (const r of rows) (cohorts.get(r.cohort_id) ?? cohorts.set(r.cohort_id, []).get(r.cohort_id)!).push(r);
        let promoted = 0;
        let relegated = 0;
        for (const members of cohorts.values()) {
          const division = members[0]!.division;
          const standings = members.map((m) => ({ userId: m.user_id, wins: m.wins, losses: m.losses, elo: m.elo }));
          const outcomes = cohortOutcomes(standings, division);
          const ranked = rankCohort(standings);
          for (const [i, s] of ranked.entries()) {
            const outcome = outcomes.get(s.userId)!;
            promoted += outcome === 'promoted' ? 1 : 0;
            relegated += outcome === 'relegated' ? 1 : 0;
            const next = shiftDivision(division, outcome);
            await client.query(`UPDATE ladder_memberships SET final_rank = $3, outcome = $4 WHERE week_start = $1 AND user_id = $2`,
              [week, s.userId, i + 1, outcome]);
            await client.query('UPDATE battle_profiles SET division = $2 WHERE user_id = $1', [s.userId, next]);
            const payload = { week_start: week, rank: i + 1, outcome, from: division, division: next,
              division_name: BATTLES.ladder.divisionNames[next] };
            const { rows: [n] } = await client.query<{ id: string }>(
              `INSERT INTO notifications (user_id, kind, payload, created_at) VALUES ($1, 'ladder_reset', $2, $3) RETURNING id`,
              [s.userId, JSON.stringify(payload), this.now()]);
            outbox.push([userChannel(s.userId), 'ladder.reset', { ...payload, notification_id: `ntf_${n!.id}` }]);
          }
        }
        await client.query('INSERT INTO ladder_resets (week_start, processed_at, cohorts, promoted, relegated) VALUES ($1, $2, $3, $4, $5)',
          [week, this.now(), cohorts.size, promoted, relegated]);
      });
    }
  }

  // ------------------------------------------------------------------ reads

  async me(userId: string) {
    const db = this.battles.db;
    const p = await this.profile(db, userId);
    const week = weekStart(this.now());
    const base = {
      division: p.division, division_name: BATTLES.ladder.divisionNames[p.division], elo: p.elo,
      ranked_played: p.ranked_played, divisions: DIVS.map((d) => ({ division: d, name: BATTLES.ladder.divisionNames[d] })),
      week: { week_start: week, resets_at: nextReset(this.now()).toISOString(), time_zone: TZ },
    };
    const { rows: [m] } = await db.query<{ cohort_id: string; division: string }>(
      'SELECT cohort_id, division FROM ladder_memberships WHERE week_start = $1 AND user_id = $2', [week, userId]);
    if (!m) return { ...base, cohort: null, message: 'Play a ranked (Play Random) battle to join this week\'s ladder.' };
    const { rows } = await db.query<{ user_id: string; username: string | null; display_name: string; wins: number; losses: number; elo: number }>(
      `SELECT m.user_id, u.username, u.display_name, m.wins, m.losses, p.elo
         FROM ladder_memberships m JOIN users u ON u.id = m.user_id JOIN battle_profiles p ON p.user_id = m.user_id
        WHERE m.cohort_id = $1`, [m.cohort_id]);
    const ranked = rankCohort(rows.map((r) => ({ userId: r.user_id, wins: r.wins, losses: r.losses, elo: r.elo })));
    const zones = zoneSizes(ranked.length);
    const byId = new Map(rows.map((r) => [r.user_id, r]));
    const standings = ranked.map((s, i) => {
      const r = byId.get(s.userId)!;
      const promote = m.division !== 'HALL_OF_FAME' && i < zones.promote && s.wins > 0;
      const relegate = !promote && m.division !== 'WALK_ON' && i >= ranked.length - zones.relegate;
      return { rank: i + 1, user_id: encodeId('user', s.userId), name: r.username ?? r.display_name, wins: s.wins, losses: s.losses,
        elo: s.elo, zone: promote ? 'promotion' : relegate ? 'relegation' : null, you: s.userId === userId };
    });
    const mine = standings.find((s) => s.you)!;
    return {
      ...base,
      cohort: {
        cohort_id: `ch_${m.cohort_id}`, division: m.division, size: ranked.length, max_size: BATTLES.ladder.cohortSize,
        promotion_spots: m.division === 'HALL_OF_FAME' ? 0 : zones.promote, relegation_spots: m.division === 'WALK_ON' ? 0 : zones.relegate,
        rank: mine.rank, wins: mine.wins, losses: mine.losses, zone: mine.zone, standings,
      },
    };
  }

  async stats(userId: string) {
    const db = this.battles.db;
    const p = await this.profile(db, userId);
    const week = weekStart(this.now());
    const { rows: [wk] } = await db.query<{ wins: number; losses: number }>(
      'SELECT wins, losses FROM ladder_memberships WHERE week_start = $1 AND user_id = $2', [week, userId]);
    const { rows: byMode } = await db.query<{ mode: string; played: number; wins: number }>(
      `SELECT mode::text, count(*)::int AS played,
              count(*) FILTER (WHERE (winner = 'A' AND user_a = $1) OR (winner = 'B' AND user_b = $1))::int AS wins
         FROM battles WHERE state = 'complete' AND (user_a = $1 OR user_b = $1) GROUP BY 1`, [userId]);
    const { rows: recent } = await db.query<{
      id: string; mode: string; ranked: boolean; code: string; user_a: string; user_b: string | null; winner: string;
      score_a: number; score_b: number; went_to_ot: boolean; completed_at: Date; opp: string | null;
      elo_a_before: number | null; elo_a_after: number | null; elo_b_before: number | null; elo_b_after: number | null;
    }>(
      `SELECT b.id, b.mode::text, b.ranked, s.code, b.user_a, b.user_b, b.winner, b.score_a, b.score_b, b.went_to_ot, b.completed_at,
              b.elo_a_before, b.elo_a_after, b.elo_b_before, b.elo_b_after,
              (SELECT coalesce(u.username::text, u.display_name) FROM users u WHERE u.id = CASE WHEN b.user_a = $1 THEN b.user_b ELSE b.user_a END) AS opp
         FROM battles b JOIN sports s ON s.id = b.sport_id
        WHERE b.state = 'complete' AND (b.user_a = $1 OR b.user_b = $1)
        ORDER BY b.completed_at DESC, b.id DESC LIMIT 20`, [userId]);
    const modes = Object.fromEntries(['AI', 'FRIEND', 'RANDOM'].map((mode) => {
      const r = byMode.find((x) => x.mode === mode);
      return [mode, { played: r?.played ?? 0, wins: r?.wins ?? 0, losses: (r?.played ?? 0) - (r?.wins ?? 0) }];
    }));
    return {
      user_id: encodeId('user', userId),
      elo: p.elo,
      division: p.division,
      division_name: BATTLES.ladder.divisionNames[p.division],
      ranked: { played: p.ranked_played, provisional: p.ranked_played < BATTLES.elo.provisionalMatches },
      this_week: { week_start: week, wins: wk?.wins ?? 0, losses: wk?.losses ?? 0 },
      totals: modes,
      recent: recent.map((r) => {
        const you = r.user_a === userId ? 'A' : 'B';
        const [mine, theirs] = you === 'A' ? [r.score_a, r.score_b] : [r.score_b, r.score_a];
        const before = you === 'A' ? r.elo_a_before : r.elo_b_before;
        const after = you === 'A' ? r.elo_a_after : r.elo_b_after;
        return {
          battle_id: `bt_${r.id}`, mode: r.mode, ranked: r.ranked, sport_id: r.code, opponent: r.opp ?? 'VarsityHQ AI',
          result: r.winner === you ? 'W' : 'L', score: `${mine}-${theirs}`, went_to_ot: r.went_to_ot,
          elo_change: before !== null && after !== null ? after - before : null, completed_at: r.completed_at.toISOString(),
        };
      }),
    };
  }
}
