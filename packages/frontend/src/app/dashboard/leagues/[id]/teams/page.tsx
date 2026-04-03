'use client';
import { use } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { leagues as leaguesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { League, Team } from '@/types';

export default function TeamsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuthStore();

  const { data: league } = useSWR(
    `/leagues/${id}`,
    () => leaguesApi.get(id) as Promise<League & { teams: Team[] }>
  );

  const teams = league?.teams || [];

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-white font-black text-lg">Teams</h2>

      {teams.length === 0 ? (
        <div className="card text-center text-white/30 py-12 text-sm">
          No teams in this league yet. Members can create teams from the Overview tab.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {teams.map((team) => {
            const isMe = team.user_id === user?.id;
            return (
              <Link
                key={team.id}
                href={`/dashboard/leagues/${id}/teams/${team.id}`}
                className={`card hover:border-gold/30 transition-all ${isMe ? 'border-gold/30' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center">
                      {team.avatar_url ? (
                        <img src={team.avatar_url} alt="" className="w-full h-full object-cover rounded-full" />
                      ) : (
                        <span className="text-gold font-bold text-sm">{team.name[0]?.toUpperCase()}</span>
                      )}
                    </div>
                    <div>
                      <p className={`font-semibold text-sm ${isMe ? 'text-gold' : 'text-white'}`}>
                        {team.name} {isMe && <span className="text-xs font-normal">(you)</span>}
                      </p>
                      {team.display_name && <p className="text-white/40 text-xs">{team.display_name}</p>}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-white font-mono text-sm">{team.wins}-{team.losses}{team.ties > 0 ? `-${team.ties}` : ''}</p>
                    <p className="text-white/40 text-xs">{Number(team.points_for).toFixed(1)} PF</p>
                    <p className="text-gold/60 text-xs mt-1">View Roster →</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
