/**
 * Draft Battles settings that are NOT sport-specific. Sport-specific values
 * live in src/battles/sports/<sport>.ts.
 */
export const BATTLES = {
  ratings: {
    /** Earliest season used anywhere (matches pipeline seasons.MIN_SEASON). */
    minSeason: '2025-26',
    /** Recency weights, newest season first: current 0.65, previous 0.35. Older seasons get 0. */
    seasonWeights: [0.65, 0.35],
    /** OVR / sub-rating for a player with no qualifying games (flagged NEW). */
    baselineOvr: 60,
    /** Percentile -> rating curve (piecewise linear): floor 40, median 68, top 10% >= 80, top 1% >= 88. */
    calibration: [[0, 40], [0.5, 68], [0.9, 80], [0.99, 88], [1, 99]] as Array<[number, number]>,
    min: 40,
    max: 99,
    /** Recompute when stat lines changed since the last run; check this often. */
    recomputeCheckMs: 15 * 60_000,
  },
  draft: {
    pickSeconds: 20,
    /** AI "thinking" delay before its pick. */
    aiPickDelayMs: 1_200,
  },
  match: {
    /** Gap between the last pick and the first event, so both clients switch screens. */
    startLeadMs: 3_000,
  },
  invites: {
    onlineTtlSeconds: 60,
    offlineTtlSeconds: 24 * 3600,
  },
  queue: {
    /** Widen to adjacent divisions after this wait, then to anyone. */
    adjacentAfterSeconds: 20,
    anyoneAfterSeconds: 40,
    defaultEstimateSeconds: 30,
  },
  elo: {
    start: 1000,
    provisionalMatches: 10,
    kProvisional: 40,
    k: 24,
  },
  ladder: {
    /** Lowest to highest. */
    divisions: ['WALK_ON', 'BENCH', 'STARTER', 'VARSITY', 'ALL_STAR', 'CAPTAIN', 'HALL_OF_FAME'] as const,
    divisionNames: { WALK_ON: 'Walk-On', BENCH: 'Bench', STARTER: 'Starter', VARSITY: 'Varsity', ALL_STAR: 'All-Star',
      CAPTAIN: 'Captain', HALL_OF_FAME: 'Hall of Fame' } as Record<string, string>,
    cohortSize: 30,
    promote: 5,
    relegate: 5,
    timeZone: 'America/Toronto',
  },
} as const;
