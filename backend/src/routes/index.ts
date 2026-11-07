import { Router } from 'express';
import { z } from 'zod';

import { requireUser } from '../auth.js';
import type { Db } from '../db.js';
import { decodeId } from '../ids.js';
import { getAthlete, searchAthletes } from '../services/athletes.js';
import { listGames, listUniversities } from '../services/reference.js';
import {
  addToRoster, availableAthletes, createLeague, dropFromRoster, getLeague, getRoster, joinLeague, listTeams, swap,
} from '../services/leagues.js';
import { getMe } from '../services/me.js';
import { listSports } from '../services/sports.js';

const sportCode = z.string({ error: 'sport_id is required, e.g. usports_mhk' })
  .regex(/^usports_[a-z]+$/, 'expected a sport id like usports_mhk');

/**
 * `sport_id` is the query parameter for choosing a sport (usports_mhk,
 * usports_mvb, ...). `sport` is accepted as an alias for older clients.
 */
const sportIdAlias = (q: unknown) => {
  if (!q || typeof q !== 'object') return q;
  const { sport_id: sportId, ...rest } = q as Record<string, unknown>;
  return sportId === undefined ? rest : { ...rest, sport: sportId };
};
const slotName = z.string().trim().min(1).max(10).regex(/^[A-Za-z]+$/, 'slot names are letters only');
const rosterLimits = z.record(
  z.string().regex(/^[A-Z]{1,10}$/, 'slot names are upper-case letters, e.g. QB or BENCH'),
  z.number().int().min(0).max(15),
).refine((m) => Object.keys(m).length > 0, 'roster_limits must not be empty');

const AthleteQueryBase = z.object({
  sport: sportCode,
  university: z.string().trim().min(1).max(64).optional(),
  q: z.string().trim().min(1).max(64).optional(),
  position: z.string().trim().min(1).max(10).optional(),
  conference: z.enum(['AUS', 'RSEQ', 'OUA', 'CW', 'aus', 'rseq', 'oua', 'cw']).optional(),
  season: z.string().regex(/^\d{4}(-\d{2})?$/).optional(),
  sort: z.enum(['fantasy_points', 'name']).default('fantasy_points'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
});

const AthleteQuery = z.preprocess(sportIdAlias, AthleteQueryBase);
const AvailableQuery = AthleteQueryBase.omit({ sport: true, season: true });

const SportsQuery = z.preprocess(sportIdAlias, z.object({
  sport: sportCode.optional(),
  season_type: z.enum(['FALL', 'WINTER', 'SPRING', 'fall', 'winter', 'spring']).transform((v) => v.toUpperCase()).optional(),
  include_inactive: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
}));

const UniversitiesQuery = z.preprocess(sportIdAlias, z.object({ sport: sportCode.optional() }));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const GamesQuery = z.preprocess(sportIdAlias, z.object({
  sport: sportCode,
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}));

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const CreateLeagueBody = z.object({
  league_name: z.string().trim().min(1).max(80),
  sport: sportCode,
  max_teams: z.number().int().min(2).max(20).default(10),
  roster_limits: rosterLimits.optional(),
  roster_size: z.number().int().min(1).max(40).optional(),
  ruleset_id: z.string().regex(/^[a-z0-9_]{3,64}$/, 'expected a ruleset id like usports_football_half_ppr').optional(),
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

/** Public reference data: no login needed. */
export function publicRouter(db: Db): Router {
  const r = Router();
  // ?sport_id=usports_mhk returns just that sport (404 if unknown);
  // ?season_type=FALL|WINTER|SPRING filters; ?include_inactive=true adds catalogued sports.
  r.get('/sports', async (req, res) => {
    const q = SportsQuery.parse(req.query);
    res.json({ data: await listSports(db, { includeInactive: q.include_inactive || !!q.sport,
      sportId: q.sport, seasonType: q.season_type }) });
  });

  r.get('/athletes', async (req, res) => {
    const q = AthleteQuery.parse(req.query);
    res.json(await searchAthletes(db, {
      sport: q.sport, university: q.university, q: q.q, position: q.position, conference: q.conference,
      season: q.season, sort: q.sort, page: q.page, pageSize: q.page_size,
    }));
  });

  r.get('/athletes/:id', async (req, res) => {
    res.json(await getAthlete(db, decodeId('athlete', req.params.id)));
  });

  r.get('/universities', async (req, res) => {
    const { sport } = UniversitiesQuery.parse(req.query);
    res.json({ data: await listUniversities(db, sport) });
  });

  r.get('/games', async (req, res) => {
    const q = GamesQuery.parse(req.query);
    const from = q.from ?? day(-3);
    const to = q.to ?? day(4);
    res.json({ from, to, data: await listGames(db, q.sport, from, to, q.limit) });
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

  r.get('/leagues/:id/teams', async (req, res) => {
    res.json({ data: await listTeams(db, requireUser(req).id, decodeId('league', req.params.id)) });
  });

  r.get('/leagues/:id/available', async (req, res) => {
    const q = AvailableQuery.parse(req.query);
    res.json(await availableAthletes(db, requireUser(req).id, decodeId('league', req.params.id), {
      university: q.university, q: q.q, position: q.position, conference: q.conference,
      sort: q.sort, page: q.page, pageSize: q.page_size,
    }));
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
