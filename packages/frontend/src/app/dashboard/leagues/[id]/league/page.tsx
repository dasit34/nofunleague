'use client';
import { use } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { leagues as leaguesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { League, Team, LeagueMember } from '@/types';

type LeagueData = League & { teams: Team[]; members: LeagueMember[] };

const HUB_ITEMS = [
  { href: '/matchups',      icon: '📊', label: 'Scoreboard',     desc: 'Weekly matchup results and scores' },
  { href: '/standings',     icon: '🏆', label: 'Standings',      desc: 'Win-loss records and rankings' },
  { href: '/schedule',      icon: '📅', label: 'Schedule',       desc: 'Full season matchup schedule' },
  { href: '',               icon: 'ℹ️', label: 'League Info',     desc: 'Settings, members, and details' },
  { href: '/trades',        icon: '📋', label: 'Recent Activity', desc: 'Trades, waivers, and transactions' },
  { href: '/waiver-order',  icon: '📑', label: 'Waiver Order',   desc: 'Current waiver priority rankings' },
];

export default function LeagueHubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuthStore();

  const { data: league } = useSWR(
    `/leagues/${id}`,
    () => leaguesApi.get(id) as Promise<LeagueData>
  );

  const isCommissioner = league?.commissioner_id === user?.id;
  const teams = league?.teams || [];
  const members = league?.members || [];

  return (
    <div className="p-6 space-y-6">
      {/* League snapshot */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-black text-lg">League Hub</h2>
          {league && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-white/30">{(league.scoring_type ?? 'standard').replace('_', ' ').toUpperCase()}</span>
              <span className="text-white/10">·</span>
              <span className="text-white/30">{teams.length} / {league.league_size} teams</span>
              <span className="text-white/10">·</span>
              <span className="text-white/30">{members.length} members</span>
            </div>
          )}
        </div>
      </div>

      {/* Hub navigation grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {HUB_ITEMS.map((item) => (
          <Link
            key={item.label}
            href={`/dashboard/leagues/${id}${item.href}`}
            className="card hover:border-gold/30 transition-all group py-5"
          >
            <div className="text-2xl mb-2">{item.icon}</div>
            <p className="text-white font-semibold text-sm group-hover:text-gold transition-colors">{item.label}</p>
            <p className="text-white/30 text-xs mt-1">{item.desc}</p>
          </Link>
        ))}
      </div>

      {/* Commissioner Tools — prominent card */}
      {isCommissioner && (
        <Link
          href={`/dashboard/leagues/${id}/league/manager-tools`}
          className="card border-gold/20 hover:border-gold/40 transition-all group block"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-gold/10 border border-gold/20 flex items-center justify-center text-2xl">
              ⚙
            </div>
            <div>
              <p className="text-gold font-black text-sm uppercase tracking-wider group-hover:text-gold/80 transition-colors">
                League Manager Tools
              </p>
              <p className="text-white/30 text-xs mt-0.5">
                Settings, roster config, scoring rules, draft setup, and member management
              </p>
            </div>
          </div>
        </Link>
      )}

      {!isCommissioner && (
        <div className="card border-white/5">
          <p className="text-white/20 text-xs text-center">
            League settings are managed by the commissioner.
          </p>
        </div>
      )}
    </div>
  );
}
