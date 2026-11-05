import type pg from 'pg';

import { type Db, type Queryable, withTransaction } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import { encodeId } from '../ids.js';
import { isEligible, isStarterSlot, orderSlots, orderedLimits } from '../sport-display.js';
import type { RosterConfig, ScoringRules } from './sports.js';
import { getSport } from './sports.js';
import { searchAthletes, type AthleteSearch } from './athletes.js';

// ----------------------------------------------------------------- leagues

interface LeagueRow {
  id: string;
  name: string;
  commissioner_id: string;
  max_teams: number;
  roster_size: number;
  roster_limits_json: Record<string, number>;
  status: string;
  is_private: boolean;
  invite_code: string;
  created_at: Date;
  competition_id: string;
  ruleset_id: string;
  ruleset_name: string;
  season: string;
  roster_config_json: RosterConfig;
  scoring_rules_json: ScoringRules;
  sport_code: string;
  team_count: number;
  viewer_team_id: string | null;
}

const LEAGUE_SQL = `
  SELECT l.id, l.name, l.commissioner_id, l.max_teams, l.roster_size, l.roster_limits_json,
         l.status, l.is_private, l.invite_code, l.created_at,
         c.id AS competition_id, c.code AS ruleset_id, c.name AS ruleset_name, c.season, c.roster_config_json, c.scoring_rules_json,
         s.code AS sport_code,
         (SELECT count(*)::int FROM fantasy_teams t WHERE t.league_id = l.id) AS team_count,
         (SELECT t.id FROM fantasy_teams t WHERE t.league_id = l.id AND t.user_id = $2) AS viewer_team_id
    FROM leagues l
    JOIN competitions c ON c.id = l.competition_id
    JOIN sports s ON s.id = c.sport_id
   WHERE l.id = $1`;

async function loadLeague(db: Queryable, leagueId: string, userId: string, lock = false): Promise<LeagueRow> {
  const { rows } = await db.query<LeagueRow>(lock ? `${LEAGUE_SQL} FOR UPDATE OF l` : LEAGUE_SQL, [leagueId, userId]);
  const row = rows[0];
  if (!row) throw notFound('League');
  return row;
}

const isMember = (l: LeagueRow, userId: string) => l.commissioner_id === userId || l.viewer_team_id !== null;

function assertCanView(l: LeagueRow, userId: string): void {
  // Private leagues are invisible to non-members (404, not 403, to avoid leaking ids).
  if (l.is_private && !isMember(l, userId)) throw notFound('League');
}

function formatLeague(l: LeagueRow, userId: string) {
  const cfg = l.roster_config_json;
  return {
    league_id: encodeId('league', l.id),
    league_name: l.name,
    commissioner_id: encodeId('user', l.commissioner_id),
    max_teams: l.max_teams,
    team_count: l.team_count,
    sport: l.sport_code,
    season: l.season,
    ruleset_id: l.ruleset_id,
    ruleset_name: l.ruleset_name,
    roster_size: l.roster_size,
    roster_limits: orderedLimits(l.roster_limits_json, cfg.slot_order),
    position_eligibility: cfg.position_eligibility ?? {},
    scoring_rules: l.scoring_rules_json,
    status: l.status,
    is_private: l.is_private,
    ...(isMember(l, userId) ? { invite_code: l.invite_code } : {}),
    my_team_id: l.viewer_team_id ? encodeId('team', l.viewer_team_id) : null,
    created_at: l.created_at,
  };
}

export interface CreateLeague {
  league_name: string;
  sport: string;
  max_teams: number;
  roster_limits?: Record<string, number>;
  roster_size?: number;
  ruleset_id?: string;
  is_private: boolean;
  team_name?: string;
}

