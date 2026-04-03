'use client';
import { use, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { draft as draftApi, leagues as leaguesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { League, Team } from '@/types';

// ─── Types matching backend DraftStatePayload ──────────────────────────────

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

interface DraftState {
  session: DraftSession;
  teams: DraftTeam[];
  picks: DraftPick[];
  currentTeamId: string | null;
  round: number;
  pickInRound: number;
  secondsRemaining: number;
}

interface DraftAvailablePlayer {
  id: string;
  full_name: string;
  position: string;
  nfl_team: string;
  status: string;
  injury_status?: string;
}

// ─── Position colors ───────────────────────────────────────────────────────

const posColors: Record<string, string> = {
  QB: 'text-red-400', RB: 'text-green-400', WR: 'text-blue-400',
  TE: 'text-orange-400', K: 'text-purple-400', DEF: 'text-yellow-400',
};

// ─── Page ──────────────────────────────────────────────────────────────────

export default function LeagueDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = use(params);
  const { user } = useAuthStore();

  const { data: league } = useSWR(
    `/leagues/${leagueId}`,
    () => leaguesApi.get(leagueId) as Promise<League & { teams: Team[] }>
  );

  const isCommissioner = league?.commissioner_id === user?.id;

  // Draft state — poll every 3s when active
  const { data: state, mutate: mutateState, error: stateErr } = useSWR<DraftState>(
    `draft-state-${leagueId}`,
    () => draftApi.getState(leagueId) as Promise<DraftState>,
    { refreshInterval: 3000, revalidateOnFocus: true }
  );

  // Start draft state
  const [draftRounds, setDraftRounds] = useState(10);
  const [starting, setStarting] = useState(false);
  const [startErr, setStartErr] = useState('');

  // Pick state
  const [posFilter, setPosFilter] = useState('');
  const [search, setSearch] = useState('');
  const [picking, setPicking] = useState<string | null>(null);
  const [pickErr, setPickErr] = useState('');

  // Available players
  const { data: available = [], mutate: mutateAvailable } = useSWR<DraftAvailablePlayer[]>(
    state?.session?.status === 'active'
      ? `draft-available-${leagueId}-${posFilter}-${search}-${state.session.current_pick}`
      : null,
    () => draftApi.available(leagueId, {
      position: posFilter || undefined,
      search: search || undefined,
      limit: 100,
    }) as Promise<DraftAvailablePlayer[]>,
    { revalidateOnFocus: false }
  );

  async function handleStart() {
    setStarting(true);
    setStartErr('');
    try {
      await draftApi.start(leagueId, { total_rounds: draftRounds, seconds_per_pick: 9999 });
      await mutateState();
    } catch (e) {
      setStartErr((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  async function handlePick(playerId: string) {
    if (picking) return;
    setPicking(playerId);
    setPickErr('');
    try {
      await draftApi.pick(leagueId, playerId);
      await Promise.all([mutateState(), mutateAvailable()]);
    } catch (e) {
      setPickErr((e as Error).message);
    } finally {
      setPicking(null);
    }
  }

  // ─── Not started yet ────────────────────────────────────────────────────

  if (stateErr || !state) {
    const noSession = stateErr?.message?.includes('No active');
    return (
      <div className="p-6 space-y-6">
        <h2 className="text-white font-black text-lg">Draft</h2>

        {noSession ? (
          <div className="card text-center py-8 space-y-4">
            <p className="text-white/40 text-sm">The draft has not started yet.</p>
            {isCommissioner && (league?.teams?.length ?? 0) >= 2 && (
              <div className="space-y-3">
                <div className="flex items-center justify-center gap-3">
                  <label className="text-white/50 text-sm">Rounds:</label>
                  <select
                    className="input-dark py-2 text-sm w-24"
                    value={draftRounds}
                    onChange={(e) => setDraftRounds(parseInt(e.target.value))}
                  >
                    {[5, 6, 7, 8, 10, 12, 15, 16].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  <button onClick={handleStart} disabled={starting} className="btn-gold text-sm py-2 px-6">
                    {starting ? 'Starting...' : 'Start Draft'}
                  </button>
                </div>
                <p className="text-white/30 text-xs">
                  Draft order will be randomized. Snake format ({draftRounds} rounds x {league?.teams?.length ?? 0} teams = {draftRounds * (league?.teams?.length ?? 0)} picks).
                </p>
                {startErr && <p className="text-red-400 text-sm">{startErr}</p>}
              </div>
            )}
            {isCommissioner && (league?.teams?.length ?? 0) < 2 && (
              <p className="text-white/40 text-xs">Need at least 2 teams to start the draft.</p>
            )}
            {!isCommissioner && (
              <p className="text-white/30 text-xs">Waiting for the commissioner to start the draft.</p>
            )}
          </div>
        ) : (
          <div className="card text-center py-8">
            <p className="text-red-400 text-sm">{stateErr?.message || 'Failed to load draft state.'}</p>
          </div>
        )}
      </div>
    );
  }

  // ─── Draft in progress / complete ───────────────────────────────────────

  const { session, teams, picks, currentTeamId, round, pickInRound, secondsRemaining } = state;
  const isDone = session.status === 'complete';
  const myTeam = teams.find((t) => t.user_id === user?.id);
  const isMyTurn = !isDone && myTeam?.id === currentTeamId;
  const onClock = teams.find((t) => t.id === currentTeamId);
  const myPicks = picks.filter((p) => p.team_id === myTeam?.id);
  const totalPicks = session.total_rounds * teams.length;

  // Group picks by round for draft board
  const picksByRound: Record<number, DraftPick[]> = {};
  for (const p of picks) {
    (picksByRound[p.round] ??= []).push(p);
  }

  return (
    <div className="p-6 space-y-4">

      {/* Status bar */}
      <div className={`card flex flex-wrap items-center gap-4 text-sm ${isMyTurn ? 'border-gold/40 bg-gold/5' : ''}`}>
        {!isDone ? (
          <>
            <div>
              <span className="text-white/40 text-xs uppercase tracking-wider">Status</span>
              <p className="text-white font-bold">{session.status}</p>
            </div>
            <div>
              <span className="text-white/40 text-xs uppercase tracking-wider">Round</span>
              <p className="text-white font-bold">{round} / {session.total_rounds}</p>
            </div>
            <div>
              <span className="text-white/40 text-xs uppercase tracking-wider">Pick</span>
              <p className="text-white font-bold">{session.current_pick} / {totalPicks}</p>
            </div>
            <div>
              <span className="text-white/40 text-xs uppercase tracking-wider">On Clock</span>
              <p className={`font-bold ${isMyTurn ? 'text-gold' : 'text-white'}`}>
                {isMyTurn ? 'YOUR PICK' : (onClock?.name ?? '—')}
              </p>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-4">
            <span className="text-green-400 font-black text-sm uppercase tracking-wider">Draft Complete</span>
            <span className="text-white/40 text-sm">{picks.length} picks made</span>
          </div>
        )}
      </div>

      {/* Post-draft links */}
      {isDone && (
        <div className="flex gap-3">
          <Link href={`/dashboard/leagues/${leagueId}/teams/${myTeam?.id}`} className="btn-gold text-sm py-2 px-4">
            View My Roster
          </Link>
          <Link href={`/dashboard/leagues/${leagueId}`} className="btn-dark border border-white/10 text-sm py-2 px-4">
            League Home
          </Link>
        </div>
      )}

      {pickErr && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">{pickErr}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* ── Left: Available Players ── */}
        {!isDone && (
          <div className="lg:col-span-2 space-y-3">
            <h3 className="text-white font-black text-sm uppercase tracking-wider">Available Players</h3>

            {/* Filters */}
            <div className="flex flex-wrap gap-2">
              {['', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map((pos) => (
                <button
                  key={pos || 'all'}
                  onClick={() => setPosFilter(pos)}
                  className={`px-3 py-1.5 text-xs font-bold rounded transition-colors ${
                    posFilter === pos
                      ? 'bg-gold/20 text-gold border border-gold/30'
                      : 'bg-white/5 text-white/40 border border-white/10 hover:text-white/70'
                  }`}
                >
                  {pos || 'ALL'}
                </button>
              ))}
              <input
                type="text"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input-dark py-1.5 text-xs ml-auto w-40"
              />
            </div>

            {/* Player table */}
            <div className="card overflow-hidden p-0">
              <div className="overflow-auto max-h-[55vh]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-dark-50 z-10">
                    <tr className="border-b border-white/10">
                      <th className="text-left text-white/40 text-xs font-semibold uppercase px-4 py-2">Player</th>
                      <th className="text-left text-white/40 text-xs font-semibold uppercase px-4 py-2 hidden sm:table-cell">Team</th>
                      <th className="text-right px-4 py-2 w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {available.map((p) => (
                      <tr key={p.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-bold ${posColors[p.position] || 'text-white/40'}`}>{p.position}</span>
                            <span className="text-white font-semibold">{p.full_name}</span>
                            {p.injury_status && <span className="text-red-400 text-xs font-bold">{p.injury_status}</span>}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-white/40 text-xs hidden sm:table-cell">{p.nfl_team}</td>
                        <td className="px-4 py-2 text-right">
                          {isMyTurn && (
                            <button
                              onClick={() => handlePick(p.id)}
                              disabled={picking === p.id}
                              className="btn-gold text-xs py-1 px-3"
                            >
                              {picking === p.id ? '...' : 'Draft'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {available.length === 0 && (
                      <tr>
                        <td colSpan={3} className="text-center text-white/30 py-8 text-xs">No players available</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── Right: Teams + Draft Board ── */}
        <div className={`space-y-4 ${isDone ? 'lg:col-span-3' : ''}`}>

          {/* Draft order + team picks */}
          <div>
            <h3 className="text-white font-black text-sm uppercase tracking-wider mb-2">Teams</h3>
            <div className="space-y-1">
              {(session.draft_order as string[]).map((teamId, idx) => {
                const team = teams.find((t) => t.id === teamId);
                const teamPickCount = picks.filter((p) => p.team_id === teamId).length;
                const isOnClock = teamId === currentTeamId && !isDone;
                const isMe = teamId === myTeam?.id;
                return (
                  <div
                    key={teamId}
                    className={`flex items-center justify-between px-3 py-2 rounded text-sm ${
                      isOnClock ? 'bg-gold/20 border border-gold/40' : 'bg-white/5'
                    }`}
                  >
                    <span className={`${isOnClock ? 'text-gold font-bold' : isMe ? 'text-gold' : 'text-white/70'}`}>
                      <span className="text-white/30 text-xs mr-2">#{idx + 1}</span>
                      {team?.name ?? 'Unknown'}
                      {isMe && <span className="text-xs text-white/30 ml-1">(you)</span>}
                    </span>
                    <span className="text-white/40 text-xs">{teamPickCount} picks</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* My picks */}
          {myTeam && myPicks.length > 0 && (
            <div>
              <h3 className="text-white font-black text-sm uppercase tracking-wider mb-2">My Roster ({myPicks.length})</h3>
              <div className="space-y-1">
                {myPicks.map((p) => (
                  <div key={p.id} className="flex items-center justify-between px-3 py-2 bg-white/5 rounded text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${posColors[p.position] || 'text-white/40'}`}>{p.position}</span>
                      <span className="text-white font-semibold">{p.player_name}</span>
                      <span className="text-white/30 text-xs">{p.nfl_team}</span>
                    </div>
                    <span className="text-white/30 text-xs">R{p.round} P{p.pick_in_round}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Draft board — all picks */}
          <div>
            <h3 className="text-white font-black text-sm uppercase tracking-wider mb-2">
              Draft Board ({picks.length} / {totalPicks})
            </h3>
            <div className="space-y-4 max-h-[50vh] overflow-auto">
              {Object.entries(picksByRound).map(([roundNum, roundPicks]) => (
                <div key={roundNum}>
                  <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-1">Round {roundNum}</p>
                  <div className="space-y-1">
                    {roundPicks.map((p) => {
                      const isMe = p.team_id === myTeam?.id;
                      return (
                        <div
                          key={p.id}
                          className={`flex items-center justify-between px-3 py-1.5 rounded text-xs ${
                            isMe ? 'bg-gold/10' : 'bg-white/5'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-white/20 font-mono w-6">{p.overall_pick}</span>
                            <span className={`font-bold ${posColors[p.position] || 'text-white/40'}`}>{p.position}</span>
                            <span className="text-white font-semibold">{p.player_name}</span>
                            <span className="text-white/30">{p.nfl_team}</span>
                          </div>
                          <div className="text-right">
                            <span className={`${isMe ? 'text-gold' : 'text-white/40'}`}>
                              {p.team_name}
                              {p.is_auto_pick && <span className="text-white/20 ml-1">(auto)</span>}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              {picks.length === 0 && (
                <div className="card text-center text-white/30 py-8 text-xs">No picks yet — waiting for first pick.</div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
