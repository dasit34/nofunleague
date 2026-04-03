'use client';
import { use, useState } from 'react';
import useSWR from 'swr';
import { leagues as leaguesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { League, Team, Matchup } from '@/types';

type LeagueWithTeams = League & { teams: Team[] };

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
  const displayWeek = viewWeek ?? (currentWeek > 1 ? currentWeek - 1 : 1);
  const isCommissioner = league?.commissioner_id === user?.id;
  const isInSeason = league?.status === 'in_season';
  const isRealMode = (league?.scoring_source ?? 'mock') === 'real';

  const { data: matchups, mutate: mutateMatchups } = useSWR(
    league ? `/leagues/${id}/matchups/${displayWeek}` : null,
    () => leaguesApi.getMatchups(id, displayWeek) as Promise<Matchup[]>
  );

  // Check if stats are loaded for the current week
  const { data: statsInfo, mutate: mutateStats } = useSWR(
    league && isRealMode ? `/debug/week/${currentWeek}?season=${league.season}` : null,
    () => leaguesApi.debugWeek(currentWeek, league?.season)
  );

  const statsLoaded = statsInfo?.stats_loaded ?? false;
  const statsCount = statsInfo?.total_player_stats ?? 0;

  const teamMap = new Map<string, string>();
  for (const t of league?.teams ?? []) teamMap.set(t.id, t.name);

  async function handleScore() {
    setScoring(true);
    setMsg('');
    setErr('');
    try {
      const result = await leaguesApi.simulateWeek(id);
      setMsg(`${result.message} — ${result.matchups_scored} matchups`);
      setViewWeek(result.week);
      mutateLeague();
      mutateMatchups();
      mutateStats();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setScoring(false);
    }
  }

  async function handleSyncStats() {
    if (!league) return;
    setSyncing(true);
    setMsg('');
    setErr('');
    try {
      const result = await leaguesApi.syncStats(league.season, currentWeek);
      setMsg(`Stats synced: ${result.synced} players for week ${currentWeek}`);
      mutateStats();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-white font-black text-lg">Matchups</h2>
          {league && (
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded ${
                isRealMode
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                  : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
              }`}>
                {isRealMode ? 'Real Stats' : 'Mock Scoring'}
              </span>
              <span className="text-white/30 text-xs">
                {league.scoring_type.replace('_', ' ').toUpperCase()}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            className="input-dark py-2 text-sm w-32"
            value={displayWeek}
            onChange={(e) => setViewWeek(parseInt(e.target.value))}
          >
            {Array.from({ length: Math.max(currentWeek, 13) }, (_, i) => i + 1).map((w) => (
              <option key={w} value={w}>
                Week {w}{w === currentWeek ? ' (current)' : ''}
              </option>
            ))}
          </select>

          {isCommissioner && isInSeason && (
            <button onClick={handleScore} disabled={scoring} className="btn-gold text-sm py-2 px-4">
              {scoring ? 'Scoring...' : `Score Week ${currentWeek}`}
            </button>
          )}
        </div>
      </div>

      {/* Stats status indicator for real-scoring leagues */}
      {isCommissioner && isRealMode && isInSeason && (
        <div className={`flex items-center justify-between px-4 py-3 rounded-lg border text-sm ${
          statsLoaded
            ? 'bg-green-500/10 border-green-500/30'
            : 'bg-yellow-500/10 border-yellow-500/30'
        }`}>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${statsLoaded ? 'bg-green-400' : 'bg-yellow-400'}`} />
            <span className={statsLoaded ? 'text-green-400' : 'text-yellow-400'}>
              {statsLoaded
                ? `Stats loaded for week ${currentWeek} (${statsCount} players)`
                : `No stats for week ${currentWeek} — sync before scoring`}
            </span>
          </div>
          <button
            onClick={handleSyncStats}
            disabled={syncing}
            className="text-xs font-bold text-white/60 hover:text-white border border-white/20 rounded px-3 py-1 transition-colors"
          >
            {syncing ? 'Syncing...' : 'Sync Stats'}
          </button>
        </div>
      )}

      {msg && <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-green-400 text-sm">{msg}</div>}
      {err && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">{err}</div>}

      {!matchups || matchups.length === 0 ? (
        <div className="card text-center text-white/30 py-12 text-sm">
          {isInSeason
            ? `No matchups for week ${displayWeek}.`
            : 'Matchups will appear once the draft completes and the season begins.'}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {matchups.map((m) => {
            const homeName = m.home_team_name || teamMap.get(m.home_team_id) || 'Team A';
            const awayName = m.away_team_name || teamMap.get(m.away_team_id) || 'Team B';
            const homeWon = m.is_complete && m.winner_team_id === m.home_team_id;
            const awayWon = m.is_complete && m.winner_team_id === m.away_team_id;
            const isTie = m.is_complete && !m.winner_team_id;

            return (
              <div key={m.id} className={`card ${m.is_complete ? '' : 'opacity-60'}`}>
                {m.is_complete && m.scoring_source && (
                  <div className="mb-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      m.scoring_source === 'real'
                        ? 'bg-green-500/10 text-green-400/60'
                        : 'bg-yellow-500/10 text-yellow-400/60'
                    }`}>
                      {m.scoring_source === 'real' ? 'real stats' : 'mock'}
                    </span>
                  </div>
                )}

                <div className={`flex items-center justify-between py-2 ${homeWon ? 'text-gold' : 'text-white'}`}>
                  <div className="flex items-center gap-2">
                    {homeWon && <span className="text-gold text-xs font-bold">W</span>}
                    {m.is_complete && !homeWon && !isTie && <span className="text-red-400/60 text-xs font-bold">L</span>}
                    {isTie && <span className="text-white/40 text-xs font-bold">T</span>}
                    <span className={`font-semibold text-sm ${homeWon ? 'text-gold' : ''}`}>{homeName}</span>
                  </div>
                  <span className={`font-mono font-bold text-lg ${homeWon ? 'text-gold' : 'text-white/60'}`}>
                    {m.is_complete ? Number(m.home_score).toFixed(1) : '—'}
                  </span>
                </div>

                <div className="border-t border-white/10" />

                <div className={`flex items-center justify-between py-2 ${awayWon ? 'text-gold' : 'text-white'}`}>
                  <div className="flex items-center gap-2">
                    {awayWon && <span className="text-gold text-xs font-bold">W</span>}
                    {m.is_complete && !awayWon && !isTie && <span className="text-red-400/60 text-xs font-bold">L</span>}
                    {isTie && <span className="text-white/40 text-xs font-bold">T</span>}
                    <span className={`font-semibold text-sm ${awayWon ? 'text-gold' : ''}`}>{awayName}</span>
                  </div>
                  <span className={`font-mono font-bold text-lg ${awayWon ? 'text-gold' : 'text-white/60'}`}>
                    {m.is_complete ? Number(m.away_score).toFixed(1) : '—'}
                  </span>
                </div>

                {!m.is_complete && <p className="text-white/20 text-xs text-center mt-1">Not yet played</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
