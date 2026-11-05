import type { Queryable } from '../db.js';
import { HttpError } from '../errors.js';
import { expandPositions, orderedLimits } from '../sport-display.js';

export interface RosterConfig {
  slot_order?: string[];
  roster_limits: Record<string, number>;
  position_eligibility?: Record<string, string[]>;
}

interface SportRow {
  id: number;
  code: string;
  name: string;
  gender: string;
  is_active: boolean;
  competition_id: string | null;
  season: string | null;
  roster_config_json: RosterConfig | null;
  scoring_rules_json: Record<string, number> | null;
}

const SPORT_SQL = `
  SELECT s.id, s.code, s.name, s.gender, s.is_active,
         c.id AS competition_id, c.season, c.roster_config_json, c.scoring_rules_json
    FROM sports s
    LEFT JOIN LATERAL (
      SELECT * FROM competitions c
       WHERE c.sport_id = s.id AND c.is_default
       ORDER BY c.season DESC LIMIT 1
    ) c ON TRUE`;

function formatSport(r: SportRow) {
  const cfg = r.roster_config_json;
  return {
    sport_id: r.code,
    sport_name: r.name,
    gender: r.gender,
    is_active: r.is_active,
    season: r.season,
    roster_positions: cfg ? expandPositions(cfg.roster_limits, cfg.slot_order) : null,
    roster_limits: cfg ? orderedLimits(cfg.roster_limits, cfg.slot_order) : null,
    scoring_rules: r.scoring_rules_json,
  };
}

export async function listSports(db: Queryable, includeInactive: boolean) {
  const { rows } = await db.query<SportRow>(`${SPORT_SQL} WHERE s.is_active OR $1 ORDER BY s.name`, [includeInactive]);
  return rows.map(formatSport);
}

export async function getSport(db: Queryable, code: string) {
  const { rows } = await db.query<SportRow>(`${SPORT_SQL} WHERE s.code = $1`, [code]);
  const row = rows[0];
  if (!row) throw new HttpError(404, 'UNKNOWN_SPORT', `Unknown sport '${code}'`);
  return { row, sport: formatSport(row) };
}
