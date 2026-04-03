'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { useAuthStore, useLeagueStore } from '@/lib/store';
import { teams as teamsApi, leagues as leaguesApi, players as playersApi } from '@/lib/api';
import TopBar from '@/components/layout/TopBar';
import type { League, Team, RosterPlayer, Player } from '@/types';
import clsx from 'clsx';

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={clsx('inline-block w-3 h-3', className)} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
    </svg>
  );
}

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

  // Add/drop state
  const [dropping, setDropping]         = useState<string | null>(null);
  const [dropErr, setDropErr]           = useState('');
  const [faSearch, setFaSearch]         = useState('');
  const [faPosFilter, setFaPosFilter]   = useState('');
  const [adding, setAdding]             = useState<string | null>(null);
  const [addMsg, setAddMsg]             = useState('');
  const [addErr, setAddErr]             = useState('');
  const [showFaPanel, setShowFaPanel]   = useState(false);

  const { data: leagueData } = useSWR(
    activeLeague && user ? `/leagues/${activeLeague.id}/full` : null,
    () => leaguesApi.get(activeLeague!.id) as Promise<League & { teams: Team[] }>
  );

  const myTeam = leagueData?.teams?.find((t) => t.user_id === user?.id);

  const { data: teamData, mutate: mutateRoster } = useSWR(
    myTeam ? `/teams/${myTeam.id}` : null,
    () => teamsApi.get(myTeam!.id) as Promise<Team & { roster: RosterPlayer[] }>
  );

  const { data: lockData } = useSWR(
    myTeam ? `/teams/${myTeam.id}/lineup-lock` : null,
    () => teamsApi.lineupLock(myTeam!.id),
    { refreshInterval: 60_000 }
  );

  const lockedIds = new Set(lockData?.locked_player_ids || []);

  // Free agent search — only fires when panel is open and search is ≥2 chars or filter is set
  const shouldSearchFa = showFaPanel && (faSearch.length >= 2 || !!faPosFilter);
  const { data: faPlayers = [] } = useSWR<Player[]>(
    shouldSearchFa ? `fa-${faPosFilter}-${faSearch}` : null,
    () => playersApi.list({ search: faSearch || undefined, position: faPosFilter || undefined, limit: 30 }) as Promise<Player[]>,
    { revalidateOnFocus: false }
  );

  // Roster player IDs for quick lookup
  const rosterIds = new Set((teamData?.roster || []).map((p) => p.id));
  // Free agents = players the search returned who are NOT on this roster
  const freeAgents = faPlayers.filter((p) => !rosterIds.has(p.id));

  async function handleDrop(playerId: string) {
    if (!myTeam) return;
    setDropping(playerId);
    setDropErr('');
    try {
      await teamsApi.dropPlayer(myTeam.id, playerId);
      await mutateRoster();
      setSaveMsg('Player dropped.');
    } catch (err) {
      setDropErr((err as Error).message);
    } finally {
      setDropping(null);
    }
  }

  async function handleAdd(playerId: string) {
    if (!myTeam) return;
    setAdding(playerId);
    setAddErr('');
    setAddMsg('');
    try {
      await teamsApi.addPlayer(myTeam.id, playerId);
      await mutateRoster();
      setAddMsg('Player added to your roster.');
    } catch (err) {
      setAddErr((err as Error).message);
    } finally {
      setAdding(null);
    }
  }

  const roster = teamData?.roster || [];
  const starters = roster
    .filter((p) => p.is_starter)
    .sort((a, b) => SLOT_ORDER.indexOf(a.roster_slot || '') - SLOT_ORDER.indexOf(b.roster_slot || ''));
  const bench = roster.filter((p) => !p.is_starter);

  function enterEditMode() {
    setPending(new Set(roster.filter((p) => p.is_starter).map((p) => p.id)));
    setEditMode(true);
    setSaveMsg('');
    setSaveErr('');
  }

  function togglePlayer(id: string) {
    if (lockedIds.has(id)) return; // locked — game already started
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
    } catch (err: unknown) {
      const errObj = err as { locked_players?: { name: string }[]; message?: string };
      if (errObj?.locked_players?.length) {
        const names = errObj.locked_players.map((p) => p.name).join(', ');
        setSaveErr(`Lineup locked — game already started for: ${names}`);
      } else {
        setSaveErr((err as Error).message || 'Failed to save lineup');
      }
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
                        const isLocked   = lockedIds.has(p.id);
                        return (
                          <tr
                            key={p.id}
                            className={clsx(
                              'border-b border-white/5 transition-colors',
                              isLocked
                                ? 'opacity-60 cursor-not-allowed'
                                : 'cursor-pointer',
                              !isLocked && isStarting ? 'bg-gold/5 hover:bg-gold/10' : '',
                              !isLocked && !isStarting ? 'hover:bg-white/5' : ''
                            )}
                            onClick={() => togglePlayer(p.id)}
                            title={isLocked ? 'Game already started — player is locked' : undefined}
                          >
                            <td className="px-4 py-3">
                              <p className="text-white font-semibold text-sm flex items-center gap-1">
                                {p.full_name}
                                {isLocked && <LockIcon className="text-red-400 ml-1" />}
                              </p>
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
                              {isLocked ? (
                                <span className="text-xs font-bold px-2 py-1 rounded bg-red-500/20 text-red-400">
                                  LOCKED
                                </span>
                              ) : (
                                <span className={clsx(
                                  'text-xs font-bold px-2 py-1 rounded',
                                  isStarting
                                    ? 'bg-gold/20 text-gold'
                                    : 'bg-white/10 text-white/40'
                                )}>
                                  {isStarting ? 'START' : 'BENCH'}
                                </span>
                              )}
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
                                <p className="text-white font-semibold text-sm flex items-center gap-1">
                                  {p.full_name}
                                  {lockedIds.has(p.id) && <LockIcon className="text-red-400" />}
                                </p>
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
                              <td className="px-4 py-3">
                                {p.injury_status ? (
                                  <span className={clsx('text-xs font-bold', INJURY_COLORS[p.injury_status] || 'text-white/40')}>
                                    {p.injury_status}
                                  </span>
                                ) : (
                                  <span className="text-green-400/60 text-xs">Active</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  disabled={dropping === p.id}
                                  onClick={() => handleDrop(p.id)}
                                  className="text-xs text-red-400 hover:text-red-300 disabled:opacity-40 border border-red-400/30 hover:border-red-300/50 rounded px-2 py-1 transition-colors"
                                >
                                  {dropping === p.id ? '…' : 'Drop'}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                  {dropErr && (
                    <p className="text-red-400 text-xs mt-2">{dropErr}</p>
                  )}
                </div>

                {/* Free Agent / Add Player */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-white font-black text-lg">Add Players</h2>
                    <button
                      onClick={() => { setShowFaPanel((v) => !v); setAddErr(''); setAddMsg(''); }}
                      className="btn-outline-gold text-sm py-2 px-4"
                    >
                      {showFaPanel ? 'Hide' : 'Browse Free Agents'}
                    </button>
                  </div>

                  {showFaPanel && (
                    <div className="card space-y-3">
                      {addMsg && <p className="text-green-400 text-sm">{addMsg}</p>}
                      {addErr && <p className="text-red-400 text-sm">{addErr}</p>}

                      <div className="flex flex-wrap gap-2">
                        {['', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map((pos) => (
                          <button
                            key={pos}
                            onClick={() => setFaPosFilter(pos)}
                            className={clsx(
                              'px-3 py-1 text-xs rounded font-bold border transition-colors',
                              faPosFilter === pos
                                ? 'bg-yellow-500 text-black border-yellow-500'
                                : 'border-white/20 text-white/60 hover:border-white/40'
                            )}
                          >
                            {pos || 'ALL'}
                          </button>
                        ))}
                        <input
                          type="text"
                          placeholder="Search name…"
                          value={faSearch}
                          onChange={(e) => setFaSearch(e.target.value)}
                          className="ml-auto px-3 py-1 text-xs bg-white/5 border border-white/20 rounded text-white placeholder-white/30 w-40"
                        />
                      </div>

                      {!shouldSearchFa ? (
                        <p className="text-white/30 text-xs text-center py-4">
                          Type a name or select a position to search
                        </p>
                      ) : freeAgents.length === 0 ? (
                        <p className="text-white/30 text-xs text-center py-4">No free agents found</p>
                      ) : (
                        <div className="overflow-auto max-h-64 border border-white/10 rounded">
                          <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-[#0f0f0f]">
                              <tr className="border-b border-white/10">
                                <th className="text-left text-white/40 text-xs px-3 py-2">Player</th>
                                <th className="text-left text-white/40 text-xs px-3 py-2">Pos</th>
                                <th className="text-left text-white/40 text-xs px-3 py-2">Team</th>
                                <th className="text-left text-white/40 text-xs px-3 py-2">Status</th>
                                <th className="px-3 py-2" />
                              </tr>
                            </thead>
                            <tbody>
                              {freeAgents.map((p) => (
                                <tr key={p.id} className="border-b border-white/5 hover:bg-white/5">
                                  <td className="px-3 py-2 text-white font-medium">{p.full_name}</td>
                                  <td className="px-3 py-2 text-white/60">{p.position}</td>
                                  <td className="px-3 py-2 text-white/60">{p.nfl_team}</td>
                                  <td className="px-3 py-2">
                                    {p.injury_status ? (
                                      <span className={clsx('text-xs font-bold', INJURY_COLORS[p.injury_status] || 'text-white/40')}>
                                        {p.injury_status}
                                      </span>
                                    ) : (
                                      <span className="text-green-400 text-xs">Active</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <button
                                      disabled={adding === p.id}
                                      onClick={() => handleAdd(p.id)}
                                      className="bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 text-black text-xs font-bold px-3 py-1 rounded"
                                    >
                                      {adding === p.id ? '…' : 'Add'}
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
