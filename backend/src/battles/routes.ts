import { Router } from 'express';
import { z } from 'zod';

import { requireUser } from '../auth.js';
import type { Db } from '../db.js';
import { decodeId } from '../ids.js';
import { HttpError } from '../errors.js';
import { listPlayers, resolveSportCode } from './players.js';
import type { Matchmaking } from './matchmaking.js';
import type { BattleService } from './service.js';

const SportBody = z.object({
  sport: z.string().max(20).optional(),
  gender: z.string().max(10).optional(),
  sport_id: z.string().regex(/^usports_[a-z]+$/).optional(),
});

const PlayersQuery = SportBody.extend({
  position: z.string().trim().max(10).optional(),
  q: z.string().trim().min(1).max(64).optional(),
  battle_id: z.string().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export const decodeBattleId = (v: unknown): string => {
  const s = String(v ?? '');
  const m = /^(?:bt_)?([1-9]\d{0,17})$/.exec(s);
  if (!m) throw new HttpError(400, 'INVALID_ID', `'${s}' is not a valid battle id (expected bt_<number>)`);
  return m[1]!;
};

/** No login needed. */
export function battlesPublicRouter(db: Db): Router {
  const r = Router();
  r.get('/players', async (req, res) => {
    const q = PlayersQuery.parse(req.query);
    res.json(await listPlayers(db, {
      sportCode: resolveSportCode(q), position: q.position, q: q.q,
      excludeBattle: q.battle_id ? decodeBattleId(q.battle_id) : undefined, page: q.page, pageSize: q.page_size,
    }));
  });
  return r;
}

const PickBody = z.object({ athlete_id: z.string() });
const InviteBody = SportBody.extend({
  username: z.string().trim().min(1).max(40).optional(),
  user_id: z.string().max(30).optional(),
}).refine((b) => b.username || b.user_id, 'username or user_id is required');
const RespondBody = z.object({ accept: z.boolean() });
const UsernameBody = z.object({ username: z.string().trim().regex(/^[A-Za-z0-9_.]{3,20}$/, '3-20 letters, digits, _ or .') });
const SearchQuery = z.object({ q: z.string().trim().min(1).max(40) });

const decodePrefixed = (prefix: string, kind: string) => (v: unknown): string => {
  const m = new RegExp(`^(?:${prefix})?([1-9]\\d{0,17})$`).exec(String(v ?? ''));
  if (!m) throw new HttpError(400, 'INVALID_ID', `'${String(v)}' is not a valid ${kind} id (expected ${prefix}<number>)`);
  return m[1]!;
};
const decodeInviteId = decodePrefixed('inv_', 'invite');
const decodeNotificationId = decodePrefixed('ntf_', 'notification');

export function battlesRouter(battles: BattleService, mm: Matchmaking): Router {
  const r = Router();

  // ---- users & notifications
  r.put('/me/username', async (req, res) => {
    res.json(await mm.setUsername(requireUser(req).id, UsernameBody.parse(req.body).username));
  });
  r.get('/users/search', async (req, res) => {
    res.json({ data: await mm.searchUsers(requireUser(req).id, SearchQuery.parse(req.query).q) });
  });
  r.get('/notifications', async (req, res) => {
    res.json(await mm.listNotifications(requireUser(req).id));
  });
  r.post('/notifications/:id/read', async (req, res) => {
    res.json(await mm.markRead(requireUser(req).id, decodeNotificationId(req.params.id)));
  });

  // ---- Play a Friend
  r.post('/battles/invite', async (req, res) => {
    const body = InviteBody.parse(req.body);
    const to = await mm.resolveUser(body);
    res.status(201).json(await mm.invite(requireUser(req).id, to, resolveSportCode(body)));
  });
  r.get('/battles/invites', async (req, res) => {
    res.json(await mm.listInvites(requireUser(req).id));
  });
  r.post('/battles/invite/:id/respond', async (req, res) => {
    res.json(await mm.respond(requireUser(req).id, decodeInviteId(req.params.id), RespondBody.parse(req.body).accept));
  });
  r.delete('/battles/invite/:id', async (req, res) => {
    res.json(await mm.cancelInvite(requireUser(req).id, decodeInviteId(req.params.id)));
  });

  // ---- Play Random (ranked)
  r.post('/queue/random', async (req, res) => {
    const status = await mm.enqueue(requireUser(req).id, resolveSportCode(SportBody.parse(req.body ?? {})));
    res.status(status.status === 'matched' ? 201 : 202).json(status);
  });
  r.get('/queue/random', async (req, res) => {
    res.json(await mm.queueStatus(requireUser(req).id));
  });
  r.delete('/queue/random', async (req, res) => {
    res.json(await mm.leaveQueue(requireUser(req).id));
  });

  r.post('/realtime/ticket', (req, res) => {
    res.status(201).json(battles.hub.issueTicket(requireUser(req).id));
  });

  r.post('/battles/ai', async (req, res) => {
    const id = await battles.createAiBattle(requireUser(req).id, resolveSportCode(SportBody.parse(req.body ?? {})));
    res.status(201).location(`/api/v1/battles/bt_${id}`).json(await battles.view(requireUser(req).id, id));
  });

  r.get('/battles/:id', async (req, res) => {
    res.json(await battles.view(requireUser(req).id, decodeBattleId(req.params.id)));
  });

  r.post('/battles/:id/pick', async (req, res) => {
    const body = PickBody.parse(req.body);
    res.json(await battles.pick(requireUser(req).id, decodeBattleId(req.params.id), decodeId('athlete', body.athlete_id)));
  });

  r.post('/battles/:id/forfeit', async (req, res) => {
    res.json(await battles.forfeit(requireUser(req).id, decodeBattleId(req.params.id)));
  });

  return r;
}
