// Response shapes of the VarsityHQ API (backend/README.md).

export interface StatColumn { key: string; label: string }

export interface Sport {
  sport_id: string;
  sport_name: string;
  gender: string;
  season_type: 'FALL' | 'WINTER' | 'SPRING';
  is_active: boolean;
  season: string | null;
  ruleset_id: string | null;
  ruleset_name: string | null;
  roster_positions: string[] | null;
  roster_limits: Record<string, number> | null;
  position_eligibility: Record<string, string[]> | null;
  scoring_rules: Record<string, number | Record<string, number>> | null;
  stat_columns: { season: StatColumn[]; game: StatColumn[] };
}

export interface AthleteStats {
  games_played: number;
  fantasy_points_avg: number | null;
  fantasy_points_total: number;
  [key: string]: number | null;
}

export interface Athlete {
  athlete_id: string;
  first_name: string;
  last_name: string;
  university: string;
  university_id: string;
  conference: string | null;
  sport: string;
  position: string | null;
  positions: string[];
  jersey_number: string | null;
  height: string | null;
  class_year: string | null;
  status: string;
  stats: AthleteStats;
}

export interface GameLogEntry {
  date: string;
  game_id: string;
  opponent: string;
  home: boolean;
  result: string | null;
  exhibition: boolean;
  playoff: boolean;
  stats: Record<string, number>;
  fantasy_points: number | null;
}

export interface AthleteDetail extends Athlete {
  season: string;
  games: GameLogEntry[];
}

export interface Paginated<T> {
  season?: string;
  data: T[];
  pagination: { page: number; page_size: number; total: number };
}

export interface University { university_id: string; name: string; conference: string | null }

export interface Game {
  game_id: string;
  date: string;
  status: string;
  exhibition: boolean;
  playoff: boolean;
  conference_game: boolean;
  home: { university_id: string; name: string; score: number | null };
  away: { university_id: string; name: string; score: number | null };
}

export interface Me {
  user_id: string;
  display_name: string;
  terms: { current_version: string | null; accepted_version: string | null; needs_acceptance: boolean };
  is_usports_athlete: boolean | null;
  athlete_sports: string[];
  teams: { team_id: string; team_name: string; league_id: string; league_name: string; sport: string }[];
}

export interface League {
  league_id: string;
  league_name: string;
  commissioner_id: string;
  max_teams: number;
  team_count: number;
  sport: string;
  season: string;
  ruleset_id: string;
  ruleset_name: string;
  roster_size: number;
  roster_limits: Record<string, number>;
  position_eligibility: Record<string, string[]>;
  status: string;
  is_private: boolean;
  invite_code?: string;
  my_team_id: string | null;
}

export interface LeagueTeam {
  team_id: string;
  team_name: string;
  owner_id: string;
  owner_name: string;
  is_mine: boolean;
  filled: number;
  roster_size: number;
  roster_points: number;
}

export interface RosterAthlete {
  athlete_id: string;
  first_name: string;
  last_name: string;
  university: string;
  position: string | null;
  positions: string[];
  status: string;
  games_played: number;
  season_fantasy_points: number;
}

export interface RosterSlot {
  slot: string;
  slot_index: number;
  slot_type: 'STARTER' | 'BENCH' | 'INJURED_RESERVE';
  athlete: RosterAthlete | null;
}

export interface Roster {
  league_id: string;
  team: { team_id: string; team_name: string; owner_id: string };
  roster_size: number;
  filled: number;
  slots: RosterSlot[];
}

export interface ApiErrorBody { code: string; message: string; details?: unknown }

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: ApiErrorBody };
