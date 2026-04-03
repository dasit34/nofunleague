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
    league_size: 10,
    scoring_type: 'half_ppr' as 'standard' | 'half_ppr' | 'ppr',
    scoring_source: 'mock' as 'mock' | 'real',
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
        league_size: form.league_size,
        scoring_type: form.scoring_type,
        scoring_source: form.scoring_source,
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
              <label className="text-white/60 text-sm font-semibold mb-1.5 block">League Size</label>
              <select
                className="input-dark"
                value={form.league_size}
                onChange={(e) => setForm({ ...form, league_size: parseInt(e.target.value) })}
              >
                {Array.from({ length: 13 }, (_, i) => i + 4).map((n) => (
                  <option key={n} value={n}>{n} teams</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-white/60 text-sm font-semibold mb-1.5 block">Scoring Type</label>
              <select
                className="input-dark"
                value={form.scoring_type}
                onChange={(e) => setForm({ ...form, scoring_type: e.target.value as 'standard' | 'half_ppr' | 'ppr' })}
              >
                <option value="standard">Standard</option>
                <option value="half_ppr">Half PPR</option>
                <option value="ppr">PPR</option>
              </select>
            </div>

            <div>
              <label className="text-white/60 text-sm font-semibold mb-1.5 block">Scoring Source</label>
              <select
                className="input-dark"
                value={form.scoring_source}
                onChange={(e) => setForm({ ...form, scoring_source: e.target.value as 'mock' | 'real' })}
              >
                <option value="mock">Mock (random scores)</option>
                <option value="real">Real (Sleeper stats)</option>
              </select>
              <p className="text-white/30 text-xs mt-1">
                {form.scoring_source === 'real'
                  ? 'Uses real NFL player stats from Sleeper. Requires stats sync.'
                  : 'Uses random mock scores for testing.'}
              </p>
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
