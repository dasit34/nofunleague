'use client';
import { useAuthStore, useLeagueStore } from '@/lib/store';
import useSWR from 'swr';
import { teams as teamsApi, leagues as leaguesApi } from '@/lib/api';
import TopBar from '@/components/layout/TopBar';
import type { League, Team, RosterPlayer } from '@/types';
import clsx from 'clsx';

const SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN'];

const INJURY_COLORS: Record<string, string> = {
  Q: 'text-yellow-400',
  D: 'text-orange-400',
  O: 'text-red-400',
  IR: 'text-red-600',
};

export default function RosterPage() {
  const { user } = useAuthStore();
  const activeLeague = useLeagueStore((s) => s.activeLeague);

  const { data: leagueData } = useSWR(
    activeLeague && user ? `/leagues/${activeLeague.id}/full` : null,
    () => leaguesApi.get(activeLeague!.id) as Promise<League & { teams: Team[] }>
  );

  const myTeam = leagueData?.teams?.find((t) => t.user_id === user?.id);

  const { data: teamData } = useSWR(
    myTeam ? `/teams/${myTeam.id}` : null,
    () => teamsApi.get(myTeam!.id) as Promise<Team & { roster: RosterPlayer[] }>
  );

  const roster = teamData?.roster || [];
  const starters = roster.filter((p) => p.is_starter).sort((a, b) =>
    SLOT_ORDER.indexOf(a.roster_slot) - SLOT_ORDER.indexOf(b.roster_slot)
  );
  const bench = roster.filter((p) => !p.is_starter);

  return (
    <div>
      <TopBar title="My Roster" subtitle={myTeam?.name || 'No team found'} />

      <div className="p-6 space-y-6">
        {!activeLeague ? (
          <div className="card text-center text-white/40 py-12">Select a league first</div>
        ) : !myTeam ? (
          <div className="card text-center text-white/40 py-12">You don't have a team in this league</div>
        ) : (
          <>
            {/* Team Stats */}
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: 'Record', value: `${myTeam.wins}-${myTeam.losses}` },
                { label: 'Points For', value: Number(myTeam.points_for).toFixed(1) },
                { label: 'Points Against', value: Number(myTeam.points_against).toFixed(1) },
                { label: 'FAAB Left', value: `$${myTeam.faab_balance}` },
              ].map((s) => (
                <div key={s.label} className="card text-center">
                  <div className="stat-value text-2xl">{s.value}</div>
                  <div className="stat-label mt-1">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Starters */}
            <div>
              <h2 className="text-white font-black text-lg mb-3">Starters</h2>
              <div className="card overflow-hidden p-0">
                {starters.length === 0 ? (
                  <p className="text-center text-white/30 py-8 text-sm">No starters set</p>
                ) : (
                  <table className="w-full">
                    <tbody>
                      {starters.map((p) => (
                        <tr key={p.id} className="border-b border-white/5 hover:bg-white/5">
                          <td className="px-4 py-3 w-14">
                            <span className="badge-gold text-xs">{p.roster_slot}</span>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-white font-semibold text-sm">{p.full_name}</p>
                            <p className="text-white/40 text-xs">{p.nfl_team}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span className="badge-dark text-xs">{p.position}</span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {p.injury_status ? (
                              <span className={clsx('text-xs font-bold', INJURY_COLORS[p.injury_status] || 'text-white/40')}>
                                {p.injury_status}
                              </span>
                            ) : (
                              <span className="text-green-400 text-xs">Active</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Bench */}
            <div>
              <h2 className="text-white font-black text-lg mb-3">Bench</h2>
              <div className="card overflow-hidden p-0">
                {bench.length === 0 ? (
                  <p className="text-center text-white/30 py-8 text-sm">No bench players</p>
                ) : (
                  <table className="w-full">
                    <tbody>
                      {bench.map((p) => (
                        <tr key={p.id} className="border-b border-white/5 hover:bg-white/5 opacity-70">
                          <td className="px-4 py-3 w-14">
                            <span className="badge badge-dark text-xs">BN</span>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-white font-semibold text-sm">{p.full_name}</p>
                            <p className="text-white/40 text-xs">{p.nfl_team}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span className="badge-dark text-xs">{p.position}</span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {p.injury_status ? (
                              <span className={clsx('text-xs font-bold', INJURY_COLORS[p.injury_status] || 'text-white/40')}>
                                {p.injury_status}
                              </span>
                            ) : (
                              <span className="text-green-400/60 text-xs">Active</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
