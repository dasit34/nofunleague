/**
 * League Settings — Canonical domain model.
 *
 * This is the single source of truth for the shape of `leagues.settings` JSONB.
 * Every module that reads or writes league settings imports from here.
 */

import { z } from 'zod';

// =============================================
// Roster Settings
// =============================================

export const FLEX_TYPES = ['RB_WR', 'RB_WR_TE', 'QB_RB_WR_TE'] as const;
export type FlexType = typeof FLEX_TYPES[number];

export interface RosterSettings {
  // Starting slots
  qb_slots: number;
  rb_slots: number;
  wr_slots: number;
  te_slots: number;
  flex_slots: number;
  flex_types: FlexType;
  superflex_slots: number;     // SUPERFLEX: QB/RB/WR/TE eligible
  k_slots: number;
  def_slots: number;
  // Bench & reserve
  bench_slots: number;
  ir_slots: number;
  // Position limits — max rostered (starters + bench + IR) per position. 0 = no limit.
  max_qb: number;
  max_rb: number;
  max_wr: number;
  max_te: number;
  max_k: number;
  max_def: number;
}

export const DEFAULT_ROSTER: RosterSettings = {
  qb_slots: 1,
  rb_slots: 2,
  wr_slots: 2,
  te_slots: 1,
  flex_slots: 1,
  flex_types: 'RB_WR_TE',
  superflex_slots: 0,
  k_slots: 0,
  def_slots: 0,
  bench_slots: 6,
  ir_slots: 0,
  max_qb: 0,
  max_rb: 0,
  max_wr: 0,
  max_te: 0,
  max_k: 0,
  max_def: 0,
};

// =============================================
// Scoring Settings
// =============================================

/**
 * Per-stat scoring multipliers for a fantasy league.
 * Field names match the Sleeper stats response so they can be applied
 * directly to raw stat JSONB from player_stats.stats.
 *
 * `type` selects a preset; individual fields can override any preset value.
 * `source` controls whether scoring uses real stats or mock random values.
 */
export interface ScoringSettings {
  type: 'standard' | 'half_ppr' | 'ppr' | 'custom';
  source: 'mock' | 'real';
  // Passing
  pass_yd: number;         // pts per passing yard  (default 0.04 = 1pt/25yd)
  pass_td: number;         // pts per passing TD     (default 4)
  pass_int: number;        // pts per interception   (default -2)
  pass_2pt: number;        // pts per 2pt conversion (default 2)
  // Rushing
  rush_yd: number;         // pts per rushing yard   (default 0.1 = 1pt/10yd)
  rush_td: number;         // pts per rushing TD     (default 6)
  rush_2pt: number;        // pts per 2pt conversion (default 2)
  // Receiving
  rec: number;             // pts per reception      (0=std, 0.5=half-PPR, 1=PPR)
  rec_yd: number;          // pts per receiving yard (default 0.1)
  rec_td: number;          // pts per receiving TD   (default 6)
  rec_2pt: number;         // pts per 2pt conversion (default 2)
  // General
  fum_lost: number;        // pts per fumble lost    (default -2)
  // Kicking
  fg_0_19: number;         // pts for FG 0-19 yards  (default 3)
  fg_20_29: number;        // pts for FG 20-29 yards (default 3)
  fg_30_39: number;        // pts for FG 30-39 yards (default 3)
  fg_40_49: number;        // pts for FG 40-49 yards (default 4)
  fg_50p: number;          // pts for FG 50+ yards   (default 5)
  xpt: number;             // pts for XP made        (default 1)
  xpt_miss: number;        // pts for missed XP      (default -1)
  // Defense / Special Teams
  def_sack: number;        // pts per sack           (default 1)
  def_int: number;         // pts per INT            (default 2)
  def_fum_rec: number;     // pts per fumble recovery(default 2)
  def_td: number;          // pts per defensive TD   (default 6)
  def_st_td: number;       // pts per ST TD          (default 6)
  def_safe: number;        // pts per safety         (default 2)
  def_blk_kick: number;    // pts per blocked kick   (default 2)
  // Defense: points-allowed tiers
  def_pts_allow_0: number;       // shutout bonus     (default 10)
  def_pts_allow_1_6: number;     // default 7
  def_pts_allow_7_13: number;    // default 4
  def_pts_allow_14_20: number;   // default 1
  def_pts_allow_21_27: number;   // default 0
  def_pts_allow_28_34: number;   // default -1
  def_pts_allow_35p: number;     // default -4
}

