import { type BattleSportConfig, perGame, rate, ratio, v } from './types.js';

/**
 * Canadian football (men's): 3 downs, 110-yard field, 4 x 15-minute quarters.
 * Lineup QB, RB, WR, WR, DEF1, DEF2. Kickers and linemen are not battle
 * positions (inferPosition returns null), so they are not rated.
 */
export interface FootballSim {
  playSecondsMin: number;
  playSecondsMax: number;
  passShare: number;
  completionBase: number;
  passYardsMean: number;
  rushYardsMean: number;
  sackBase: number;
  intBase: number;
  fumbleBase: number;
  bigPlayBase: number;
  fieldGoalRange: number;
  sensitivity: number;
}

export const football: BattleSportConfig<FootballSim> = {
  sport: 'football',
  name: 'Football',
  sportCodes: { MEN: 'usports_fb' },
  lineup: [
    { slot: 'QB', position: 'QB', count: 1, label: 'Quarterback' },
    { slot: 'RB', position: 'RB', count: 1, label: 'Running back' },
    { slot: 'WR', position: 'WR', count: 2, label: 'Receiver' },
    { slot: 'DEF', position: 'DEF', count: 2, label: 'Defender' },
  ],
  positionMap: {
    QB: 'QB', RB: 'RB', FB: 'RB', HB: 'RB', WR: 'WR', SB: 'WR', TE: 'WR', REC: 'WR',
    LB: 'DEF', DB: 'DEF', CB: 'DEF', S: 'DEF', DL: 'DEF', DE: 'DEF', DT: 'DEF', LINEBACKER: 'DEF', SAFETY: 'DEF',
  },
  inferPosition: (t) => {
    if (rate(t, 'passing_attempts') >= 5) return 'QB';
    const rush = rate(t, 'rushing_attempts');
    const rec = rate(t, 'receiving_receptions');
    if (rush >= 3 && rush >= rec) return 'RB';
    if (rec >= 1) return 'WR';
    if (v(t, 'defence_tackles') + v(t, 'defence_sacks') + v(t, 'defence_interceptions') > 0) return 'DEF';
    return null;
  },
  metrics: {
    comp_pct: ratio((t) => v(t, 'passing_completions'), (t) => v(t, 'passing_attempts')),
    yds_per_att: ratio((t) => v(t, 'passing_yards'), (t) => v(t, 'passing_attempts')),
    td_int: ratio((t) => v(t, 'passing_touchdown') - 1.5 * v(t, 'passing_interception'), (t) => v(t, 'passing_attempts')),
    pass_ypg: perGame('passing_yards'),
    rush_ypg: perGame('rushing_yards'),
    yds_per_carry: ratio((t) => v(t, 'rushing_yards'), (t) => v(t, 'rushing_attempts')),
    rush_td_pg: perGame('rushing_touchdown'),
    fumbles_pg: perGame('misc_fumble_lost', true),
    rec_pg: perGame('receiving_receptions'),
    rec_ypg: perGame('receiving_yards'),
    yds_per_rec: ratio((t) => v(t, 'receiving_yards'), (t) => v(t, 'receiving_receptions')),
    rec_td_pg: perGame('receiving_touchdown'),
    tackles_pg: perGame('defence_tackles'),
    pressure_pg: ratio((t) => v(t, 'defence_sacks') + 0.5 * v(t, 'defence_tackles_for_loss'), (t) => v(t, 'games')),
    coverage_pg: ratio((t) => 2 * v(t, 'defence_interceptions') + v(t, 'defence_passes_defended'), (t) => v(t, 'games')),
    takeaways_pg: ratio((t) => v(t, 'defence_forced_fumbles') + v(t, 'defence_fumble_recoveries') + v(t, 'defence_interceptions'),
      (t) => v(t, 'games')),
    team_pa_pg: ratio((t) => v(t, '_team_against'), (t) => v(t, '_scored_games'), true),
  },
  positions: {
    QB: {
      label: 'Quarterback',
      subRatings: {
        ACC: { label: 'Accuracy', metrics: { comp_pct: 1 } },
        ARM: { label: 'Arm', metrics: { yds_per_att: 0.6, pass_ypg: 0.4 } },
        DEC: { label: 'Decisions (TD/INT)', metrics: { td_int: 1 } },
        MOB: { label: 'Mobility', metrics: { rush_ypg: 1 } },
      },
      ovrWeights: { ACC: 0.3, ARM: 0.3, DEC: 0.3, MOB: 0.1 },
    },
    RB: {
      label: 'Running back',
      subRatings: {
        RSH: { label: 'Rushing', metrics: { rush_ypg: 1 } },
        ELU: { label: 'Elusiveness (yds/carry)', metrics: { yds_per_carry: 1 } },
        POW: { label: 'Power (rush TDs)', metrics: { rush_td_pg: 1 } },
        REC: { label: 'Receiving', metrics: { rec_pg: 0.5, rec_ypg: 0.5 } },
        BAL: { label: 'Ball security', metrics: { fumbles_pg: 1 } },
      },
      ovrWeights: { RSH: 0.35, ELU: 0.25, POW: 0.2, REC: 0.12, BAL: 0.08 },
    },
    WR: {
      label: 'Receiver',
      subRatings: {
        CAT: { label: 'Catching', metrics: { rec_pg: 1 } },
        SPD: { label: 'Speed (yds/catch)', metrics: { yds_per_rec: 1 } },
        PRD: { label: 'Production', metrics: { rec_ypg: 1 } },
        RZN: { label: 'Red zone', metrics: { rec_td_pg: 1 } },
      },
      ovrWeights: { CAT: 0.25, SPD: 0.2, PRD: 0.35, RZN: 0.2 },
    },
    DEF: {
      label: 'Defender',
      subRatings: {
        TKL: { label: 'Tackling', metrics: { tackles_pg: 1 } },
        PRS: { label: 'Pass rush', metrics: { pressure_pg: 1 } },
        COV: { label: 'Coverage', metrics: { coverage_pg: 0.8, team_pa_pg: 0.2 } },
        TAK: { label: 'Takeaways', metrics: { takeaways_pg: 1 } },
      },
      ovrWeights: { TKL: 0.35, PRS: 0.25, COV: 0.25, TAK: 0.15 },
    },
  },
  ratings: { k: 6 },
  sim: {
    playSecondsMin: 22,
    playSecondsMax: 40,
    passShare: 0.56,
    completionBase: 0.63,
    passYardsMean: 14,
    rushYardsMean: 5.8,
    sackBase: 0.05,
    intBase: 0.03,
    fumbleBase: 0.012,
    bigPlayBase: 0.075,
    fieldGoalRange: 47,
    sensitivity: 0.0066,
  },
  timing: { regulationMs: 160_000, overtimeMs: 45_000 },
  periods: ['Q1', 'Q2', 'Q3', 'Q4'],
};
