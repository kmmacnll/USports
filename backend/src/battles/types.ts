/**
 * Shared Draft Battles match schema. The frontend is designed against
 * MatchEvent / MatchResult exactly as written here: do not rename fields.
 */
import type { BattleSport } from './sports/types.js';

export type MatchEventType =
  | 'goal' | 'point' | 'shot' | 'save' | 'turnover' | 'foul' | 'penalty' | 'sub'
  | 'period_start' | 'period_end' | 'ot_start' | 'final' | 'highlight';

export type Side = 'A' | 'B';

export interface MatchEvent {
  /** ms from match start */
  t: number;
  /** "P1", "Q3", "SET2", "1H", "OT" */
  period: string;
  /** in-game clock display, e.g. "12:41" */
  clock: string;
  type: MatchEventType;
  side: Side | null;
  playerIds: string[];
  /** broadcast-style line, e.g. "Okafor rips one top shelf! 2-1 Gaels." */
  text: string;
  scoreA: number;
  scoreB: number;
  /** -1..1 for a momentum bar (positive favours A) */
  momentum: number;
}

export interface MatchResult {
  matchId: string;
  sport: BattleSport;
  seed: number;
  events: MatchEvent[];
  finalScoreA: number;
  finalScoreB: number;
  winner: Side;
  wentToOT: boolean;
  durationMs: number;
}

/** A drafted player as the simulation sees them. */
export interface SimPlayer {
  id: string;
  /** broadcast name, usually the last name: "Okafor" */
  name: string;
  /** battle position (F, D, G, QB, OH ...) */
  position: string;
  slot: string;
  ovr: number;
  sub: Record<string, number>;
}

export interface Lineup {
  /** team name used in the play-by-play ("Gaels", "Kieran's squad") */
  name: string;
  players: SimPlayer[];
}
