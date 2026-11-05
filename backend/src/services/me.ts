import { type Db, withTransaction } from '../db.js';
import { HttpError } from '../errors.js';
import { encodeId } from '../ids.js';

export async function getMe(db: Db, userId: string) {
  const { rows } = await db.query<{
    id: string; display_name: string; terms_version_accepted: string | null; terms_accepted_at: Date | null;
    is_usports_athlete: boolean | null; current_terms: string | null; athlete_sports: string[];
  }>(
    `SELECT u.id, u.display_name, u.terms_version_accepted, u.terms_accepted_at, u.is_usports_athlete,
            (SELECT version FROM terms_versions WHERE is_current) AS current_terms,
            coalesce(array(SELECT s.code FROM user_athlete_declarations d JOIN sports s ON s.id = d.sport_id
                            WHERE d.user_id = u.id ORDER BY s.code), '{}') AS athlete_sports
       FROM users u WHERE u.id = $1`,
    [userId],
  );
  const u = rows[0];
  if (!u) throw new HttpError(404, 'NOT_FOUND', 'User not found');
  const { rows: teams } = await db.query<{ id: string; league_id: string; team_name: string; league_name: string; sport: string }>(
    `SELECT t.id, t.league_id, t.team_name, l.name AS league_name, s.code AS sport
       FROM fantasy_teams t JOIN leagues l ON l.id = t.league_id
       JOIN competitions c ON c.id = l.competition_id JOIN sports s ON s.id = c.sport_id
      WHERE t.user_id = $1 ORDER BY t.created_at`,
    [userId],
  );
  return {
    user_id: encodeId('user', u.id),
    display_name: u.display_name,
    terms: {
      current_version: u.current_terms,
      accepted_version: u.terms_version_accepted,
      accepted_at: u.terms_accepted_at,
      needs_acceptance: u.current_terms !== null && u.terms_version_accepted !== u.current_terms,
    },
    is_usports_athlete: u.is_usports_athlete,
    athlete_sports: u.athlete_sports,
    teams: teams.map((t) => ({
      team_id: encodeId('team', t.id), team_name: t.team_name,
      league_id: encodeId('league', t.league_id), league_name: t.league_name, sport: t.sport,
    })),
  };
}

export interface AcceptTerms {
  terms_version: string;
  is_usports_athlete: boolean;
  athlete_sports: string[];
}

/**
 * Accept the current Terms & Conditions and answer the athlete question.
 * Declarations are additive: a user cannot remove a declared sport
 * themselves (that would let an athlete un-declare to join their own sport).
 */
export async function acceptTerms(db: Db, userId: string, input: AcceptTerms) {
  if (input.is_usports_athlete && input.athlete_sports.length === 0) {
    throw new HttpError(422, 'ATHLETE_SPORTS_REQUIRED', 'Declare at least one sport you compete in');
  }
  if (!input.is_usports_athlete && input.athlete_sports.length > 0) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'athlete_sports must be empty when is_usports_athlete is false');
  }
  await withTransaction(db, async (client) => {
    const { rows } = await client.query<{ version: string }>('SELECT version FROM terms_versions WHERE is_current');
    const current = rows[0]?.version;
    if (!current || current !== input.terms_version) {
      throw new HttpError(409, 'TERMS_VERSION_MISMATCH', `The current terms version is ${current ?? 'unset'}`,
        { current_version: current ?? null });
    }
    const { rows: declared } = await client.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM user_athlete_declarations WHERE user_id = $1', [userId]);
    if (!input.is_usports_athlete && (declared[0]?.n ?? 0) > 0) {
      throw new HttpError(409, 'ATHLETE_DECLARATION_LOCKED',
        'You have declared U Sports sports already; contact support to change a declaration');
    }

    const { rows: sports } = await client.query<{ id: number; code: string }>(
      'SELECT id, code FROM sports WHERE code = ANY($1)', [input.athlete_sports]);
    const unknown = input.athlete_sports.filter((c) => !sports.some((s) => s.code === c));
    if (unknown.length) throw new HttpError(422, 'UNKNOWN_SPORT', `Unknown sport(s): ${unknown.join(', ')}`);

    await client.query(
      `UPDATE users SET terms_version_accepted = $2, terms_accepted_at = now(),
                        is_usports_athlete = $3 OR EXISTS (SELECT 1 FROM user_athlete_declarations WHERE user_id = $1)
        WHERE id = $1`,
      [userId, current, input.is_usports_athlete],
    );
    for (const s of sports) {
      // The declarations trigger rejects a sport the user still has leagues in.
      await client.query(
        `INSERT INTO user_athlete_declarations (user_id, sport_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, s.id]);
    }
  });
  return getMe(db, userId);
}
