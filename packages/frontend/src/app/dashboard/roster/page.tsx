'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { useAuthStore, useLeagueStore } from '@/lib/store';
import { teams as teamsApi, leagues as leaguesApi } from '@/lib/api';
import TopBar from '@/components/layout/TopBar';
import type { League, Team, RosterPlayer } from '@/types';
import clsx from 'clsx';

const SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN'];

const INJURY_COLORS: Record<string, string> = {
  Q:  'text-yellow-400',
  D:  'text-orange-400',
  O:  'text-red-400',
  IR: 'text-red-600',
};

export default function RosterPage() {
  const { user } = useAuthStore();
  const activeLeague = useLeagueStore((s) => s.activeLeague);

  const [editMode, setEditMode]         = useState(false);
  const [pendingStarters, setPending]   = useState<Set<string>>(new Set());
  const [saving, setSaving]             = useState(false);
  const [saveMsg, setSaveMsg]           = useState('');
  const [saveErr, setSaveErr]           = useState('');

  const { data: leagueData } = useSWR(
    activeLeague && user ? `/leagues/${activeLeague.id}/full` : null,
    () => leaguesApi.get(activeLeague!.id) as Promise<League & { teams: Team[] }>
  );

  const myTeam = leagueData?.teams?.find((t) => t.user_id === user?.id);

  const { data: teamData, mutate: mutateRoster } = useSWR(
    myTeam ? `/teams/${myTeam.id}` : null,
    () => teamsApi.get(myTeam!.id) as Promise<Team & { roster: RosterPlayer[] }>
  );

  const roster = teamData?.roster || [];
  const starters = roster
    .filter((p) => p.is_starter)
    .sort((a, b) => SLOT_ORDER.indexOf(a.roster_slot) - SLOT_ORDER.indexOf(b.roster_slot));
  const bench = roster.filter((p) => !p.is_starter);

  function enterEditMode() {
    setPending(new Set(roster.filter((p) => p.is_starter).map((p) => p.id)));
    setEditMode(true);
    setSaveMsg('');
    setSaveErr('');
  }

  function togglePlayer(id: string) {
    setPending((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function saveLineup() {
    if (!myTeam) return;
    setSaving(true);
    setSaveMsg('');
    setSaveErr('');
    try {
      await teamsApi.setRoster(myTeam.id, Array.from(pendingStarters));
      await mutateRoster();
      setEditMode(false);
      setSaveMsg('Lineup saved.');
    } catch (err) {
      setSaveErr((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <TopBar title="My Roster" subtitle={myTeam?.name || 'No team found'} />

      <div className="p-6 space-y-6">
        {!activeLeague ? (
          <div className="card text-center text-white/40 py-12">Select a league first</div>
        ) : !myTeam ? (
          <div className="card text-center py-12">
            <p className="text-white/40 mb-2">You don't have a team in this league.</p>
            <p className="text-white/20 text-sm">
              Set your Sleeper username in Profile, then ask the commissioner to sync the league.
            </p>
          </div>
        ) : (
          <>
            {/* Team Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Record',        value: `${myTeam.wins}-${myTeam.losses}` },
                { label: 'Points For',    value: Number(myTeam.points_for).toFixed(1) },
                { label: 'Points Against',value: Number(myTeam.points_against).toFixed(1) },
                { label: 'FAAB Left',     value: `$${myTeam.faab_balance}` },
              ].map((s) => (
                <div key={s.label} className="card text-center">
                  <div className="stat-value text-2xl">{s.value}</div>
                  <div className="stat-label mt-1">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Feedback */}
            {saveMsg && (
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-green-400 text-sm">
                {saveMsg}
              </div>
            )}
            {saveErr && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                {saveErr}
              </div>
            )}

            {/* Edit mode */}
            {editMode ? (
              <div className="space-y-4">
                <div className="card-gold">
                  <p className="text-gold font-bold text-sm">Editing Lineup</p>
                  <p className="text-white/50 text-xs mt-1">
                    Toggle players to move them between starters and bench. Save when done.
                  </p>
                </div>

                <div className="card overflow-hidden p-0">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/10">
                        <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">Player</th>
                        <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">Pos</th>
                        <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">Status</th>
                        <th className="text-right text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">Slot</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roster.map((p) => {
                        const isStarting = pendingStarters.has(p.id);
                        return (
                          <tr
                            key={p.id}
                            className={clsx(
                              'border-b border-white/5 cursor-pointer transition-colors',
                              isStarting ? 'bg-gold/5 hover:bg-gold/10' : 'hover:bg-white/5'
                            )}
                            onClick={() => togglePlayer(p.id)}
                          >
                            <td className="px-4 py-3">
                              <p className="text-white font-semibold text-sm">{p.full_name}</p>
                              <p className="text-white/40 text-xs">{p.nfl_team}</p>
                            </td>
                            <td className="px-4 py-3">
                              <span className="badge-gold text-xs">{p.position}</span>
                            </td>
                            <td className="px-4 py-3">
                              {p.injury_status ? (
                                <span className={clsx('text-xs font-bold', INJURY_COLORS[p.injury_status] || 'text-white/40')}>
                                  {p.injury_status}
                                </span>
                              ) : (
                                <span className="text-green-400 text-xs">Active</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className={clsx(
                                'text-xs font-bold px-2 py-1 rounded',
                                isStarting
                                  ? 'bg-gold/20 text-gold'
                                  : 'bg-white/10 text-white/40'
                              )}>
                                {isStarting ? 'START' : 'BENCH'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex gap-3">
                  <button onClick={saveLineup} disabled={saving} className="btn-gold flex-1">
                    {saving ? 'Saving...' : `Save Lineup (${pendingStarters.size} starters)`}
                  </button>
                  <button
                    onClick={() => setEditMode(false)}
                    className="btn-dark border border-white/10 px-6"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Starters */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-white font-black text-lg">Starters</h2>
                    <button onClick={enterEditMode} className="btn-outline-gold text-sm py-2 px-4">
                      Edit Lineup
                    </button>
                  </div>
                  <div className="card overflow-hidden p-0">
                    {starters.length === 0 ? (
                      <div className="text-center text-white/30 py-8 text-sm space-y-2">
                        <p>No starters set.</p>
                        <button onClick={enterEditMode} className="text-gold text-xs hover:text-gold/70 transition-colors">
                          Edit lineup →
                        </button>
                      </div>
                    ) : (
                      <table className="w-full">
                        <tbody>
                          {starters.map((p) => (
                            <tr key={p.id} className="border-b border-white/5 hover:bg-white/5">
                              <td className="px-4 py-3 w-14">
                                <span className="badge-gold text-xs">{p.roster_slot || p.position}</span>
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
          </>
        )}
      </div>
    </div>
  );
}
