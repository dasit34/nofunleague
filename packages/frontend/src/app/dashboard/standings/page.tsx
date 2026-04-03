'use client';
import useSWR from 'swr';
import { leagues as leaguesApi } from '@/lib/api';
import { useLeagueStore } from '@/lib/store';
import TopBar from '@/components/layout/TopBar';
import type { League, Team } from '@/types';

export default function StandingsPage() {
  const activeLeague = useLeagueStore((s) => s.activeLeague);

  const { data: league } = useSWR(
    activeLeague ? `/leagues/${activeLeague.id}/full` : null,
    () => leaguesApi.get(activeLeague!.id) as Promise<League & { teams: Team[] }>
  );

  const teams = league?.teams || [];

  return (
    <div>
      <TopBar title="Standings" subtitle={activeLeague?.name} />

      <div className="p-6">
        {!activeLeague ? (
          <div className="card text-center text-white/40 py-12">Select a league to view standings</div>
        ) : (
          <div className="card overflow-hidden p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10 bg-dark-100">
                  <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">#</th>
                  <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">Team</th>
                  <th className="text-right text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">W</th>
                  <th className="text-right text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">L</th>
                  <th className="text-right text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">T</th>
                  <th className="text-right text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">PF</th>
                  <th className="text-right text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">PA</th>
                  <th className="text-right text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">+/-</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((team, idx) => {
                  const diff = Number(team.points_for) - Number(team.points_against);
                  return (
                    <tr
                      key={team.id}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <span className={`font-black text-sm ${
                          idx === 0 ? 'text-gold' :
                          idx <= 3 ? 'text-white' : 'text-white/30'
                        }`}>{idx + 1}</span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-white font-bold text-sm">{team.name}</p>
                        {team.display_name && (
                          <p className="text-white/40 text-xs">{team.display_name}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-green-400 font-bold text-sm">{team.wins}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-red-400 font-bold text-sm">{team.losses}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-white/40 font-bold text-sm">{team.ties}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-gold font-mono text-sm font-bold">
                          {Number(team.points_for).toFixed(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-white/60 font-mono text-sm">
                          {Number(team.points_against).toFixed(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-mono text-sm ${diff > 0 ? 'text-green-400' : diff < 0 ? 'text-red-400' : 'text-white/40'}`}>
                          {diff > 0 ? '+' : ''}{diff.toFixed(1)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {teams.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center text-white/30 py-12 text-sm">
                      No teams in this league yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
