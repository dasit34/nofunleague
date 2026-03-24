'use client';
import { use, useEffect } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { leagues as leaguesApi } from '@/lib/api';
import { useLeagueStore } from '@/lib/store';
import TopBar from '@/components/layout/TopBar';
import type { League, Team } from '@/types';

export default function LeaguePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const setActiveLeague = useLeagueStore((s) => s.setActiveLeague);

  const { data: league, mutate } = useSWR(
    `/leagues/${id}`,
    () => leaguesApi.get(id) as Promise<League & { teams: Team[] }>
  );

  useEffect(() => {
    if (league) setActiveLeague(league);
  }, [league, setActiveLeague]);

  async function handleSync() {
    await leaguesApi.syncSleeper(id);
    mutate();
  }

  const teams = league?.teams || [];

  return (
    <div>
      <TopBar
        title={league?.name || 'Loading...'}
        subtitle={`Season ${league?.season} — Week ${league?.week}`}
      />

      <div className="p-6 space-y-6">
        {/* Actions */}
        {league?.sleeper_league_id && (
          <div className="flex gap-3">
            <button onClick={handleSync} className="btn-outline-gold text-sm py-2 px-4">
              Sync from Sleeper
            </button>
            <Link href={`/dashboard/leagues/${id}/matchups`} className="btn-dark text-sm py-2 px-4">
              View Matchups
            </Link>
          </div>
        )}

        {/* Standings */}
        <div>
          <h2 className="text-white font-black text-lg mb-4">Standings</h2>
          <div className="card overflow-hidden p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">#</th>
                  <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">Team</th>
                  <th className="text-right text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">W-L</th>
                  <th className="text-right text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">PF</th>
                  <th className="text-right text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">PA</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((team, idx) => (
                  <tr key={team.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3">
                      <span className={`text-sm font-bold ${idx === 0 ? 'text-gold' : 'text-white/40'}`}>
                        {idx + 1}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-white font-semibold text-sm">{team.name}</p>
                      {team.display_name && (
                        <p className="text-white/40 text-xs">{team.display_name}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-white font-mono text-sm">{team.wins}-{team.losses}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-gold font-mono text-sm">{Number(team.points_for).toFixed(1)}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-white/60 font-mono text-sm">{Number(team.points_against).toFixed(1)}</span>
                    </td>
                  </tr>
                ))}
                {teams.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center text-white/30 py-8 text-sm">
                      No teams yet. Sync from Sleeper or add teams manually.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { href: `/dashboard/leagues/${id}/matchups`, icon: '⚔️', label: 'Matchups' },
            { href: `/dashboard/chat`, icon: '💬', label: 'League Chat' },
            { href: `/dashboard/ai`, icon: '🤖', label: 'AI Chaos' },
            { href: `/dashboard/players`, icon: '🏈', label: 'Players' },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="card hover:border-gold/30 transition-all text-center group py-4"
            >
              <div className="text-2xl mb-2">{item.icon}</div>
              <div className="text-white/60 text-sm font-semibold group-hover:text-gold transition-colors">
                {item.label}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
