/**
 * Matchmaking: Play a Friend (invites) and Play Random (ranked FIFO queue).
 * Play AI needs none (BattleService.createAiBattle).
 *
 * Queue rule (findMatches, pure): oldest waiting player first; match them
 * with the oldest other player in the same sport whose division is within
 * the pair's tolerance: same division at first, adjacent divisions once
 * either has waited 20 s, anyone once either has waited 40 s.
 */
import type pg from 'pg';

import type { Queryable } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import { encodeId } from '../ids.js';
import { BATTLES } from './config.js';
import { userChannel } from './realtime.js';
import type { BattleService, TxFn } from './service.js';

export type Division = (typeof BATTLES.ladder.divisions)[number];
export const divisionIndex = (d: string) => BATTLES.ladder.divisions.indexOf(d as Division);

export interface QueueEntry {
  userId: string;
  sportId: number;
  division: string;
  enqueuedAt: number;     // epoch ms
}

/** Division distance allowed after waiting `waitMs`. */
export function tolerance(waitMs: number): number {
  if (waitMs < BATTLES.queue.adjacentAfterSeconds * 1000) return 0;
  if (waitMs < BATTLES.queue.anyoneAfterSeconds * 1000) return 1;
  return Infinity;
}

export function findMatches(entries: QueueEntry[], now: number): Array<[QueueEntry, QueueEntry]> {
  const fifo = [...entries].sort((a, b) => a.enqueuedAt - b.enqueuedAt || Number(a.userId) - Number(b.userId));
  const used = new Set<string>();
  const pairs: Array<[QueueEntry, QueueEntry]> = [];
  for (const e of fifo) {
    if (used.has(e.userId)) continue;
    for (const c of fifo) {
      if (c.userId === e.userId || used.has(c.userId) || c.sportId !== e.sportId) continue;
      const allowed = Math.max(tolerance(now - e.enqueuedAt), tolerance(now - c.enqueuedAt));
      if (Math.abs(divisionIndex(e.division) - divisionIndex(c.division)) <= allowed) {
        used.add(e.userId);
        used.add(c.userId);
        pairs.push([e, c]);
        break;
      }
    }
  }
  return pairs;
}

/** Push notifications hook (no provider is configured; replace to deliver). */
export interface PushSender {
  send(userId: string, title: string, body: string, data: Record<string, unknown>): Promise<void>;
}
export const noopPush: PushSender = { send: async () => undefined };

const QUEUE_LOCK = 727_200;

interface InviteRow {
  id: string; battle_id: string; from_user: string; to_user: string; status: string; delivery: string;
  expires_at: Date; responded_at: Date | null; created_at: Date; sport_code: string;
  from_name: string; to_name: string; from_username: string | null; to_username: string | null;
}

export class Matchmaking {
  private queueLevel = new Map<string, number>();

  constructor(private battles: BattleService, private push: PushSender = noopPush) {
    battles.tickHooks.push({ name: 'invite-expiry', run: () => this.expireInvites() });
    battles.tickHooks.push({ name: 'queue', run: () => this.matchQueue() });
  }

  private get db() { return this.battles.db; }
  private get hub() { return this.battles.hub; }
  private now() { return this.battles.now(); }
  private tx<T>(fn: TxFn<T>) { return this.battles.tx(fn); }

  // ------------------------------------------------------------------ users

  async setUsername(userId: string, username: string) {
    try {
      await this.db.query('UPDATE users SET username = $2 WHERE id = $1', [userId, username]);
    } catch (err) {
      if ((err as { constraint?: string }).constraint === 'users_username_key') {
        throw new HttpError(409, 'USERNAME_TAKEN', 'That username is taken');
      }
      throw err;
    }
    return { user_id: encodeId('user', userId), username };
  }

  async searchUsers(userId: string, q: string) {
    const prefix = q.replace(/[%_\\]/g, '\\$&') + '%';
    const { rows } = await this.db.query<{ id: string; username: string | null; display_name: string }>(
      `SELECT id, username, display_name FROM users
        WHERE id <> $1 AND (username ILIKE $2 OR display_name ILIKE $2)
        ORDER BY (username ILIKE $2) DESC, username NULLS LAST, display_name LIMIT 20`, [userId, prefix]);
    return rows.map((r) => ({ user_id: encodeId('user', r.id), username: r.username, display_name: r.display_name,
      online: this.hub.isOnline(r.id) }));
  }

