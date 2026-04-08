'use client';
import { use, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { leagues as leaguesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { League, Team, Matchup } from '@/types';

type LeagueWithTeams = League & { teams: Team[] };

/** Generate placeholder matchup pairings from teams (1v2, 3v4, etc.) */
function generatePlaceholderPairings(teams: Team[]): { home: Team; away: Team; id: string }[] {
  const pairs: { home: Team; away: Team; id: string }[] = [];
  for (let i = 0; i < teams.length - 1; i += 2) {
    pairs.push({ home: teams[i], away: teams[i + 1], id: `placeholder-${i}` });
  }
  // Odd team out gets a bye placeholder
  if (teams.length % 2 !== 0) {
    pairs.push({ home: teams[teams.length - 1], away: { id: 'bye', name: 'BYE', wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0 } as Team, id: `placeholder-bye` });
  }
  return pairs;
}

export default function MatchupsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuthStore();

  const { data: league, mutate: mutateLeague } = useSWR(
    `/leagues/${id}`,
    () => leaguesApi.get(id) as Promise<LeagueWithTeams>
  );

  const [viewWeek, setViewWeek] = useState<number | null>(null);
  const [scoring, setScoring] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const currentWeek = league?.week ?? 1;
  const displayWeek = viewWeek ?? currentWeek;
  const isCommissioner = league?.commissioner_id === user?.id;
  const isInSeason = league?.status === 'in_season' || league?.status === 'post_season';
  const isRealMode = (league?.scoring_source ?? 'mock') === 'real';
  const teams = league?.teams || [];

  const { data: matchups, mutate: mutateMatchups } = useSWR(
    league ? `/leagues/${id}/matchups/${displayWeek}` : null,
    () => leaguesApi.getMatchups(id, displayWeek) as Promise<Matchup[]>
  );

  const { data: statsInfo, mutate: mutateStats } = useSWR(
    league && isRealMode ? `/debug/week/${currentWeek}?season=${league.season}` : null,
    () => leaguesApi.debugWeek(currentWeek, league?.season)
  );

  const statsLoaded = statsInfo?.stats_loaded ?? false;
  const statsCount = statsInfo?.total_player_stats ?? 0;

  const teamMap = new Map<string, Team>();
  for (const t of teams) teamMap.set(t.id, t);

  const hasRealMatchups = matchups && matchups.length > 0;
  const placeholderPairings = !hasRealMatchups ? generatePlaceholderPairings(teams) : [];

  const [warn, setWarn] = useState('');

  async function handleScore() {
    setScoring(true); setMsg(''); setErr(''); setWarn('');
    try {
      const result = await leaguesApi.simulateWeek(id);
      setMsg(`Week ${result.week} scored (${result.scoring_source}) — ${result.matchups_scored} matchups`);
      if (result.warning) setWarn(result.warning);
      setViewWeek(result.week);
      mutateLeague(); mutateMatchups(); mutateStats();
    } catch (e) { setErr((e as Error).message); }
    finally { setScoring(false); }
  }

  async function handleSyncStats() {
    if (!league) return;
    setSyncing(true); setMsg(''); setErr('');
    try {
      const result = await leaguesApi.syncStats(league.season, currentWeek);
      setMsg(`Stats synced: ${result.synced} players`);
      mutateStats();
    } catch (e) { setErr((e as Error).message); }
    finally { setSyncing(false); }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-white font-black text-lg">Matchups</h2>
          {league && (
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded ${
                isRealMode ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
              }`}>{isRealMode ? 'Real Stats' : 'Mock Scoring'}</span>
              <span className="text-white/30 text-xs">{(league.scoring_type ?? 'standard').replace('_', ' ').toUpperCase()}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setViewWeek(Math.max(1, displayWeek - 1))} disabled={displayWeek <= 1}
            className="px-2 py-2 rounded bg-white/5 text-white/40 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-20 disabled:cursor-not-allowed text-sm">&larr;</button>
          <select className="input-dark py-2 text-sm w-32" value={displayWeek}
            onChange={(e) => setViewWeek(parseInt(e.target.value))}>
            {Array.from({ length: Math.max(currentWeek, 14) }, (_, i) => i + 1).map((w) => (
              <option key={w} value={w}>Week {w}{w === currentWeek ? ' (current)' : ''}</option>
            ))}
          </select>
          <button onClick={() => setViewWeek(displayWeek + 1)} disabled={displayWeek >= Math.max(currentWeek, 18)}
            className="px-2 py-2 rounded bg-white/5 text-white/40 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-20 disabled:cursor-not-allowed text-sm">&rarr;</button>
          {isCommissioner && isInSeason && (
            <button onClick={handleScore} disabled={scoring} className="btn-gold text-sm py-2 px-4 ml-1">
              {scoring ? 'Scoring...' : `Score Week ${currentWeek}`}
            </button>
          )}
        </div>
      </div>

      {/* Stats indicator */}
      {isCommissioner && isRealMode && isInSeason && (
        <div className={`flex items-center justify-between px-4 py-3 rounded-lg border text-sm ${
          statsLoaded ? 'bg-green-500/10 border-green-500/30' : 'bg-yellow-500/10 border-yellow-500/30'
        }`}>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${statsLoaded ? 'bg-green-400' : 'bg-yellow-400'}`} />
            <span className={statsLoaded ? 'text-green-400' : 'text-yellow-400'}>
              {statsLoaded ? `Stats loaded (${statsCount} players)` : `No stats for week ${currentWeek}`}
            </span>
          </div>
          <button onClick={handleSyncStats} disabled={syncing}
            className="text-xs font-bold text-white/60 hover:text-white border border-white/20 rounded px-3 py-1 transition-colors">
            {syncing ? 'Syncing...' : 'Sync Stats'}
          </button>
        </div>
      )}

      {msg && <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-green-400 text-sm">{msg}</div>}
      {warn && <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-yellow-400 text-sm">{warn}</div>}
      {err && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">{err}</div>}

      {/* Matchup Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Real matchups */}
        {hasRealMatchups && matchups!.map((m) => {
          const home = teamMap.get(m.home_team_id);
          const away = teamMap.get(m.away_team_id);
          const homeName = m.home_team_name || home?.name || 'Team A';
          const awayName = m.away_team_name || away?.name || 'Team B';
          const homeWon = m.is_complete && m.winner_team_id === m.home_team_id;
          const awayWon = m.is_complete && m.winner_team_id === m.away_team_id;

          return (
            <Link key={m.id} href={`/dashboard/leagues/${id}/matchups/${m.id}`}
              className={`card hover:border-gold/30 transition-all ${m.is_playoffs ? 'border-purple-500/20' : ''}`}>
              {(m.is_playoffs || (m.is_complete && m.scoring_source)) && (
                <div className="mb-2 flex gap-1.5">
                  {m.is_playoffs && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30 font-bold">Playoffs</span>
                  )}
                  {m.is_complete && m.scoring_source && (
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      m.scoring_source === 'real' ? 'bg-green-500/10 text-green-400/60' : 'bg-yellow-500/10 text-yellow-400/60'
                    }`}>{m.scoring_source === 'real' ? 'real stats' : 'mock'}</span>
                  )}
                </div>
              )}
              <MatchupCardRow name={homeName} score={m.is_complete ? Number(m.home_score).toFixed(1) : '—'}
                record={home ? `${home.wins}-${home.losses}` : '0-0'} won={homeWon} lost={m.is_complete && !homeWon && m.winner_team_id !== null}
                topScorer={(m as unknown as Record<string, unknown>).home_top_scorer_name as string | undefined} />
              <div className="border-t border-white/10" />
              <MatchupCardRow name={awayName} score={m.is_complete ? Number(m.away_score).toFixed(1) : '—'}
                record={away ? `${away.wins}-${away.losses}` : '0-0'} won={awayWon} lost={m.is_complete && !awayWon && m.winner_team_id !== null}
                topScorer={(m as unknown as Record<string, unknown>).away_top_scorer_name as string | undefined} />
              {!m.is_complete && <p className="text-white/15 text-xs text-center mt-1">Upcoming</p>}
            </Link>
          );
        })}

        {/* Placeholder matchups when no real schedule exists */}
        {!hasRealMatchups && placeholderPairings.map((p) => (
          <div key={p.id} className="card opacity-60">
            <MatchupCardRow name={p.home.name} score="—" record={`${p.home.wins}-${p.home.losses}`} won={false} lost={false} />
            <div className="border-t border-white/10" />
            <MatchupCardRow name={p.away.name} score="—" record={`${p.away.wins}-${p.away.losses}`} won={false} lost={false} />
            <p className="text-white/15 text-xs text-center mt-1">
              {league?.status === 'pre_draft' ? 'Preview — schedule after draft' : 'Not scheduled'}
            </p>
          </div>
        ))}

        {/* No teams at all */}
        {!hasRealMatchups && placeholderPairings.length === 0 && (
          <div className="card text-center py-8 md:col-span-2">
            <p className="text-white/30 text-sm">Add teams to see matchup previews.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-component ──────────────────────────────────────────────────────────

function MatchupCardRow({ name, score, record, won, lost, topScorer }: {
  name: string; score: string; record: string; won: boolean; lost: boolean; topScorer?: string;
}) {
  return (
    <div className={`flex items-center justify-between py-2 ${won ? 'text-gold' : 'text-white'}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {won && <span className="text-gold text-xs font-bold shrink-0">W</span>}
          {lost && <span className="text-red-400/60 text-xs font-bold shrink-0">L</span>}
          <span className={`font-semibold text-sm truncate ${won ? 'text-gold' : ''}`}>{name}</span>
          <span className="text-white/20 text-xs font-mono shrink-0">{record}</span>
        </div>
        {topScorer && <p className="text-white/20 text-[10px] mt-0.5 ml-5 truncate">Top: {topScorer}</p>}
      </div>
      <span className={`font-mono font-bold text-lg shrink-0 ${won ? 'text-gold' : 'text-white/40'}`}>{score}</span>
    </div>
  );
}
