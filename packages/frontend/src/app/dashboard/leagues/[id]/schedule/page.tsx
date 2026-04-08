'use client';
import { use, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { leagues as leaguesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { League, Team, Matchup } from '@/types';

type LeagueWithTeams = League & { teams: Team[] };

const TOTAL_WEEKS = 13;

export default function SchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuthStore();

  const { data: league } = useSWR(`/leagues/${id}`, () => leaguesApi.get(id) as Promise<LeagueWithTeams>);

  const isCommissioner = league?.commissioner_id === user?.id;
  const teams = league?.teams || [];
  const currentWeek = league?.week ?? 1;

  // Fetch all weeks
  const { data: weekData, isLoading, mutate: mutateSchedule } = useSWR(
    league ? `schedule-all-${id}` : null,
    async () => {
      const result: Record<number, Matchup[]> = {};
      const fetches = Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1).map(async (w) => {
        try {
          const m = await leaguesApi.getMatchups(id, w) as Matchup[];
          if (m.length > 0) result[w] = m;
        } catch { /* week not scheduled */ }
      });
      await Promise.all(fetches);
      return result;
    }
  );

  const scheduledWeeks = weekData ? Object.keys(weekData).length : 0;
  const totalMatchups = weekData ? Object.values(weekData).reduce((sum, m) => sum + m.length, 0) : 0;

  const teamMap = new Map<string, string>();
  for (const t of teams) teamMap.set(t.id, t.name);

  // Generate schedule action
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState('');
  const [genErr, setGenErr] = useState('');

  async function handleGenerate() {
    setGenerating(true); setGenMsg(''); setGenErr('');
    try {
      const result = await leaguesApi.generateSchedule(id, TOTAL_WEEKS);
      setGenMsg(`${result.message} — ${result.matchups_created} matchups created, ${result.weeks_skipped} weeks skipped`);
      mutateSchedule();
    } catch (e) {
      setGenErr((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-white font-black text-lg">Season Schedule</h2>
          <p className="text-white/30 text-xs mt-0.5">
            {scheduledWeeks > 0 ? `${scheduledWeeks} weeks · ${totalMatchups} matchups · ${teams.length} teams` : `${teams.length} teams`}
          </p>
        </div>
        {isCommissioner && teams.length >= 2 && scheduledWeeks === 0 && (
          <button onClick={handleGenerate} disabled={generating} className="btn-gold text-sm py-2 px-4">
            {generating ? 'Generating...' : 'Generate Schedule'}
          </button>
        )}
      </div>

      {genMsg && <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-green-400 text-sm">{genMsg}</div>}
      {genErr && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">{genErr}</div>}

      {isLoading ? (
        <div className="card text-center py-8 text-white/30 text-sm">Loading schedule...</div>
      ) : scheduledWeeks === 0 ? (
        <div className="card text-center py-12 space-y-3">
          <p className="text-white/40 text-sm">No schedule generated yet.</p>
          <p className="text-white/20 text-xs">
            {league?.status === 'in_season'
              ? 'The schedule should have been created automatically. Use the button above to generate one.'
              : 'The schedule is created automatically when the draft completes.'}
          </p>
          {/* Preview pairings */}
          {teams.length >= 2 && (
            <div className="mt-6 text-left space-y-3">
              <p className="text-white/20 text-xs font-semibold uppercase tracking-wider">Preview (Week 1)</p>
              <div className="grid gap-2 md:grid-cols-2">
                {Array.from({ length: Math.floor(teams.length / 2) }).map((_, i) => (
                  <div key={i} className="bg-white/[0.03] rounded-lg px-4 py-2.5 flex items-center justify-between">
                    <span className="text-white/30 text-sm">{teams[i * 2]?.name || 'TBD'}</span>
                    <span className="text-white/10 text-xs">vs</span>
                    <span className="text-white/30 text-sm">{teams[i * 2 + 1]?.name || 'TBD'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {Array.from({ length: TOTAL_WEEKS }).map((_, wi) => {
            const week = wi + 1;
            const matchups = weekData?.[week] || [];
            const isCurrent = week === currentWeek;
            const isPast = week < currentWeek;
            const allComplete = matchups.length > 0 && matchups.every(m => m.is_complete);

            return (
              <div key={week}>
                <div className="flex items-center gap-2 mb-2">
                  <p className={`text-xs font-semibold uppercase tracking-wider ${isCurrent ? 'text-gold' : 'text-white/30'}`}>
                    Week {week}
                  </p>
                  {isCurrent && <span className="text-xs px-1.5 py-0.5 rounded bg-gold/20 text-gold border border-gold/30">Current</span>}
                  {isPast && allComplete && <span className="text-white/15 text-xs">Final</span>}
                </div>

                {matchups.length > 0 ? (
                  <div className="grid gap-2 md:grid-cols-2">
                    {matchups.map((m) => {
                      const homeName = m.home_team_name || teamMap.get(m.home_team_id) || '?';
                      const awayName = m.away_team_name || teamMap.get(m.away_team_id) || '?';
                      const homeWon = m.is_complete && m.winner_team_id === m.home_team_id;
                      const awayWon = m.is_complete && m.winner_team_id === m.away_team_id;

                      return (
                        <Link key={m.id} href={`/dashboard/leagues/${id}/matchups/${m.id}`}
                          className="bg-white/[0.03] hover:bg-white/[0.06] rounded-lg px-4 py-2.5 flex items-center justify-between transition-colors">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {homeWon && <span className="text-gold text-xs font-bold shrink-0">W</span>}
                            <span className={`text-sm truncate ${homeWon ? 'text-gold font-bold' : 'text-white/70'}`}>{homeName}</span>
                          </div>
                          {m.is_complete ? (
                            <div className="flex items-center gap-1.5 shrink-0 mx-2">
                              <span className={`font-mono text-sm font-bold ${homeWon ? 'text-gold' : 'text-white/40'}`}>{Number(m.home_score).toFixed(0)}</span>
                              <span className="text-white/15 text-xs">-</span>
                              <span className={`font-mono text-sm font-bold ${awayWon ? 'text-gold' : 'text-white/40'}`}>{Number(m.away_score).toFixed(0)}</span>
                            </div>
                          ) : (
                            <span className="text-white/10 text-xs mx-2 shrink-0">0.0 - 0.0</span>
                          )}
                          <div className="flex items-center gap-2 min-w-0 flex-1 justify-end">
                            <span className={`text-sm truncate text-right ${awayWon ? 'text-gold font-bold' : 'text-white/70'}`}>{awayName}</span>
                            {awayWon && <span className="text-gold text-xs font-bold shrink-0">W</span>}
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                ) : (
                  <div className="bg-white/[0.02] rounded-lg px-4 py-3 text-center">
                    <span className="text-white/10 text-xs">No matchups</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
