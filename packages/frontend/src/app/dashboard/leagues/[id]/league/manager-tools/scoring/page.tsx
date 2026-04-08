'use client';
import { use, useState, useEffect } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { leagues as leaguesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { League, ScoringSettings } from '@/types';
import { getLeagueSettings } from '@/types';

// =============================================
// Stat definitions organized by category
// =============================================

interface StatDef {
  key: keyof ScoringSettings;
  label: string;
  hint?: string;
  step?: number;
}

const SCORING_CATEGORIES: { label: string; stats: StatDef[] }[] = [
  {
    label: 'Passing',
    stats: [
      { key: 'pass_yd', label: 'Passing Yards', hint: '0.04 = 1pt/25yds', step: 0.01 },
      { key: 'pass_td', label: 'Passing TD', step: 1 },
      { key: 'pass_int', label: 'Interception', step: 1 },
      { key: 'pass_2pt', label: '2-Pt Conversion', step: 1 },
    ],
  },
  {
    label: 'Rushing',
    stats: [
      { key: 'rush_yd', label: 'Rushing Yards', hint: '0.1 = 1pt/10yds', step: 0.01 },
      { key: 'rush_td', label: 'Rushing TD', step: 1 },
      { key: 'rush_2pt', label: '2-Pt Conversion', step: 1 },
    ],
  },
  {
    label: 'Receiving',
    stats: [
      { key: 'rec', label: 'Reception (PPR)', hint: '0=Std, 0.5=Half, 1=Full', step: 0.25 },
      { key: 'rec_yd', label: 'Receiving Yards', hint: '0.1 = 1pt/10yds', step: 0.01 },
      { key: 'rec_td', label: 'Receiving TD', step: 1 },
      { key: 'rec_2pt', label: '2-Pt Conversion', step: 1 },
    ],
  },
  {
    label: 'Kicking',
    stats: [
      { key: 'fg_0_19', label: 'FG 0-19 yds', step: 1 },
      { key: 'fg_20_29', label: 'FG 20-29 yds', step: 1 },
      { key: 'fg_30_39', label: 'FG 30-39 yds', step: 1 },
      { key: 'fg_40_49', label: 'FG 40-49 yds', step: 1 },
      { key: 'fg_50p', label: 'FG 50+ yds', step: 1 },
      { key: 'xpt', label: 'Extra Point Made', step: 1 },
      { key: 'xpt_miss', label: 'Extra Point Missed', step: 1 },
    ],
  },
  {
    label: 'Defense',
    stats: [
      { key: 'def_sack', label: 'Sack', step: 0.5 },
      { key: 'def_int', label: 'Interception', step: 1 },
      { key: 'def_fum_rec', label: 'Fumble Recovery', step: 1 },
      { key: 'def_td', label: 'Defensive TD', step: 1 },
      { key: 'def_st_td', label: 'Special Teams TD', step: 1 },
      { key: 'def_safe', label: 'Safety', step: 1 },
      { key: 'def_blk_kick', label: 'Blocked Kick', step: 1 },
    ],
  },
  {
    label: 'Pts Allowed',
    stats: [
      { key: 'def_pts_allow_0', label: 'Shutout (0 pts)', step: 1 },
      { key: 'def_pts_allow_1_6', label: '1-6 Points', step: 1 },
      { key: 'def_pts_allow_7_13', label: '7-13 Points', step: 1 },
      { key: 'def_pts_allow_14_20', label: '14-20 Points', step: 1 },
      { key: 'def_pts_allow_21_27', label: '21-27 Points', step: 1 },
      { key: 'def_pts_allow_28_34', label: '28-34 Points', step: 1 },
      { key: 'def_pts_allow_35p', label: '35+ Points', step: 1 },
    ],
  },
  {
    label: 'Misc',
    stats: [
      { key: 'fum_lost', label: 'Fumble Lost', step: 1 },
    ],
  },
];

// Preset values (must match backend scoringPresetValues)
const PRESETS: { label: string; type: ScoringSettings['type']; rec: number }[] = [
  { label: 'Standard', type: 'standard', rec: 0 },
  { label: 'Half PPR', type: 'half_ppr', rec: 0.5 },
  { label: 'PPR', type: 'ppr', rec: 1 },
];

const BASE_VALUES: Omit<ScoringSettings, 'type' | 'source'> = {
  pass_yd: 0.04, pass_td: 4, pass_int: -2, pass_2pt: 2,
  rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
  rec: 0.5, rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
  fum_lost: -2,
  fg_0_19: 3, fg_20_29: 3, fg_30_39: 3, fg_40_49: 4, fg_50p: 5,
  xpt: 1, xpt_miss: -1,
  def_sack: 1, def_int: 2, def_fum_rec: 2, def_td: 6, def_st_td: 6, def_safe: 2, def_blk_kick: 2,
  def_pts_allow_0: 10, def_pts_allow_1_6: 7, def_pts_allow_7_13: 4,
  def_pts_allow_14_20: 1, def_pts_allow_21_27: 0, def_pts_allow_28_34: -1, def_pts_allow_35p: -4,
};

// =============================================
// Page
// =============================================

export default function ScoringSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuthStore();
  const { data: league, mutate } = useSWR(`/leagues/${id}`, () => leaguesApi.get(id) as Promise<League>);

  const [scoring, setScoring] = useState<ScoringSettings | null>(null);
  const [activeGroup, setActiveGroup] = useState('Passing');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (league) {
      const settings = getLeagueSettings(league.settings);
      setScoring(settings.scoring);
      setDirty(false);
    }
  }, [league]);

  if (!league || !scoring) return null;
  const isCommissioner = league.commissioner_id === user?.id;
  if (!isCommissioner) {
    return <div className="p-6"><div className="card text-center py-12 text-white/40 text-sm">Commissioner access required.</div></div>;
  }

  const canEdit = league.status === 'pre_draft';

  function updateStat(key: keyof ScoringSettings, value: number) {
    if (!scoring) return;
    setScoring({ ...scoring, [key]: value, type: 'custom' });
    setDirty(true);
  }

  function applyPreset(preset: typeof PRESETS[number]) {
    if (!scoring) return;
    setScoring({
      ...scoring,
      ...BASE_VALUES,
      rec: preset.rec,
      type: preset.type,
    });
    setDirty(true);
  }

  async function handleSave() {
    if (!scoring) return;
    setSaving(true); setMsg(''); setErr('');
    try {
      await leaguesApi.updateSettings(id, 'scoring', scoring);
      setMsg('Scoring settings saved.');
      setDirty(false);
      mutate();
    } catch (e) { setErr((e as Error).message); }
    finally { setSaving(false); }
  }

  const activeCategory = SCORING_CATEGORIES.find(c => c.label === activeGroup);

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <Link href={`/dashboard/leagues/${id}/league/manager-tools`} className="text-white/30 text-xs hover:text-gold transition-colors">
          &larr; League Manager
        </Link>
        <h2 className="text-white font-black text-lg mt-1">Scoring Settings</h2>
        <p className="text-white/30 text-xs mt-1">Configure per-stat point values for your league.</p>
      </div>

      {!canEdit && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-yellow-400 text-sm">
          Scoring settings are locked after the draft begins.
        </div>
      )}

      {/* Format badge + presets */}
      <div className="card space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs px-3 py-1.5 rounded bg-gold/20 text-gold border border-gold/30 font-bold uppercase">
            {scoring.type === 'custom' ? 'Custom' : scoring.type.replace('_', ' ')}
          </span>
          <span className="text-white/30 text-xs">
            Receptions = {scoring.rec} pt{scoring.rec !== 1 ? 's' : ''}
          </span>
          <span className="text-white/30 text-xs">
            Source: {scoring.source === 'real' ? 'Real Stats' : 'Mock'}
          </span>
        </div>

        {canEdit && (
          <div>
            <p className="text-white/40 text-xs mb-2">Quick Presets:</p>
            <div className="flex gap-2">
              {PRESETS.map((p) => (
                <button key={p.label} onClick={() => applyPreset(p)}
                  className={`px-4 py-2 rounded text-sm font-semibold transition-colors ${
                    scoring.type === p.type
                      ? 'bg-gold/20 text-gold border border-gold/40'
                      : 'bg-white/5 text-white/40 border border-white/10 hover:border-white/20'
                  }`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 bg-white/5 rounded-xl p-1 w-fit overflow-x-auto">
        {SCORING_CATEGORIES.map((c) => (
          <button key={c.label} onClick={() => setActiveGroup(c.label)}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              activeGroup === c.label ? 'bg-gold text-black' : 'text-white/40 hover:text-white'
            }`}>
            {c.label}
          </button>
        ))}
      </div>

      {/* Stat rows */}
      {activeCategory && (
        <div className="card overflow-hidden p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">Stat</th>
                <th className="text-right text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3 w-36">Points</th>
              </tr>
            </thead>
            <tbody>
              {activeCategory.stats.map((stat) => {
                const value = scoring[stat.key] as number;
                return (
                  <tr key={stat.key} className="border-b border-white/5 hover:bg-white/[0.03] transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-white text-sm">{stat.label}</p>
                      {stat.hint && <p className="text-white/20 text-[10px] mt-0.5">{stat.hint}</p>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canEdit ? (
                        <input
                          type="number"
                          step={stat.step ?? 0.5}
                          className="input-dark text-sm w-24 text-right font-mono"
                          value={value}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v)) updateStat(stat.key, v);
                          }}
                        />
                      ) : (
                        <span className={`font-mono text-sm font-bold ${value > 0 ? 'text-green-400' : value < 0 ? 'text-red-400' : 'text-white/30'}`}>
                          {value > 0 ? '+' : ''}{value}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary */}
      <div className="card space-y-3">
        <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider">Key Values</h3>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          <SummaryPill label="Pass TD" value={scoring.pass_td} />
          <SummaryPill label="Rush TD" value={scoring.rush_td} />
          <SummaryPill label="Rec TD" value={scoring.rec_td} />
          <SummaryPill label="Reception" value={scoring.rec} highlight />
          <SummaryPill label="INT" value={scoring.pass_int} />
          <SummaryPill label="Fum Lost" value={scoring.fum_lost} />
        </div>
      </div>

      {/* Save */}
      {canEdit && (
        <div className="flex items-center gap-3">
          <button onClick={handleSave} disabled={saving || !dirty}
            className={`text-sm py-2 px-6 rounded font-bold transition-colors ${
              saving || !dirty
                ? 'bg-white/10 text-white/30 cursor-not-allowed'
                : 'btn-gold'
            }`}>
            {saving ? 'Saving...' : !dirty ? 'No Changes' : 'Save Scoring Settings'}
          </button>
          {msg && <span className="text-green-400 text-sm">{msg}</span>}
          {err && <span className="text-red-400 text-sm">{err}</span>}
        </div>
      )}
    </div>
  );
}

function SummaryPill({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="bg-white/5 rounded px-2 py-1.5">
      <p className="text-white/30 text-[10px] uppercase tracking-wider">{label}</p>
      <p className={`text-sm font-bold font-mono ${
        highlight ? 'text-gold' : value > 0 ? 'text-green-400' : value < 0 ? 'text-red-400' : 'text-white/30'
      }`}>
        {value > 0 ? '+' : ''}{value}
      </p>
    </div>
  );
}