/** Base scoring values shared across all presets. */
const BASE_SCORING_VALUES = {
  pass_yd: 0.04, pass_td: 4, pass_int: -2, pass_2pt: 2,
  rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
  rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
  fum_lost: -2,
  fg_0_19: 3, fg_20_29: 3, fg_30_39: 3, fg_40_49: 4, fg_50p: 5,
  xpt: 1, xpt_miss: -1,
  def_sack: 1, def_int: 2, def_fum_rec: 2, def_td: 6, def_st_td: 6, def_safe: 2, def_blk_kick: 2,
  def_pts_allow_0: 10, def_pts_allow_1_6: 7, def_pts_allow_7_13: 4,
  def_pts_allow_14_20: 1, def_pts_allow_21_27: 0, def_pts_allow_28_34: -1, def_pts_allow_35p: -4,
};

/** Get per-stat values for a scoring preset type. */
export function scoringPresetValues(type: string): Omit<ScoringSettings, 'type' | 'source'> {
  switch (type) {
    case 'standard':  return { ...BASE_SCORING_VALUES, rec: 0 };
    case 'ppr':       return { ...BASE_SCORING_VALUES, rec: 1 };
    case 'half_ppr':
    default:          return { ...BASE_SCORING_VALUES, rec: 0.5 };
  }
}

export const DEFAULT_SCORING: ScoringSettings = {
  type: 'half_ppr',
  source: 'mock',
  ...scoringPresetValues('half_ppr'),
};

// =============================================
// Draft Settings
// =============================================

export interface DraftSettings {
  type: 'snake' | 'linear';
  seconds_per_pick: number;
  auto_pick_on_timeout: boolean;
  // total_rounds is derived from roster: starterCount + bench + IR
}

export const DEFAULT_DRAFT: DraftSettings = {
  type: 'snake',
  seconds_per_pick: 90,
  auto_pick_on_timeout: true,
};

// =============================================
// Trade Settings
// =============================================

export interface TradeSettings {
  approval_type: 'commissioner' | 'league_vote' | 'none';
  review_period_hours: number;    // hours after acceptance before trade processes
  trade_deadline_week: number;    // 0 = no deadline
  votes_to_veto: number;         // only used if approval_type = 'league_vote'
  allow_draft_pick_trades: boolean;
}

export const DEFAULT_TRADES: TradeSettings = {
  approval_type: 'commissioner',
  review_period_hours: 24,
  trade_deadline_week: 0,
  votes_to_veto: 4,
  allow_draft_pick_trades: false,
};

// =============================================
// Waiver Settings
// =============================================

export interface WaiverSettings {
  type: 'standard' | 'faab' | 'none';
  waiver_period_days: number;    // days a dropped player is on waivers
  faab_budget: number;           // per-team FAAB budget (only if type = 'faab')
  process_day: 'tuesday' | 'wednesday' | 'daily';
}

export const DEFAULT_WAIVERS: WaiverSettings = {
  type: 'standard',
  waiver_period_days: 2,
  faab_budget: 100,
  process_day: 'wednesday',
};

// =============================================
// Season Settings
// =============================================

export interface SeasonSettings {
  regular_season_weeks: number;
  playoff_start_week: number;    // derived: regular_season_weeks + 1
  schedule_type: 'round_robin' | 'random';
}

export const DEFAULT_SEASON: SeasonSettings = {
  regular_season_weeks: 14,
  playoff_start_week: 15,
  schedule_type: 'round_robin',
};

// =============================================
// Playoff Settings
// =============================================

export interface PlayoffSettings {
  teams: number;                 // number of playoff teams (4, 6, 8)
  weeks_per_round: 1 | 2;       // 1 = single week, 2 = two-week matchups
  reseed: boolean;               // re-seed after each round?
  consolation_bracket: boolean;  // run a consolation bracket for non-playoff teams?
}

export const DEFAULT_PLAYOFFS: PlayoffSettings = {
  teams: 4,
  weeks_per_round: 1,
  reseed: false,
  consolation_bracket: false,
};

// =============================================
// Full League Settings
// =============================================

