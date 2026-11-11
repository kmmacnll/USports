import type { Db } from '../db.js';
import { HttpError } from '../errors.js';
import { encodeId } from '../ids.js';

export async function getMe(db: Db, userId: string) {
  const { rows } = await db.query<{
    id: string; display_name: string; avatar_data_url: string | null; university_slug: string | null; university_name: string | null;
  }>(
    `SELECT u.id, u.display_name, u.avatar_data_url, un.slug AS university_slug, un.name AS university_name
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
    avatar_url: u.avatar_data_url,
    university: u.university_slug ? { university_id: u.university_slug, name: u.university_name } : null,
    teams: teams.map((t) => ({
      team_id: encodeId('team', t.id), team_name: t.team_name,
      league_id: encodeId('league', t.league_id), league_name: t.league_name, sport: t.sport,
    })),
  };
}

/** Profile settings. `avatar_data_url: null` removes the picture; leaving a field out keeps it. */
export async function updateMe(db: Db, userId: string, patch: { display_name?: string; avatar_data_url?: string | null }) {
  const sets: string[] = [];
  const args: unknown[] = [userId];
  if (patch.display_name !== undefined) { args.push(patch.display_name); sets.push(`display_name = $${args.length}`); }
  if (patch.avatar_data_url !== undefined) { args.push(patch.avatar_data_url); sets.push(`avatar_data_url = $${args.length}`); }
  if (sets.length) await db.query(`UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, args);
  return getMe(db, userId);
}
