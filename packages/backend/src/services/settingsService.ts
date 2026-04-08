/**
 * Settings Service — read/write layer for league settings.
 *
 * All settings reads and writes go through here.
 * Routes call this service, not raw SQL for settings.
 */

import { query } from '../config/database';
import {
  type LeagueSettings,
  type RosterSettings,
  mergeWithDefaults,
  validateSection,
  RosterSettingsSchema,
} from '../config/leagueSettings';
import { z } from 'zod';

export interface SettingsUpdateResult {
  settings: LeagueSettings;
  message: string;
}

/**
 * Get the full, validated settings for a league.
 * Merges stored JSONB with defaults so callers always get a complete object.
 */
export async function getSettings(leagueId: string): Promise<LeagueSettings> {
  const { rows: [league] } = await query(
    'SELECT settings FROM leagues WHERE id = $1',
    [leagueId],
  );
  if (!league) throw new Error('League not found');
  return mergeWithDefaults(league.settings as Record<string, unknown>);
}

/**
 * Update a single settings section.
 * Validates the incoming data, merges it into the full settings object, and persists.
 *
 * @param leagueId - League UUID
 * @param section  - Which section to update
 * @param data     - The new values for that section
 * @param opts     - Options: skipStatusCheck to allow edits regardless of league status
 */
export async function updateSection(
  leagueId: string,
  section: keyof LeagueSettings,
  data: unknown,
  opts?: { skipStatusCheck?: boolean },
): Promise<SettingsUpdateResult> {
  // Fetch current league
  const { rows: [league] } = await query(
    'SELECT id, status, settings FROM leagues WHERE id = $1',
    [leagueId],
  );
  if (!league) throw Object.assign(new Error('League not found'), { status: 404 });

  // Status gating: most settings are locked after draft starts
  if (!opts?.skipStatusCheck) {
    const lockedSections: Array<keyof LeagueSettings> = ['roster', 'scoring', 'draft', 'season'];
    if (lockedSections.includes(section) && league.status !== 'pre_draft') {
      throw Object.assign(
        new Error(`${section} settings can only be changed before the draft starts.`),
        { status: 400 },
      );
    }
  }

  // Validate the incoming section data
  let validated: unknown;
  try {
    validated = validateSection(section, data);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw Object.assign(
        new Error(err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ')),
        { status: 400, details: err.errors },
      );
    }
    throw err;
  }

  // Merge into existing settings
  const currentSettings = mergeWithDefaults(league.settings as Record<string, unknown>);
  const newSettings: LeagueSettings = {
    ...currentSettings,
    [section]: validated,
  };

  // Persist
  await query(
    'UPDATE leagues SET settings = $2, updated_at = NOW() WHERE id = $1',
    [leagueId, JSON.stringify(newSettings)],
  );

  // If scoring settings changed, also sync the top-level columns for backward compat
  if (section === 'scoring') {
    const scoring = validated as LeagueSettings['scoring'];
    await query(
      'UPDATE leagues SET scoring_type = $2, scoring_source = $3, updated_at = NOW() WHERE id = $1',
      [leagueId, scoring.type, scoring.source],
    );
  }

  return {
    settings: newSettings,
    message: `${section} settings updated`,
  };
}

/**
 * Update roster settings specifically — convenience wrapper used by the
 * existing PATCH /roster-settings endpoint for backward compatibility.
 */
export async function updateRosterSettings(
  leagueId: string,
  data: unknown,
): Promise<SettingsUpdateResult> {
  return updateSection(leagueId, 'roster', data);
}

/**
 * Bulk update — accepts a partial settings object and updates each provided section.
 * Used when creating a league or importing settings.
 */
export async function setInitialSettings(
  leagueId: string,
  partial: Partial<LeagueSettings>,
): Promise<LeagueSettings> {
  const current = await getSettings(leagueId);
  const merged: LeagueSettings = { ...current };

  for (const [key, value] of Object.entries(partial)) {
    if (value !== undefined) {
      (merged as unknown as Record<string, unknown>)[key] = value;
    }
  }

  await query(
    'UPDATE leagues SET settings = $2, updated_at = NOW() WHERE id = $1',
    [leagueId, JSON.stringify(merged)],
  );

  return merged;
}
