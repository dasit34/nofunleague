'use client';
import { use, useState, useEffect } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { leagues as leaguesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { League, SeasonSettings, PlayoffSettings } from '@/types';
import { getLeagueSettings } from '@/types';

export default function SeasonSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuthStore();
  const { data: league, mutate } = useSWR(`/leagues/${id}`, () => leaguesApi.get(id) as Promise<League>);

  // Season settings state
  const [regularSeasonWeeks, setRegularSeasonWeeks] = useState(14);
  const [scheduleType, setScheduleType] = useState<'round_robin' | 'random'>('round_robin');

  // Playoff settings state
  const [playoffTeams, setPlayoffTeams] = useState(4);
  const [weeksPerRound, setWeeksPerRound] = useState<1 | 2>(1);
  const [reseed, setReseed] = useState(false);
  const [consolationBracket, setConsolationBracket] = useState(false);

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (league) {
      const settings = getLeagueSettings(league.settings);
      setRegularSeasonWeeks(settings.season.regular_season_weeks);
      setScheduleType(settings.season.schedule_type);
      setPlayoffTeams(settings.playoffs.teams);
      setWeeksPerRound(settings.playoffs.weeks_per_round);
      setReseed(settings.playoffs.reseed);
      setConsolationBracket(settings.playoffs.consolation_bracket);
      setDirty(false);
    }
  }, [league]);

  if (!league) return null;
  const isCommissioner = league.commissioner_id === user?.id;
  if (!isCommissioner) {
    return <div className="p-6"><div className="card text-center py-12 text-white/40 text-sm">Commissioner access required.</div></div>;
  }

  // Season section is locked after draft starts
  const canEdit = league.status === 'pre_draft';
  // playoff_start_week is always regular_season_weeks + 1 (backend enforces this)
  const playoffStartWeek = regularSeasonWeeks + 1;

  async function handleSave() {
    setSaving(true); setMsg(''); setErr('');
    try {
      // Save season and playoffs sections separately
      await leaguesApi.updateSettings(id, 'season', {
        regular_season_weeks: regularSeasonWeeks,
        playoff_start_week: playoffStartWeek,
        schedule_type: scheduleType,
      } satisfies SeasonSettings);

      await leaguesApi.updateSettings(id, 'playoffs', {
        teams: playoffTeams,
        weeks_per_round: weeksPerRound,
        reseed,
        consolation_bracket: consolationBracket,
      } satisfies PlayoffSettings);

      setMsg('Season & playoff settings saved.');
      setDirty(false);
      mutate();
    } catch (e) { setErr((e as Error).message); }
    finally { setSaving(false); }
  }

  // Compute total playoff weeks based on bracket size and weeks_per_round
  function playoffRoundCount(): number {
    if (playoffTeams <= 2) return 1;
    if (playoffTeams <= 4) return 2;
    if (playoffTeams <= 6) return 3; // wild card + semis + championship
    return 3; // quarters + semis + championship
  }
  const totalPlayoffWeeks = playoffTeams > 0 ? playoffRoundCount() * weeksPerRound : 0;
  const lastWeek = regularSeasonWeeks + totalPlayoffWeeks;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <Link href={`/dashboard/leagues/${id}/league/manager-tools`} className="text-white/30 text-xs hover:text-gold transition-colors">
          &larr; League Manager
        </Link>
        <h2 className="text-white font-black text-lg mt-1">Season &amp; Playoff Settings</h2>
        <p className="text-white/30 text-xs mt-1">Configure the regular season structure and playoff format.</p>
      </div>

      {!canEdit && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-yellow-400 text-sm">
          Season settings are locked after the draft begins.
        </div>
      )}

      {/* Regular Season */}
      <div className="card space-y-4">
        <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider">Regular Season</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-white/40 text-xs block mb-1">Regular Season Weeks</label>
            {canEdit ? (
              <select className="input-dark text-sm w-full" value={regularSeasonWeeks}
                onChange={e => { setRegularSeasonWeeks(parseInt(e.target.value)); setDirty(true); }}>
                {Array.from({ length: 13 }, (_, i) => i + 6).map(w => (
                  <option key={w} value={w}>{w} weeks</option>
                ))}
              </select>
            ) : (
              <p className="text-white text-sm font-semibold bg-white/5 rounded-lg px-3 py-2">{regularSeasonWeeks} weeks</p>
            )}
          </div>

          <div>
            <label className="text-white/40 text-xs block mb-1">Schedule Type</label>
            {canEdit ? (
              <div className="flex gap-2">
                {(['round_robin', 'random'] as const).map(t => (
                  <button key={t} onClick={() => { setScheduleType(t); setDirty(true); }}
                    className={`px-4 py-2 rounded text-sm font-semibold transition-colors ${
                      scheduleType === t
                        ? 'bg-gold/20 text-gold border border-gold/40'
                        : 'bg-white/5 text-white/40 border border-white/10 hover:border-white/20'
                    }`}>
                    {t === 'round_robin' ? 'Round Robin' : 'Random'}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-white text-sm font-semibold bg-white/5 rounded-lg px-3 py-2">
                {scheduleType === 'round_robin' ? 'Round Robin' : 'Random'}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Playoffs */}
      <div className="card space-y-4">
        <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider">Playoffs</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-white/40 text-xs block mb-1">Playoff Teams</label>
            {canEdit ? (
              <select className="input-dark text-sm w-full" value={playoffTeams}
                onChange={e => { setPlayoffTeams(parseInt(e.target.value)); setDirty(true); }}>
                {[0, 2, 4, 6, 8].map(n => (
                  <option key={n} value={n}>{n === 0 ? 'No playoffs' : `${n} teams`}</option>
                ))}
              </select>
            ) : (
              <p className="text-white text-sm font-semibold bg-white/5 rounded-lg px-3 py-2">
                {playoffTeams === 0 ? 'No playoffs' : `${playoffTeams} teams`}
              </p>
            )}
          </div>

          <div>
            <label className="text-white/40 text-xs block mb-1">Weeks Per Round</label>
            {canEdit ? (
              <div className="flex gap-2">
                {([1, 2] as const).map(w => (
                  <button key={w} onClick={() => { setWeeksPerRound(w); setDirty(true); }}
                    className={`px-4 py-2 rounded text-sm font-semibold transition-colors ${
                      weeksPerRound === w
                        ? 'bg-gold/20 text-gold border border-gold/40'
                        : 'bg-white/5 text-white/40 border border-white/10 hover:border-white/20'
                    }`}>
                    {w === 1 ? 'Single Week' : '2-Week Matchups'}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-white text-sm font-semibold bg-white/5 rounded-lg px-3 py-2">
                {weeksPerRound === 1 ? 'Single week' : '2-week matchups'}
              </p>
            )}
          </div>

          <div>
            <label className="text-white/40 text-xs block mb-1">Reseed Each Round</label>
            {canEdit ? (
              <div className="flex gap-2">
                <button onClick={() => { setReseed(false); setDirty(true); }}
                  className={`px-4 py-2 rounded text-sm font-semibold transition-colors ${
                    !reseed
                      ? 'bg-gold/20 text-gold border border-gold/40'
                      : 'bg-white/5 text-white/40 border border-white/10 hover:border-white/20'
                  }`}>No</button>
                <button onClick={() => { setReseed(true); setDirty(true); }}
                  className={`px-4 py-2 rounded text-sm font-semibold transition-colors ${
                    reseed
                      ? 'bg-gold/20 text-gold border border-gold/40'
                      : 'bg-white/5 text-white/40 border border-white/10 hover:border-white/20'
                  }`}>Yes</button>
              </div>
            ) : (
              <p className="text-white text-sm font-semibold bg-white/5 rounded-lg px-3 py-2">{reseed ? 'Yes' : 'No'}</p>
            )}
          </div>

          <div>
            <label className="text-white/40 text-xs block mb-1">Consolation Bracket</label>
            {canEdit ? (
              <div className="flex gap-2">
                <button onClick={() => { setConsolationBracket(false); setDirty(true); }}
                  className={`px-4 py-2 rounded text-sm font-semibold transition-colors ${
                    !consolationBracket
                      ? 'bg-gold/20 text-gold border border-gold/40'
                      : 'bg-white/5 text-white/40 border border-white/10 hover:border-white/20'
                  }`}>No</button>
                <button onClick={() => { setConsolationBracket(true); setDirty(true); }}
                  className={`px-4 py-2 rounded text-sm font-semibold transition-colors ${
                    consolationBracket
                      ? 'bg-gold/20 text-gold border border-gold/40'
                      : 'bg-white/5 text-white/40 border border-white/10 hover:border-white/20'
                  }`}>Yes</button>
              </div>
            ) : (
              <p className="text-white text-sm font-semibold bg-white/5 rounded-lg px-3 py-2">{consolationBracket ? 'Yes' : 'No'}</p>
            )}
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="card space-y-3">
        <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider">Season Overview</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <SummaryPill label="Regular Season" value={`${regularSeasonWeeks} weeks`} />
          <SummaryPill label="Playoff Start" value={playoffTeams > 0 ? `Week ${playoffStartWeek}` : 'N/A'} highlight />
          <SummaryPill label="Playoff Teams" value={playoffTeams === 0 ? 'None' : `${playoffTeams}`} highlight />
          <SummaryPill label="Playoff Weeks" value={totalPlayoffWeeks > 0 ? `${totalPlayoffWeeks}` : 'N/A'} />
          <SummaryPill label="Last Week" value={playoffTeams > 0 ? `Week ${lastWeek}` : `Week ${regularSeasonWeeks}`} />
          <SummaryPill label="Schedule" value={scheduleType === 'round_robin' ? 'Round Robin' : 'Random'} />
          <SummaryPill label="Weeks/Round" value={weeksPerRound === 1 ? 'Single' : '2-Week'} />
          <SummaryPill label="Reseed" value={reseed ? 'Yes' : 'No'} />
        </div>
      </div>

      {/* Save */}
      {canEdit && (
        <div className="flex items-center gap-3">
          <button onClick={handleSave} disabled={saving || !dirty}
            className={`text-sm py-2 px-6 rounded font-bold transition-colors ${
              saving || !dirty
                ? 'bg-white/10 text-white/30 cursor-not-allowed'
                : 'btn-gold'
            }`}>
            {saving ? 'Saving...' : !dirty ? 'No Changes' : 'Save Season Settings'}
          </button>
          {msg && <span className="text-green-400 text-sm">{msg}</span>}
          {err && <span className="text-red-400 text-sm">{err}</span>}
        </div>
      )}
    </div>
  );
}

function SummaryPill({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-white/5 rounded px-2 py-1.5">
      <p className="text-white/30 text-[10px] uppercase tracking-wider">{label}</p>
      <p className={`text-sm font-bold ${highlight ? 'text-gold' : 'text-white'}`}>{value}</p>
    </div>
  );
}
