'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { ai as aiApi, leagues as leaguesApi } from '@/lib/api';
import { useAuthStore, useLeagueStore } from '@/lib/store';
import TopBar from '@/components/layout/TopBar';
import type { Matchup, League, Team } from '@/types';

const STYLES = ['aggressive', 'petty', 'poetic', 'silent'] as const;

export default function AIPage() {
  const activeLeague = useLeagueStore((s) => s.activeLeague);
  const { user } = useAuthStore();

  // Weekly Recap
  const [recapLoading, setRecapLoading] = useState(false);
  const [recapText, setRecapText] = useState('');

  // Trash Talk
  const [trashTarget, setTrashTarget] = useState('');
  const [trashMatchup, setTrashMatchup] = useState('');
  const [trashStyle, setTrashStyle] = useState<typeof STYLES[number]>('aggressive');
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashText, setTrashText] = useState('');

  // Trade Reaction
  const [trade, setTrade] = useState({
    team1_name: '',
    team1_giving: '',
    team2_name: '',
    team2_giving: '',
  });
  const [tradeLoading, setTradeLoading] = useState(false);
  const [tradeText, setTradeText] = useState('');

  // Lineup Advice
  const [lineupLoading, setLineupLoading] = useState(false);
  const [lineupText, setLineupText] = useState('');

  // Waiver Recs
  const [waiverLoading, setWaiverLoading] = useState(false);
  const [waiverText, setWaiverText] = useState('');

  const { data: matchups } = useSWR(
    activeLeague ? `/leagues/${activeLeague.id}/matchups/${activeLeague.week}` : null,
    () => leaguesApi.getMatchups(activeLeague!.id, activeLeague!.week) as Promise<Matchup[]>
  );

  const { data: leagueData } = useSWR(
    activeLeague && user ? `/leagues/${activeLeague.id}/full` : null,
    () => leaguesApi.get(activeLeague!.id) as Promise<League & { teams: Team[] }>
  );

  const myTeam = leagueData?.teams?.find((t) => t.user_id === user?.id);

  async function handleWeeklyRecap() {
    if (!activeLeague) return;
    setRecapLoading(true);
    setRecapText('');
    try {
      const { text } = await aiApi.weeklyRecap({ league_id: activeLeague.id, week: activeLeague.week });
      setRecapText(text);
    } catch (err) {
      setRecapText(`Error: ${(err as Error).message}`);
    } finally {
      setRecapLoading(false);
    }
  }

  async function handleTrashTalk() {
    if (!activeLeague || !trashMatchup || !trashTarget) return;
    setTrashLoading(true);
    setTrashText('');
    try {
      const { text } = await aiApi.trashTalk({
        league_id: activeLeague.id,
        matchup_id: trashMatchup,
        target_team_id: trashTarget,
        style: trashStyle,
      });
      setTrashText(text);
    } catch (err) {
      setTrashText(`Error: ${(err as Error).message}`);
    } finally {
      setTrashLoading(false);
    }
  }

  async function handleTradeReaction(e: React.FormEvent) {
    e.preventDefault();
    if (!activeLeague || !trade.team1_name || !trade.team2_name) return;
    setTradeLoading(true);
    setTradeText('');
    try {
      const { text } = await aiApi.tradeReaction({
        league_id: activeLeague.id,
        team1_name: trade.team1_name,
        team1_giving: trade.team1_giving.split(',').map((s) => s.trim()).filter(Boolean),
        team2_name: trade.team2_name,
        team2_giving: trade.team2_giving.split(',').map((s) => s.trim()).filter(Boolean),
      });
      setTradeText(text);
    } catch (err) {
      setTradeText(`Error: ${(err as Error).message}`);
    } finally {
      setTradeLoading(false);
    }
  }

  async function handleLineupAdvice() {
    if (!activeLeague || !myTeam) return;
    setLineupLoading(true);
    setLineupText('');
    try {
      const { text } = await aiApi.lineupAdvice(myTeam.id, activeLeague.week);
      setLineupText(text);
    } catch (err) {
      setLineupText(`Error: ${(err as Error).message}`);
    } finally {
      setLineupLoading(false);
    }
  }

  async function handleWaiverRecs() {
    if (!activeLeague) return;
    setWaiverLoading(true);
    setWaiverText('');
    try {
      const { text } = await aiApi.waiverRecs(activeLeague.id, activeLeague.week);
      setWaiverText(text);
    } catch (err) {
      setWaiverText(`Error: ${(err as Error).message}`);
    } finally {
      setWaiverLoading(false);
    }
  }

  return (
    <div>
      <TopBar title="AI Chaos Center" subtitle="CHAOS awaits your command" />

      <div className="p-6 space-y-6">
        {!activeLeague ? (
          <div className="card text-center text-white/40 py-12">Select a league to unleash AI chaos</div>
        ) : (
          <>
            {/* Header */}
            <div className="card-gold">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-3xl">🤖</span>
                <div>
                  <h2 className="text-gold font-black text-xl">CHAOS</h2>
                  <p className="text-white/50 text-sm">Your AI Commissioner — Powered by Claude</p>
                </div>
              </div>
            </div>

            {/* Weekly Recap */}
            <div className="card space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-white font-black text-lg">Weekly Recap</h3>
                  <p className="text-white/40 text-sm">Generate Week {activeLeague.week} recap and post to chat</p>
                </div>
                <button
                  onClick={handleWeeklyRecap}
                  disabled={recapLoading}
                  className="btn-gold py-2 px-4 text-sm"
                >
                  {recapLoading ? 'Writing...' : 'Generate Recap'}
                </button>
              </div>
              {recapText && (
                <div className="ai-message animate-slide-up whitespace-pre-wrap">{recapText}</div>
              )}
            </div>

            {/* Trash Talk */}
            <div className="card space-y-4">
              <div>
                <h3 className="text-white font-black text-lg">Fire Trash Talk</h3>
                <p className="text-white/40 text-sm">Target a team and let CHAOS do the talking</p>
              </div>
              {matchups && matchups.length > 0 ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-white/60 text-sm font-semibold mb-1.5 block">Select Matchup</label>
                    <select
                      className="input-dark"
                      value={trashMatchup}
                      onChange={(e) => { setTrashMatchup(e.target.value); setTrashTarget(''); }}
                    >
                      <option value="">Pick a matchup...</option>
                      {matchups.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.home_team_name} vs {m.away_team_name} (Week {m.week})
                        </option>
                      ))}
                    </select>
                  </div>
                  {trashMatchup && (
                    <div>
                      <label className="text-white/60 text-sm font-semibold mb-1.5 block">Target Team</label>
                      <select className="input-dark" value={trashTarget} onChange={(e) => setTrashTarget(e.target.value)}>
                        <option value="">Who are we roasting?</option>
                        {matchups
                          .filter((m) => m.id === trashMatchup)
                          .flatMap((m) => [
                            { id: m.home_team_id, name: m.home_team_name },
                            { id: m.away_team_id, name: m.away_team_name },
                          ])
                          .map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="text-white/60 text-sm font-semibold mb-1.5 block">Roast Style</label>
                    <div className="grid grid-cols-4 gap-2">
                      {STYLES.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setTrashStyle(s)}
                          className={`py-2 px-3 rounded-lg border text-xs font-semibold capitalize transition-all ${
                            trashStyle === s
                              ? 'border-gold bg-gold/10 text-gold'
                              : 'border-white/10 text-white/50 hover:border-white/30'
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={handleTrashTalk}
                    disabled={trashLoading || !trashMatchup || !trashTarget}
                    className="btn-gold w-full"
                  >
                    {trashLoading ? 'Cooking up chaos...' : 'Unleash CHAOS'}
                  </button>
                  {trashText && (
                    <div className="ai-message animate-slide-up">
                      <p className="font-bold text-gold mb-1 text-xs uppercase tracking-wider">CHAOS says:</p>
                      <p className="whitespace-pre-wrap">{trashText}</p>
                      <p className="text-white/30 text-xs mt-2">Posted to league chat</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-white/30 text-sm text-center py-4">
                  No matchups found for Week {activeLeague.week}. Import matchups from Sleeper first.
                </p>
              )}
            </div>

            {/* Trade Reaction */}
            <div className="card space-y-4">
              <div>
                <h3 className="text-white font-black text-lg">Trade Reaction</h3>
                <p className="text-white/40 text-sm">Who got robbed? Let CHAOS decide.</p>
              </div>
              <form onSubmit={handleTradeReaction} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-white/60 text-sm font-semibold block">Team 1</label>
                    <input
                      type="text"
                      className="input-dark"
                      placeholder="Team name"
                      value={trade.team1_name}
                      onChange={(e) => setTrade({ ...trade, team1_name: e.target.value })}
                    />
                    <textarea
                      className="input-dark resize-none"
                      rows={2}
                      placeholder="Players giving away (comma-separated)"
                      value={trade.team1_giving}
                      onChange={(e) => setTrade({ ...trade, team1_giving: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-white/60 text-sm font-semibold block">Team 2</label>
                    <input
                      type="text"
                      className="input-dark"
                      placeholder="Team name"
                      value={trade.team2_name}
                      onChange={(e) => setTrade({ ...trade, team2_name: e.target.value })}
                    />
                    <textarea
                      className="input-dark resize-none"
                      rows={2}
                      placeholder="Players giving away (comma-separated)"
                      value={trade.team2_giving}
                      onChange={(e) => setTrade({ ...trade, team2_giving: e.target.value })}
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={tradeLoading || !trade.team1_name || !trade.team2_name}
                  className="btn-gold w-full"
                >
                  {tradeLoading ? 'Judging...' : 'Get Trade Verdict'}
                </button>
                {tradeText && (
                  <div className="ai-message animate-slide-up">
                    <p className="font-bold text-gold mb-1 text-xs uppercase tracking-wider">CHAOS Verdict:</p>
                    <p className="whitespace-pre-wrap">{tradeText}</p>
                  </div>
                )}
              </form>
            </div>

            {/* AI Lineup Advice */}
            <div className="card space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-white font-black text-lg">AI Lineup Advice</h3>
                    <span className="badge bg-blue-500/20 text-blue-400 border border-blue-500/30 text-xs">Phase 2</span>
                  </div>
                  <p className="text-white/40 text-sm">
                    {myTeam
                      ? `Analyzing Week ${activeLeague.week} roster for ${myTeam.name}`
                      : 'You need a team in this league to get lineup advice'}
                  </p>
                </div>
                <button
                  onClick={handleLineupAdvice}
                  disabled={lineupLoading || !myTeam}
                  className="btn-gold py-2 px-4 text-sm"
                >
                  {lineupLoading ? 'Analyzing...' : 'Get Advice'}
                </button>
              </div>
              {lineupText && (
                <div className="ai-message animate-slide-up">
                  <p className="font-bold text-gold mb-1 text-xs uppercase tracking-wider">CHAOS on your lineup:</p>
                  <p className="whitespace-pre-wrap">{lineupText}</p>
                </div>
              )}
            </div>

            {/* AI Waiver Wire */}
            <div className="card space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-white font-black text-lg">AI Waiver Wire</h3>
                    <span className="badge bg-purple-500/20 text-purple-400 border border-purple-500/30 text-xs">Phase 3</span>
                  </div>
                  <p className="text-white/40 text-sm">
                    Week {activeLeague.week} free agent recommendations for {activeLeague.name}
                  </p>
                </div>
                <button
                  onClick={handleWaiverRecs}
                  disabled={waiverLoading}
                  className="btn-gold py-2 px-4 text-sm"
                >
                  {waiverLoading ? 'Scouting...' : 'Get Recs'}
                </button>
              </div>
              {waiverText && (
                <div className="ai-message animate-slide-up">
                  <p className="font-bold text-gold mb-1 text-xs uppercase tracking-wider">CHAOS Waiver Picks:</p>
                  <p className="whitespace-pre-wrap">{waiverText}</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
