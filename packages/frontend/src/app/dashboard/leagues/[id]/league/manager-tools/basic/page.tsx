'use client';
import { use, useState, useEffect } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { leagues as leaguesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { League } from '@/types';

export default function BasicSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuthStore();
  const { data: league, mutate } = useSWR(`/leagues/${id}`, () => leaguesApi.get(id) as Promise<League>);

  const [name, setName] = useState('');
  const [season, setSeason] = useState(2026);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (league) {
      setName(league.name);
      setSeason(league.season);
      setDirty(false);
    }
  }, [league]);

  if (!league) return null;
  const isCommissioner = league.commissioner_id === user?.id;
  if (!isCommissioner) return (
    <div className="p-6"><div className="card text-center py-12 text-white/40 text-sm">Commissioner access required.</div></div>
  );

  async function handleSave() {
    setSaving(true); setMsg(''); setErr('');
    try {
      const updates: Record<string, unknown> = {};
      if (name !== league!.name) updates.name = name;
      if (season !== league!.season) updates.season = season;

      if (Object.keys(updates).length === 0) { setMsg('No changes to save.'); setSaving(false); return; }

      await leaguesApi.update(id, updates as { name?: string; season?: number });
      setMsg('Settings saved.');
      setDirty(false);
      mutate();
    } catch (e) { setErr((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <Link href={`/dashboard/leagues/${id}/league/manager-tools`} className="text-white/30 text-xs hover:text-gold transition-colors">&larr; League Manager</Link>
        <h2 className="text-white font-black text-lg mt-1">Basic Settings</h2>
      </div>

      <div className="card space-y-5">
        <div>
          <label className="text-white/40 text-xs font-semibold uppercase tracking-wider block mb-1.5">League Name</label>
          <input type="text" className="input-dark w-full" value={name}
            onChange={(e) => { setName(e.target.value); setDirty(true); }} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-white/40 text-xs font-semibold uppercase tracking-wider block mb-1.5">Season</label>
            <select className="input-dark w-full" value={season}
              onChange={(e) => { setSeason(parseInt(e.target.value)); setDirty(true); }}>
              {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="text-white/40 text-xs font-semibold uppercase tracking-wider block mb-1.5">League Size</label>
            <div className="bg-white/5 rounded-lg px-4 py-3">
              <span className="text-white text-sm">{league.league_size} teams</span>
              <span className="text-white/20 text-xs ml-2">(set at creation)</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-white/40 text-xs font-semibold uppercase tracking-wider block mb-1.5">Status</label>
            <div className="bg-white/5 rounded-lg px-4 py-3">
              <span className="text-white text-sm">{(league.status ?? '').replace(/_/g, ' ')}</span>
            </div>
          </div>
          <div>
            <label className="text-white/40 text-xs font-semibold uppercase tracking-wider block mb-1.5">Current Week</label>
            <div className="bg-white/5 rounded-lg px-4 py-3">
              <span className="text-white text-sm">Week {league.week}</span>
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 pt-5">
          <div className="flex items-center gap-3">
            <button onClick={handleSave} disabled={saving || !dirty}
              className={`text-sm py-2 px-6 rounded font-bold transition-colors ${
                saving || !dirty
                  ? 'bg-white/10 text-white/30 cursor-not-allowed'
                  : 'btn-gold'
              }`}>
              {saving ? 'Saving...' : !dirty ? 'No Changes' : 'Save Changes'}
            </button>
            {msg && <span className="text-green-400 text-sm">{msg}</span>}
            {err && <span className="text-red-400 text-sm">{err}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
