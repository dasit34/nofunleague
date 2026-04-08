'use client';
import { use, useState, useEffect } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { leagues as leaguesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { League, DraftSettings } from '@/types';
import { getLeagueSettings, getRosterFromSettings, draftRounds } from '@/types';

const TIMER_OPTIONS = [
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
  { value: 90, label: '90 seconds' },
  { value: 120, label: '2 minutes' },
  { value: 180, label: '3 minutes' },
  { value: 300, label: '5 minutes' },
  { value: 600, label: '10 minutes' },
];

export default function DraftSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuthStore();
  const { data: league, mutate } = useSWR(`/leagues/${id}`, () => leaguesApi.get(id) as Promise<League>);

  const [draftType, setDraftType] = useState<'snake' | 'linear'>('snake');
  const [secondsPerPick, setSecondsPerPick] = useState(90);
  const [autoPickOnTimeout, setAutoPickOnTimeout] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (league) {
      const settings = getLeagueSettings(league.settings);
      setDraftType(settings.draft.type);
      setSecondsPerPick(settings.draft.seconds_per_pick);
      setAutoPickOnTimeout(settings.draft.auto_pick_on_timeout);
      setDirty(false);
    }
  }, [league]);

  if (!league) return null;
  const isCommissioner = league.commissioner_id === user?.id;
  if (!isCommissioner) {
    return <div className="p-6"><div className="card text-center py-12 text-white/40 text-sm">Commissioner access required.</div></div>;
  }

  const canEdit = league.status === 'pre_draft';
  const roster = getRosterFromSettings(league.settings);
  const rounds = draftRounds(roster);

  async function handleSave() {
    setSaving(true); setMsg(''); setErr('');
    try {
      await leaguesApi.updateSettings(id, 'draft', {
        type: draftType,
        seconds_per_pick: secondsPerPick,
        auto_pick_on_timeout: autoPickOnTimeout,
      } satisfies DraftSettings);
      setMsg('Draft settings saved.');
      setDirty(false);
      mutate();
    } catch (e) { setErr((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <Link href={`/dashboard/leagues/${id}/league/manager-tools`} className="text-white/30 text-xs hover:text-gold transition-colors">
          &larr; League Manager
        </Link>
        <h2 className="text-white font-black text-lg mt-1">Draft Settings</h2>
        <p className="text-white/30 text-xs mt-1">Configure how your league's draft will run.</p>
      </div>

      {!canEdit && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-yellow-400 text-sm">
          Draft settings are locked &mdash; the draft has already {league.status === 'drafting' ? 'started' : 'completed'}.
        </div>
      )}

      {/* Draft Type */}
      <div className="card space-y-4">
        <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider">Draft Type</h3>
        {canEdit ? (
          <div className="flex gap-2">
            {(['snake', 'linear'] as const).map(t => (
              <button key={t} onClick={() => { setDraftType(t); setDirty(true); }}
                className={`px-4 py-2 rounded text-sm font-semibold transition-colors ${
                  draftType === t
                    ? 'bg-gold/20 text-gold border border-gold/40'
                    : 'bg-white/5 text-white/40 border border-white/10 hover:border-white/20'
                }`}>
                {t === 'snake' ? 'Snake' : 'Linear'}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-white text-sm font-semibold">{draftType === 'snake' ? 'Snake' : 'Linear'}</p>
        )}
        <p className="text-white/20 text-xs">
          {draftType === 'snake'
            ? 'Odd rounds go left-to-right, even rounds reverse. Balances pick value across teams.'
            : 'Same order every round. First pick advantage.'}
        </p>
      </div>

      {/* Pick Timer */}
      <div className="card space-y-4">
        <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider">Pick Timer</h3>
        {canEdit ? (
          <select className="input-dark text-sm w-full md:w-64" value={secondsPerPick}
            onChange={e => { setSecondsPerPick(parseInt(e.target.value)); setDirty(true); }}>
            {TIMER_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        ) : (
          <p className="text-white text-sm font-semibold">
            {TIMER_OPTIONS.find(o => o.value === secondsPerPick)?.label ?? `${secondsPerPick}s`}
          </p>
        )}
        <p className="text-white/20 text-xs">Time each team has to make their pick before the clock runs out.</p>
      </div>

      {/* Auto-Pick on Timeout */}
      <div className="card space-y-4">
        <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider">Auto-Pick on Timeout</h3>
        {canEdit ? (
          <div className="flex gap-2">
            <button onClick={() => { setAutoPickOnTimeout(true); setDirty(true); }}
              className={`px-4 py-2 rounded text-sm font-semibold transition-colors ${
                autoPickOnTimeout
                  ? 'bg-gold/20 text-gold border border-gold/40'
                  : 'bg-white/5 text-white/40 border border-white/10 hover:border-white/20'
              }`}>
              Enabled
            </button>
            <button onClick={() => { setAutoPickOnTimeout(false); setDirty(true); }}
              className={`px-4 py-2 rounded text-sm font-semibold transition-colors ${
                !autoPickOnTimeout
                  ? 'bg-gold/20 text-gold border border-gold/40'
                  : 'bg-white/5 text-white/40 border border-white/10 hover:border-white/20'
              }`}>
              Disabled
            </button>
          </div>
        ) : (
          <p className="text-white text-sm font-semibold">{autoPickOnTimeout ? 'Enabled' : 'Disabled'}</p>
        )}
        <p className="text-white/20 text-xs">
          {autoPickOnTimeout
            ? 'When time runs out, the system auto-picks the best available player.'
            : 'When time runs out, the pick stays pending until the owner or commissioner acts.'}
        </p>
      </div>

      {/* Derived Values (read-only) */}
      <div className="card space-y-4">
        <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider">Derived Settings</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white/5 rounded-lg px-3 py-2">
            <p className="text-white/30 text-[10px] uppercase tracking-wider">Rounds</p>
            <p className="text-gold text-sm font-bold">{rounds}</p>
          </div>
          <div className="bg-white/5 rounded-lg px-3 py-2">
            <p className="text-white/30 text-[10px] uppercase tracking-wider">Teams</p>
            <p className="text-white text-sm font-bold">{league.league_size}</p>
          </div>
          <div className="bg-white/5 rounded-lg px-3 py-2">
            <p className="text-white/30 text-[10px] uppercase tracking-wider">Total Picks</p>
            <p className="text-white text-sm font-bold">{rounds * league.league_size}</p>
          </div>
          <div className="bg-white/5 rounded-lg px-3 py-2">
            <p className="text-white/30 text-[10px] uppercase tracking-wider">Order</p>
            <p className="text-white text-sm font-bold">Random</p>
          </div>
        </div>
        <p className="text-white/20 text-xs">
          Rounds are derived from roster size ({rounds} slots). Draft order is randomized when the draft starts.
        </p>
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
            {saving ? 'Saving...' : !dirty ? 'No Changes' : 'Save Draft Settings'}
          </button>
          {msg && <span className="text-green-400 text-sm">{msg}</span>}
          {err && <span className="text-red-400 text-sm">{err}</span>}
        </div>
      )}
    </div>
  );
}
