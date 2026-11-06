import { type BattleSportConfig, perGame, rate, ratio, v } from './types.js';

/**
 * Ice hockey (men's + women's). Lineup 3 F, 2 D, 1 G.
 *
 * Box scores give goals, assists, shots, +/-, PIM, faceoffs and goalie
 * saves / goals allowed / shots against / minutes. There is no skating or
 * hitting data, so SKT and PHY are proxies (documented per sub-rating).
 */
export interface HockeySim {
  /** game-time seconds per simulated tick */
  tickSeconds: number;
  /** P(a team generates a shot attempt | it has the puck this tick) */
  shotRate: number;
  /** base P(goal | shot on net) between equal players */
  goalBase: number;
  /** logistic slope per rating point (shooter vs goalie/defence) */
  sensitivity: number;
  /** logistic slope for puck possession (team control) */
  possessionSensitivity: number;
  /** P(penalty) per team per tick */
  penaltyRate: number;
  /** multiplier on shot rate / goal chance on the power play */
  powerPlayShotBoost: number;
  powerPlayGoalBoost: number;
  /** OT: 3v3 sudden death length (game seconds) and shot boost */
  otSeconds: number;
  otShotBoost: number;
  /** shootout: base P(goal) per attempt */
  shootoutBase: number;
}

export const hockey: BattleSportConfig<HockeySim> = {
  sport: 'hockey',
  name: 'Hockey',
  sportCodes: { MEN: 'usports_mhk', WOMEN: 'usports_whk' },
  lineup: [
    { slot: 'F', position: 'F', count: 3, label: 'Forward' },
    { slot: 'D', position: 'D', count: 2, label: 'Defence' },
    { slot: 'G', position: 'G', count: 1, label: 'Goalie' },
  ],
  positionMap: { F: 'F', C: 'F', LW: 'F', RW: 'F', W: 'F', D: 'D', LD: 'D', RD: 'D', G: 'G' },
  inferPosition: (t) => {
    if (v(t, 'saves') > 0 || v(t, 'shots_against') > 0 || v(t, 'goals_allowed') > 0) return 'G';
    if (rate(t, 'faceoffs_total') >= 1.5) return 'F';
    const pts = v(t, 'goals') + v(t, 'assists');
    // Defencemen score a small share of their points as goals.
    if (pts >= 3 && v(t, 'goals') / pts < 0.25) return 'D';
    return 'F';
  },
  metrics: {
    goals_pg: perGame('goals'),
    assists_pg: perGame('assists'),
    points_pg: ratio((t) => v(t, 'goals') + v(t, 'assists'), (t) => v(t, 'games')),
    shots_pg: perGame('shots'),
    shooting_pct: ratio((t) => v(t, 'goals'), (t) => v(t, 'shots')),
    plus_minus_pg: perGame('plus_minus'),
    pim_pg: perGame('penalty_minutes'),
    faceoff_pct: ratio((t) => v(t, 'faceoffs_won'), (t) => v(t, 'faceoffs_total')),
    team_ga_pg: ratio((t) => v(t, '_team_against'), (t) => v(t, '_scored_games'), true),
    // goalies
    save_pct: ratio((t) => v(t, 'saves'), (t) => v(t, 'shots_against') || v(t, 'saves') + v(t, 'goals_allowed')),
    gaa: ratio((t) => v(t, 'goals_allowed') * 60, (t) => v(t, 'minutes') || v(t, 'games') * 60, true),
    saves_per60: ratio((t) => v(t, 'saves') * 60, (t) => v(t, 'minutes') || v(t, 'games') * 60),
    minutes_pg: ratio((t) => v(t, 'minutes') || v(t, 'games') * 60, (t) => v(t, 'games')),
  },
  positions: {
    F: {
      label: 'Forward',
      subRatings: {
        SHT: { label: 'Shooting', metrics: { goals_pg: 0.5, shots_pg: 0.3, shooting_pct: 0.2 } },
        PAS: { label: 'Passing', metrics: { assists_pg: 0.8, points_pg: 0.2 } },
        SKT: { label: 'Skating (proxy: involvement, +/-, faceoffs)', metrics: { points_pg: 0.4, plus_minus_pg: 0.4, faceoff_pct: 0.2 } },
        DEF: { label: 'Defence (proxy: +/-, team GA)', metrics: { plus_minus_pg: 0.5, team_ga_pg: 0.5 } },
        PHY: { label: 'Physical (proxy: PIM, shot volume)', metrics: { pim_pg: 0.5, shots_pg: 0.3, plus_minus_pg: 0.2 } },
      },
      ovrWeights: { SHT: 0.32, PAS: 0.26, SKT: 0.18, DEF: 0.12, PHY: 0.12 },
    },
    D: {
      label: 'Defence',
      subRatings: {
        SHT: { label: 'Shooting', metrics: { shots_pg: 0.5, goals_pg: 0.5 } },
        PAS: { label: 'Passing', metrics: { assists_pg: 0.8, points_pg: 0.2 } },
        SKT: { label: 'Skating (proxy: involvement, +/-)', metrics: { points_pg: 0.5, plus_minus_pg: 0.5 } },
        DEF: { label: 'Defence (proxy: +/-, team GA)', metrics: { plus_minus_pg: 0.45, team_ga_pg: 0.55 } },
        PHY: { label: 'Physical (proxy: PIM)', metrics: { pim_pg: 0.7, plus_minus_pg: 0.3 } },
      },
      ovrWeights: { SHT: 0.1, PAS: 0.2, SKT: 0.15, DEF: 0.38, PHY: 0.17 },
    },
    G: {
      label: 'Goalie',
      subRatings: {
        REF: { label: 'Reflexes (save %)', metrics: { save_pct: 1 } },
        POS: { label: 'Positioning (GAA)', metrics: { gaa: 0.7, team_ga_pg: 0.3 } },
        HND: { label: 'Handling (workload)', metrics: { saves_per60: 0.6, save_pct: 0.4 } },
        STA: { label: 'Stamina (minutes)', metrics: { minutes_pg: 1 } },
      },
      ovrWeights: { REF: 0.45, POS: 0.3, HND: 0.15, STA: 0.1 },
    },
  },
  ratings: { k: 8 },
  sim: {
    tickSeconds: 20,
    shotRate: 0.31,
    goalBase: 0.088,
    sensitivity: 0.0235,
    possessionSensitivity: 0.0157,
    penaltyRate: 0.011,
    powerPlayShotBoost: 1.5,
    powerPlayGoalBoost: 1.45,
    otSeconds: 300,
    otShotBoost: 1.8,
    shootoutBase: 0.33,
  },
  timing: { regulationMs: 150_000, overtimeMs: 45_000 },
  periods: ['P1', 'P2', 'P3'],
};
