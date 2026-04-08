'use client';
import { use, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { draft as draftApi, leagues as leaguesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { League, Team } from '@/types';
import { getRosterFromSettings, draftRounds as calcDraftRounds, getLeagueSettings, formatStatus } from '@/types';

// ─── Types ──────────────────────────────────────────────────────────────────

interface DraftSession {
  id: string;
  status: 'pending' | 'active' | 'paused' | 'complete';
  total_rounds: number;
  seconds_per_pick: number;
  current_pick: number;
  draft_order: string[];
}
interface DraftTeam { id: string; name: string; user_id: string; display_name: string | null }
interface DraftPick {
  id: string; overall_pick: number; round: number; pick_in_round: number;
  team_id: string; player_id: string; player_name: string; position: string;
  nfl_team: string; team_name: string; is_auto_pick: boolean;
}
interface DraftState {
  session: DraftSession; teams: DraftTeam[]; picks: DraftPick[];
  currentTeamId: string | null; round: number; pickInRound: number; secondsRemaining: number;
}
interface DraftAvailablePlayer {
  id: string; full_name: string; position: string; nfl_team: string; status: string; injury_status?: string;
}

const POS_COLORS: Record<string, string> = {
  QB: 'text-red-400', RB: 'text-green-400', WR: 'text-blue-400',
  TE: 'text-orange-400', K: 'text-purple-400', DEF: 'text-yellow-400',
};

// ─── Page ───────────────────────────────────────────────────────────────────

export default function LeagueDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = use(params);
  const { user } = useAuthStore();

  const { data: league } = useSWR(
    `/leagues/${leagueId}`,
    () => leaguesApi.get(leagueId) as Promise<League & { teams: Team[] }>
  );

  const isCommissioner = league?.commissioner_id === user?.id;
  const teams = league?.teams || [];
  const rosterSettings = league ? getRosterFromSettings(league.settings) : null;
  const leagueSettings = league ? getLeagueSettings(league.settings) : null;
  const computedRounds = rosterSettings ? calcDraftRounds(rosterSettings) : 13;
  const draftType = leagueSettings?.draft?.type === 'linear' ? 'Linear' : 'Snake';
  const draftTimer = leagueSettings?.draft?.seconds_per_pick ?? 90;

  // Draft state — poll every 3s
  const { data: state, mutate: mutateState, error: stateErr } = useSWR<DraftState>(
    `draft-state-${leagueId}`,
    () => draftApi.getState(leagueId) as Promise<DraftState>,
    { refreshInterval: 3000, revalidateOnFocus: true }
  );

  const [starting, setStarting] = useState(false);
  const [startErr, setStartErr] = useState('');

  async function handleStart() {
    setStarting(true); setStartErr('');
    try { await draftApi.start(leagueId); await mutateState(); }
    catch (e) { setStartErr((e as Error).message); }
    finally { setStarting(false); }
  }

  // ─── LOBBY: No active draft session ─────────────────────────────────────

  if (stateErr || !state) {
    const noSession = stateErr?.message?.includes('No active');
    const isDrafted = league?.status === 'in_season' || league?.status === 'post_season' || league?.status === 'complete';

    if (!noSession && !isDrafted) {
      return (
        <div className="p-6 space-y-6">
          <h2 className="text-white font-black text-lg">Draft</h2>
          <div className="card text-center py-8">
            <p className="text-red-400 text-sm">{stateErr?.message || 'Failed to load draft state.'}</p>
          </div>
        </div>
      );
    }

    return (
      <div className="p-6 space-y-6">
        <h2 className="text-white font-black text-lg">Draft Lobby</h2>

        {/* Draft status */}
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-white/40 text-xs uppercase tracking-wider">Draft Status</span>
              <p className="text-white font-black text-lg mt-1">
                {isDrafted ? 'Completed' : 'Not Started'}
              </p>
            </div>
            <span className={`px-3 py-1.5 rounded text-xs font-bold ${
              isDrafted
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-white/10 text-white/40 border border-white/10'
            }`}>
              {isDrafted ? 'Complete' : formatStatus(league?.status)}
            </span>
          </div>
        </div>

        {/* Settings summary */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Type', value: draftType },
            { label: 'Timer', value: `${draftTimer}s` },
            { label: 'Teams', value: String(teams.length) },
            { label: 'Rounds', value: String(computedRounds) },
            { label: 'Total Picks', value: String(computedRounds * teams.length) },
          ].map(s => (
            <div key={s.label} className="card text-center py-4">
              <p className="text-xl font-black text-white">{s.value}</p>
              <p className="text-white/30 text-xs mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Teams / Managers */}
        <div className="card space-y-3">
          <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider">
            Teams ({teams.length} / {league?.league_size ?? '?'})
          </h3>
          {teams.length === 0 ? (
            <p className="text-white/20 text-sm text-center py-4">No teams yet. Invite managers to join.</p>
          ) : (
            <div className="space-y-1">
              {teams.map((t, i) => {
                const isMe = t.user_id === user?.id;
                return (
                  <div key={t.id} className={`flex items-center justify-between px-3 py-2.5 rounded-lg ${isMe ? 'bg-gold/5' : 'bg-white/[0.03]'}`}>
                    <div className="flex items-center gap-3">
                      <span className="text-white/20 text-xs font-mono w-6">{i + 1}</span>
                      <div>
                        <p className={`text-sm font-semibold ${isMe ? 'text-gold' : 'text-white'}`}>
                          {t.name} {isMe && <span className="text-xs font-normal text-gold/60">(you)</span>}
                        </p>
                        {t.display_name && <p className="text-white/30 text-xs">{t.display_name}</p>}
                      </div>
                    </div>
                    <span className="text-green-400/60 text-xs">Ready</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Draft order preview */}
        {teams.length >= 2 && !isDrafted && (
          <div className="card space-y-3">
            <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider">Draft Order Preview</h3>
            <p className="text-white/20 text-xs">Order will be randomized when draft starts. Current team order shown as preview.</p>
            <div className="flex gap-2 flex-wrap">
              {teams.map((t, i) => (
                <div key={t.id} className="bg-white/5 rounded-lg px-3 py-2 text-center min-w-[80px]">
                  <p className="text-white/30 text-xs">Pick {i + 1}</p>
                  <p className="text-white text-xs font-semibold truncate">{t.name}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Commissioner CTA */}
        {!isDrafted && (
          <div className="card border-gold/20 space-y-3">
            {isCommissioner && teams.length >= 2 ? (
              <>
                <p className="text-white text-sm">
                  Ready to draft <span className="text-gold font-bold">{computedRounds} rounds</span> with {teams.length} teams ({computedRounds * teams.length} total picks).
                </p>
                <button onClick={handleStart} disabled={starting} className="btn-gold text-sm py-2.5 px-8">
                  {starting ? 'Starting Draft...' : 'Start Draft'}
                </button>
                {startErr && <p className="text-red-400 text-sm">{startErr}</p>}
              </>
            ) : isCommissioner ? (
              <p className="text-white/40 text-sm">Need at least 2 teams to start the draft.</p>
            ) : (
              <p className="text-white/30 text-sm">Waiting for the commissioner to start the draft.</p>
            )}
          </div>
        )}

        {/* Post-draft */}
        {isDrafted && (
          <div className="card border-green-500/20 space-y-2">
            <p className="text-green-400 text-sm font-semibold">Draft is complete. Season is underway.</p>
            <div className="flex gap-3">
              <Link href={`/dashboard/leagues/${leagueId}/matchups`} className="btn-gold text-sm py-2 px-4">View Matchups</Link>
              <Link href={`/dashboard/leagues/${leagueId}/standings`} className="btn-dark border border-white/10 text-sm py-2 px-4">Standings</Link>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── DRAFT ROOM: Active or complete session ─────────────────────────────

  const { session, teams: draftTeams, picks, currentTeamId, round, pickInRound } = state;
  const isDone = session.status === 'complete';
  const myTeam = draftTeams.find(t => t.user_id === user?.id);
  const isMyTurn = !isDone && myTeam?.id === currentTeamId;
  const onClock = draftTeams.find(t => t.id === currentTeamId);
  const myPicks = picks.filter(p => p.team_id === myTeam?.id);
  const totalPicks = session.total_rounds * draftTeams.length;

  const picksByRound: Record<number, DraftPick[]> = {};
  for (const p of picks) (picksByRound[p.round] ??= []).push(p);

  // Available players
  const [posFilter, setPosFilter] = useState('');
  const [search, setSearch] = useState('');
  const [picking, setPicking] = useState<string | null>(null);
  const [pickErr, setPickErr] = useState('');

  const { data: available = [], mutate: mutateAvailable } = useSWR<DraftAvailablePlayer[]>(
    session.status === 'active' ? `draft-avail-${leagueId}-${posFilter}-${search}-${session.current_pick}` : null,
    () => draftApi.available(leagueId, {
      ...(posFilter ? { position: posFilter } : {}),
      ...(search ? { search } : {}),
      limit: 100,
    }) as Promise<DraftAvailablePlayer[]>,
    { revalidateOnFocus: false }
  );

  async function handlePick(playerId: string) {
    if (picking) return;
    setPicking(playerId); setPickErr('');
    try { await draftApi.pick(leagueId, playerId); await Promise.all([mutateState(), mutateAvailable()]); }
    catch (e) { setPickErr((e as Error).message); }
    finally { setPicking(null); }
  }

  return (
    <div className="p-6 space-y-4">
      {/* Status bar */}
      <div className={`card flex flex-wrap items-center gap-4 text-sm ${isMyTurn ? 'border-gold/40 bg-gold/5' : ''}`}>
        {!isDone ? (
          <>
            <div><span className="text-white/40 text-xs uppercase tracking-wider">Round</span><p className="text-white font-bold">{round}/{session.total_rounds}</p></div>
            <div><span className="text-white/40 text-xs uppercase tracking-wider">Pick</span><p className="text-white font-bold">{session.current_pick}/{totalPicks}</p></div>
            <div>
              <span className="text-white/40 text-xs uppercase tracking-wider">On Clock</span>
              <p className={`font-bold ${isMyTurn ? 'text-gold' : 'text-white'}`}>{isMyTurn ? 'YOUR PICK' : (onClock?.name ?? '—')}</p>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-4">
            <span className="text-green-400 font-black text-sm uppercase tracking-wider">Draft Complete</span>
            <span className="text-white/40 text-sm">{picks.length} picks</span>
          </div>
        )}
      </div>

      {isDone && (
        <div className="flex gap-3">
          {myTeam && <Link href={`/dashboard/leagues/${leagueId}/teams/${myTeam.id}`} className="btn-gold text-sm py-2 px-4">View My Roster</Link>}
          <Link href={`/dashboard/leagues/${leagueId}`} className="btn-dark border border-white/10 text-sm py-2 px-4">League Home</Link>
        </div>
      )}

      {pickErr && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">{pickErr}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Available Players */}
        {!isDone && (
          <div className="lg:col-span-2 space-y-3">
            <h3 className="text-white font-black text-sm uppercase tracking-wider">Available Players</h3>
            <div className="flex flex-wrap gap-2">
              {['', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map(pos => (
                <button key={pos || 'all'} onClick={() => setPosFilter(pos)}
                  className={`px-3 py-1.5 text-xs font-bold rounded transition-colors ${
                    posFilter === pos ? 'bg-gold/20 text-gold border border-gold/30' : 'bg-white/5 text-white/40 border border-white/10 hover:text-white/70'
                  }`}>{pos || 'ALL'}</button>
              ))}
              <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}
                className="input-dark py-1.5 text-xs ml-auto w-40" />
            </div>
            <div className="card overflow-hidden p-0">
              <div className="overflow-auto max-h-[55vh]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-dark-50 z-10">
                    <tr className="border-b border-white/10">
                      <th className="text-left text-white/40 text-xs uppercase px-4 py-2">Player</th>
                      <th className="text-left text-white/40 text-xs uppercase px-4 py-2 hidden sm:table-cell">Team</th>
                      <th className="text-right px-4 py-2 w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {available.map(p => (
                      <tr key={p.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-bold ${POS_COLORS[p.position] || 'text-white/40'}`}>{p.position}</span>
                            <span className="text-white font-semibold">{p.full_name}</span>
                            {p.injury_status && <span className="text-red-400 text-xs font-bold">{p.injury_status}</span>}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-white/40 text-xs hidden sm:table-cell">{p.nfl_team}</td>
                        <td className="px-4 py-2 text-right">
                          {isMyTurn && (
                            <button onClick={() => handlePick(p.id)} disabled={picking === p.id} className="btn-gold text-xs py-1 px-3">
                              {picking === p.id ? '...' : 'Draft'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {available.length === 0 && <tr><td colSpan={3} className="text-center text-white/30 py-8 text-xs">No players available</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Right panel: Teams + Picks */}
        <div className={`space-y-4 ${isDone ? 'lg:col-span-3' : ''}`}>
          {/* Teams */}
          <div>
            <h3 className="text-white font-black text-sm uppercase tracking-wider mb-2">Teams</h3>
            <div className="space-y-1">
              {(session.draft_order as string[]).map((teamId, idx) => {
                const team = draftTeams.find(t => t.id === teamId);
                const pickCount = picks.filter(p => p.team_id === teamId).length;
                const isOnClock = teamId === currentTeamId && !isDone;
                const isMe = teamId === myTeam?.id;
                return (
                  <div key={teamId} className={`flex items-center justify-between px-3 py-2 rounded text-sm ${
                    isOnClock ? 'bg-gold/20 border border-gold/40' : 'bg-white/5'
                  }`}>
                    <span className={`${isOnClock ? 'text-gold font-bold' : isMe ? 'text-gold' : 'text-white/70'}`}>
                      <span className="text-white/20 text-xs mr-2">#{idx + 1}</span>
                      {team?.name ?? '?'}{isMe && <span className="text-xs text-white/30 ml-1">(you)</span>}
                    </span>
                    <span className="text-white/30 text-xs">{pickCount} picks</span>
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
                {myPicks.map(p => (
                  <div key={p.id} className="flex items-center justify-between px-3 py-2 bg-white/5 rounded text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${POS_COLORS[p.position] || 'text-white/40'}`}>{p.position}</span>
                      <span className="text-white font-semibold">{p.player_name}</span>
                      <span className="text-white/20 text-xs">{p.nfl_team}</span>
                    </div>
                    <span className="text-white/20 text-xs">R{p.round}P{p.pick_in_round}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Draft board */}
          <div>
            <h3 className="text-white font-black text-sm uppercase tracking-wider mb-2">Draft Board ({picks.length}/{totalPicks})</h3>
            <div className="space-y-3 max-h-[50vh] overflow-auto">
              {Object.entries(picksByRound).map(([rNum, rPicks]) => (
                <div key={rNum}>
                  <p className="text-white/30 text-xs font-semibold uppercase tracking-wider mb-1">Round {rNum}</p>
                  <div className="space-y-1">
                    {rPicks.map(p => {
                      const isMe = p.team_id === myTeam?.id;
                      return (
                        <div key={p.id} className={`flex items-center justify-between px-3 py-1.5 rounded text-xs ${isMe ? 'bg-gold/10' : 'bg-white/5'}`}>
                          <div className="flex items-center gap-2">
                            <span className="text-white/15 font-mono w-6">{p.overall_pick}</span>
                            <span className={`font-bold ${POS_COLORS[p.position] || 'text-white/40'}`}>{p.position}</span>
                            <span className="text-white font-semibold">{p.player_name}</span>
                          </div>
                          <span className={`${isMe ? 'text-gold' : 'text-white/30'}`}>{p.team_name}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              {picks.length === 0 && <div className="card text-center text-white/20 py-6 text-xs">Waiting for first pick...</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