export interface LeagueSettings {
  roster: RosterSettings;
  scoring: ScoringSettings;
  draft: DraftSettings;
  trades: TradeSettings;
  waivers: WaiverSettings;
  season: SeasonSettings;
  playoffs: PlayoffSettings;
}

export function createDefaultSettings(): LeagueSettings {
  return {
    roster:   { ...DEFAULT_ROSTER },
    scoring:  { ...DEFAULT_SCORING },
    draft:    { ...DEFAULT_DRAFT },
    trades:   { ...DEFAULT_TRADES },
    waivers:  { ...DEFAULT_WAIVERS },
    season:   { ...DEFAULT_SEASON },
    playoffs: { ...DEFAULT_PLAYOFFS },
  };
}

/**
 * Safely merge a partial settings object with defaults.
 * Fills missing sections without overwriting existing values.
 */
export function mergeWithDefaults(partial: Record<string, unknown> | null | undefined): LeagueSettings {
  const defaults = createDefaultSettings();
  if (!partial) return defaults;

  function mergeSection<T>(def: T, raw: unknown): T {
    if (!raw || typeof raw !== 'object') return { ...def };
    const result: Record<string, unknown> = { ...(def as Record<string, unknown>) };
    for (const key of Object.keys(result)) {
      const val = (raw as Record<string, unknown>)[key];
      if (val !== undefined && val !== null) {
        result[key] = val;
      }
    }
    return result as T;
  }

  return {
    roster:   mergeSection<RosterSettings>(DEFAULT_ROSTER, partial.roster),
    scoring:  mergeSection<ScoringSettings>(DEFAULT_SCORING, partial.scoring),
    draft:    mergeSection<DraftSettings>(DEFAULT_DRAFT, partial.draft),
    trades:   mergeSection<TradeSettings>(DEFAULT_TRADES, partial.trades),
    waivers:  mergeSection<WaiverSettings>(DEFAULT_WAIVERS, partial.waivers),
    season:   mergeSection<SeasonSettings>(DEFAULT_SEASON, partial.season),
    playoffs: mergeSection<PlayoffSettings>(DEFAULT_PLAYOFFS, partial.playoffs),
  };
}

// =============================================
// Roster Helpers
// =============================================

export function starterCount(r: RosterSettings): number {
  return r.qb_slots + r.rb_slots + r.wr_slots + r.te_slots
    + r.flex_slots + r.superflex_slots + r.k_slots + r.def_slots;
}

export function totalRosterSize(r: RosterSettings): number {
  return starterCount(r) + r.bench_slots + r.ir_slots;
}

export function draftRounds(r: RosterSettings): number {
  // IR slots are not drafted — draft rounds = starters + bench
  return starterCount(r) + r.bench_slots;
}

// =============================================
// Validation Schemas
// =============================================

export const RosterSettingsSchema = z.object({
  qb_slots:        z.number().int().min(0).max(4),
  rb_slots:        z.number().int().min(0).max(8),
  wr_slots:        z.number().int().min(0).max(8),
  te_slots:        z.number().int().min(0).max(4),
  flex_slots:      z.number().int().min(0).max(4),
  flex_types:      z.enum(FLEX_TYPES),
  superflex_slots: z.number().int().min(0).max(2),
  k_slots:        z.number().int().min(0).max(2),
  def_slots:      z.number().int().min(0).max(2),
  bench_slots:    z.number().int().min(0).max(15),
  ir_slots:       z.number().int().min(0).max(5),
  max_qb:         z.number().int().min(0).max(10),
  max_rb:         z.number().int().min(0).max(10),
  max_wr:         z.number().int().min(0).max(10),
  max_te:         z.number().int().min(0).max(10),
  max_k:          z.number().int().min(0).max(5),
  max_def:        z.number().int().min(0).max(5),
}).refine(
  (data) => {
    // Position limit must be >= starting slots for that position (or 0 = no limit)
    if (data.max_qb > 0 && data.max_qb < data.qb_slots) return false;
    if (data.max_rb > 0 && data.max_rb < data.rb_slots) return false;
    if (data.max_wr > 0 && data.max_wr < data.wr_slots) return false;
    if (data.max_te > 0 && data.max_te < data.te_slots) return false;
    if (data.max_k > 0 && data.max_k < data.k_slots) return false;
    if (data.max_def > 0 && data.max_def < data.def_slots) return false;
    return true;
  },
  { message: 'Position limit cannot be lower than the number of starting slots for that position' }
).refine(
  (data) => {
    // Must have at least 1 starter slot
    const starters = data.qb_slots + data.rb_slots + data.wr_slots + data.te_slots
      + data.flex_slots + data.superflex_slots + data.k_slots + data.def_slots;
    return starters >= 1;
  },
  { message: 'Must have at least 1 starting slot' }
).refine(
  (data) => {
    // Total roster cannot exceed 53 (NFL max)
    const total = data.qb_slots + data.rb_slots + data.wr_slots + data.te_slots
      + data.flex_slots + data.superflex_slots + data.k_slots + data.def_slots
      + data.bench_slots + data.ir_slots;
    return total <= 53;
  },
  { message: 'Total roster size cannot exceed 53' }
);