export async function createLeague(db: Db, userId: string, input: CreateLeague) {
  const { row: sport } = await getSport(db, input.sport);
  if (!sport.is_active) throw new HttpError(422, 'SPORT_INACTIVE', `${sport.name} is not open for fantasy leagues yet`);

  let competitionId = sport.competition_id;
  if (input.ruleset_id) {
    // Latest season of that ruleset for this sport.
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM competitions WHERE code = $1 AND sport_id = $2 AND is_public
        ORDER BY season DESC LIMIT 1`, [input.ruleset_id, sport.id]);
    competitionId = rows[0]?.id ?? null;
    if (!competitionId) throw new HttpError(422, 'UNKNOWN_RULESET', `Ruleset '${input.ruleset_id}' does not exist for ${sport.name}`);
  }
  if (!competitionId) {
    throw new HttpError(422, 'NO_RULESET', `${sport.name} has no default scoring ruleset yet`);
  }

  if (input.roster_limits && input.roster_size !== undefined) {
    const sum = Object.values(input.roster_limits).reduce((a, b) => a + b, 0);
    if (sum !== input.roster_size) {
      throw new HttpError(422, 'ROSTER_SIZE_MISMATCH', `roster_size is ${input.roster_size} but roster_limits add up to ${sum}`);
    }
  }

  const leagueId = await withTransaction(db, async (client) => {
    // roster_limits_json / roster_size default from the competition (leagues trigger).
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO leagues (competition_id, commissioner_id, name, max_teams, is_private, roster_limits_json, roster_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [competitionId, userId, input.league_name, input.max_teams, input.is_private,
       input.roster_limits ? JSON.stringify(input.roster_limits) : null, input.roster_size ?? null],
    );
    const id = rows[0]!.id;
    if (input.team_name) {
      await client.query('INSERT INTO fantasy_teams (league_id, user_id, team_name) VALUES ($1, $2, $3)',
        [id, userId, input.team_name]);
    }
    return id;
  });
  return formatLeague(await loadLeague(db, leagueId, userId), userId);
}

export async function getLeague(db: Db, userId: string, leagueId: string) {
  const league = await loadLeague(db, leagueId, userId);
  assertCanView(league, userId);
  return formatLeague(league, userId);
}

export async function joinLeague(db: Db, userId: string, leagueId: string, teamName: string, inviteCode?: string) {
  const league = await loadLeague(db, leagueId, userId);
  if (league.is_private && league.commissioner_id !== userId && inviteCode !== league.invite_code) {
    // Same response as a missing league, so ids can't be probed.
    throw notFound('League');
  }
  if (league.viewer_team_id) {
    // Checked before the insert: the capacity trigger would otherwise report LEAGUE_FULL.
    throw new HttpError(409, 'ALREADY_IN_LEAGUE', 'You already have a team in this league');
  }
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO fantasy_teams (league_id, user_id, team_name) VALUES ($1, $2, $3) RETURNING id',
    [leagueId, userId, teamName],
  );
  return { team_id: encodeId('team', rows[0]!.id), league_id: encodeId('league', leagueId), team_name: teamName };
}

// ----------------------------------------------------------------- rosters

interface TeamRow {
  id: string;
  team_name: string;
  user_id: string;
}

interface SpotRow {
  id: string;
  athlete_id: string;
  position_assigned: string;
  slot_index: number;
  slot_type: string;
  first_name: string;
  last_name: string;
  position: string | null;
  positions: string[];
  status: string;
  university_name: string;
  season_fantasy_points: string | null;
  games_played: number;
}

async function loadTeam(db: Queryable, league: LeagueRow, userId: string, teamId?: string, lock = false): Promise<TeamRow> {
  const sql = teamId
    ? 'SELECT id, team_name, user_id FROM fantasy_teams WHERE league_id = $1 AND id = $2'
    : 'SELECT id, team_name, user_id FROM fantasy_teams WHERE league_id = $1 AND user_id = $2';
  const { rows } = await db.query<TeamRow>(lock ? `${sql} FOR UPDATE` : sql, [league.id, teamId ?? userId]);
  const team = rows[0];
  if (!team) {
    throw teamId ? notFound('Team') : new HttpError(404, 'NO_TEAM', 'You do not have a team in this league');
  }
  return team;
}

async function loadSpots(db: Queryable, league: LeagueRow, teamId: string): Promise<SpotRow[]> {
  const { rows } = await db.query<SpotRow>(
    `SELECT rs.id, rs.athlete_id, rs.position_assigned, rs.slot_index, rs.slot_type,
            a.first_name, a.last_name, a.position, a.positions, a.status, u.name AS university_name,
            fp.points AS season_fantasy_points, coalesce(fp.games, 0)::int AS games_played
       FROM roster_spots rs
       JOIN athletes a     ON a.id = rs.athlete_id
       JOIN universities u ON u.id = a.university_id
       LEFT JOIN LATERAL (
         SELECT sum(p.points) AS points, count(*) AS games
           FROM game_stats gs
           JOIN game_stat_fantasy_points p ON p.game_stat_id = gs.id AND p.competition_id = $2
          WHERE gs.athlete_id = a.id
       ) fp ON TRUE
      WHERE rs.fantasy_team_id = $1`,
    [teamId, league.competition_id],
  );
  return rows;
}

function formatRoster(league: LeagueRow, team: TeamRow, spots: SpotRow[]) {
  const bySlot = new Map(spots.map((s) => [`${s.position_assigned}#${s.slot_index}`, s]));
  const slots = orderSlots(league.roster_limits_json, league.roster_config_json.slot_order).flatMap((slot) =>
    Array.from({ length: league.roster_limits_json[slot] ?? 0 }, (_, i) => {
      const s = bySlot.get(`${slot}#${i + 1}`);
      return {
        slot,
        slot_index: i + 1,
        slot_type: s?.slot_type ?? (isStarterSlot(slot) ? 'STARTER' : slot === 'IR' ? 'INJURED_RESERVE' : 'BENCH'),
        athlete: s
          ? {
              athlete_id: encodeId('athlete', s.athlete_id),
              first_name: s.first_name,
              last_name: s.last_name,
              university: s.university_name,
              position: s.position,
              positions: s.positions,
              status: s.status,
              games_played: s.games_played,
              season_fantasy_points: s.season_fantasy_points === null ? 0 : Number(s.season_fantasy_points),
            }
          : null,
      };
    }));
  return {
    league_id: encodeId('league', league.id),
    team: { team_id: encodeId('team', team.id), team_name: team.team_name, owner_id: encodeId('user', team.user_id) },
    roster_size: league.roster_size,
    filled: spots.length,
    slots,
  };
}

export async function getRoster(db: Db, userId: string, leagueId: string, teamId?: string) {
  const league = await loadLeague(db, leagueId, userId);
  assertCanView(league, userId);
  const team = await loadTeam(db, league, userId, teamId);
  return formatRoster(league, team, await loadSpots(db, league, team.id));
}

function assertSlot(league: LeagueRow, slot: string, index: number): void {
  const limit = league.roster_limits_json[slot];
  if (limit === undefined || index < 1 || index > limit) {
    throw new HttpError(422, 'INVALID_SLOT', `Slot ${slot} #${index} is not part of this league's roster`,
      { roster_limits: orderedLimits(league.roster_limits_json, league.roster_config_json.slot_order) });
  }
}

/** Runs `fn` against the caller's own team with the team row locked. */
async function withOwnTeam<T>(db: Db, userId: string, leagueId: string,
  fn: (c: pg.PoolClient, league: LeagueRow, team: TeamRow) => Promise<T>): Promise<T> {
  return withTransaction(db, async (client) => {
    const league = await loadLeague(client, leagueId, userId);
    if (!isMember(league, userId)) throw notFound('League');
    const team = await loadTeam(client, league, userId, undefined, true);
    return fn(client, league, team);
  });
}

export interface SwapInput {
  athlete_id: string;
  target_slot: string;
  target_slot_index: number;
}

/**
 * Move an athlete to another slot on the caller's team. If the slot is
 * occupied the two athletes trade places. Both moves happen in one
 * transaction with the slot constraint deferred; the database rejects
 * ineligible moves (e.g. a C into PG) and the whole swap rolls back.
 */
export async function swap(db: Db, userId: string, leagueId: string, input: SwapInput) {
  return withOwnTeam(db, userId, leagueId, async (client, league, team) => {
    const target = input.target_slot.toUpperCase();
    assertSlot(league, target, input.target_slot_index);

    const spots = await loadSpots(client, league, team.id);
    const moving = spots.find((s) => s.athlete_id === input.athlete_id);
    if (!moving) throw new HttpError(404, 'NOT_ON_ROSTER', 'That athlete is not on your roster');
    if (moving.position_assigned === target && moving.slot_index === input.target_slot_index) {
      throw new HttpError(400, 'NO_CHANGE', 'The athlete is already in that slot');
    }
    const occupant = spots.find((s) => s.position_assigned === target && s.slot_index === input.target_slot_index);

    await client.query('SET CONSTRAINTS roster_spots_slot_key DEFERRED');
    await client.query('UPDATE roster_spots SET position_assigned = $1, slot_index = $2 WHERE id = $3',
      [target, input.target_slot_index, moving.id]);
    if (occupant) {
      await client.query('UPDATE roster_spots SET position_assigned = $1, slot_index = $2 WHERE id = $3',
        [moving.position_assigned, moving.slot_index, occupant.id]);
    }
    await client.query('SET CONSTRAINTS roster_spots_slot_key IMMEDIATE');
    return formatRoster(league, team, await loadSpots(client, league, team.id));
  });
}

export interface AddInput {
  athlete_id: string;
  slot?: string;
  slot_index?: number;
}

/**
 * Add an available athlete to the caller's roster. Without an explicit slot
 * the first open starter slot the athlete is eligible for is used, then the
 * first open bench slot.
 */
export async function addToRoster(db: Db, userId: string, leagueId: string, input: AddInput) {
  return withOwnTeam(db, userId, leagueId, async (client, league, team) => {
    const { rows } = await client.query<{ positions: string[] }>(
      'SELECT positions FROM athletes WHERE id = $1', [input.athlete_id]);
    const athlete = rows[0];
    if (!athlete) throw notFound('Athlete');

    const spots = await loadSpots(client, league, team.id);
    const taken = new Set(spots.map((s) => `${s.position_assigned}#${s.slot_index}`));
    let slot = input.slot?.toUpperCase();
    let index = input.slot_index ?? 1;

    if (slot) {
      assertSlot(league, slot, index);
      if (taken.has(`${slot}#${index}`)) throw new HttpError(409, 'SLOT_OCCUPIED', 'That roster slot is already filled');
    } else {
      const order = orderSlots(league.roster_limits_json, league.roster_config_json.slot_order);
      const open = order.flatMap((s) => Array.from({ length: league.roster_limits_json[s] ?? 0 }, (_, i) => [s, i + 1] as const))
        .filter(([s, i]) => !taken.has(`${s}#${i}`));
      const pick = open.find(([s]) => isStarterSlot(s) && isEligible(s, athlete.positions, league.roster_config_json.position_eligibility))
        ?? open.find(([s]) => s === 'BENCH');
      if (!pick) throw new HttpError(409, 'ROSTER_FULL', 'No open roster slot this athlete can fill');
      [slot, index] = pick;
    }

    await client.query(
      `INSERT INTO roster_spots (fantasy_team_id, league_id, athlete_id, position_assigned, slot_index)
       VALUES ($1, $2, $3, $4, $5)`,
      [team.id, league.id, input.athlete_id, slot, index],
    );
    return formatRoster(league, team, await loadSpots(client, league, team.id));
  });
}

export async function dropFromRoster(db: Db, userId: string, leagueId: string, athleteId: string) {
  return withOwnTeam(db, userId, leagueId, async (client, league, team) => {
    const { rowCount } = await client.query(
      'DELETE FROM roster_spots WHERE fantasy_team_id = $1 AND athlete_id = $2', [team.id, athleteId]);
    if (!rowCount) throw new HttpError(404, 'NOT_ON_ROSTER', 'That athlete is not on your roster');
    return formatRoster(league, team, await loadSpots(client, league, team.id));
  });
}

/** Teams in a league, ranked by the season points of their current rosters. */
export async function listTeams(db: Db, userId: string, leagueId: string) {
  const league = await loadLeague(db, leagueId, userId);
  assertCanView(league, userId);
  const { rows } = await db.query<{
    id: string; team_name: string; user_id: string; display_name: string; filled: number; roster_points: string;
  }>(
    `SELECT t.id, t.team_name, t.user_id, u.display_name,
            (SELECT count(*)::int FROM roster_spots rs WHERE rs.fantasy_team_id = t.id) AS filled,
            coalesce((SELECT sum(p.points)
                        FROM roster_spots rs
                        JOIN game_stats gs ON gs.athlete_id = rs.athlete_id
                        JOIN game_stat_fantasy_points p ON p.game_stat_id = gs.id AND p.competition_id = $2
                       WHERE rs.fantasy_team_id = t.id), 0) AS roster_points
       FROM fantasy_teams t JOIN users u ON u.id = t.user_id
      WHERE t.league_id = $1
      ORDER BY roster_points DESC, t.created_at`,
    [league.id, league.competition_id],
  );
  return rows.map((t) => ({
    team_id: encodeId('team', t.id),
    team_name: t.team_name,
    owner_id: encodeId('user', t.user_id),
    owner_name: t.display_name,
    is_mine: t.user_id === userId,
    filled: t.filled,
    roster_size: league.roster_size,
    roster_points: Number(t.roster_points),
  }));
}

/** Athletes in the league's sport not yet rostered by any team in it. */
export async function availableAthletes(db: Db, userId: string, leagueId: string,
  q: Omit<AthleteSearch, 'sport' | 'availableInLeague'>) {
  const league = await loadLeague(db, leagueId, userId);
  if (!isMember(league, userId)) throw notFound('League');
  return searchAthletes(db, { ...q, sport: league.sport_code, availableInLeague: league.id });
}
