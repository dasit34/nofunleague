'use client';
import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { leagues as leaguesApi } from '@/lib/api';
import { useAuthStore, useLeagueStore } from '@/lib/store';
import TopBar from '@/components/layout/TopBar';
import type { League, Matchup, Team } from '@/types';

export default function MatchupsPage() {
  const { user }     = useAuthStore();
  const activeLeague = useLeagueStore((s) => s.activeLeague);

  const [viewWeek, setViewWeek]           = useState<number | null>(null);
  const [generating, setGenerating]       = useState(false);
  const [generateMsg, setGenerateMsg]     = useState('');
  const [generateErr, setGenerateErr]     = useState('');

  // Fetch full league to get real week and commissioner info
  const { data: league } = useSWR(
    activeLeague ? `/leagues/${activeLeague.id}/full` : null,
    () => leaguesApi.get(activeLeague!.id) as Promise<League & { teams: Team[] }>
  );

  // Once we have the real week, initialise viewWeek once
  useEffect(() => {
    if (league?.week && viewWeek === null) {
      setViewWeek(league.week);
    }
  }, [league?.week, viewWeek]);

  const currentWeek   = viewWeek ?? league?.week ?? 1;
  const isCommissioner = !!user && league?.commissioner_id === user.id;

  const { data: matchups, isLoading, mutate: mutateMatchups } = useSWR(
    activeLeague && viewWeek !== null
      ? `/leagues/${activeLeague.id}/matchups/${currentWeek}`
      : null,
    () => leaguesApi.getMatchups(activeLeague!.id, currentWeek) as Promise<Matchup[]>
  );

  async function handleGenerateSchedule() {
    if (!activeLeague) return;
    setGenerating(true);
    setGenerateMsg('');
    setGenerateErr('');
    try {
      const result = await leaguesApi.generateSchedule(activeLeague.id, 13);
      setGenerateMsg(`Schedule generated — ${result.matchups_created} matchups created.`);
      // Reset to week 1 and refetch
      setViewWeek(1);
      await mutateMatchups();
    } catch (err) {
      setGenerateErr((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div>
      <TopBar
        title="Matchups"
        subtitle={league ? `${league.name} — Week ${currentWeek}` : activeLeague?.name}
      />

      <div className="p-6 space-y-4">
        {!activeLeague ? (
          <div className="card text-center text-white/40 py-12">Select a league to view matchups</div>
        ) : (
          <>
            {/* Week navigation */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setViewWeek((w) => Math.max(1, (w ?? 1) - 1))}
                disabled={currentWeek <= 1}
                className="btn-dark border border-white/10 px-4 py-2 text-sm disabled:opacity-30"
              >
                ← Prev
              </button>
              <span className="text-white font-bold text-sm min-w-20 text-center">Week {currentWeek}</span>
              <button
                onClick={() => setViewWeek((w) => (w ?? 1) + 1)}
                className="btn-dark border border-white/10 px-4 py-2 text-sm"
              >
                Next →
              </button>
            </div>

            {/* Feedback for generate */}
            {generateMsg && (
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-green-400 text-sm">
                {generateMsg}
              </div>
            )}
            {generateErr && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                {generateErr}
              </div>
            )}

            {isLoading ? (
              <div className="card text-center text-white/40 py-12">Loading matchups...</div>
            ) : !matchups?.length ? (
              <div className="card text-center py-12 space-y-3">
                <p className="text-white/40">No matchups for Week {currentWeek}.</p>
                {isCommissioner && !league?.sleeper_league_id && (
                  <div>
                    <p className="text-white/20 text-sm mb-3">
                      Generate a round-robin schedule for all {league?.teams?.length ?? '?'} teams.
                    </p>
                    <button
                      onClick={handleGenerateSchedule}
                      disabled={generating}
                      className="btn-gold py-2 px-6"
                    >
                      {generating ? 'Generating…' : 'Generate Schedule (13 weeks)'}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              matchups.map((matchup) => {
                const homeWin = matchup.is_complete && matchup.home_score > matchup.away_score;
                const awayWin = matchup.is_complete && matchup.away_score > matchup.home_score;
                return (
                  <div key={matchup.id} className="card-gold">
                    <div className="flex items-center gap-4">
                      {/* Home team */}
                      <div className={`flex-1 ${matchup.is_complete && !homeWin ? 'opacity-50' : ''}`}>
                        <p className="text-white font-black text-lg">{matchup.home_team_name}</p>
                        {matchup.home_owner && (
                          <p className="text-white/40 text-sm">{matchup.home_owner}</p>
                        )}
                        <p className={`text-3xl font-black mt-2 ${homeWin ? 'text-gold' : 'text-white'}`}>
                          {Number(matchup.home_score).toFixed(1)}
                        </p>
                      </div>

                      {/* VS */}
                      <div className="text-center px-4">
                        <p className="text-white/30 font-black text-sm">VS</p>
                        {matchup.is_complete ? (
                          <p className="text-white/20 text-xs mt-1">Final</p>
                        ) : (
                          <span className="badge bg-green-500/20 text-green-400 border border-green-500/30 text-xs mt-1 block">
                            Upcoming
                          </span>
                        )}
                      </div>

                      {/* Away team */}
                      <div className={`flex-1 text-right ${matchup.is_complete && !awayWin ? 'opacity-50' : ''}`}>
                        <p className="text-white font-black text-lg">{matchup.away_team_name}</p>
                        {matchup.away_owner && (
                          <p className="text-white/40 text-sm">{matchup.away_owner}</p>
                        )}
                        <p className={`text-3xl font-black mt-2 ${awayWin ? 'text-gold' : 'text-white'}`}>
                          {Number(matchup.away_score).toFixed(1)}
                        </p>
                      </div>
                    </div>

                    {matchup.is_playoffs && (
                      <div className="mt-3 pt-3 border-t border-white/10">
                        <span className="badge bg-gold/20 text-gold border border-gold/30">Playoffs</span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}
      </div>
    </div>
  );
}
