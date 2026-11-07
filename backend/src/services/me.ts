import type { Db } from '../db.js';
import { HttpError } from '../errors.js';
import { encodeId } from '../ids.js';

export async function getMe(db: Db, userId: string) {
  const { rows } = await db.query<{
    id: string; display_name: string; university_slug: string | null; university_name: string | null;
  }>(
    `SELECT u.id, u.display_name, un.slug AS university_slug, un.name AS university_name
       FROM users u LEFT JOIN universities un ON un.id = u.university_id
      WHERE u.id = $1`,
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
    university: u.university_slug ? { university_id: u.university_slug, name: u.university_name } : null,
    teams: teams.map((t) => ({
      team_id: encodeId('team', t.id), team_name: t.team_name,
      league_id: encodeId('league', t.league_id), league_name: t.league_name, sport: t.sport,
    })),
  };
}
