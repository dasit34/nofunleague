'use client';
import { use } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { leagues as leaguesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { formatStatus } from '@/types';

export default function StandingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuthStore();

  const { data } = useSWR(
    `/leagues/${id}/standings`,
    () => leaguesApi.getStandings(id)
  );

  const standings = data?.standings || [];
  const currentWeek = data?.week ?? 1;
  const status = data?.status ?? '';
  const gamesPlayed = currentWeek > 1 ? currentWeek - 1 : 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-white font-black text-lg">Standings</h2>
          <p className="text-white/30 text-xs mt-0.5">
            {gamesPlayed > 0 ? `Through Week ${gamesPlayed}` : 'Season has not started'}
            {status && ` · ${formatStatus(status)}`}
          </p>
        </div>
      </div>

      {/* Standings Table */}
      {standings.length === 0 ? (
        <div className="card text-center py-12 space-y-2">
          <p className="text-white/40 text-sm">No teams in this league yet.</p>
          <p className="text-white/20 text-xs">Invite members to join, then draft to start the season.</p>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          {/* Desktop table */}
          <table className="w-full hidden md:table">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-center text-white/30 text-xs font-semibold uppercase tracking-wider px-3 py-3 w-12">#</th>
                <th className="text-left text-white/30 text-xs font-semibold uppercase tracking-wider px-4 py-3">Team</th>
                <th className="text-center text-white/30 text-xs font-semibold uppercase tracking-wider px-3 py-3 w-20">Record</th>
                <th className="text-center text-white/30 text-xs font-semibold uppercase tracking-wider px-3 py-3 w-12">W</th>
                <th className="text-center text-white/30 text-xs font-semibold uppercase tracking-wider px-3 py-3 w-12">L</th>
                <th className="text-center text-white/30 text-xs font-semibold uppercase tracking-wider px-3 py-3 w-12">T</th>
                <th className="text-right text-white/30 text-xs font-semibold uppercase tracking-wider px-4 py-3 w-20">PF</th>
                <th className="text-right text-white/30 text-xs font-semibold uppercase tracking-wider px-4 py-3 w-20">PA</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((team) => {
                const isMe = team.user_id === user?.id;
                return (
                  <tr key={team.team_id} className={`border-b border-white/5 transition-colors ${isMe ? 'bg-gold/5' : 'hover:bg-white/[0.03]'}`}>
                    <td className="px-3 py-3 text-center">
                      <span className={`text-sm font-black ${
                        team.rank === 1 ? 'text-gold' : team.rank === 2 ? 'text-white/60' : team.rank === 3 ? 'text-orange-400/60' : 'text-white/20'
                      }`}>{team.rank}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/leagues/${id}/teams/${team.team_id}`} className="group">
                        <p className={`font-semibold text-sm group-hover:text-gold transition-colors ${isMe ? 'text-gold' : 'text-white'}`}>
                          {team.team_name}
                          {isMe && <span className="text-xs font-normal text-gold/60 ml-1">(you)</span>}
                        </p>
                        {team.display_name && <p className="text-white/30 text-xs">{team.display_name}</p>}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-center"><span className="text-white font-mono text-sm font-bold">{team.record}</span></td>
                    <td className="px-3 py-3 text-center"><span className="text-white/60 font-mono text-sm">{team.wins}</span></td>
                    <td className="px-3 py-3 text-center"><span className="text-white/60 font-mono text-sm">{team.losses}</span></td>
                    <td className="px-3 py-3 text-center"><span className="text-white/30 font-mono text-sm">{team.ties}</span></td>
                    <td className="px-4 py-3 text-right"><span className="text-gold font-mono text-sm">{team.points_for.toFixed(1)}</span></td>
                    <td className="px-4 py-3 text-right"><span className="text-white/40 font-mono text-sm">{team.points_against.toFixed(1)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Mobile card list */}
          <div className="md:hidden divide-y divide-white/5">
            {standings.map((team) => {
              const isMe = team.user_id === user?.id;
              return (
                <Link key={team.team_id} href={`/dashboard/leagues/${id}/teams/${team.team_id}`}
                  className={`flex items-center gap-3 px-4 py-3 transition-colors ${isMe ? 'bg-gold/5' : 'hover:bg-white/[0.03]'}`}>
                  <span className={`text-lg font-black w-8 text-center shrink-0 ${
                    team.rank === 1 ? 'text-gold' : team.rank === 2 ? 'text-white/60' : team.rank === 3 ? 'text-orange-400/60' : 'text-white/15'
                  }`}>{team.rank}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`font-semibold text-sm truncate ${isMe ? 'text-gold' : 'text-white'}`}>{team.team_name}</p>
                    {team.display_name && <p className="text-white/30 text-xs truncate">{team.display_name}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-white font-mono text-sm font-bold">{team.record}</p>
                    <p className="text-gold/60 font-mono text-xs">{team.points_for.toFixed(1)} PF</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
