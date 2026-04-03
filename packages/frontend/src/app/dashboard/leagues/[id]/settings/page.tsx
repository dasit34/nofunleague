'use client';
import { use } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { leagues as leaguesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { League } from '@/types';

export default function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuthStore();

  const { data: league } = useSWR(
    `/leagues/${id}`,
    () => leaguesApi.get(id) as Promise<League>
  );

  if (!league) return null;

  const isCommissioner = league.commissioner_id === user?.id;

  if (!isCommissioner) {
    return (
      <div className="p-6">
        <div className="card text-center py-12 space-y-3">
          <p className="text-white/40 text-sm">Only the commissioner can access league settings.</p>
          <Link href={`/dashboard/leagues/${id}`} className="text-gold text-sm hover:underline">
            Back to overview
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-white font-black text-lg">League Settings</h2>

      <div className="card space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-white/40 text-xs font-semibold uppercase tracking-wider block mb-1">League Name</label>
            <p className="text-white text-sm">{league.name}</p>
          </div>
          <div>
            <label className="text-white/40 text-xs font-semibold uppercase tracking-wider block mb-1">Season</label>
            <p className="text-white text-sm">{league.season}</p>
          </div>
          <div>
            <label className="text-white/40 text-xs font-semibold uppercase tracking-wider block mb-1">League Size</label>
            <p className="text-white text-sm">{league.league_size} teams</p>
          </div>
          <div>
            <label className="text-white/40 text-xs font-semibold uppercase tracking-wider block mb-1">Scoring Type</label>
            <p className="text-white text-sm">{(league.scoring_type ?? 'half_ppr').replace('_', ' ').toUpperCase()}</p>
          </div>
          <div>
            <label className="text-white/40 text-xs font-semibold uppercase tracking-wider block mb-1">Status</label>
            <p className="text-white text-sm">{league.status.replace('_', ' ')}</p>
          </div>
          <div>
            <label className="text-white/40 text-xs font-semibold uppercase tracking-wider block mb-1">Invite Code</label>
            <p className="text-gold font-mono font-bold text-sm tracking-widest">{league.invite_code || 'None'}</p>
          </div>
        </div>

        <div className="border-t border-white/10 pt-4">
          <p className="text-white/30 text-sm">League settings editing will be available here in a future update.</p>
        </div>
      </div>
    </div>
  );
}
