'use client';
import { use } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { leagues as leaguesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { League, Team, LeagueMember } from '@/types';

type LeagueData = League & { teams: Team[]; members: LeagueMember[] };

export default function ManagersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuthStore();
  const { data: league } = useSWR(`/leagues/${id}`, () => leaguesApi.get(id) as Promise<LeagueData>);

  if (!league) return null;
  const isCommissioner = league.commissioner_id === user?.id;
  if (!isCommissioner) return (
    <div className="p-6"><div className="card text-center py-12 text-white/40 text-sm">Commissioner access required.</div></div>
  );

  const members = league.members || [];
  const teams = league.teams || [];
  const openSlots = Math.max(0, league.league_size - members.length);

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link href={`/dashboard/leagues/${id}/league/manager-tools`} className="text-white/30 text-xs hover:text-gold transition-colors">← Manager Tools</Link>
        <h2 className="text-white font-black text-lg mt-1">Managers</h2>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card text-center py-4">
          <p className="text-2xl font-black text-white">{members.length}</p>
          <p className="text-white/40 text-xs mt-1">Members</p>
        </div>
        <div className="card text-center py-4">
          <p className="text-2xl font-black text-white">{teams.length}</p>
          <p className="text-white/40 text-xs mt-1">Teams</p>
        </div>
        <div className="card text-center py-4">
          <p className={`text-2xl font-black ${openSlots > 0 ? 'text-gold' : 'text-white/30'}`}>{openSlots}</p>
          <p className="text-white/40 text-xs mt-1">Open Slots</p>
        </div>
      </div>

      {/* Member list */}
      <div className="card overflow-hidden p-0">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">Manager</th>
              <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">Team</th>
              <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">Role</th>
              <th className="text-right text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const team = teams.find((t) => t.user_id === m.user_id);
              const isMe = m.user_id === user?.id;
              return (
                <tr key={m.id} className={`border-b border-white/5 ${isMe ? 'bg-gold/5' : 'hover:bg-white/5'} transition-colors`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center">
                        <span className="text-gold font-bold text-xs">{m.display_name?.[0]?.toUpperCase() || '?'}</span>
                      </div>
                      <div>
                        <p className={`text-sm font-semibold ${isMe ? 'text-gold' : 'text-white'}`}>
                          {m.display_name || m.username} {isMe && <span className="text-xs font-normal">(you)</span>}
                        </p>
                        <p className="text-white/30 text-xs">@{m.username}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-white/60 text-sm">{team?.name || 'No team'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold uppercase tracking-wider ${m.role === 'commissioner' ? 'text-gold' : 'text-white/40'}`}>
                      {m.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {m.role !== 'commissioner' && (
                      <button disabled className="text-white/20 text-xs hover:text-red-400 transition-colors" title="Coming soon">
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {/* Empty slot rows */}
            {openSlots > 0 && Array.from({ length: Math.min(openSlots, 4) }).map((_, i) => (
              <tr key={`empty-${i}`} className="border-b border-white/5">
                <td className="px-4 py-3" colSpan={4}>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full border border-dashed border-white/10 flex items-center justify-center">
                      <span className="text-white/10 text-xs">+</span>
                    </div>
                    <span className="text-white/20 text-xs italic">Open slot</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
