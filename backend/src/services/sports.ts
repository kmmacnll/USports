import type { Queryable } from '../db.js';
import { HttpError } from '../errors.js';
import { expandPositions, orderedLimits, statColumns } from '../sport-display.js';

/** Flat {"points":1} or grouped {"passing":{"yards":0.04}} (scored as passing_yards). */
export type ScoringRules = Record<string, number | Record<string, number>>;

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
  season_type: string;
  is_active: boolean;
  competition_id: string | null;
  ruleset_id: string | null;
  ruleset_name: string | null;
  season: string | null;
  roster_config_json: RosterConfig | null;
  scoring_rules_json: ScoringRules | null;
}

const SPORT_SQL = `
  SELECT s.id, s.code, s.name, s.gender, s.season_type::text AS season_type, s.is_active,
         c.id AS competition_id, c.code AS ruleset_id, c.name AS ruleset_name, c.season, c.roster_config_json, c.scoring_rules_json
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
    season_type: r.season_type,
    is_active: r.is_active,
    season: r.season,
    ruleset_id: r.ruleset_id,
    ruleset_name: r.ruleset_name,
    roster_positions: cfg ? expandPositions(cfg.roster_limits, cfg.slot_order) : null,
    roster_limits: cfg ? orderedLimits(cfg.roster_limits, cfg.slot_order) : null,
    position_eligibility: cfg?.position_eligibility ?? null,
    scoring_rules: r.scoring_rules_json,
    stat_columns: statColumns(r.code),
  };
}

export interface SportFilter {
  includeInactive?: boolean;
  sportId?: string;
  seasonType?: string;
}

export async function listSports(db: Queryable, f: SportFilter = {}) {
  const { rows } = await db.query<SportRow>(
    `${SPORT_SQL}
      WHERE (s.is_active OR $1)
        AND ($2::text IS NULL OR s.code = $2)
        AND ($3::text IS NULL OR s.season_type::text = $3)
      ORDER BY s.name`,
    [f.includeInactive ?? false, f.sportId ?? null, f.seasonType ?? null],
  );
  if (f.sportId && rows.length === 0) throw new HttpError(404, 'UNKNOWN_SPORT', `Unknown sport '${f.sportId}'`);
  return rows.map(formatSport);
}

export async function getSport(db: Queryable, code: string) {
  const { rows } = await db.query<SportRow>(`${SPORT_SQL} WHERE s.code = $1`, [code]);
  const row = rows[0];
  if (!row) throw new HttpError(404, 'UNKNOWN_SPORT', `Unknown sport '${code}'`);
  return { row, sport: formatSport(row) };
}
