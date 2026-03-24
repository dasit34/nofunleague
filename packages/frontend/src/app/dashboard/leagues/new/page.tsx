'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { leagues as leaguesApi } from '@/lib/api';
import { useLeagueStore } from '@/lib/store';
import TopBar from '@/components/layout/TopBar';
import type { League } from '@/types';

export default function NewLeaguePage() {
  const router = useRouter();
  const setActiveLeague = useLeagueStore((s) => s.setActiveLeague);
  const [form, setForm] = useState({
    name: '',
    sleeper_league_id: '',
    season: new Date().getFullYear(),
    ai_enabled: true,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const league = await leaguesApi.create({
        name: form.name,
        sleeper_league_id: form.sleeper_league_id || undefined,
        season: form.season,
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
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="text-white/60 text-sm font-semibold mb-1.5 block">League Name</label>
              <input
                type="text"
                className="input-dark"
                placeholder="The No Fun League"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>

            <div>
              <label className="text-white/60 text-sm font-semibold mb-1.5 block">
                Sleeper League ID
                <span className="text-white/30 font-normal ml-2">(optional — link your existing Sleeper league)</span>
              </label>
              <input
                type="text"
                className="input-dark"
                placeholder="e.g. 1048616708453257216"
                value={form.sleeper_league_id}
                onChange={(e) => setForm({ ...form, sleeper_league_id: e.target.value })}
              />
              <p className="text-white/30 text-xs mt-1.5">
                Find your Sleeper league ID in the URL when viewing your league on sleeper.app
              </p>
            </div>

            <div>
              <label className="text-white/60 text-sm font-semibold mb-1.5 block">Season</label>
              <input
                type="number"
                className="input-dark"
                value={form.season}
                onChange={(e) => setForm({ ...form, season: parseInt(e.target.value) })}
                min={2020}
                max={2030}
              />
            </div>

            <div className="flex items-center justify-between p-4 bg-gold/5 border border-gold/20 rounded-lg">
              <div>
                <p className="text-white font-semibold text-sm">Enable AI (CHAOS)</p>
                <p className="text-white/40 text-xs mt-0.5">Automated trash talk, recaps, and chaos</p>
              </div>
              <button
                type="button"
                onClick={() => setForm({ ...form, ai_enabled: !form.ai_enabled })}
                className={`w-12 h-6 rounded-full transition-colors relative ${
                  form.ai_enabled ? 'bg-gold' : 'bg-white/20'
                }`}
              >
                <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                  form.ai_enabled ? 'translate-x-7' : 'translate-x-1'
                }`} />
              </button>
            </div>

            <div className="flex gap-3 pt-2">
              <button type="submit" className="btn-gold flex-1" disabled={loading}>
                {loading ? 'Creating...' : 'Create League'}
              </button>
              <Link href="/dashboard" className="btn-dark flex-1 text-center">
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
