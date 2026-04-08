'use client';
import { use, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { leagues as leaguesApi, invites as invitesApi, teams as teamsApi, draft as draftApi } from '@/lib/api';
import { useAuthStore, useLeagueStore } from '@/lib/store';
import type { League, Team, LeagueMember, LeagueInvite, Transaction, WaiverClaim } from '@/types';
import { getRosterFromSettings, draftRounds as calcDraftRounds } from '@/types';

export default function LeaguePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user } = useAuthStore();
  const setActiveLeague = useLeagueStore((s) => s.setActiveLeague);

  const { data: league, mutate } = useSWR(
    `/leagues/${id}`,
    () => leaguesApi.get(id) as Promise<League & { teams: Team[]; members: LeagueMember[] }>
  );

  const { data: transactions } = useSWR(
    `/leagues/${id}/transactions`,
    () => leaguesApi.transactions(id, 10) as Promise<Transaction[]>
  );

  const { data: waiverActivity } = useSWR(
    `/leagues/${id}/waivers`,
    () => leaguesApi.waiverList(id) as Promise<WaiverClaim[]>
  );

  const { data: currentInvite, mutate: mutateInvite } = useSWR<LeagueInvite | null>(
    league?.commissioner_id === user?.id ? `/leagues/${id}/invite` : null,
    () => invitesApi.getCurrent(id) as Promise<LeagueInvite | null>,
    { shouldRetryOnError: false }
  );

  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [joinName, setJoinName] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinErr, setJoinErr] = useState('');
  const rosterSettings = league ? getRosterFromSettings(league.settings) : null;
  const computedRounds = rosterSettings ? calcDraftRounds(rosterSettings) : 13;
  const [draftRounds, setDraftRounds] = useState(computedRounds);
  const [draftStarting, setDraftStarting] = useState(false);
  const [draftStartErr, setDraftStartErr] = useState('');
  const [errMsg, setErrMsg] = useState('');

  if (!league) return null; // Layout handles loading/not-found

  const isCommissioner = league.commissioner_id === user?.id;
  const teams = league.teams || [];
  const members = league.members || [];
  const myTeam = teams.find((t) => t.user_id === user?.id);
  const hasTeam = !!myTeam;

  async function handleJoinAsTeam() {
    if (!joinName.trim()) return;
    setJoinLoading(true);
    setJoinErr('');
    try {
      await teamsApi.create({ league_id: id, name: joinName.trim() });
      setJoinName('');
      mutate();
    } catch (err) {
      setJoinErr((err as Error).message);
    } finally {
      setJoinLoading(false);
    }
  }

  async function handleGenerateInvite() {
    setInviteLoading(true);
    try {
      await invitesApi.generate(id);
      await mutateInvite();
    } catch (err) {
      setErrMsg((err as Error).message);
    } finally {
      setInviteLoading(false);
    }
  }

  async function handleDeactivateInvite() {
    setInviteLoading(true);
    try {
      await invitesApi.deactivate(id);
      await mutateInvite();
    } catch (err) {
      setErrMsg((err as Error).message);
    } finally {
      setInviteLoading(false);
    }
  }

  function copyInviteCode() {
    if (!league?.invite_code) return;
    const url = `${window.location.origin}/join?code=${league.invite_code}`;
    navigator.clipboard.writeText(url).then(() => {
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    });
  }

  async function handleStartDraft() {
    if (!league) return;
    setDraftStarting(true);
    setDraftStartErr('');
    try {
      await draftApi.start(id);
      setActiveLeague(league);
      router.push('/dashboard/draft');
    } catch (err) {
      setDraftStartErr((err as Error).message);
      setDraftStarting(false);
    }
  }

  return (
    <div className="p-6 space-y-6">

      {/* League Info */}
      <div className="card space-y-3">
        <h2 className="text-white font-black text-lg mb-2">League Info</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <p className="text-white/40 text-xs font-semibold uppercase tracking-wider">Commissioner</p>
            <p className="text-white text-sm mt-1">
              {isCommissioner
                ? 'You'
                : members.find((m) => m.role === 'commissioner')?.display_name || '—'}
            </p>
          </div>
          <div>
            <p className="text-white/40 text-xs font-semibold uppercase tracking-wider">League Size</p>
            <p className="text-white text-sm mt-1">{league.league_size ?? '—'} teams</p>
          </div>
          <div>
            <p className="text-white/40 text-xs font-semibold uppercase tracking-wider">Scoring</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-white text-sm">{(league.scoring_type ?? 'half_ppr').replace('_', ' ').toUpperCase()}</span>
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                (league.scoring_source ?? 'mock') === 'real'
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-yellow-500/20 text-yellow-400'
              }`}>
                {(league.scoring_source ?? 'mock') === 'real' ? 'Real' : 'Mock'}
              </span>
            </div>
          </div>
          <div>
            <p className="text-white/40 text-xs font-semibold uppercase tracking-wider">Members</p>
            <p className="text-white text-sm mt-1">{members.length} / {league.league_size ?? '—'}</p>
          </div>
          {league.invite_code && (
            <div>
              <p className="text-white/40 text-xs font-semibold uppercase tracking-wider">Invite Code</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-gold font-mono font-bold text-sm tracking-widest">{league.invite_code}</span>
                <button
                  onClick={copyInviteCode}
                  className="text-white/30 hover:text-gold text-xs transition-colors"
                  title="Copy join link"
                >
                  {inviteCopied ? '✓' : '📋'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Commissioner Tools */}
      {isCommissioner && (
        <div className="card border-gold/20 space-y-4">
          <span className="text-gold font-black text-sm uppercase tracking-wider">Commissioner Tools</span>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Link href={`/dashboard/leagues/${id}/settings`} className="card hover:border-gold/30 transition-all text-center group py-3">
              <div className="text-lg mb-1">⚙</div>
              <div className="text-white/60 text-xs font-semibold group-hover:text-gold transition-colors">League Settings</div>
            </Link>
            <Link href={`/dashboard/leagues/${id}/teams`} className="card hover:border-gold/30 transition-all text-center group py-3">
              <div className="text-lg mb-1">👥</div>
              <div className="text-white/60 text-xs font-semibold group-hover:text-gold transition-colors">Teams</div>
            </Link>
            <Link href={`/dashboard/leagues/${id}/matchups`} className="card hover:border-gold/30 transition-all text-center group py-3">
              <div className="text-lg mb-1">⚔</div>
              <div className="text-white/60 text-xs font-semibold group-hover:text-gold transition-colors">Matchups</div>
            </Link>
            <Link href={`/dashboard/leagues/${id}/standings`} className="card hover:border-gold/30 transition-all text-center group py-3">
              <div className="text-lg mb-1">🏆</div>
              <div className="text-white/60 text-xs font-semibold group-hover:text-gold transition-colors">Standings</div>
            </Link>
            <Link href={`/dashboard/leagues/${id}/players`} className="card hover:border-gold/30 transition-all text-center group py-3">
              <div className="text-lg mb-1">🏈</div>
              <div className="text-white/60 text-xs font-semibold group-hover:text-gold transition-colors">Players / Waivers</div>
            </Link>
          </div>

          {/* Draft start — pre_draft only */}
          {league.status === 'pre_draft' && (
            <div className="space-y-2 border-t border-white/10 pt-4">
              <label className="text-white/60 text-xs font-semibold uppercase tracking-wider block">Start Draft</label>
              <p className="text-white/40 text-xs">{draftRounds} rounds (based on {computedRounds} roster slots) · Snake format</p>
              <div className="flex gap-2 items-center flex-wrap">
                <button onClick={handleStartDraft} disabled={draftStarting || teams.length < 2} className="btn-gold text-sm py-2 px-4">
                  {draftStarting ? 'Starting...' : `Start Draft (${draftRounds} rounds)`}
                </button>
              </div>
              {teams.length < 2 && <p className="text-white/40 text-xs">Need at least 2 teams to start.</p>}
              {draftStartErr && <p className="text-red-400 text-sm">{draftStartErr}</p>}
            </div>
          )}

          {league.status === 'drafting' && (
            <Link href="/dashboard/draft" className="btn-gold text-sm py-2 px-4 inline-block">Resume Draft</Link>
          )}

          {/* Invite management */}
          <div className="space-y-3 border-t border-white/10 pt-4">
            <label className="text-white/60 text-xs font-semibold uppercase tracking-wider block">Invite Players</label>
            {currentInvite ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2">
                  <span className="text-white/40 text-xs">Code:</span>
                  <span className="text-gold font-mono font-bold tracking-widest text-sm flex-1">{currentInvite.code}</span>
                  <span className="text-white/30 text-xs">{currentInvite.uses} use{currentInvite.uses !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/join/${currentInvite.code}`); }} className="btn-gold text-sm py-2 px-4 flex-1">
                    Copy Invite Link
                  </button>
                  <button onClick={handleGenerateInvite} disabled={inviteLoading} className="btn-outline-gold text-sm py-2 px-3" title="Regenerate">↻</button>
                  <button onClick={handleDeactivateInvite} disabled={inviteLoading} className="btn-dark border border-white/10 text-sm py-2 px-3 text-white/40 hover:text-red-400 transition-colors" title="Deactivate">✕</button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-white/30 text-sm">No active invite link.</p>
                <button onClick={handleGenerateInvite} disabled={inviteLoading} className="btn-outline-gold text-sm py-2 px-4">
                  {inviteLoading ? 'Generating...' : '+ Generate Invite Link'}
                </button>
              </div>
            )}
          </div>

          {/* Lineup Lock Control */}
          {league.status === 'in_season' && (
            <div className="space-y-2 border-t border-white/10 pt-4">
              <label className="text-white/60 text-xs font-semibold uppercase tracking-wider block">Lineup Lock</label>
              <div className="flex items-center gap-3">
                {(league.lineup_locked_week ?? 0) >= league.week ? (
                  <>
                    <span className="px-3 py-1.5 rounded text-xs font-bold bg-red-500/20 text-red-400 border border-red-500/30">
                      Locked — Week {league.week}
                    </span>
                    <button
                      onClick={async () => {
                        try {
                          await leaguesApi.unlockLineup(id);
                          mutate();
                        } catch (e) { setErrMsg((e as Error).message); }
                      }}
                      className="btn-outline-gold text-xs py-1.5 px-3"
                    >
                      Unlock Lineups
                    </button>
                  </>
                ) : (
                  <span className="px-3 py-1.5 rounded text-xs font-bold bg-green-500/20 text-green-400 border border-green-500/30">
                    Lineups Open — Week {league.week}
                  </span>
                )}
              </div>
            </div>
          )}

          {errMsg && <p className="text-red-400 text-sm">{errMsg}</p>}
        </div>
      )}

      {/* Join as team — shown when user has no team yet */}
      {!hasTeam && (
        <div className="card border-white/20 space-y-3">
          <p className="text-white font-bold text-sm">You don&apos;t have a team in this league yet.</p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Team name..."
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              className="input-dark flex-1 py-2 text-sm"
            />
            <button onClick={handleJoinAsTeam} disabled={joinLoading || !joinName.trim()} className="btn-gold text-sm py-2 px-4">
              {joinLoading ? 'Joining...' : 'Create Team'}
            </button>
          </div>
          {joinErr && <p className="text-red-400 text-sm">{joinErr}</p>}
        </div>
      )}

      {/* Member List */}
      <div>
        <h2 className="text-white font-black text-lg mb-4">Members ({members.length})</h2>
        <div className="card overflow-hidden p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">Member</th>
                <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">Role</th>
                <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3 hidden sm:table-cell">Joined</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const isMe = m.user_id === user?.id;
                return (
                  <tr key={m.id} className={`border-b border-white/5 ${isMe ? 'bg-gold/5' : 'hover:bg-white/5'} transition-colors`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center shrink-0">
                          {m.avatar_url ? (
                            <img src={m.avatar_url} alt="" className="w-full h-full object-cover rounded-full" />
                          ) : (
                            <span className="text-gold font-bold text-xs">{m.display_name?.[0]?.toUpperCase() || '?'}</span>
                          )}
                        </div>
                        <div>
                          <p className={`text-sm font-semibold ${isMe ? 'text-gold' : 'text-white'}`}>
                            {m.display_name || m.username} {isMe && <span className="text-xs font-normal">(you)</span>}
                          </p>
                          <p className="text-white/40 text-xs">@{m.username}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold uppercase tracking-wider ${m.role === 'commissioner' ? 'text-gold' : 'text-white/40'}`}>
                        {m.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="text-white/40 text-xs">{new Date(m.created_at).toLocaleDateString()}</span>
                    </td>
                  </tr>
                );
              })}
              {members.length === 0 && (
                <tr>
                  <td colSpan={3} className="text-center text-white/30 py-8 text-sm">No members yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Activity */}
      <div>
        <h2 className="text-white font-black text-lg mb-4">Recent Activity</h2>
        {transactions && transactions.length > 0 ? (
          <div className="card space-y-0 p-0 divide-y divide-white/5">
            {transactions.map((tx) => (
              <div key={tx.id} className="px-4 py-3 flex items-center gap-3">
                <span className={`text-xs font-bold uppercase w-10 shrink-0 ${
                  tx.type === 'add' ? 'text-green-400' : tx.type === 'drop' ? 'text-red-400' : 'text-blue-400'
                }`}>
                  {tx.type}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm truncate">
                    <span className="font-semibold">{tx.team_name || tx.user_name}</span>
                    {tx.type === 'add' && <> added <span className="text-gold font-semibold">{tx.player_name}</span></>}
                    {tx.type === 'drop' && <> dropped <span className="text-white/60">{tx.player_name}</span></>}
                    {tx.type === 'move' && <> moved <span className="text-gold font-semibold">{tx.player_name}</span> <span className="text-white/30">{tx.detail}</span></>}
                  </p>
                </div>
                <span className="text-white/20 text-xs shrink-0">
                  {new Date(tx.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="card text-center py-8">
            <p className="text-white/30 text-sm">No activity yet. Roster moves, adds, and drops will appear here.</p>
          </div>
        )}
      </div>

      {/* Waiver Activity */}
      {waiverActivity && waiverActivity.length > 0 && (
        <div>
          <h2 className="text-white font-black text-lg mb-4">Waiver Activity</h2>
          <div className="card space-y-0 p-0 divide-y divide-white/5">
            {waiverActivity.map((c) => (
              <div key={c.id} className="px-4 py-3 flex items-center gap-3">
                <span className={`text-xs font-bold uppercase w-16 shrink-0 ${
                  c.status === 'approved' ? 'text-green-400' : c.status === 'rejected' ? 'text-red-400/60' : 'text-gold'
                }`}>
                  {c.status}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm truncate">
                    <span className="font-semibold">{c.team_name}</span>
                    {c.status === 'approved' && <> claimed <span className="text-gold font-semibold">{c.player_name}</span></>}
                    {c.status === 'rejected' && <> lost claim on <span className="text-white/40">{c.player_name}</span></>}
                    {c.status === 'pending' && <> wants <span className="text-gold">{c.player_name}</span></>}
                    <span className="text-white/20 ml-2">{c.player_position}</span>
                  </p>
                </div>
                <span className="text-white/20 text-xs shrink-0">
                  {new Date(c.processed_at || c.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Standings preview */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-black text-lg">Standings</h2>
          <Link href={`/dashboard/leagues/${id}/standings`} className="text-gold text-sm hover:underline">View full →</Link>
        </div>
        {teams.length > 0 ? (
          <div className="card overflow-hidden p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">#</th>
                  <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">Team</th>
                  <th className="text-right text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">W-L</th>
                  <th className="text-right text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3 hidden sm:table-cell">PF</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((team, idx) => {
                  const isMe = team.user_id === user?.id;
                  return (
                    <tr key={team.id} className={`border-b border-white/5 ${isMe ? 'bg-gold/5' : 'hover:bg-white/5'} transition-colors`}>
                      <td className="px-4 py-3">
                        <span className={`text-sm font-bold ${idx === 0 ? 'text-gold' : 'text-white/40'}`}>{idx + 1}</span>
                      </td>
                      <td className="px-4 py-3">
                        <p className={`font-semibold text-sm ${isMe ? 'text-gold' : 'text-white'}`}>
                          {team.name} {isMe && <span className="text-xs font-normal">(you)</span>}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-white font-mono text-sm">{team.wins}-{team.losses}</span>
                      </td>
                      <td className="px-4 py-3 text-right hidden sm:table-cell">
                        <span className="text-gold font-mono text-sm">{Number(team.points_for).toFixed(1)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card text-center py-8">
            <p className="text-white/30 text-sm">No teams yet. Invite members to join and standings will appear here.</p>
          </div>
        )}
      </div>
    </div>
  );
}
