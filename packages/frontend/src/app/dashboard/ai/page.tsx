'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { ai as aiApi, leagues as leaguesApi } from '@/lib/api';
import { useLeagueStore } from '@/lib/store';
import TopBar from '@/components/layout/TopBar';
import type { Matchup } from '@/types';

export default function AIPage() {
  const activeLeague = useLeagueStore((s) => s.activeLeague);
  const [recapLoading, setRecapLoading] = useState(false);
  const [recapText, setRecapText] = useState('');
  const [trashTarget, setTrashTarget] = useState('');
  const [trashMatchup, setTrashMatchup] = useState('');
  const [trashStyle, setTrashStyle] = useState('aggressive');
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashText, setTrashText] = useState('');

  const { data: matchups } = useSWR(
    activeLeague ? `/leagues/${activeLeague.id}/matchups/${activeLeague.week}` : null,
    () => leaguesApi.getMatchups(activeLeague!.id, activeLeague!.week) as Promise<Matchup[]>
  );

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
                  <p className="text-white/50 text-sm">Your AI Commissioner — Powered by Claude claude-sonnet-4-20250514</p>
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
                <div className="ai-message animate-slide-up whitespace-pre-wrap">
                  {recapText}
                </div>
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
                          ))
                        }
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="text-white/60 text-sm font-semibold mb-1.5 block">Roast Style</label>
                    <div className="grid grid-cols-4 gap-2">
                      {['aggressive', 'petty', 'poetic', 'silent'].map((s) => (
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

            {/* Phase 2/3 Previews */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="card opacity-60">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">🎯</span>
                  <span className="text-white font-bold">AI Lineup Advice</span>
                  <span className="badge bg-blue-500/20 text-blue-400 border border-blue-500/30 text-xs">Phase 2</span>
                </div>
                <p className="text-white/40 text-sm">Start/sit recommendations with trash talk flavor.</p>
              </div>
              <div className="card opacity-60">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">📋</span>
                  <span className="text-white font-bold">AI Waiver Wire</span>
                  <span className="badge bg-purple-500/20 text-purple-400 border border-purple-500/30 text-xs">Phase 3</span>
                </div>
                <p className="text-white/40 text-sm">AI-powered waiver wire recommendations.</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
