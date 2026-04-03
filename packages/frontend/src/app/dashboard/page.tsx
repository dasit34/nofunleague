'use client';
import useSWR from 'swr';
import Link from 'next/link';
import { useAuthStore, useLeagueStore } from '@/lib/store';
import { leagues as leaguesApi, auth as authApi } from '@/lib/api';
import TopBar from '@/components/layout/TopBar';
import type { League } from '@/types';

export default function DashboardPage() {
  const { user } = useAuthStore();
  const { setActiveLeague } = useLeagueStore();

  const { data: leagueList, isLoading } = useSWR(
    '/leagues',
    () => leaguesApi.list() as Promise<League[]>
  );

  const { data: userStats } = useSWR('/users/me/stats', () => authApi.stats());

  function selectLeague(league: League) {
    setActiveLeague(league);
  }

  const record = userStats
    ? `${userStats.total_wins}-${userStats.total_losses}${userStats.total_ties ? `-${userStats.total_ties}` : ''}`
    : '—';

  const quickStats = [
    { label: 'Leagues',       value: userStats?.leagues_count ?? leagueList?.length ?? '—' },
    { label: 'Season Record', value: record },
    { label: 'Points For',    value: userStats ? Math.round(userStats.total_points_for) : '—' },
    { label: 'Pending Trades',value: userStats?.pending_trades ?? '—' },
  ];

  return (
    <div>
      <TopBar
        title={`Welcome back, ${user?.display_name}`}
        subtitle="The No Fun League awaits. Choose violence."
      />

      <div className="p-6 space-y-6">
        {/* Quick Stats — real data */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {quickStats.map((stat) => (
            <div key={stat.label} className="card text-center">
              <div className="stat-value text-3xl">{stat.value}</div>
              <div className="stat-label mt-1">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Leagues */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-black text-lg">Your Leagues</h2>
            <Link href="/dashboard/leagues/new" className="btn-gold py-2 px-4 text-sm">
              + New League
            </Link>
          </div>

          {isLoading ? (
            <div className="card text-center text-white/40 py-12">Loading leagues...</div>
          ) : leagueList?.length === 0 ? (
            <div className="card text-center py-12">
              <p className="text-white/40 mb-4">No leagues yet. The chaos needs a home.</p>
              <Link href="/dashboard/leagues/new" className="btn-gold">
                Create Your League
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {leagueList?.map((league) => (
                <Link
                  key={league.id}
                  href={`/dashboard/leagues/${league.id}`}
                  onClick={() => selectLeague(league)}
                  className="card hover:border-gold/30 transition-all group"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-white font-black text-lg group-hover:text-gold transition-colors">
                        {league.name}
                      </h3>
                      {league.commissioner_id === user?.id ? (
                        <p className="text-gold/70 text-xs font-semibold uppercase tracking-wide">Commissioner</p>
                      ) : league.team_name ? (
                        <p className="text-white/50 text-sm">{league.team_name}</p>
                      ) : null}
                    </div>
                    <span className={`badge ${
                      league.status === 'in_season'
                        ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                        : 'badge-dark'
                    }`}>
                      {league.status.replace('_', ' ')}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-white/40">
                      Season <span className="text-white">{league.season}</span>
                    </span>
                    <span className="text-white/40">
                      Week <span className="text-gold font-bold">{league.week}</span>
                    </span>
                    {league.ai_enabled && (
                      <span className="badge-gold">AI Active</span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* CHAOS callout */}
        <div className="card-gold">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">🤖</span>
            <span className="text-gold font-black text-lg">CHAOS says:</span>
          </div>
          <p className="text-white/80 italic text-sm leading-relaxed">
            "Another week, another chance for your opponents to witness what mediocrity looks like in real time.
            Don't worry — I'll make sure everyone knows about it. Choose your league above to get started."
          </p>
        </div>
      </div>
    </div>
  );
}
