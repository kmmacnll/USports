import { type BattleSportConfig, perUnit, ratio, v } from './types.js';

/**
 * Soccer (men's + women's), 7-a-side abstraction of a 90-minute match.
 * Lineup 1 GK, 2 DEF, 2 MID, 2 FWD.
 *
 * Outfield box scores have goals, assists, shots, shots on goal, minutes and
 * cards; there are no tackles or passes, so DEF is a proxy (team goals
 * against in the player's games, minutes trusted) and DIS is discipline.
 */
export interface SoccerSim {
  /** P(the team in possession creates a chance) per simulated minute */
  chanceRate: number;
  /** base P(goal | chance) between equal players */
  goalBase: number;
  /** P(chance is on target) baseline */
  onTargetBase: number;
  sensitivity: number;
  possessionSensitivity: number;
  foulRate: number;
  yellowShare: number;
  goldenGoalMinutes: number;
  penaltyBase: number;
}

const per90 = (key: string, lower = false) => perUnit(key, 'minutes', 90, lower);

const outfieldSubs = {
  ATT: { label: 'Attacking', metrics: { goals_per90: 0.6, shots_per90: 0.4 } },
  FIN: { label: 'Finishing', metrics: { goals_per_sog: 0.5, sog_pct: 0.5 } },
  PAS: { label: 'Passing / creation', metrics: { assists_per90: 1 } },
  DEF: { label: 'Defending (proxy: team GA, minutes)', metrics: { team_ga_pg: 0.7, minutes_pg: 0.3 } },
  DIS: { label: 'Discipline', metrics: { cards_per90: 0.6, minutes_pg: 0.4 } },
};

export const soccer: BattleSportConfig<SoccerSim> = {
  sport: 'soccer',
  name: 'Soccer',
  sportCodes: { MEN: 'usports_msoc', WOMEN: 'usports_wsoc' },
  lineup: [
    { slot: 'GK', position: 'GK', count: 1, label: 'Goalkeeper' },
    { slot: 'DEF', position: 'DEF', count: 2, label: 'Defender' },
    { slot: 'MID', position: 'MID', count: 2, label: 'Midfielder' },
    { slot: 'FWD', position: 'FWD', count: 2, label: 'Forward' },
  ],
  positionMap: { GK: 'GK', G: 'GK', D: 'DEF', DEF: 'DEF', M: 'MID', MID: 'MID', F: 'FWD', FWD: 'FWD' },
  inferPosition: (t) => {
    if (v(t, 'saves') > 0 || v(t, 'goals_against') > 0 || v(t, 'shots_on_goal_against') > 0) return 'GK';
    const min = v(t, 'minutes') || v(t, 'games') * 70;
    const p90 = (k: string) => (min > 0 ? (v(t, k) * 90) / min : 0);
    if (p90('shots') >= 2 || p90('goals') >= 0.35) return 'FWD';
    if (p90('assists') >= 0.2 || p90('shots') >= 0.8) return 'MID';
    return 'DEF';
  },
  metrics: {
    goals_per90: per90('goals'),
    shots_per90: per90('shots'),
    goals_per_sog: ratio((t) => v(t, 'goals'), (t) => v(t, 'shots_on_goal')),
    sog_pct: ratio((t) => v(t, 'shots_on_goal'), (t) => v(t, 'shots')),
    assists_per90: per90('assists'),
    team_ga_pg: ratio((t) => v(t, '_team_against'), (t) => v(t, '_scored_games'), true),
    minutes_pg: ratio((t) => v(t, 'minutes'), (t) => v(t, 'games')),
    cards_per90: ratio((t) => (v(t, 'yellow_cards') + 2 * v(t, 'red_cards')) * 90,
      (t) => v(t, 'minutes') || v(t, 'games') * 70, true),
    // keepers
    save_pct: ratio((t) => v(t, 'saves'), (t) => v(t, 'saves') + v(t, 'goals_against')),
    ga_per90: ratio((t) => v(t, 'goals_against') * 90, (t) => v(t, 'minutes') || v(t, 'games') * 90, true),
    saves_per90: per90('saves'),
  },
  positions: {
    GK: {
      label: 'Goalkeeper',
      subRatings: {
        REF: { label: 'Reflexes (save %)', metrics: { save_pct: 1 } },
        POS: { label: 'Positioning (GA/90)', metrics: { ga_per90: 0.7, team_ga_pg: 0.3 } },
        HND: { label: 'Handling (saves/90)', metrics: { saves_per90: 0.6, save_pct: 0.4 } },
        STA: { label: 'Stamina (minutes)', metrics: { minutes_pg: 1 } },
      },
      ovrWeights: { REF: 0.45, POS: 0.3, HND: 0.15, STA: 0.1 },
    },
    DEF: { label: 'Defender', subRatings: outfieldSubs, ovrWeights: { DEF: 0.5, PAS: 0.15, DIS: 0.2, ATT: 0.1, FIN: 0.05 } },
    MID: { label: 'Midfielder', subRatings: outfieldSubs, ovrWeights: { PAS: 0.35, ATT: 0.2, FIN: 0.15, DEF: 0.15, DIS: 0.15 } },
    FWD: { label: 'Forward', subRatings: outfieldSubs, ovrWeights: { ATT: 0.4, FIN: 0.35, PAS: 0.15, DEF: 0.05, DIS: 0.05 } },
  },
  ratings: { k: 7 },
  sim: {
    chanceRate: 0.11,
    goalBase: 0.24,
    onTargetBase: 0.45,
    sensitivity: 0.03,
    possessionSensitivity: 0.025,
    foulRate: 0.035,
    yellowShare: 0.25,
    goldenGoalMinutes: 20,
    penaltyBase: 0.74,
  },
  timing: { regulationMs: 150_000, overtimeMs: 50_000 },
  periods: ['1H', '2H'],
};