export const ScoringSettingsSchema = z.object({
  type:   z.enum(['standard', 'half_ppr', 'ppr', 'custom']),
  source: z.enum(['mock', 'real']),
  // Per-stat scoring values — all required with reasonable ranges
  pass_yd: z.number().min(-1).max(1),
  pass_td: z.number().min(-10).max(10),
  pass_int: z.number().min(-10).max(10),
  pass_2pt: z.number().min(-5).max(5),
  rush_yd: z.number().min(-1).max(1),
  rush_td: z.number().min(-10).max(10),
  rush_2pt: z.number().min(-5).max(5),
  rec: z.number().min(-2).max(2),
  rec_yd: z.number().min(-1).max(1),
  rec_td: z.number().min(-10).max(10),
  rec_2pt: z.number().min(-5).max(5),
  fum_lost: z.number().min(-10).max(10),
  fg_0_19: z.number().min(-5).max(10),
  fg_20_29: z.number().min(-5).max(10),
  fg_30_39: z.number().min(-5).max(10),
  fg_40_49: z.number().min(-5).max(10),
  fg_50p: z.number().min(-5).max(10),
  xpt: z.number().min(-5).max(5),
  xpt_miss: z.number().min(-5).max(5),
  def_sack: z.number().min(-5).max(5),
  def_int: z.number().min(-5).max(10),
  def_fum_rec: z.number().min(-5).max(10),
  def_td: z.number().min(-10).max(10),
  def_st_td: z.number().min(-10).max(10),
  def_safe: z.number().min(-5).max(10),
  def_blk_kick: z.number().min(-5).max(10),
  def_pts_allow_0: z.number().min(-10).max(20),
  def_pts_allow_1_6: z.number().min(-10).max(20),
  def_pts_allow_7_13: z.number().min(-10).max(20),
  def_pts_allow_14_20: z.number().min(-10).max(20),
  def_pts_allow_21_27: z.number().min(-10).max(20),
  def_pts_allow_28_34: z.number().min(-10).max(20),
  def_pts_allow_35p: z.number().min(-10).max(20),
});

export const DraftSettingsSchema = z.object({
  type:                  z.enum(['snake', 'linear']),
  seconds_per_pick:      z.number().int().min(30).max(600),
  auto_pick_on_timeout:  z.boolean(),
});

export const TradeSettingsSchema = z.object({
  approval_type:          z.enum(['commissioner', 'league_vote', 'none']),
  review_period_hours:    z.number().int().min(0).max(168),
  trade_deadline_week:    z.number().int().min(0).max(18),
  votes_to_veto:          z.number().int().min(1).max(15),
  allow_draft_pick_trades: z.boolean(),
});

export const WaiverSettingsSchema = z.object({
  type:                z.enum(['standard', 'faab', 'none']),
  waiver_period_days:  z.number().int().min(0).max(7),
  faab_budget:         z.number().int().min(0).max(1000),
  process_day:         z.enum(['tuesday', 'wednesday', 'daily']),
});

export const SeasonSettingsSchema = z.object({
  regular_season_weeks: z.number().int().min(6).max(18),
  playoff_start_week:   z.number().int().min(7).max(19),
  schedule_type:        z.enum(['round_robin', 'random']),
}).refine(
  (data) => data.playoff_start_week === data.regular_season_weeks + 1,
  { message: 'Playoff start week must be regular season weeks + 1' }
);

