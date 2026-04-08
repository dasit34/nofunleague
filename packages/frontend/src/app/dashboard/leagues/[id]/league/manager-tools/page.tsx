'use client';
import { use } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { leagues as leaguesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { League } from '@/types';
import { getLeagueSettings, starterCount, totalRosterSize, draftRounds, formatScoringType, formatStatus } from '@/types';

export default function ManagerToolsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuthStore();

  const { data: league } = useSWR(
    `/leagues/${id}`,
    () => leaguesApi.get(id) as Promise<League>
  );

  const isCommissioner = league?.commissioner_id === user?.id;

  if (!isCommissioner) {
    return (
      <div className="p-6">
        <div className="card text-center py-12 space-y-3">
          <p className="text-white/40 text-sm">Only the commissioner can access league manager tools.</p>
          <Link href={`/dashboard/leagues/${id}/league`} className="text-gold text-sm hover:underline">Back to league</Link>
        </div>
      </div>
    );
  }

  const isLocked = league?.status !== 'pre_draft';
  const settings = league ? getLeagueSettings(league.settings) : null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href={`/dashboard/leagues/${id}/league`} className="text-white/30 text-xs hover:text-gold transition-colors">
            &larr; League Hub
          </Link>
          <h2 className="text-white font-black text-lg mt-1">League Manager</h2>
        </div>
        {isLocked && (
          <span className="text-xs px-3 py-1.5 rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
            Some settings locked &mdash; {formatStatus(league?.status)}
          </span>
        )}
      </div>

      {/* Settings sections with live values */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Roster Settings */}
        <SettingsCard
          href={`/dashboard/leagues/${id}/league/manager-tools/roster`}
          label="Roster Settings"
          desc="Starting slots, bench, IR, FLEX rules, position limits"
          locked={isLocked}
        >
          {settings && (
            <div className="grid grid-cols-3 gap-2 mt-3">
              <ValuePill label="Starters" value={starterCount(settings.roster)} highlight />
              <ValuePill label="Bench" value={settings.roster.bench_slots} />
              <ValuePill label="IR" value={settings.roster.ir_slots} />
              <ValuePill label="Total" value={totalRosterSize(settings.roster)} />
              <ValuePill label="Draft Rds" value={draftRounds(settings.roster)} highlight />
              <ValuePill label="FLEX" value={
                settings.roster.superflex_slots > 0 ? 'SF' :
                settings.roster.flex_slots > 0 ? settings.roster.flex_types.replace(/_/g, '/') : 'None'
              } />
            </div>
          )}
        </SettingsCard>

        {/* Scoring Settings */}
        <SettingsCard
          href={`/dashboard/leagues/${id}/league/manager-tools/scoring`}
          label="Scoring Settings"
          desc="Scoring format and point values"
          locked={isLocked}
        >
          {settings && (
            <div className="grid grid-cols-2 gap-2 mt-3">
              <ValuePill label="Format" value={formatScoringType(settings.scoring.type)} />
              <ValuePill label="Source" value={settings.scoring.source === 'real' ? 'Real Stats' : 'Mock'} />
            </div>
          )}
        </SettingsCard>

        {/* Draft Settings */}
        <SettingsCard
          href={`/dashboard/leagues/${id}/league/manager-tools/draft`}
          label="Draft Settings"
          desc="Draft type, pick timer, auto-pick"
          locked={isLocked}
        >
          {settings && (
            <div className="grid grid-cols-3 gap-2 mt-3">
              <ValuePill label="Type" value={settings.draft.type === 'snake' ? 'Snake' : 'Linear'} />
              <ValuePill label="Timer" value={`${settings.draft.seconds_per_pick}s`} />
              <ValuePill label="Auto-pick" value={settings.draft.auto_pick_on_timeout ? 'On' : 'Off'} />
            </div>
          )}
        </SettingsCard>

        {/* Trade Settings */}
        <SettingsCard
          href={`/dashboard/leagues/${id}/league/manager-tools/trades`}
          label="Trade Settings"
          desc="Approval rules, review period, deadline"
        >
          {settings && (
            <div className="grid grid-cols-2 gap-2 mt-3">
              <ValuePill label="Approval" value={
                settings.trades.approval_type === 'commissioner' ? 'Commissioner' :
                settings.trades.approval_type === 'league_vote' ? 'League Vote' : 'None'
              } />
              <ValuePill label="Review" value={`${settings.trades.review_period_hours}h`} />
              <ValuePill label="Deadline" value={settings.trades.trade_deadline_week > 0 ? `Wk ${settings.trades.trade_deadline_week}` : 'None'} />
              <ValuePill label="Pick Trades" value={settings.trades.allow_draft_pick_trades ? 'Yes' : 'No'} />
            </div>
          )}
        </SettingsCard>

        {/* Season Settings */}
        <SettingsCard
          href={`/dashboard/leagues/${id}/league/manager-tools/season`}
          label="Season Settings"
          desc="Regular season length, schedule format"
          locked={isLocked}
        >
          {settings && (
            <div className="grid grid-cols-2 gap-2 mt-3">
              <ValuePill label="Reg Season" value={`${settings.season.regular_season_weeks} wks`} />
              <ValuePill label="Playoffs" value={`Wk ${settings.season.playoff_start_week}`} />
              <ValuePill label="Schedule" value={settings.season.schedule_type === 'round_robin' ? 'Round Robin' : 'Random'} />
              <ValuePill label="Playoff Teams" value={settings.playoffs.teams} highlight />
            </div>
          )}
        </SettingsCard>

        {/* Basic / Admin */}
        <SettingsCard
          href={`/dashboard/leagues/${id}/league/manager-tools/basic`}
          label="Basic Settings"
          desc="League name, size, invite code"
        >
          {league && (
            <div className="grid grid-cols-2 gap-2 mt-3">
              <ValuePill label="Size" value={`${league.league_size} teams`} />
              <ValuePill label="Season" value={league.season} />
            </div>
          )}
        </SettingsCard>

        {/* Managers */}
        <SettingsCard
          href={`/dashboard/leagues/${id}/league/manager-tools/managers`}
          label="Managers"
          desc="Members, roles, and access"
        />

        {/* Invite */}
        <SettingsCard
          href={`/dashboard/leagues/${id}/league/manager-tools/invite`}
          label="Invite"
          desc="Invite code and share link"
        >
          {league?.invite_code && (
            <div className="mt-3">
              <ValuePill label="Code" value={league.invite_code} highlight />
            </div>
          )}
        </SettingsCard>

        {/* Commissioner Corrections */}
        <SettingsCard
          href={`/dashboard/leagues/${id}/league/manager-tools/corrections`}
          label="Corrections"
          desc="Transfer players, fix scores, roster overrides"
        />
      </div>
    </div>
  );
}

// =============================================
// Sub-components
// =============================================

function SettingsCard({
  href, label, desc, locked, children,
}: {
  href: string;
  label: string;
  desc: string;
  locked?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Link href={href} className="card hover:border-gold/30 transition-all group block">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-white font-semibold text-sm group-hover:text-gold transition-colors">{label}</p>
          <p className="text-white/30 text-xs mt-0.5">{desc}</p>
        </div>
        {locked && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-500/60 border border-yellow-500/20 shrink-0">
            Locked
          </span>
        )}
      </div>
      {children}
    </Link>
  );
}

function ValuePill({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className="bg-white/5 rounded px-2 py-1.5">
      <p className="text-white/30 text-[10px] uppercase tracking-wider">{label}</p>
      <p className={`text-sm font-bold ${highlight ? 'text-gold' : 'text-white'}`}>{value}</p>
    </div>
  );
}
