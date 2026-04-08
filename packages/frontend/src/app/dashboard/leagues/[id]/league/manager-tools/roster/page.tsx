'use client';
import { use, useState, useEffect, useCallback } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { leagues as leaguesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { League, RosterSettings, FlexType } from '@/types';
import { DEFAULT_ROSTER_SETTINGS, getRosterFromSettings, totalRosterSize, starterCount, draftRounds } from '@/types';

// =============================================
// Presets
// =============================================
const PRESETS: { label: string; desc: string; roster: RosterSettings }[] = [
  {
    label: 'Standard',
    desc: '1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 6 BN',
    roster: { ...DEFAULT_ROSTER_SETTINGS },
  },
  {
    label: 'Standard + K/DST',
    desc: '1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 K, 1 DST, 6 BN',
    roster: { ...DEFAULT_ROSTER_SETTINGS, k_slots: 1, def_slots: 1 },
  },
  {
    label: 'Superflex',
    desc: '1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 SF, 7 BN',
    roster: { ...DEFAULT_ROSTER_SETTINGS, superflex_slots: 1, bench_slots: 7 },
  },
  {
    label: 'Deep Bench',
    desc: '1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 10 BN, 2 IR',
    roster: { ...DEFAULT_ROSTER_SETTINGS, bench_slots: 10, ir_slots: 2 },
  },
  {
    label: '3WR League',
    desc: '1 QB, 2 RB, 3 WR, 1 TE, 1 FLEX, 7 BN',
    roster: { ...DEFAULT_ROSTER_SETTINGS, wr_slots: 3, bench_slots: 7 },
  },
];

// =============================================
// Validation
// =============================================
interface ValidationError {
  field: string;
  message: string;
}

function validate(r: RosterSettings): ValidationError[] {
  const errors: ValidationError[] = [];

  const starters = starterCount(r);
  if (starters < 1) {
    errors.push({ field: 'general', message: 'Must have at least 1 starting slot.' });
  }

  const total = totalRosterSize(r);
  if (total > 53) {
    errors.push({ field: 'general', message: `Total roster size (${total}) exceeds maximum of 53.` });
  }
  if (total < 1) {
    errors.push({ field: 'general', message: 'Total roster size must be at least 1.' });
  }

  // Position limits must be >= starting slots (or 0 for no limit)
  const limitChecks: { limit: keyof RosterSettings; slots: keyof RosterSettings; name: string }[] = [
    { limit: 'max_qb', slots: 'qb_slots', name: 'QB' },
    { limit: 'max_rb', slots: 'rb_slots', name: 'RB' },
    { limit: 'max_wr', slots: 'wr_slots', name: 'WR' },
    { limit: 'max_te', slots: 'te_slots', name: 'TE' },
    { limit: 'max_k', slots: 'k_slots', name: 'K' },
    { limit: 'max_def', slots: 'def_slots', name: 'D/ST' },
  ];

  for (const { limit, slots, name } of limitChecks) {
    const maxVal = r[limit] as number;
    const slotVal = r[slots] as number;
    if (maxVal > 0 && maxVal < slotVal) {
      errors.push({
        field: limit,
        message: `${name} roster max (${maxVal}) cannot be less than starting slots (${slotVal}).`,
      });
    }
  }

  // SUPERFLEX without at least 1 QB starter is unusual — warn but allow
  // FLEX eligibility: if flex_slots > 0 but flex_types has no valid positions, flag it

  return errors;
}

// =============================================
// Component
// =============================================
export default function RosterSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuthStore();
  const { data: league, mutate } = useSWR(`/leagues/${id}`, () => leaguesApi.get(id) as Promise<League>);

  const [roster, setRoster] = useState<RosterSettings>(DEFAULT_ROSTER_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (league) {
      setRoster(getRosterFromSettings(league.settings));
      setDirty(false);
    }
  }, [league]);

  const updateField = useCallback((key: keyof RosterSettings, value: number | string) => {
    setRoster(prev => {
      const next = { ...prev, [key]: value };
      setErrors(validate(next));
      setDirty(true);
      return next;
    });
  }, []);

  if (!league) return null;
  const isCommissioner = league.commissioner_id === user?.id;
  if (!isCommissioner) {
    return (
      <div className="p-6">
        <div className="card text-center py-12 text-white/40 text-sm">Commissioner access required.</div>
      </div>
    );
  }

  const canEdit = league.status === 'pre_draft';
  const total = totalRosterSize(roster);
  const starters = starterCount(roster);
  const rounds = draftRounds(roster);
  const hasErrors = errors.length > 0;

  async function handleSave() {
    const validationErrors = validate(roster);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      setErr('Fix validation errors before saving.');
      return;
    }

    setSaving(true);
    setMsg('');
    setErr('');
    try {
      await leaguesApi.updateRosterSettings(id, roster);
      setMsg('Roster settings saved.');
      setDirty(false);
      mutate();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function applyPreset(preset: RosterSettings) {
    setRoster(preset);
    setErrors(validate(preset));
    setDirty(true);
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <Link href={`/dashboard/leagues/${id}/league/manager-tools`} className="text-white/30 text-xs hover:text-gold transition-colors">
          &larr; League Manager
        </Link>
        <h2 className="text-white font-black text-lg mt-1">Roster Settings</h2>
        <p className="text-white/30 text-xs mt-1">
          Configure starting lineup, bench, IR, and position limits for your league.
        </p>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-5 gap-3">
        <SummaryCard label="Starters" value={starters} highlight />
        <SummaryCard label="Bench" value={roster.bench_slots} />
        <SummaryCard label="IR" value={roster.ir_slots} />
        <SummaryCard label="Total Roster" value={total} />
        <SummaryCard label="Draft Rounds" value={rounds} highlight />
      </div>

      {/* Lock warning */}
      {!canEdit && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-yellow-400 text-sm">
          Roster settings are locked after the draft begins. These values are read-only.
        </div>
      )}

      {/* Validation errors */}
      {hasErrors && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 space-y-1">
          {errors.map((e, i) => (
            <p key={i} className="text-red-400 text-sm">{e.message}</p>
          ))}
        </div>
      )}

      {/* Presets */}
      {canEdit && (
        <div className="card space-y-3">
          <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider">Quick Presets</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => applyPreset(p.roster)}
                className="text-left px-3 py-2 rounded border border-white/10 hover:border-gold/30 hover:bg-gold/5 transition-all group"
              >
                <p className="text-white text-sm font-semibold group-hover:text-gold transition-colors">{p.label}</p>
                <p className="text-white/30 text-[10px] mt-0.5">{p.desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Starting Lineup Slots */}
      <div className="card space-y-4">
        <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider">Starting Lineup</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SlotEditor label="QB" field="qb_slots" max={4} value={roster.qb_slots} canEdit={canEdit} onChange={updateField} />
          <SlotEditor label="RB" field="rb_slots" max={8} value={roster.rb_slots} canEdit={canEdit} onChange={updateField} />
          <SlotEditor label="WR" field="wr_slots" max={8} value={roster.wr_slots} canEdit={canEdit} onChange={updateField} />
          <SlotEditor label="TE" field="te_slots" max={4} value={roster.te_slots} canEdit={canEdit} onChange={updateField} />
          <SlotEditor label="FLEX" field="flex_slots" max={4} value={roster.flex_slots} canEdit={canEdit} onChange={updateField}
            hint={roster.flex_slots > 0 ? roster.flex_types.replace(/_/g, '/') : undefined} />
          <SlotEditor label="SUPERFLEX" field="superflex_slots" max={2} value={roster.superflex_slots} canEdit={canEdit} onChange={updateField}
            hint="QB/RB/WR/TE" />
          <SlotEditor label="K" field="k_slots" max={2} value={roster.k_slots} canEdit={canEdit} onChange={updateField} />
          <SlotEditor label="D/ST" field="def_slots" max={2} value={roster.def_slots} canEdit={canEdit} onChange={updateField} />
        </div>

        {/* FLEX Eligibility */}
        {(roster.flex_slots > 0) && (
          <div className="border-t border-white/10 pt-4">
            <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-3">FLEX Eligible Positions</h3>
            {canEdit ? (
              <div className="flex gap-2">
                {([
                  { value: 'RB_WR_TE' as FlexType, label: 'RB / WR / TE' },
                  { value: 'RB_WR' as FlexType, label: 'RB / WR only' },
                  { value: 'QB_RB_WR_TE' as FlexType, label: 'QB / RB / WR / TE' },
                ]).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => updateField('flex_types', opt.value)}
                    className={`text-xs px-3 py-2 rounded border transition-colors ${
                      roster.flex_types === opt.value
                        ? 'border-gold/50 bg-gold/10 text-gold'
                        : 'border-white/10 text-white/40 hover:border-white/20'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-white text-sm">{roster.flex_types.replace(/_/g, ' / ')}</p>
            )}
          </div>
        )}
      </div>

      {/* Bench & IR */}
      <div className="card space-y-4">
        <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider">Bench &amp; Reserve</h3>
        <div className="grid grid-cols-2 gap-4">
          <SlotEditor label="Bench Slots" field="bench_slots" max={15} value={roster.bench_slots} canEdit={canEdit} onChange={updateField}
            hint="Players not in starting lineup" />
          <SlotEditor label="IR Slots" field="ir_slots" max={5} value={roster.ir_slots} canEdit={canEdit} onChange={updateField}
            hint="Injured reserve — does not count toward roster max" />
        </div>
      </div>

      {/* Position Limits (Roster Maximums) */}
      <div className="card space-y-4">
        <div>
          <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider">Position Limits</h3>
          <p className="text-white/20 text-[10px] mt-1">Maximum players per position on a roster. Set to 0 for no limit.</p>
        </div>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
          <LimitEditor label="QB" field="max_qb" max={10} value={roster.max_qb} canEdit={canEdit} onChange={updateField}
            hasError={errors.some(e => e.field === 'max_qb')} />
          <LimitEditor label="RB" field="max_rb" max={10} value={roster.max_rb} canEdit={canEdit} onChange={updateField}
            hasError={errors.some(e => e.field === 'max_rb')} />
          <LimitEditor label="WR" field="max_wr" max={10} value={roster.max_wr} canEdit={canEdit} onChange={updateField}
            hasError={errors.some(e => e.field === 'max_wr')} />
          <LimitEditor label="TE" field="max_te" max={10} value={roster.max_te} canEdit={canEdit} onChange={updateField}
            hasError={errors.some(e => e.field === 'max_te')} />
          <LimitEditor label="K" field="max_k" max={5} value={roster.max_k} canEdit={canEdit} onChange={updateField}
            hasError={errors.some(e => e.field === 'max_k')} />
          <LimitEditor label="D/ST" field="max_def" max={5} value={roster.max_def} canEdit={canEdit} onChange={updateField}
            hasError={errors.some(e => e.field === 'max_def')} />
        </div>
      </div>

      {/* Roster Breakdown */}
      <div className="card space-y-3">
        <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider">Roster Breakdown</h3>
        <div className="space-y-1">
          {generateRosterBreakdown(roster).map((line, i) => (
            <div key={i} className="flex items-center justify-between text-sm py-1 border-b border-white/5 last:border-0">
              <span className="text-white/60">{line.label}</span>
              <span className={`font-mono font-bold ${line.highlight ? 'text-gold' : 'text-white'}`}>{line.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Save */}
      {canEdit && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving || hasErrors || !dirty}
            className={`text-sm py-2 px-6 rounded font-bold transition-colors ${
              saving || hasErrors || !dirty
                ? 'bg-white/10 text-white/30 cursor-not-allowed'
                : 'btn-gold'
            }`}
          >
            {saving ? 'Saving...' : hasErrors ? 'Fix Errors to Save' : !dirty ? 'No Changes' : 'Save Roster Settings'}
          </button>
          {msg && <span className="text-green-400 text-sm">{msg}</span>}
          {err && <span className="text-red-400 text-sm">{err}</span>}
        </div>
      )}
    </div>
  );
}

// =============================================
// Sub-components
// =============================================

function SummaryCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="card text-center py-3">
      <p className={`text-xl font-black ${highlight ? 'text-gold' : 'text-white'}`}>{value}</p>
      <p className="text-white/40 text-[10px] uppercase tracking-wider mt-1">{label}</p>
    </div>
  );
}

function SlotEditor({
  label, field, max, value, canEdit, onChange, hint,
}: {
  label: string;
  field: keyof RosterSettings;
  max: number;
  value: number;
  canEdit: boolean;
  onChange: (key: keyof RosterSettings, value: number) => void;
  hint?: string;
}) {
  return (
    <div>
      <label className="text-white/40 text-xs block mb-1">{label}</label>
      {canEdit ? (
        <select
          className="input-dark py-2 text-sm w-full"
          value={value}
          onChange={(e) => onChange(field, parseInt(e.target.value))}
        >
          {Array.from({ length: max + 1 }, (_, i) => (
            <option key={i} value={i}>{i}</option>
          ))}
        </select>
      ) : (
        <p className="text-white text-sm font-mono bg-white/5 rounded-lg px-3 py-2">{value}</p>
      )}
      {hint && <p className="text-white/20 text-[10px] mt-1">{hint}</p>}
    </div>
  );
}

function LimitEditor({
  label, field, max, value, canEdit, onChange, hasError,
}: {
  label: string;
  field: keyof RosterSettings;
  max: number;
  value: number;
  canEdit: boolean;
  onChange: (key: keyof RosterSettings, value: number) => void;
  hasError?: boolean;
}) {
  return (
    <div>
      <label className="text-white/40 text-xs block mb-1">{label}</label>
      {canEdit ? (
        <select
          className={`input-dark py-2 text-sm w-full ${hasError ? 'border-red-500/50' : ''}`}
          value={value}
          onChange={(e) => onChange(field, parseInt(e.target.value))}
        >
          <option value={0}>No Limit</option>
          {Array.from({ length: max }, (_, i) => (
            <option key={i + 1} value={i + 1}>{i + 1}</option>
          ))}
        </select>
      ) : (
        <p className="text-white text-sm font-mono bg-white/5 rounded-lg px-3 py-2">
          {value === 0 ? '—' : value}
        </p>
      )}
    </div>
  );
}

function generateRosterBreakdown(r: RosterSettings) {
  const lines: { label: string; value: string; highlight?: boolean }[] = [];

  if (r.qb_slots > 0) lines.push({ label: `QB${r.qb_slots > 1 ? ` x${r.qb_slots}` : ''}`, value: `${r.qb_slots}` });
  if (r.rb_slots > 0) lines.push({ label: `RB${r.rb_slots > 1 ? ` x${r.rb_slots}` : ''}`, value: `${r.rb_slots}` });
  if (r.wr_slots > 0) lines.push({ label: `WR${r.wr_slots > 1 ? ` x${r.wr_slots}` : ''}`, value: `${r.wr_slots}` });
  if (r.te_slots > 0) lines.push({ label: `TE${r.te_slots > 1 ? ` x${r.te_slots}` : ''}`, value: `${r.te_slots}` });
  if (r.flex_slots > 0) lines.push({ label: `FLEX (${r.flex_types.replace(/_/g, '/')})`, value: `${r.flex_slots}` });
  if (r.superflex_slots > 0) lines.push({ label: 'SUPERFLEX (QB/RB/WR/TE)', value: `${r.superflex_slots}` });
  if (r.k_slots > 0) lines.push({ label: 'K', value: `${r.k_slots}` });
  if (r.def_slots > 0) lines.push({ label: 'D/ST', value: `${r.def_slots}` });

  lines.push({ label: 'Starters Total', value: `${starterCount(r)}`, highlight: true });
  lines.push({ label: 'Bench', value: `${r.bench_slots}` });
  if (r.ir_slots > 0) lines.push({ label: 'IR', value: `${r.ir_slots}` });
  lines.push({ label: 'Total Roster Size', value: `${totalRosterSize(r)}`, highlight: true });
  lines.push({ label: 'Draft Rounds', value: `${draftRounds(r)}`, highlight: true });

  return lines;
}
