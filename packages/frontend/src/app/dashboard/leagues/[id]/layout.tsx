'use client';
import { use, useEffect } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { leagues as leaguesApi } from '@/lib/api';
import { useAuthStore, useLeagueStore } from '@/lib/store';
import LeagueTabs from '@/components/league/LeagueTabs';
import type { League, Team, LeagueMember } from '@/types';
import { formatStatus } from '@/types';

type LeagueWithDetails = League & { teams: Team[]; members: LeagueMember[] };

export default function LeagueLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user } = useAuthStore();
  const setActiveLeague = useLeagueStore((s) => s.setActiveLeague);

  const { data: league, isLoading } = useSWR(
    `/leagues/${id}`,
    () => leaguesApi.get(id) as Promise<LeagueWithDetails>
  );

  useEffect(() => {
    if (league) setActiveLeague(league);
  }, [league, setActiveLeague]);

  const isCommissioner = !!league && league.commissioner_id === user?.id;

  if (isLoading) {
    return (
      <div>
        <div className="border-b border-white/10 px-6 py-4">
          <h1 className="text-xl font-black text-white">Loading...</h1>
        </div>
        <div className="p-6">
          <div className="card text-center text-white/40 py-12">Loading league...</div>
        </div>
      </div>
    );
  }

  if (!league) {
    return (
      <div>
        <div className="border-b border-white/10 px-6 py-4">
          <h1 className="text-xl font-black text-white">League not found</h1>
        </div>
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
      {/* League header */}
      <div className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-white">{league.name}</h1>
          <p className="text-white/40 text-sm">
            Season {league.season} · Week {league.week} · {formatStatus(league.status)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-white/40 text-sm">Week</span>
          <span className="badge-gold">{league.week}</span>
          <span className="text-white/20 mx-1">|</span>
          <span className={`badge ${
            league.status === 'in_season'
              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
              : 'badge-dark'
          }`}>
            {formatStatus(league.status)}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <LeagueTabs leagueId={id} isCommissioner={isCommissioner} />

      {/* Page content */}
      {children}
    </div>
  );
}
