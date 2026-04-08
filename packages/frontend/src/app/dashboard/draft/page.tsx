'use client';
import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { useAuthStore, useLeagueStore } from '@/lib/store';
import { draft as draftApi } from '@/lib/api';

// =============================================
// Types matching backend DraftStatePayload
// =============================================
interface DraftSession {
  id: string;
  status: 'pending' | 'active' | 'paused' | 'complete';
  total_rounds: number;
  seconds_per_pick: number;
  current_pick: number;
  draft_order: string[];
}

interface DraftTeam {
  id: string;
  name: string;
  user_id: string;
  display_name: string | null;
}

interface DraftPick {
  id: string;
  overall_pick: number;
  round: number;
  pick_in_round: number;
  team_id: string;
  player_id: string;
  player_name: string;
  position: string;
  nfl_team: string;
  team_name: string;
  is_auto_pick: boolean;
}

interface DraftStatePayload {
  session: DraftSession;
  teams: DraftTeam[];
  picks: DraftPick[];
  currentTeamId: string | null;
  round: number;
  pickInRound: number;
  secondsRemaining: number;
}

interface AvailablePlayer {
  id: string;
  full_name: string;
  position: string;
  nfl_team: string;
  status: string;
  injury_status?: string;
}

// =============================================
// Draft Page
// =============================================
export default function DraftPage() {
  const { user }       = useAuthStore();
  const activeLeague   = useLeagueStore((s) => s.activeLeague);
  const leagueId       = activeLeague?.id;

  const [posFilter, setPosFilter] = useState('');
  const [search, setSearch]       = useState('');
  const [picking, setPicking]     = useState<string | null>(null); // player_id being submitted
  const [starting, setStarting]   = useState(false);
  const [startErr, setStartErr]   = useState('');
  const [pickErr, setPickErr]     = useState('');
  const [draftRounds, setDraftRounds] = useState(10);

  // Poll draft state every 3 seconds
  const { data: state, mutate: mutateState, error: stateErr } = useSWR<DraftStatePayload>(
    leagueId ? `draft-state-${leagueId}` : null,
    () => draftApi.getState(leagueId!) as Promise<DraftStatePayload>,
    { refreshInterval: 3000, revalidateOnFocus: true }
  );

  // Available players — refetch when pick changes
  const { data: available = [], mutate: mutateAvailable } = useSWR<AvailablePlayer[]>(
    leagueId && state?.session?.status === 'active'
      ? `draft-available-${leagueId}-${posFilter}-${search}`
      : null,
    () => draftApi.available(leagueId!, {
      position: posFilter || undefined,
      search:   search    || undefined,
      limit:    100,
    }) as Promise<AvailablePlayer[]>,
    { revalidateOnFocus: false }
  );

  if (!leagueId) {
    return (
      <div className="p-6">
        <p className="text-white/40">Select a league first.</p>
      </div>
    );
  }

  // Draft not started yet
  if (stateErr || !state) {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-white font-black text-2xl">Draft Room</h1>
        {stateErr && (
          <p className="text-white/50 text-sm">
            {stateErr.message?.includes('No active') ? 'Draft has not started yet.' : stateErr.message}
          </p>
        )}
        {activeLeague?.commissioner_id === user?.id && (
          <div className="space-y-3">
            <div className="flex gap-2 items-center flex-wrap">
              <label className="text-white/50 text-sm">Rounds:</label>
              <select
                className="bg-white/10 border border-white/20 text-white rounded px-2 py-1 text-sm"
                value={draftRounds}
                onChange={(e) => setDraftRounds(parseInt(e.target.value))}
              >
                {[5, 6, 7, 8, 10, 12, 15].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <button
                disabled={starting}
                onClick={async () => {
                  setStarting(true);
                  setStartErr('');
                  try {
                    await draftApi.start(leagueId);
                    await mutateState();
                  } catch (e) {
                    setStartErr((e as Error).message);
                  } finally {
                    setStarting(false);
                  }
                }}
                className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold px-6 py-3 rounded"
              >
                {starting ? 'Starting…' : 'Start Draft'}
              </button>
            </div>
            {startErr && <p className="text-red-400 text-sm">{startErr}</p>}
          </div>
        )}
      </div>
    );
  }

  const { session, teams, picks, currentTeamId, round, pickInRound, secondsRemaining } = state;
  const isDone    = session.status === 'complete';
  const myTeam    = teams.find((t) => t.user_id === user?.id);
  const isMyTurn  = !isDone && myTeam?.id === currentTeamId;
  const onClock   = teams.find((t) => t.id === currentTeamId);
  const numTeams  = teams.length;

  async function handlePick(playerId: string) {
    if (!isMyTurn || picking) return;
    setPicking(playerId);
    setPickErr('');
    try {
      await draftApi.pick(leagueId!, playerId);
      await Promise.all([mutateState(), mutateAvailable()]);
    } catch (e) {
      setPickErr((e as Error).message);
    } finally {
      setPicking(null);
    }
  }

  // My picks so far
  const myPicks = picks.filter((p) => p.team_id === myTeam?.id);

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-white font-black text-xl">
        Draft Room — {activeLeague?.name}
      </h1>

      {/* Status bar */}
      <div className="bg-white/5 border border-white/10 rounded p-3 flex flex-wrap gap-4 text-sm">
        <span className="text-white/60">
          Status: <strong className="text-white">{session.status}</strong>
        </span>
        {!isDone && (
          <>
            <span className="text-white/60">
              Round: <strong className="text-white">{round}/{session.total_rounds}</strong>
            </span>
            <span className="text-white/60">
              Pick: <strong className="text-white">{session.current_pick}</strong>
            </span>
            <span className="text-white/60">
              On clock: <strong className={isMyTurn ? 'text-yellow-400' : 'text-white'}>
                {isMyTurn ? 'YOU' : (onClock?.name ?? '—')}
              </strong>
            </span>
            <span className="text-white/60">
              Time: <strong className={secondsRemaining < 15 ? 'text-red-400' : 'text-white'}>
                {secondsRemaining}s
              </strong>
            </span>
          </>
        )}
        {isDone && <span className="text-green-400 font-bold">Draft Complete</span>}
      </div>

      {/* Post-draft navigation */}
      {isDone && (
        <div className="flex gap-3 flex-wrap">
          <Link
            href="/dashboard/roster"
            className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold px-4 py-2 rounded text-sm"
          >
            View My Roster →
          </Link>
          <Link
            href="/dashboard"
            className="border border-white/20 text-white/60 hover:text-white px-4 py-2 rounded text-sm"
          >
            Dashboard
          </Link>
        </div>
      )}

      {pickErr && (
        <p className="text-red-400 text-sm border border-red-500/20 bg-red-500/10 rounded p-2">
          {pickErr}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* ── Left: Available Players ── */}
        {!isDone && (
          <div className="lg:col-span-2 space-y-3">
            <h2 className="text-white font-bold">Available Players</h2>

            {/* Filters */}
            <div className="flex flex-wrap gap-2">
              {['', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map((pos) => (
                <button
                  key={pos}
                  onClick={() => setPosFilter(pos)}
                  className={`px-3 py-1 text-xs rounded font-bold border transition-colors ${
                    posFilter === pos
                      ? 'bg-yellow-500 text-black border-yellow-500'
                      : 'border-white/20 text-white/60 hover:border-white/40'
                  }`}
                >
                  {pos || 'ALL'}
                </button>
              ))}
              <input
                type="text"
                placeholder="Search name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="ml-auto px-3 py-1 text-xs bg-white/5 border border-white/20 rounded text-white placeholder-white/30 w-40"
              />
            </div>

            {/* Player list */}
            <div className="overflow-auto max-h-[60vh] border border-white/10 rounded">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[#0f0f0f]">
                  <tr className="border-b border-white/10">
                    <th className="text-left text-white/40 text-xs px-3 py-2">Player</th>
                    <th className="text-left text-white/40 text-xs px-3 py-2">Pos</th>
                    <th className="text-left text-white/40 text-xs px-3 py-2">Team</th>
                    <th className="text-left text-white/40 text-xs px-3 py-2">Status</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {available.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center text-white/30 py-8 text-xs">
                        No players found
                      </td>
                    </tr>
                  )}
                  {available.map((p) => (
                    <tr key={p.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-3 py-2 text-white font-medium">{p.full_name}</td>
                      <td className="px-3 py-2 text-white/60">{p.position}</td>
                      <td className="px-3 py-2 text-white/60">{p.nfl_team}</td>
                      <td className="px-3 py-2">
                        {p.injury_status ? (
                          <span className="text-orange-400 text-xs">{p.injury_status}</span>
                        ) : (
                          <span className="text-green-400 text-xs">Active</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {isMyTurn && (
                          <button
                            disabled={picking === p.id}
                            onClick={() => handlePick(p.id)}
                            className="bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 text-black text-xs font-bold px-3 py-1 rounded"
                          >
                            {picking === p.id ? '…' : 'Draft'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Right: Teams + Recent Picks ── */}
        <div className="space-y-4">

          {/* Teams */}
          <div>
            <h2 className="text-white font-bold mb-2">Teams</h2>
            <div className="space-y-1">
              {teams.map((t) => {
                const teamPickCount = picks.filter((p) => p.team_id === t.id).length;
                const isOnClock     = t.id === currentTeamId && !isDone;
                return (
                  <div
                    key={t.id}
                    className={`flex items-center justify-between px-3 py-2 rounded text-sm ${
                      isOnClock ? 'bg-yellow-500/20 border border-yellow-500/40' : 'bg-white/5'
                    }`}
                  >
                    <span className={isOnClock ? 'text-yellow-400 font-bold' : 'text-white/70'}>
                      {t.id === myTeam?.id ? '★ ' : ''}{t.name}
                    </span>
                    <span className="text-white/40 text-xs">{teamPickCount} picks</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent picks */}
          <div>
            <h2 className="text-white font-bold mb-2">Recent Picks</h2>
            <div className="space-y-1 max-h-64 overflow-auto">
              {[...picks].reverse().slice(0, 20).map((p) => (
                <div key={p.id} className="flex justify-between text-xs bg-white/5 rounded px-3 py-2">
                  <div>
                    <span className="text-white font-medium">{p.player_name}</span>
                    <span className="text-white/40 ml-1">({p.position})</span>
                  </div>
                  <div className="text-right text-white/50">
                    <div>{p.team_name}</div>
                    <div>R{p.round}P{p.pick_in_round}</div>
                  </div>
                </div>
              ))}
              {picks.length === 0 && (
                <p className="text-white/30 text-xs text-center py-4">No picks yet</p>
              )}
            </div>
          </div>

          {/* My picks */}
          {myTeam && (
            <div>
              <h2 className="text-white font-bold mb-2">My Roster ({myPicks.length})</h2>
              <div className="space-y-1 max-h-64 overflow-auto">
                {myPicks.map((p) => (
                  <div key={p.id} className="flex justify-between text-xs bg-white/5 rounded px-3 py-2">
                    <span className="text-white">{p.player_name}</span>
                    <span className="text-white/50">{p.position} · R{p.round}</span>
                  </div>
                ))}
                {myPicks.length === 0 && (
                  <p className="text-white/30 text-xs text-center py-4">No picks yet</p>
                )}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
