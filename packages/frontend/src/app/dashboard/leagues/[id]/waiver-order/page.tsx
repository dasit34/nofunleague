'use client';
import { use } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { leagues as leaguesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { League, Team } from '@/types';

type LeagueWithTeams = League & { teams: Team[] };

export default function WaiverOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuthStore();

  const { data: league } = useSWR(`/leagues/${id}`, () => leaguesApi.get(id) as Promise<LeagueWithTeams>);

  const teams = [...(league?.teams || [])].sort((a, b) => {
    const ap = a.waiver_priority ?? 999;
    const bp = b.waiver_priority ?? 999;
    return ap - bp;
  });

  const hasWaiverPriority = teams.some(t => t.waiver_priority != null && t.waiver_priority > 0);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-white font-black text-lg">Waiver Order</h2>
        <p className="text-white/30 text-xs mt-0.5">
          Lower number = higher priority. Priority rotates when a claim is won.
        </p>
      </div>

      {teams.length === 0 ? (
        <div className="card text-center py-12 space-y-2">
          <p className="text-white/40 text-sm">No teams in this league yet.</p>
          <p className="text-white/20 text-xs">Waiver priority is set after the draft completes (reverse draft order).</p>
        </div>
      ) : !hasWaiverPriority ? (
        <div className="space-y-4">
          <div className="card text-center py-8 space-y-2">
            <p className="text-white/40 text-sm">Waiver priority has not been set yet.</p>
            <p className="text-white/20 text-xs">Priority is assigned automatically when the draft completes — last pick gets top priority.</p>
          </div>
          {/* Show teams in default order as preview */}
          <div className="card overflow-hidden p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-center text-white/20 text-xs font-semibold uppercase tracking-wider px-3 py-3 w-12">#</th>
                  <th className="text-left text-white/20 text-xs font-semibold uppercase tracking-wider px-4 py-3">Team</th>
                  <th className="text-center text-white/20 text-xs font-semibold uppercase tracking-wider px-3 py-3 w-20">Priority</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((team, idx) => (
                  <tr key={team.id} className="border-b border-white/5">
                    <td className="px-3 py-3 text-center"><span className="text-white/15 text-sm">{idx + 1}</span></td>
                    <td className="px-4 py-3">
                      <span className="text-white/30 text-sm">{team.name}</span>
                      {team.display_name && <span className="text-white/15 text-xs ml-2">{team.display_name}</span>}
                    </td>
                    <td className="px-3 py-3 text-center"><span className="text-white/15 text-sm">—</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-center text-white/30 text-xs font-semibold uppercase tracking-wider px-3 py-3 w-12">Priority</th>
                <th className="text-left text-white/30 text-xs font-semibold uppercase tracking-wider px-4 py-3">Team</th>
                <th className="text-left text-white/30 text-xs font-semibold uppercase tracking-wider px-4 py-3 hidden sm:table-cell">Owner</th>
                <th className="text-center text-white/30 text-xs font-semibold uppercase tracking-wider px-3 py-3 w-20">Record</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => {
                const isMe = team.user_id === user?.id;
                const priority = team.waiver_priority ?? '—';

                return (
                  <tr key={team.id} className={`border-b border-white/5 transition-colors ${isMe ? 'bg-gold/5' : 'hover:bg-white/[0.03]'}`}>
                    <td className="px-3 py-3 text-center">
                      <span className={`text-sm font-black ${
                        priority === 1 ? 'text-gold' : typeof priority === 'number' && priority <= 3 ? 'text-white/60' : 'text-white/30'
                      }`}>{priority}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/leagues/${id}/teams/${team.id}`}
                        className={`font-semibold text-sm hover:text-gold transition-colors ${isMe ? 'text-gold' : 'text-white'}`}>
                        {team.name}
                        {isMe && <span className="text-xs font-normal text-gold/60 ml-1">(you)</span>}
                      </Link>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="text-white/40 text-xs">{team.display_name || '—'}</span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className="text-white/50 font-mono text-sm">
                        {team.wins}-{team.losses}{team.ties > 0 ? `-${team.ties}` : ''}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
