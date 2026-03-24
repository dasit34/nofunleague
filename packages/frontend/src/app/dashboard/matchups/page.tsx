'use client';
import useSWR from 'swr';
import { leagues as leaguesApi } from '@/lib/api';
import { useLeagueStore } from '@/lib/store';
import TopBar from '@/components/layout/TopBar';
import type { Matchup } from '@/types';

export default function MatchupsPage() {
  const activeLeague = useLeagueStore((s) => s.activeLeague);

  const { data: matchups, isLoading } = useSWR(
    activeLeague ? `/leagues/${activeLeague.id}/matchups/${activeLeague.week}` : null,
    () => leaguesApi.getMatchups(activeLeague!.id, activeLeague!.week) as Promise<Matchup[]>
  );

  return (
    <div>
      <TopBar
        title="Matchups"
        subtitle={activeLeague ? `Week ${activeLeague.week} — ${activeLeague.name}` : undefined}
      />

      <div className="p-6 space-y-4">
        {!activeLeague ? (
          <div className="card text-center text-white/40 py-12">Select a league to view matchups</div>
        ) : isLoading ? (
          <div className="card text-center text-white/40 py-12">Loading matchups...</div>
        ) : !matchups?.length ? (
          <div className="card text-center py-12">
            <p className="text-white/40 mb-2">No matchups for Week {activeLeague.week}.</p>
            <p className="text-white/20 text-sm">Sync from Sleeper to import matchup data.</p>
          </div>
        ) : (
          matchups.map((matchup) => {
            const homeWin = matchup.is_complete && matchup.home_score > matchup.away_score;
            const awayWin = matchup.is_complete && matchup.away_score > matchup.home_score;
            return (
              <div key={matchup.id} className="card-gold">
                <div className="flex items-center gap-4">
                  {/* Home Team */}
                  <div className={`flex-1 ${homeWin ? 'opacity-100' : matchup.is_complete ? 'opacity-50' : 'opacity-100'}`}>
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
                    {matchup.is_complete && (
                      <p className="text-white/20 text-xs mt-1">Final</p>
                    )}
                    {!matchup.is_complete && (
                      <span className="badge bg-green-500/20 text-green-400 border border-green-500/30 text-xs mt-1">
                        Live
                      </span>
                    )}
                  </div>

                  {/* Away Team */}
                  <div className={`flex-1 text-right ${awayWin ? 'opacity-100' : matchup.is_complete ? 'opacity-50' : 'opacity-100'}`}>
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
      </div>
    </div>
  );
}
