'use client';
import { use, useEffect, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { leagues as leaguesApi, invites as invitesApi } from '@/lib/api';
import { useAuthStore, useLeagueStore } from '@/lib/store';
import TopBar from '@/components/layout/TopBar';
import type { League, Team, LeagueInvite } from '@/types';

export default function LeaguePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user } = useAuthStore();
  const setActiveLeague = useLeagueStore((s) => s.setActiveLeague);

  const { data: league, mutate, isLoading } = useSWR(
    `/leagues/${id}`,
    () => leaguesApi.get(id) as Promise<League & { teams: Team[] }>
  );

  const { data: currentInvite, mutate: mutateInvite } = useSWR<LeagueInvite | null>(
    league?.commissioner_id === user?.id ? `/leagues/${id}/invite` : null,
    () => invitesApi.getCurrent(id) as Promise<LeagueInvite | null>,
    { shouldRetryOnError: false }
  );

  const [syncLoading, setSyncLoading]   = useState(false);
  const [syncMsg, setSyncMsg]           = useState('');
  const [syncErr, setSyncErr]           = useState('');
  const [importWeek, setImportWeek]     = useState<number>(1);
  const [importLoading, setImportLoading] = useState(false);
  const [importMsg, setImportMsg]       = useState('');
  const [importErr, setImportErr]       = useState('');
  const [weekInput, setWeekInput]       = useState<number>(1);
  const [weekLoading, setWeekLoading]   = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteCopied, setInviteCopied]   = useState(false);

  useEffect(() => {
    if (league) {
      setActiveLeague(league);
      setImportWeek(league.week);
      setWeekInput(league.week);
    }
  }, [league, setActiveLeague]);

  const isCommissioner = !!league && league.commissioner_id === user?.id;
  const teams = league?.teams || [];

  async function handleSync() {
    setSyncLoading(true);
    setSyncMsg('');
    setSyncErr('');
    try {
      const result = await leaguesApi.syncSleeper(id);
      setSyncMsg(
        `Synced ${result.synced_rosters} teams · Week ${result.week} · ` +
        `${result.scoring_format.toUpperCase()} · ${result.linked_users} user(s) linked`
      );
      mutate();
    } catch (err) {
      setSyncErr((err as Error).message);
    } finally {
      setSyncLoading(false);
    }
  }

  async function handleImportMatchups() {
    setImportLoading(true);
    setImportMsg('');
    setImportErr('');
    try {
      const result = await leaguesApi.importMatchups(id, importWeek);
      setImportMsg(result.message);
      mutate();
    } catch (err) {
      setImportErr((err as Error).message);
    } finally {
      setImportLoading(false);
    }
  }

  async function handleAdvanceWeek() {
    setWeekLoading(true);
    try {
      await leaguesApi.update(id, { week: weekInput });
      mutate();
    } catch (err) {
      setSyncErr((err as Error).message);
    } finally {
      setWeekLoading(false);
    }
  }

  async function handleGenerateInvite() {
    setInviteLoading(true);
    try {
      await invitesApi.generate(id);
      await mutateInvite();
    } catch (err) {
      setSyncErr((err as Error).message);
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
      setSyncErr((err as Error).message);
    } finally {
      setInviteLoading(false);
    }
  }

  function copyInviteLink() {
    if (!currentInvite) return;
    const url = `${window.location.origin}/join/${currentInvite.code}`;
    navigator.clipboard.writeText(url).then(() => {
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    });
  }

  function goToMatchups() {
    if (league) setActiveLeague(league);
    router.push('/dashboard/matchups');
  }

  if (isLoading) {
    return (
      <div>
        <TopBar title="Loading..." />
        <div className="p-6">
          <div className="card text-center text-white/40 py-12">Loading league...</div>
        </div>
      </div>
    );
  }

  if (!league) {
    return (
      <div>
        <TopBar title="League not found" />
        <div className="p-6">
          <div className="card text-center text-white/40 py-12">
            League not found. <Link href="/dashboard" className="text-gold">Back to dashboard</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <TopBar
        title={league.name}
        subtitle={`Season ${league.season} · Week ${league.week} · ${league.status.replace('_', ' ')}`}
      />

      <div className="p-6 space-y-6">

        {/* Commissioner panel */}
        {isCommissioner && league.sleeper_league_id && (
          <div className="card border-gold/20 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-gold font-black text-sm uppercase tracking-wider">Commissioner Controls</span>
            </div>

            {/* Sync + feedback */}
            <div className="space-y-2">
              <div className="flex gap-3 flex-wrap items-center">
                <button
                  onClick={handleSync}
                  disabled={syncLoading}
                  className="btn-outline-gold text-sm py-2 px-4"
                >
                  {syncLoading ? 'Syncing...' : '↻ Sync from Sleeper'}
                </button>
              </div>
              {syncMsg && <p className="text-green-400 text-sm">{syncMsg}</p>}
              {syncErr && <p className="text-red-400 text-sm">{syncErr}</p>}
            </div>

            {/* Import matchups */}
            <div className="space-y-2 border-t border-white/10 pt-4">
              <label className="text-white/60 text-xs font-semibold uppercase tracking-wider block">
                Import Matchups
              </label>
              <div className="flex gap-2 items-center flex-wrap">
                <select
                  className="input-dark py-2 text-sm w-28"
                  value={importWeek}
                  onChange={(e) => setImportWeek(parseInt(e.target.value))}
                >
                  {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
                    <option key={w} value={w}>Week {w}</option>
                  ))}
                </select>
                <button
                  onClick={handleImportMatchups}
                  disabled={importLoading}
                  className="btn-gold text-sm py-2 px-4"
                >
                  {importLoading ? 'Importing...' : 'Import Scores'}
                </button>
              </div>
              {importMsg && <p className="text-green-400 text-sm">{importMsg}</p>}
              {importErr && <p className="text-red-400 text-sm">{importErr}</p>}
            </div>

            {/* Advance week */}
            <div className="space-y-2 border-t border-white/10 pt-4">
              <label className="text-white/60 text-xs font-semibold uppercase tracking-wider block">
                Current Week
              </label>
              <div className="flex gap-2 items-center">
                <select
                  className="input-dark py-2 text-sm w-28"
                  value={weekInput}
                  onChange={(e) => setWeekInput(parseInt(e.target.value))}
                >
                  {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
                    <option key={w} value={w}>Week {w}</option>
                  ))}
                </select>
                <button
                  onClick={handleAdvanceWeek}
                  disabled={weekLoading || weekInput === league.week}
                  className="btn-outline-gold text-sm py-2 px-4"
                >
                  {weekLoading ? 'Updating...' : 'Set Week'}
                </button>
              </div>
            </div>

            {/* Invite Players */}
            <div className="space-y-3 border-t border-white/10 pt-4">
              <label className="text-white/60 text-xs font-semibold uppercase tracking-wider block">
                Invite Players
              </label>

              {currentInvite ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2">
                    <span className="text-white/40 text-xs">Code:</span>
                    <span className="text-gold font-mono font-bold tracking-widest text-sm flex-1">
                      {currentInvite.code}
                    </span>
                    <span className="text-white/30 text-xs">
                      {currentInvite.uses} use{currentInvite.uses !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={copyInviteLink}
                      className="btn-gold text-sm py-2 px-4 flex-1"
                    >
                      {inviteCopied ? '✓ Copied!' : '🔗 Copy Invite Link'}
                    </button>
                    <button
                      onClick={handleGenerateInvite}
                      disabled={inviteLoading}
                      className="btn-outline-gold text-sm py-2 px-3"
                      title="Generate a new code (deactivates current)"
                    >
                      ↻
                    </button>
                    <button
                      onClick={handleDeactivateInvite}
                      disabled={inviteLoading}
                      className="btn-dark border border-white/10 text-sm py-2 px-3 text-white/40 hover:text-red-400 transition-colors"
                      title="Deactivate invite"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-white/30 text-sm">No active invite link.</p>
                  <button
                    onClick={handleGenerateInvite}
                    disabled={inviteLoading}
                    className="btn-outline-gold text-sm py-2 px-4"
                  >
                    {inviteLoading ? 'Generating...' : '+ Generate Invite Link'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Non-commissioner quick actions */}
        {!isCommissioner && league.sleeper_league_id && (
          <div className="flex gap-3 flex-wrap">
            <button onClick={goToMatchups} className="btn-outline-gold text-sm py-2 px-4">
              ⚔️ View Matchups
            </button>
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
                  <th className="text-right text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3 hidden sm:table-cell">PF</th>
                  <th className="text-right text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3 hidden sm:table-cell">PA</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((team, idx) => {
                  const isMe = team.user_id === user?.id;
                  return (
                    <tr
                      key={team.id}
                      className={`border-b border-white/5 transition-colors ${isMe ? 'bg-gold/5' : 'hover:bg-white/5'}`}
                    >
                      <td className="px-4 py-3">
                        <span className={`text-sm font-bold ${idx === 0 ? 'text-gold' : 'text-white/40'}`}>
                          {idx + 1}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className={`font-semibold text-sm ${isMe ? 'text-gold' : 'text-white'}`}>
                          {team.name} {isMe && <span className="text-xs font-normal">(you)</span>}
                        </p>
                        {team.display_name && (
                          <p className="text-white/40 text-xs">{team.display_name}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-white font-mono text-sm">{team.wins}-{team.losses}</span>
                      </td>
                      <td className="px-4 py-3 text-right hidden sm:table-cell">
                        <span className="text-gold font-mono text-sm">{Number(team.points_for).toFixed(1)}</span>
                      </td>
                      <td className="px-4 py-3 text-right hidden sm:table-cell">
                        <span className="text-white/60 font-mono text-sm">{Number(team.points_against).toFixed(1)}</span>
                      </td>
                    </tr>
                  );
                })}
                {teams.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center text-white/30 py-8 text-sm">
                      {isCommissioner
                        ? 'No teams yet — sync from Sleeper or add teams manually.'
                        : 'No teams yet in this league.'}
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
            { action: goToMatchups,                                   icon: '⚔️',  label: 'Matchups' },
            { href: '/dashboard/trades',                              icon: '🔄',  label: 'Trades' },
            { href: '/dashboard/roster',                              icon: '👥',  label: 'My Roster' },
            { href: '/dashboard/chat',                                icon: '💬',  label: 'League Chat' },
          ].map((item) => (
            item.href ? (
              <Link
                key={item.label}
                href={item.href}
                className="card hover:border-gold/30 transition-all text-center group py-4"
              >
                <div className="text-2xl mb-2">{item.icon}</div>
                <div className="text-white/60 text-sm font-semibold group-hover:text-gold transition-colors">
                  {item.label}
                </div>
              </Link>
            ) : (
              <button
                key={item.label}
                onClick={item.action}
                className="card hover:border-gold/30 transition-all text-center group py-4"
              >
                <div className="text-2xl mb-2">{item.icon}</div>
                <div className="text-white/60 text-sm font-semibold group-hover:text-gold transition-colors">
                  {item.label}
                </div>
              </button>
            )
          ))}
        </div>

      </div>
    </div>
  );
}
