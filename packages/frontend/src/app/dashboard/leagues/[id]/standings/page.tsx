'use client';
import { use } from 'react';
import useSWR from 'swr';
import { leagues as leaguesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { League, Team } from '@/types';

export default function StandingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuthStore();

  const { data: league } = useSWR(
    `/leagues/${id}`,
    () => leaguesApi.get(id) as Promise<League & { teams: Team[] }>
  );

  // Explicit sort: wins DESC, then points_for DESC (safety — backend also sorts)
  const teams = [...(league?.teams || [])].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return Number(b.points_for) - Number(a.points_for);
  });

  const isRealMode = (league?.scoring_source ?? 'mock') === 'real';

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-black text-lg">Standings</h2>
        {league && (
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded ${
              isRealMode
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
            }`}>
              {isRealMode ? 'Real Stats' : 'Mock'}
            </span>
            <span className="text-white/30 text-xs">Week {league.week}</span>
          </div>
        )}
      </div>

      {teams.length === 0 ? (
        <div className="card text-center text-white/30 py-12 text-sm">
          No teams yet. Standings will appear once teams are added.
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">Rank</th>
                <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">Team</th>
                <th className="text-right text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">W</th>
                <th className="text-right text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">L</th>
                <th className="text-right text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">T</th>
                <th className="text-right text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">PF</th>
                <th className="text-right text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">PA</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team, idx) => {
                const isMe = team.user_id === user?.id;
                return (
                  <tr key={team.id} className={`border-b border-white/5 ${isMe ? 'bg-gold/5' : 'hover:bg-white/5'} transition-colors`}>
                    <td className="px-4 py-3">
                      <span className={`text-sm font-bold ${idx === 0 ? 'text-gold' : 'text-white/40'}`}>{idx + 1}</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className={`font-semibold text-sm ${isMe ? 'text-gold' : 'text-white'}`}>
                        {team.name} {isMe && <span className="text-xs font-normal">(you)</span>}
                      </p>
                      {team.display_name && <p className="text-white/40 text-xs">{team.display_name}</p>}
                    </td>
                    <td className="px-4 py-3 text-right"><span className="text-white font-mono text-sm">{team.wins}</span></td>
                    <td className="px-4 py-3 text-right"><span className="text-white font-mono text-sm">{team.losses}</span></td>
                    <td className="px-4 py-3 text-right"><span className="text-white/40 font-mono text-sm">{team.ties}</span></td>
                    <td className="px-4 py-3 text-right"><span className="text-gold font-mono text-sm">{Number(team.points_for).toFixed(1)}</span></td>
                    <td className="px-4 py-3 text-right"><span className="text-white/60 font-mono text-sm">{Number(team.points_against).toFixed(1)}</span></td>
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
