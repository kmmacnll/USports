import { Router } from 'express';
import { z } from 'zod';

import { requireUser } from '../auth.js';
import type { Db } from '../db.js';
import { decodeId } from '../ids.js';
import { searchAthletes } from '../services/athletes.js';
import {
  addToRoster, createLeague, dropFromRoster, getLeague, getRoster, joinLeague, swap,
} from '../services/leagues.js';
import { acceptTerms, getMe } from '../services/me.js';
import { listSports } from '../services/sports.js';

const sportCode = z.string({ error: 'sport is required, e.g. usports_mbk' }).regex(/^usports_[a-z]+$/, 'expected a sport id like usports_mbk');
const slotName = z.string().trim().min(1).max(10).regex(/^[A-Za-z]+$/, 'slot names are letters only');
const rosterLimits = z.record(
  z.string().regex(/^[A-Z]{1,10}$/, 'slot names are upper-case letters, e.g. QB or BENCH'),
  z.number().int().min(0).max(15),
).refine((m) => Object.keys(m).length > 0, 'roster_limits must not be empty');

const AthleteQuery = z.object({
  sport: sportCode,
  university: z.string().trim().min(1).max(64).optional(),
  q: z.string().trim().min(1).max(64).optional(),
  position: z.string().trim().min(1).max(10).optional(),
  season: z.string().regex(/^\d{4}(-\d{2})?$/).optional(),
  sort: z.enum(['fantasy_points', 'name']).default('fantasy_points'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
});

const CreateLeagueBody = z.object({
  league_name: z.string().trim().min(1).max(80),
  sport: sportCode,
  max_teams: z.number().int().min(2).max(20).default(10),
  roster_limits: rosterLimits.optional(),
  roster_size: z.number().int().min(1).max(40).optional(),
  competition_id: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]).transform(String).optional(),
  is_private: z.boolean().default(true),
  team_name: z.string().trim().min(1).max(60).optional(),
});

const JoinBody = z.object({
  team_name: z.string().trim().min(1).max(60),
  invite_code: z.string().trim().max(32).optional(),
});

const SwapBody = z.object({
  athlete_id: z.string(),
  target_slot: slotName,
  target_slot_index: z.number().int().min(1).max(15).default(1),
});

const AddBody = z.object({
  athlete_id: z.string(),
  slot: slotName.optional(),
  slot_index: z.number().int().min(1).max(15).optional(),
});

const TermsBody = z.object({
  terms_version: z.string().min(1).max(32),
  is_usports_athlete: z.boolean(),
  athlete_sports: z.array(sportCode).max(5).default([]),
});

/** Public reference data: no login needed. */
export function publicRouter(db: Db): Router {
  const r = Router();
  r.get('/sports', async (req, res) => {
    const includeInactive = req.query.include_inactive === 'true';
    res.json({ data: await listSports(db, includeInactive) });
  });

  r.get('/athletes', async (req, res) => {
    const q = AthleteQuery.parse(req.query);
    res.json(await searchAthletes(db, {
      sport: q.sport, university: q.university, q: q.q, position: q.position, season: q.season,
      sort: q.sort, page: q.page, pageSize: q.page_size,
    }));
  });

  return r;
}

/** Everything below requires an authenticated user (see auth.ts). */
export function apiRouter(db: Db): Router {
  const r = Router();

  // ---- current user
  r.get('/me', async (req, res) => {
    res.json(await getMe(db, requireUser(req).id));
  });

  r.put('/me/terms', async (req, res) => {
    res.json(await acceptTerms(db, requireUser(req).id, TermsBody.parse(req.body)));
  });

  // ---- leagues
  r.post('/leagues', async (req, res) => {
    const league = await createLeague(db, requireUser(req).id, CreateLeagueBody.parse(req.body));
    res.status(201).location(`/api/v1/leagues/${league.league_id}`).json(league);
  });

  r.get('/leagues/:id', async (req, res) => {
    res.json(await getLeague(db, requireUser(req).id, decodeId('league', req.params.id)));
  });

  r.post('/leagues/:id/teams', async (req, res) => {
    const body = JoinBody.parse(req.body);
    res.status(201).json(await joinLeague(db, requireUser(req).id, decodeId('league', req.params.id),
      body.team_name, body.invite_code));
  });

  // ---- rosters
  r.get('/leagues/:id/roster', async (req, res) => {
    const teamId = typeof req.query.team_id === 'string' ? decodeId('team', req.query.team_id) : undefined;
    res.json(await getRoster(db, requireUser(req).id, decodeId('league', req.params.id), teamId));
  });

  r.post('/leagues/:id/roster/swap', async (req, res) => {
    const body = SwapBody.parse(req.body);
    res.json(await swap(db, requireUser(req).id, decodeId('league', req.params.id), {
      athlete_id: decodeId('athlete', body.athlete_id),
      target_slot: body.target_slot,
      target_slot_index: body.target_slot_index,
    }));
  });

  r.post('/leagues/:id/roster', async (req, res) => {
    const body = AddBody.parse(req.body);
    res.status(201).json(await addToRoster(db, requireUser(req).id, decodeId('league', req.params.id), {
      athlete_id: decodeId('athlete', body.athlete_id), slot: body.slot, slot_index: body.slot_index,
    }));
  });

  r.delete('/leagues/:id/roster/:athleteId', async (req, res) => {
    res.json(await dropFromRoster(db, requireUser(req).id, decodeId('league', req.params.id),
      decodeId('athlete', req.params.athleteId)));
  });

  return r;
}