  // ------------------------------------------------------------------ notifications

  async notify(q: Queryable, userId: string, kind: string, payload: Record<string, unknown>, expiresAt: Date | null) {
    const { rows: [n] } = await q.query<{ id: string; created_at: Date }>(
      `INSERT INTO notifications (user_id, kind, payload, expires_at, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
      [userId, kind, JSON.stringify(payload), expiresAt, this.now()]);
    return { notification_id: `ntf_${n!.id}`, kind, payload, created_at: n!.created_at.toISOString(), read_at: null,
      expires_at: expiresAt?.toISOString() ?? null };
  }

  async listNotifications(userId: string) {
    const { rows } = await this.db.query<{ id: string; kind: string; payload: Record<string, unknown>; created_at: Date; read_at: Date | null; expires_at: Date | null }>(
      `SELECT id, kind, payload, created_at, read_at, expires_at FROM notifications
        WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > $2) ORDER BY created_at DESC, id DESC LIMIT 100`,
      [userId, this.now()]);
    return {
      unread: rows.filter((r) => !r.read_at).length,
      data: rows.map((r) => ({ notification_id: `ntf_${r.id}`, kind: r.kind, payload: r.payload, created_at: r.created_at.toISOString(),
        read_at: r.read_at?.toISOString() ?? null, expires_at: r.expires_at?.toISOString() ?? null })),
    };
  }

  async markRead(userId: string, id: string) {
    const { rowCount } = await this.db.query('UPDATE notifications SET read_at = coalesce(read_at, $3) WHERE id = $1 AND user_id = $2',
      [id, userId, this.now()]);
    if (!rowCount) throw notFound('Notification');
    return { notification_id: `ntf_${id}`, read: true };
  }

  // ------------------------------------------------------------------ invites

  private async loadInvite(q: Queryable, id: string, forUpdate = false): Promise<InviteRow | undefined> {
    const { rows } = await q.query<InviteRow>(
      `SELECT i.*, s.code AS sport_code, fu.display_name AS from_name, tu.display_name AS to_name,
              fu.username AS from_username, tu.username AS to_username
         FROM battle_invites i JOIN battles b ON b.id = i.battle_id JOIN sports s ON s.id = b.sport_id
         JOIN users fu ON fu.id = i.from_user JOIN users tu ON tu.id = i.to_user
        WHERE i.id = $1${forUpdate ? ' FOR UPDATE OF i' : ''}`, [id]);
    return rows[0];
  }

  private invitePayload(i: InviteRow) {
    return {
      invite_id: `inv_${i.id}`, battle_id: `bt_${i.battle_id}`, sport_id: i.sport_code, status: i.status, delivery: i.delivery,
      from: { user_id: encodeId('user', i.from_user), username: i.from_username, display_name: i.from_name },
      to: { user_id: encodeId('user', i.to_user), username: i.to_username, display_name: i.to_name },
      expires_at: i.expires_at.toISOString(), responded_at: i.responded_at?.toISOString() ?? null, created_at: i.created_at.toISOString(),
    };
  }

  async resolveUser(target: { username?: string; user_id?: string }): Promise<string> {
    if (target.user_id) {
      const id = target.user_id.replace(/^usr_/, '');
      const { rowCount } = await this.db.query('SELECT 1 FROM users WHERE id = $1', [/^\d+$/.test(id) ? id : '0']);
      if (rowCount) return id;
    } else if (target.username) {
      const { rows } = await this.db.query<{ id: string }>('SELECT id FROM users WHERE username = $1', [target.username]);
      if (rows[0]) return rows[0].id;
    }
    throw new HttpError(404, 'USER_NOT_FOUND', 'No user with that username');
  }

  async invite(fromUser: string, toUser: string, sportCode: string) {
    if (fromUser === toUser) throw new HttpError(422, 'CANNOT_INVITE_SELF', 'You can\'t invite yourself');
    const online = this.hub.isOnline(toUser);
    const ttl = (online ? BATTLES.invites.onlineTtlSeconds : BATTLES.invites.offlineTtlSeconds) * 1000;
    const expires = new Date(this.now().getTime() + ttl);
    const invite = await this.tx(async (client, outbox) => {
      const battleId = await this.battles.createTx(client, outbox,
        { mode: 'FRIEND', sportCode, userA: fromUser, userB: toUser, state: 'queued' });
      const { rows: [r] } = await client.query<{ id: string }>(
        `INSERT INTO battle_invites (battle_id, from_user, to_user, delivery, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [battleId, fromUser, toUser, online ? 'realtime' : 'inbox', expires, this.now()]);
      const inv = (await this.loadInvite(client, r!.id))!;
      const payload = this.invitePayload(inv);
      if (online) {
        outbox.push([userChannel(toUser), 'invite.received', payload]);
      } else {
        const n = await this.notify(client, toUser, 'battle_invite', payload, expires);
        outbox.push([userChannel(toUser), 'notification.created', n]);
      }
      outbox.push([userChannel(fromUser), 'invite.updated', payload]);
      return inv;
    });
    if (invite.delivery === 'inbox') {
      await this.push.send(toUser, 'Draft Battle invite',
        `${invite.from_username ?? invite.from_name} challenged you to a ${invite.sport_code} Draft Battle`, { invite_id: `inv_${invite.id}` })
        .catch(() => undefined);
    }
    return this.invitePayload(invite);
  }

  async respond(userId: string, inviteId: string, accept: boolean) {
    return this.tx(async (client, outbox) => {
      const i = await this.loadInvite(client, inviteId, true);
      if (!i || i.to_user !== userId) throw notFound('Invite');
      if (i.status !== 'pending') throw new HttpError(409, 'INVITE_NOT_PENDING', `This invite is ${i.status}`);
      if (i.expires_at.getTime() <= this.now().getTime()) {
        await this.closeInviteTx(client, outbox, i, 'expired');
        throw new HttpError(410, 'INVITE_EXPIRED', 'This invite has expired');
      }
      if (accept) {
        await this.battles.lockUsers(client, [i.from_user, i.to_user]);
        await this.battles.assertFree(client, userId, 'You are', { except: i.battle_id });
        await this.battles.assertFree(client, i.from_user, 'Your friend is', { except: i.battle_id });
        await client.query(`UPDATE battle_invites SET status = 'accepted', responded_at = $2 WHERE id = $1`, [i.id, this.now()]);
        await this.battles.startDraftTx(client, outbox, i.battle_id);
      } else {
        await this.closeInviteTx(client, outbox, i, 'declined');
      }
      const payload = this.invitePayload((await this.loadInvite(client, i.id))!);
      outbox.push([userChannel(i.from_user), 'invite.updated', payload]);
      outbox.push([userChannel(i.to_user), 'invite.updated', payload]);
      return payload;
    });
  }

  async cancelInvite(userId: string, inviteId: string) {
    return this.tx(async (client, outbox) => {
      const i = await this.loadInvite(client, inviteId, true);
      if (!i || i.from_user !== userId) throw notFound('Invite');
      if (i.status !== 'pending') throw new HttpError(409, 'INVITE_NOT_PENDING', `This invite is ${i.status}`);
      await this.closeInviteTx(client, outbox, i, 'cancelled');
      const payload = this.invitePayload((await this.loadInvite(client, i.id))!);
      outbox.push([userChannel(i.to_user), 'invite.updated', payload]);
      outbox.push([userChannel(i.from_user), 'invite.updated', payload]);
      return payload;
    });
  }

  /** declined / cancelled / expired: the invite and its queued battle end together. */
  private async closeInviteTx(client: pg.PoolClient, _outbox: unknown, i: InviteRow, status: 'declined' | 'cancelled' | 'expired') {
    await client.query(`UPDATE battle_invites SET status = $2, responded_at = coalesce(responded_at, $3) WHERE id = $1`, [i.id, status, this.now()]);
    await client.query(`UPDATE battles SET state = $2, end_reason = $3 WHERE id = $1 AND state = 'queued'`,
      [i.battle_id, status === 'expired' ? 'expired' : 'cancelled', `invite_${status}`]);
    await client.query(`UPDATE notifications SET read_at = coalesce(read_at, $3)
                         WHERE user_id = $1 AND kind = 'battle_invite' AND payload->>'invite_id' = $2`, [i.to_user, `inv_${i.id}`, this.now()]);
  }

  async listInvites(userId: string) {
    const { rows } = await this.db.query<{ id: string }>(
      `SELECT id FROM battle_invites WHERE (from_user = $1 OR to_user = $1) AND created_at > $2 ORDER BY id DESC LIMIT 50`,
      [userId, new Date(this.now().getTime() - 7 * 86_400_000)]);
    const all = await Promise.all(rows.map((r) => this.loadInvite(this.db, r.id)));
    const items = all.filter((x): x is InviteRow => !!x).map((i) => this.invitePayload(i));
    return {
      incoming: items.filter((x) => x.to.user_id === encodeId('user', userId)),
      outgoing: items.filter((x) => x.from.user_id === encodeId('user', userId)),
    };
  }

  async expireInvites() {
    for (let guard = 0; guard < 200; guard++) {
      const done = await this.tx(async (client, outbox) => {
        const { rows: [r] } = await client.query<{ id: string }>(
          `SELECT id FROM battle_invites WHERE status = 'pending' AND expires_at <= $1 ORDER BY expires_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [this.now()]);
        if (!r) return true;
        const i = (await this.loadInvite(client, r.id))!;
        await this.closeInviteTx(client, outbox, i, 'expired');
        const payload = this.invitePayload((await this.loadInvite(client, i.id))!);
        outbox.push([userChannel(i.from_user), 'invite.updated', payload]);
        outbox.push([userChannel(i.to_user), 'invite.updated', payload]);
        return false;
      });
      if (done) return;
    }
  }

  // ------------------------------------------------------------------ queue

  async ensureProfile(q: Queryable, userId: string) {
    await q.query('INSERT INTO battle_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
    return (await q.query<{ elo: number; division: string }>('SELECT elo, division FROM battle_profiles WHERE user_id = $1', [userId])).rows[0]!;
  }

  async estimateWaitSeconds(q: Queryable, sportId: number, division: string, waitedMs = 0): Promise<number> {
    const { rows: [w] } = await q.query<{ others_same: number; others: number; median: number | null }>(
      `SELECT (SELECT count(*)::int FROM battle_queue WHERE sport_id = $1 AND division = $2) AS others_same,
              (SELECT count(*)::int FROM battle_queue WHERE sport_id = $1) AS others,
              (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY queue_wait_ms)
                 FROM (SELECT queue_wait_ms FROM battles WHERE sport_id = $1 AND queue_wait_ms IS NOT NULL
                        ORDER BY id DESC LIMIT 50) x) AS median`, [sportId, division]);
    const base = w!.median !== null ? w!.median / 1000 : BATTLES.queue.defaultEstimateSeconds;
    const est = w!.others_same > 1 ? 2 : w!.others > 1 ? Math.min(base, BATTLES.queue.adjacentAfterSeconds) : base;
    return Math.max(0, Math.round(est - waitedMs / 1000));
  }

  async enqueue(userId: string, sportCode: string) {
    await this.tx(async (client) => {
      await this.battles.lockUsers(client, [userId]);
      await this.battles.assertFree(client, userId);
      const { rows: [s] } = await client.query<{ id: number }>('SELECT id FROM sports WHERE code = $1', [sportCode]);
      await this.battles.assertPool(client, sportCode);
      const p = await this.ensureProfile(client, userId);
      await client.query('INSERT INTO battle_queue (user_id, sport_id, division, elo, enqueued_at) VALUES ($1, $2, $3, $4, $5)',
        [userId, s!.id, p.division, p.elo, this.now()]);
    });
    await this.matchQueue();
    return this.queueStatus(userId);
  }

  async leaveQueue(userId: string) {
    const { rowCount } = await this.db.query('DELETE FROM battle_queue WHERE user_id = $1', [userId]);
    if (!rowCount) throw new HttpError(404, 'NOT_QUEUED', 'You are not in the queue');
    this.queueLevel.delete(userId);
    return { status: 'cancelled' };
  }

  async queueStatus(userId: string) {
    const { rows: [q] } = await this.db.query<{ sport_id: number; code: string; division: string; enqueued_at: Date }>(
      `SELECT q.sport_id, s.code, q.division, q.enqueued_at FROM battle_queue q JOIN sports s ON s.id = q.sport_id WHERE q.user_id = $1`, [userId]);
    if (q) {
      const waited = this.now().getTime() - q.enqueued_at.getTime();
      const tol = tolerance(waited);
      return { status: 'queued', sport_id: q.code, division: q.division, enqueued_at: q.enqueued_at.toISOString(),
        waited_seconds: Math.floor(waited / 1000), matching: tol === 0 ? 'same_division' : tol === 1 ? 'adjacent_divisions' : 'anyone',
        estimated_wait_seconds: await this.estimateWaitSeconds(this.db, q.sport_id, q.division, waited) };
    }
    const battle = await this.battles.activeBattle(this.db, userId);
    if (battle) {
      const b = await this.battles.load(this.db, battle);
      if (b?.mode === 'RANDOM') return { status: 'matched', battle_id: `bt_${battle}` };
    }
    return { status: 'idle' };
  }

  /** Pair waiting players (serialised across processes by an advisory lock). */
  async matchQueue() {
    await this.tx(async (client, outbox) => {
      const { rows: [l] } = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS ok', [QUEUE_LOCK]);
      if (!l!.ok) return;
      const { rows } = await client.query<{ user_id: string; sport_id: number; division: string; enqueued_at: Date; code: string }>(
        `SELECT q.user_id, q.sport_id, q.division, q.enqueued_at, s.code FROM battle_queue q JOIN sports s ON s.id = q.sport_id`);
      const now = this.now().getTime();
      const code = new Map(rows.map((r) => [r.sport_id, r.code]));
      const entries = rows.map((r) => ({ userId: r.user_id, sportId: r.sport_id, division: r.division, enqueuedAt: r.enqueued_at.getTime() }));
      const matched = new Set<string>();
      for (const [a, b] of findMatches(entries, now)) {
        await client.query('SAVEPOINT pair');
        const mark = outbox.length;
        try {
          const id = await this.battles.createTx(client, outbox,
            { mode: 'RANDOM', sportCode: code.get(a.sportId)!, userA: a.userId, userB: b.userId, state: 'drafting', fromQueue: true });
          await client.query('DELETE FROM battle_queue WHERE user_id = ANY($1)', [[a.userId, b.userId]]);
          await client.query('UPDATE battles SET queue_wait_ms = $2 WHERE id = $1', [id, Math.round(((now - a.enqueuedAt) + (now - b.enqueuedAt)) / 2)]);
          await client.query('RELEASE SAVEPOINT pair');
          for (const u of [a, b]) {
            matched.add(u.userId);
            this.queueLevel.delete(u.userId);
            outbox.push([userChannel(u.userId), 'queue.matched', { battle_id: `bt_${id}`, sport_id: code.get(a.sportId),
              waited_seconds: Math.round((now - u.enqueuedAt) / 1000) }]);
          }
        } catch {
          // e.g. a player became ineligible: drop just this pair, keep both queued
          await client.query('ROLLBACK TO SAVEPOINT pair');
          outbox.length = mark;
        }
      }
      // tell waiting players when their search widens
      for (const e of entries) {
        if (matched.has(e.userId)) continue;
        const tol = tolerance(now - e.enqueuedAt);
        const level = tol === 0 ? 0 : tol === 1 ? 1 : 2;
        if ((this.queueLevel.get(e.userId) ?? 0) !== level) {
          this.queueLevel.set(e.userId, level);
          outbox.push([userChannel(e.userId), 'queue.status', {
            status: 'queued', matching: ['same_division', 'adjacent_divisions', 'anyone'][level],
            waited_seconds: Math.floor((now - e.enqueuedAt) / 1000),
            estimated_wait_seconds: await this.estimateWaitSeconds(client, e.sportId, e.division, now - e.enqueuedAt),
          }]);
        }
      }
    });
  }
}
