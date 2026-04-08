'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { leagues as leaguesApi } from '@/lib/api';
import { useLeagueStore } from '@/lib/store';
import TopBar from '@/components/layout/TopBar';
import type { League, RosterSettings } from '@/types';
import { DEFAULT_ROSTER_SETTINGS, totalRosterSize, starterCount } from '@/types';

const PRESETS = [
  { label: 'Standard', key: 'standard', roster: { ...DEFAULT_ROSTER_SETTINGS } },
  { label: 'With K/DEF', key: 'with_kd', roster: { ...DEFAULT_ROSTER_SETTINGS, k_slots: 1, def_slots: 1 } },
  { label: 'Deep Bench', key: 'deep', roster: { ...DEFAULT_ROSTER_SETTINGS, bench_slots: 10 } },
  { label: 'Custom', key: 'custom', roster: null },
];

export default function NewLeaguePage() {
  const router = useRouter();
  const setActiveLeague = useLeagueStore((s) => s.setActiveLeague);
  const [form, setForm] = useState({
    name: '',
    league_size: 10,
    scoring_type: 'half_ppr' as 'standard' | 'half_ppr' | 'ppr',
    scoring_source: 'mock' as 'mock' | 'real',
  });
  const [roster, setRoster] = useState<RosterSettings>({ ...DEFAULT_ROSTER_SETTINGS });
  const [preset, setPreset] = useState('standard');
  const [showRoster, setShowRoster] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const total = totalRosterSize(roster);
  const starters = starterCount(roster);

  function applyPreset(key: string) {
    setPreset(key);
    const p = PRESETS.find(pr => pr.key === key);
    if (p?.roster) setRoster(p.roster);
    if (key === 'custom') setShowRoster(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const league = await leaguesApi.create({
        name: form.name,
        league_size: form.league_size,
        scoring_type: form.scoring_type,
        scoring_source: form.scoring_source,
        roster_settings: roster,
      }) as League;
      setActiveLeague(league);
      router.push(`/dashboard/leagues/${league.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <TopBar title="Create League" subtitle="Build your empire of chaos" />

      <div className="p-6 max-w-2xl">
        <div className="card-gold">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-red-400 text-sm">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="text-white/60 text-sm font-semibold mb-1.5 block">League Name</label>
              <input type="text" className="input-dark" placeholder="The No Fun League"
                value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>

            <div>
              <label className="text-white/60 text-sm font-semibold mb-1.5 block">League Size</label>
              <select className="input-dark" value={form.league_size}
                onChange={(e) => setForm({ ...form, league_size: parseInt(e.target.value) })}>
                {Array.from({ length: 13 }, (_, i) => i + 4).map((n) => (
                  <option key={n} value={n}>{n} teams</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-white/60 text-sm font-semibold mb-1.5 block">Scoring Type</label>
                <select className="input-dark" value={form.scoring_type}
                  onChange={(e) => setForm({ ...form, scoring_type: e.target.value as 'standard' | 'half_ppr' | 'ppr' })}>
                  <option value="standard">Standard</option>
                  <option value="half_ppr">Half PPR</option>
                  <option value="ppr">PPR</option>
                </select>
              </div>
              <div>
                <label className="text-white/60 text-sm font-semibold mb-1.5 block">Scoring Source</label>
                <select className="input-dark" value={form.scoring_source}
                  onChange={(e) => setForm({ ...form, scoring_source: e.target.value as 'mock' | 'real' })}>
                  <option value="mock">Mock (random)</option>
                  <option value="real">Real (Sleeper)</option>
                </select>
              </div>
            </div>

            {/* Roster Preset */}
            <div>
              <label className="text-white/60 text-sm font-semibold mb-1.5 block">Roster Preset</label>
              <div className="flex gap-2 flex-wrap">
                {PRESETS.map((p) => (
                  <button key={p.key} type="button" onClick={() => applyPreset(p.key)}
                    className={`px-3 py-1.5 text-xs font-bold rounded transition-colors ${
                      preset === p.key
                        ? 'bg-gold/20 text-gold border border-gold/30'
                        : 'bg-white/5 text-white/40 border border-white/10 hover:text-white/70'
                    }`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Roster Summary */}
            <div className="bg-white/5 rounded-lg px-4 py-3 flex items-center justify-between">
              <div className="flex gap-4 text-xs">
                <span className="text-white/40">Starters: <span className="text-gold font-bold">{starters}</span></span>
                <span className="text-white/40">Bench: <span className="text-white font-bold">{roster.bench_slots}</span></span>
                <span className="text-white/40">Total: <span className="text-white font-bold">{total}</span></span>
                <span className="text-white/40">Draft Rounds: <span className="text-gold font-bold">{total}</span></span>
              </div>
              <button type="button" onClick={() => setShowRoster(!showRoster)}
                className="text-white/30 text-xs hover:text-white/60 transition-colors">
                {showRoster ? 'Hide details' : 'Customize'}
              </button>
            </div>

            {/* Detailed roster editor */}
            {showRoster && (
              <div className="grid grid-cols-4 gap-3">
                {([
                  { key: 'qb_slots', label: 'QB', max: 4 },
                  { key: 'rb_slots', label: 'RB', max: 6 },
                  { key: 'wr_slots', label: 'WR', max: 6 },
                  { key: 'te_slots', label: 'TE', max: 4 },
                  { key: 'flex_slots', label: 'FLEX', max: 4 },
                  { key: 'def_slots', label: 'DEF', max: 2 },
                  { key: 'k_slots', label: 'K', max: 2 },
                  { key: 'bench_slots', label: 'Bench', max: 10 },
                ] as const).map(({ key, label, max }) => (
                  <div key={key}>
                    <label className="text-white/40 text-xs block mb-1">{label}</label>
                    <select className="input-dark py-1.5 text-sm w-full" value={roster[key]}
                      onChange={(e) => { setRoster(r => ({ ...r, [key]: parseInt(e.target.value) })); setPreset('custom'); }}>
                      {Array.from({ length: max + 1 }, (_, i) => (
                        <option key={i} value={i}>{i}</option>
                      ))}
                    </select>
                  </div>
                ))}
                {roster.flex_slots > 0 && (
                  <div className="col-span-2">
                    <label className="text-white/40 text-xs block mb-1">FLEX Type</label>
                    <select className="input-dark py-1.5 text-sm w-full" value={roster.flex_types}
                      onChange={(e) => setRoster(r => ({ ...r, flex_types: e.target.value as 'RB_WR' | 'RB_WR_TE' }))}>
                      <option value="RB_WR_TE">RB / WR / TE</option>
                      <option value="RB_WR">RB / WR only</option>
                    </select>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button type="submit" className="btn-gold flex-1" disabled={loading}>
                {loading ? 'Creating...' : 'Create League'}
              </button>
              <Link href="/dashboard" className="btn-dark flex-1 text-center">Cancel</Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
