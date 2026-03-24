'use client';
import { useState, useEffect, useCallback } from 'react';
import useSWR from 'swr';
import { useAuthStore, useLeagueStore } from '@/lib/store';
import { draft as draftApi, leagues as leaguesApi } from '@/lib/api';
import TopBar from '@/components/layout/TopBar';
import type {
  League, Team,
  DraftState, DraftAvailablePlayer, DraftPickRow,
} from '@/types';
import clsx from 'clsx';

const POSITION_COLORS: Record<string, string> = {
  QB:  'bg-red-500/20 text-red-400',
  RB:  'bg-green-500/20 text-green-400',
  WR:  'bg-blue-500/20 text-blue-400',
  TE:  'bg-orange-500/20 text-orange-400',
  K:   'bg-purple-500/20 text-purple-400',
  DEF: 'bg-gray-500/20 text-gray-400',
};

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

function Timer({ seconds, total }: { seconds: number; total: number }) {
  const pct = total > 0 ? (seconds / total) * 100 : 0;
  const color = seconds <= 10 ? 'bg-red-500' : seconds <= 30 ? 'bg-yellow-500' : 'bg-gold';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-white/60">Time remaining</span>
        <span className={clsx('font-mono font-bold text-lg', seconds <= 10 ? 'text-red-400' : 'text-gold')}>
          {seconds}s
        </span>
      </div>
      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
        <div
          className={clsx('h-full rounded-full transition-all duration-1000', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function PickBadge({ p }: { p: DraftPickRow }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-white/5 last:border-0">
      <span className="text-white/30 font-mono text-xs w-6 text-right">{p.overall_pick}</span>
      <span className={clsx('badge text-xs px-1.5 py-0.5 rounded', POSITION_COLORS[p.position] || 'bg-white/10 text-white/60')}>
        {p.position}
      </span>
      <span className="text-white text-xs font-semibold flex-1 truncate">{p.player_name}</span>
      <span className="text-white/40 text-xs truncate max-w-[6rem]">{p.team_name}</span>
      {p.is_auto_pick && <span className="text-yellow-500/60 text-xs">AUTO</span>}
    </div>
  );
}

export default function DraftPage() {
  const { user } = useAuthStore();
  const activeLeague = useLeagueStore((s) => s.activeLeague);

  const [posFilter, setPosFilter] = useState('ALL');
  const [search, setSearch]       = useState('');
  const [picking, setPicking]     = useState(false);
  const [pickErr, setPickErr]     = useState('');
  const [starting, setStarting]   = useState(false);
  const [startErr, setStartErr]   = useState('');

  // League data to find my team + check commissioner
  const { data: leagueData } = useSWR(
    activeLeague ? `/leagues/${activeLeague.id}/full` : null,
    () => leaguesApi.get(activeLeague!.id) as Promise<League & { teams: Team[] }>
  );

  const myTeam = leagueData?.teams?.find((t) => t.user_id === user?.id);
  const isCommissioner = leagueData?.commissioner_id === user?.id;

  // Poll draft state every 3s
  const { data: draftState, mutate: mutateDraft } = useSWR<DraftState>(
    activeLeague ? `/draft/${activeLeague.id}/state` : null,
    () => draftApi.getState(activeLeague!.id) as Promise<DraftState>,
    { refreshInterval: 3000, revalidateOnFocus: true }
  );

  // Available players
  const availableKey = activeLeague
    ? `/draft/${activeLeague.id}/available?pos=${posFilter}&q=${search}`
    : null;
  const { data: available } = useSWR<DraftAvailablePlayer[]>(
    draftState?.session?.status === 'active' ? availableKey : null,
    () => draftApi.available(activeLeague!.id, {
      position: posFilter !== 'ALL' ? posFilter : undefined,
      search: search || undefined,
      limit: 100,
    }) as Promise<DraftAvailablePlayer[]>,
    { refreshInterval: 5000 }
  );

  const session      = draftState?.session;
  const myTeamId     = myTeam?.id;
  const isMyTurn     = !!myTeamId && draftState?.currentTeamId === myTeamId;
  const isDone       = session?.status === 'complete';
  const isActive     = session?.status === 'active';
  const noDraft      = !session;

  const onboardTeamName = draftState?.teams?.find(
    (t) => t.id === draftState.currentTeamId
  )?.display_name || draftState?.teams?.find(
    (t) => t.id === draftState?.currentTeamId
  )?.name;

  const myPicks = draftState?.picks?.filter((p) => p.team_id === myTeamId) ?? [];

  async function handlePick(playerId: string) {
    if (!activeLeague || !isMyTurn) return;
    setPicking(true);
    setPickErr('');
    try {
      await draftApi.pick(activeLeague.id, playerId);
      await mutateDraft();
    } catch (err) {
      setPickErr((err as Error).message);
    } finally {
      setPicking(false);
    }
  }

  async function handleStart() {
    if (!activeLeague) return;
    setStarting(true);
    setStartErr('');
    try {
      await draftApi.start(activeLeague.id, { total_rounds: 15, seconds_per_pick: 90 });
      await mutateDraft();
    } catch (err) {
      setStartErr((err as Error).message);
    } finally {
      setStarting(false);
    }
  }

  if (!activeLeague) {
    return (
      <div>
        <TopBar title="Draft Room" />
        <div className="p-6">
          <div className="card text-center text-white/40 py-12">Select a league first</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <TopBar
        title="Draft Room"
        subtitle={activeLeague.name}
      />

      <div className="p-4 space-y-4">

        {/* No draft yet */}
        {noDraft && (
          <div className="card text-center py-12 space-y-4">
            <p className="text-white/40">No draft session found for this league.</p>
            {isCommissioner && (
              <>
                <button
                  onClick={handleStart}
                  disabled={starting}
                  className="btn-gold"
                >
                  {starting ? 'Starting...' : 'Start Draft'}
                </button>
                {startErr && <p className="text-red-400 text-sm">{startErr}</p>}
              </>
            )}
          </div>
        )}

        {/* Draft complete */}
        {isDone && (
          <div className="card-gold text-center py-8 space-y-2">
            <p className="text-gold font-black text-xl">Draft Complete!</p>
            <p className="text-white/60 text-sm">All {session!.total_rounds} rounds finished.</p>
          </div>
        )}

        {/* Active draft */}
        {isActive && draftState && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* LEFT — On the clock + player pool */}
            <div className="lg:col-span-2 space-y-4">

              {/* On the clock */}
              <div className={clsx(
                'card border',
                isMyTurn ? 'border-gold/40 bg-gold/5' : 'border-white/10'
              )}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-white/50 text-xs uppercase tracking-wider font-semibold">
                      Round {draftState.round} · Pick {draftState.pickInRound}
                      &nbsp;(Overall #{session!.current_pick})
                    </p>
                    <p className={clsx('font-black text-lg mt-0.5', isMyTurn ? 'text-gold' : 'text-white')}>
                      {isMyTurn ? 'Your pick!' : `${onboardTeamName || '…'} is picking`}
                    </p>
                  </div>
                  {session!.seconds_per_pick > 0 && (
                    <div className="w-36">
                      <Timer seconds={draftState.secondsRemaining} total={session!.seconds_per_pick} />
                    </div>
                  )}
                </div>
                {pickErr && <p className="text-red-400 text-sm mt-2">{pickErr}</p>}
              </div>

              {/* Player pool */}
              <div className="card p-0 overflow-hidden">
                {/* Filters */}
                <div className="p-3 border-b border-white/10 flex gap-2 flex-wrap items-center">
                  <div className="flex gap-1 flex-wrap">
                    {POSITIONS.map((pos) => (
                      <button
                        key={pos}
                        onClick={() => setPosFilter(pos)}
                        className={clsx(
                          'px-2 py-1 rounded text-xs font-bold transition-colors',
                          posFilter === pos
                            ? 'bg-gold text-black'
                            : 'bg-white/10 text-white/60 hover:bg-white/20'
                        )}
                      >
                        {pos}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    placeholder="Search players..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="input-dark text-sm py-1 flex-1 min-w-[120px]"
                  />
                </div>

                <div className="overflow-y-auto max-h-[420px]">
                  <table className="w-full">
                    <thead className="sticky top-0 bg-[#1a1a2e]">
                      <tr className="border-b border-white/10">
                        <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-3 py-2">Player</th>
                        <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-3 py-2 hidden sm:table-cell">Team</th>
                        <th className="text-right text-white/40 text-xs font-semibold uppercase tracking-wider px-3 py-2">Avg PPR</th>
                        <th className="px-3 py-2 w-16"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(available || []).map((p) => (
                        <tr key={p.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span className={clsx('badge text-xs px-1.5 py-0.5 rounded', POSITION_COLORS[p.position] || 'bg-white/10 text-white/60')}>
                                {p.position}
                              </span>
                              <div>
                                <p className="text-white text-sm font-semibold">{p.full_name}</p>
                                {p.injury_status && (
                                  <p className="text-yellow-400 text-xs">{p.injury_status}</p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2 hidden sm:table-cell">
                            <span className="text-white/50 text-xs">{p.nfl_team}</span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <span className="text-gold font-mono text-sm">{p.avg_ppr}</span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            {isMyTurn && (
                              <button
                                onClick={() => handlePick(p.id)}
                                disabled={picking}
                                className="btn-gold text-xs py-1 px-2"
                              >
                                {picking ? '…' : 'Draft'}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {(available || []).length === 0 && (
                        <tr>
                          <td colSpan={4} className="text-center text-white/30 py-8 text-sm">
                            No players found
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* RIGHT — Board + My picks */}
            <div className="space-y-4">

              {/* My picks */}
              {myTeam && (
                <div className="card">
                  <p className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-2">
                    My Picks ({myPicks.length}/{session!.total_rounds})
                  </p>
                  {myPicks.length === 0 ? (
                    <p className="text-white/30 text-sm">No picks yet</p>
                  ) : (
                    <div className="space-y-0">
                      {myPicks.map((p) => (
                        <PickBadge key={p.id} p={p} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Draft board — recent picks */}
              <div className="card">
                <p className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-2">
                  Recent Picks
                </p>
                {draftState.picks.length === 0 ? (
                  <p className="text-white/30 text-sm">No picks yet</p>
                ) : (
                  <div>
                    {[...draftState.picks].reverse().slice(0, 20).map((p) => (
                      <PickBadge key={p.id} p={p} />
                    ))}
                  </div>
                )}
              </div>

              {/* Draft order */}
              <div className="card">
                <p className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-2">
                  Draft Order
                </p>
                {draftState.teams.map((team, idx) => {
                  const pos = draftState.session.draft_order.indexOf(team.id);
                  const isCurrentPicker = team.id === draftState.currentTeamId;
                  const isMe = team.user_id === user?.id;
                  return (
                    <div
                      key={team.id}
                      className={clsx(
                        'flex items-center gap-2 py-1.5 border-b border-white/5 last:border-0',
                        isCurrentPicker && 'bg-gold/5 rounded'
                      )}
                    >
                      <span className="text-white/30 font-mono text-xs w-4">{pos + 1}</span>
                      <span className={clsx(
                        'text-sm flex-1 truncate',
                        isCurrentPicker ? 'text-gold font-bold' : isMe ? 'text-gold/70' : 'text-white/70'
                      )}>
                        {team.display_name || team.name}
                        {isMe && ' (you)'}
                      </span>
                      {isCurrentPicker && (
                        <span className="text-gold text-xs">← on clock</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Complete — full board */}
        {isDone && draftState && (
          <div className="card p-0 overflow-hidden">
            <div className="p-4 border-b border-white/10">
              <h2 className="text-white font-black">Full Draft Board</h2>
            </div>
            <div className="overflow-y-auto max-h-[600px]">
              <table className="w-full">
                <thead className="sticky top-0 bg-[#1a1a2e]">
                  <tr className="border-b border-white/10">
                    <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">#</th>
                    <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">Player</th>
                    <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">Team</th>
                  </tr>
                </thead>
                <tbody>
                  {draftState.picks.map((p) => (
                    <tr key={p.id} className={clsx(
                      'border-b border-white/5 hover:bg-white/5',
                      p.team_id === myTeamId && 'bg-gold/5'
                    )}>
                      <td className="px-4 py-2">
                        <span className="text-white/40 font-mono text-xs">{p.overall_pick}</span>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className={clsx('badge text-xs px-1.5 rounded', POSITION_COLORS[p.position] || 'bg-white/10 text-white/60')}>
                            {p.position}
                          </span>
                          <span className="text-white text-sm font-semibold">{p.player_name}</span>
                          {p.is_auto_pick && <span className="text-yellow-500/60 text-xs">AUTO</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <span className="text-white/60 text-sm">{p.team_name}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