export const PlayoffSettingsSchema = z.object({
  teams:                z.number().int().refine(v => [0, 2, 4, 6, 8].includes(v), {
    message: 'Playoff teams must be 0, 2, 4, 6, or 8',
  }),
  weeks_per_round:      z.union([z.literal(1), z.literal(2)]),
  reseed:               z.boolean(),
  consolation_bracket:  z.boolean(),
});

/** Validate a single settings section. Returns parsed data or throws ZodError. */
export function validateSection<T>(
  section: 'roster' | 'scoring' | 'draft' | 'trades' | 'waivers' | 'season' | 'playoffs',
  data: unknown,
): T {
  const schemas = {
    roster:   RosterSettingsSchema,
    scoring:  ScoringSettingsSchema,
    draft:    DraftSettingsSchema,
    trades:   TradeSettingsSchema,
    waivers:  WaiverSettingsSchema,
    season:   SeasonSettingsSchema,
    playoffs: PlayoffSettingsSchema,
  };
  return schemas[section].parse(data) as T;
}

// =============================================
// Slot Helpers (used by draft, lineups, etc.)
// =============================================

export function generateSlotNames(r: RosterSettings): string[] {
  const slots: string[] = [];

  const push = (prefix: string, count: number) => {
    for (let i = 1; i <= count; i++) slots.push(count === 1 ? prefix : `${prefix}${i}`);
  };

  push('QB', r.qb_slots);
  push('RB', r.rb_slots);
  push('WR', r.wr_slots);
  push('TE', r.te_slots);
  push('FLEX', r.flex_slots);
  push('SUPERFLEX', r.superflex_slots);
  push('K', r.k_slots);
  push('DEF', r.def_slots);
  push('BN', r.bench_slots);
  push('IR', r.ir_slots);

  return slots;
}

export function allowedPositionsForSlot(slotName: string, flexTypes: FlexType): string[] {
  const base = slotName.replace(/\d+$/, '');
  switch (base) {
    case 'QB':        return ['QB'];
    case 'RB':        return ['RB'];
    case 'WR':        return ['WR'];
    case 'TE':        return ['TE'];
    case 'K':         return ['K'];
    case 'DEF':       return ['DEF'];
    case 'FLEX':
      if (flexTypes === 'RB_WR') return ['RB', 'WR'];
      if (flexTypes === 'QB_RB_WR_TE') return ['QB', 'RB', 'WR', 'TE'];
      return ['RB', 'WR', 'TE'];
    case 'SUPERFLEX': return ['QB', 'RB', 'WR', 'TE'];
    case 'BN':        return [];   // bench accepts any
    case 'IR':        return [];   // IR accepts any (eligibility checked separately)
    default:          return [];
  }
}

export function isStarterSlot(slotName: string): boolean {
  const base = slotName.replace(/\d+$/, '');
  return base !== 'BN' && base !== 'IR';
}

/**
 * Determine which roster slot a drafted player should be assigned to.
 *
 * Walks the league's slot list in order (starters → flex → bench),
 * skipping IR (not drafted) and already-filled slots, and returns
 * the first slot where the player's position is eligible.
 *
 * @param playerPosition - The player's position (QB, RB, WR, TE, K, DEF)
 * @param filledSlots    - Slot names already occupied on this team
 * @param rosterSettings - The league's roster configuration
 * @returns The slot name to assign (e.g. "RB1", "FLEX", "BN3")
 */
export function assignDraftSlot(
  playerPosition: string,
  filledSlots: string[],
  rosterSettings: RosterSettings,
): string {
  const allSlots = generateSlotNames(rosterSettings);
  // IR slots are not drafted
  const draftableSlots = allSlots.filter(s => !s.replace(/\d+$/, '').startsWith('IR'));
  const filledSet = new Set(filledSlots);

  for (const slot of draftableSlots) {
    if (filledSet.has(slot)) continue;
    const allowed = allowedPositionsForSlot(slot, rosterSettings.flex_types);
    // Empty array means "accepts any position" (BN slots)
    if (allowed.length === 0 || allowed.includes(playerPosition)) {
      return slot;
    }
  }

  // Fallback: should not happen in a correctly configured draft,
  // but assign to first unfilled BN slot if somehow all typed slots are full
  for (const slot of draftableSlots) {
    if (!filledSet.has(slot) && slot.replace(/\d+$/, '') === 'BN') {
      return slot;
    }
  }

  // Last resort: return BN1 (will conflict-ignore on insert)
  return 'BN1';
}
