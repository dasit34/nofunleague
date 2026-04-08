/**
 * Roster configuration — re-exports from the canonical leagueSettings model
 * and provides backward-compatible helpers.
 *
 * Existing code that imports from rosterConfig continues to work.
 * New code should import from leagueSettings directly.
 */

export type {
  RosterSettings,
  FlexType,
} from './leagueSettings';

export {
  DEFAULT_ROSTER,
  FLEX_TYPES,
  starterCount,
  totalRosterSize,
  draftRounds,
  generateSlotNames,
  allowedPositionsForSlot,
  isStarterSlot,
} from './leagueSettings';

import { DEFAULT_ROSTER, type RosterSettings } from './leagueSettings';

export const PRESETS: Record<string, { label: string; roster: RosterSettings }> = {
  standard: {
    label: 'Standard',
    roster: { ...DEFAULT_ROSTER },
  },
  standard_kdef: {
    label: 'Standard + K/DEF',
    roster: { ...DEFAULT_ROSTER, k_slots: 1, def_slots: 1 },
  },
  superflex: {
    label: 'Superflex',
    roster: { ...DEFAULT_ROSTER, superflex_slots: 1, bench_slots: 7 },
  },
  deep_bench: {
    label: 'Deep Bench',
    roster: { ...DEFAULT_ROSTER, bench_slots: 10 },
  },
};

/** Extract roster settings from league.settings JSONB, with safe defaults */
export function getRosterSettings(leagueSettings: Record<string, unknown> | null): RosterSettings {
  const raw = (leagueSettings as Record<string, unknown>)?.roster as Partial<RosterSettings> | undefined;
  if (!raw) return { ...DEFAULT_ROSTER };
  return { ...DEFAULT_ROSTER, ...raw };
}
