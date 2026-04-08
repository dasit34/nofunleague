'use client';
import { use, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { teams as teamsApi, leagues as leaguesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { League, Team, RosterPlayer, WaiverClaim, RosterSettings } from '@/types';
import { getRosterFromSettings, totalRosterSize, starterCount } from '@/types';

// ─── Build slot definitions from league roster settings ─────────────────────

interface SlotDef { slot: string; label: string; isStarter: boolean }

type SlotSection = 'starter' | 'bench' | 'ir';

function buildSlots(r: RosterSettings): (SlotDef & { section: SlotSection })[] {
  const slots: (SlotDef & { section: SlotSection })[] = [];
  const push = (prefix: string, count: number, label: string, section: SlotSection) => {
    for (let i = 1; i <= count; i++) slots.push({ slot: count === 1 ? prefix : `${prefix}${i}`, label, isStarter: section === 'starter', section });
  };
  push('QB', r.qb_slots, 'QB', 'starter');
  push('RB', r.rb_slots, 'RB', 'starter');
  push('WR', r.wr_slots, 'WR', 'starter');
  push('TE', r.te_slots, 'TE', 'starter');
  push('FLEX', r.flex_slots, 'FLEX', 'starter');
  push('SUPERFLEX', r.superflex_slots || 0, 'SF', 'starter');
  push('DEF', r.def_slots, 'D/ST', 'starter');
  push('K', r.k_slots, 'K', 'starter');
  push('BN', r.bench_slots, 'BE', 'bench');
  push('IR', r.ir_slots || 0, 'IR', 'ir');
  return slots;
}

function getAllowedSlots(position: string, rosterSettings: RosterSettings): string[] {
  const slots: string[] = [];
  const r = rosterSettings;
  const push = (prefix: string, count: number) => {
    for (let i = 1; i <= count; i++) slots.push(count === 1 ? prefix : `${prefix}${i}`);
  };
  // Position-specific starter slots
  if (position === 'QB') push('QB', r.qb_slots);
  if (position === 'RB') push('RB', r.rb_slots);
  if (position === 'WR') push('WR', r.wr_slots);
  if (position === 'TE') push('TE', r.te_slots);
  if (position === 'K') push('K', r.k_slots);
  if (position === 'DEF') push('DEF', r.def_slots);
  // FLEX: RB/WR/TE eligible (or QB too if flex_types includes QB)
  if (['RB', 'WR', 'TE'].includes(position) || (r.flex_types === 'QB_RB_WR_TE' && position === 'QB')) {
    push('FLEX', r.flex_slots);
  }
  // SUPERFLEX: QB/RB/WR/TE eligible
  if (['QB', 'RB', 'WR', 'TE'].includes(position)) {
    push('SUPERFLEX', r.superflex_slots || 0);
  }
  // Bench: any position
  push('BN', r.bench_slots);
  // IR: any position
  push('IR', r.ir_slots || 0);
  return slots;
}

// ─── Position colors ────────────────────────────────────────────────────────

const POS_COLORS: Record<string, string> = {
  QB: 'text-red-400', RB: 'text-green-400', WR: 'text-blue-400',
  TE: 'text-orange-400', FLEX: 'text-purple-400', SF: 'text-purple-400',
  'D/ST': 'text-yellow-400', DEF: 'text-yellow-400', K: 'text-cyan-400',
  BE: 'text-white/20', IR: 'text-white/20',
};

// ─── Types ──────────────────────────────────────────────────────────────────

type TeamWithRoster = Team & {
  roster: RosterPlayer[];
  lineup_locked: boolean;
  league_week: number;
  lineup_locked_week: number;
  league_status: string;
};

// ─── Page ───────────────────────────────────────────────────────────────────

export default function TeamRosterPage({
  params,
}: {
  params: Promise<{ id: string; teamId: string }>;
}) {
  const { id: leagueId, teamId } = use(params);
  const { user } = useAuthStore();

  const { data: league } = useSWR(
    `/leagues/${leagueId}`,
    () => leaguesApi.get(leagueId) as Promise<League>
  );

  const { data: team, mutate, isLoading } = useSWR(
    `/teams/${teamId}`,
    () => teamsApi.get(teamId) as Promise<TeamWithRoster>
  );

  const isOwner = !!team && team.user_id === user?.id;
  const isLocked = team?.lineup_locked ?? false;
  const canEdit = isOwner && !isLocked;
  const roster = team?.roster || [];

  // Roster settings from league config
  const rosterSettings = league ? getRosterFromSettings(league.settings) : null;
  const allSlots = rosterSettings ? buildSlots(rosterSettings) : [];
  const starterSlots = allSlots.filter(s => s.section === 'starter');
  const benchSlots = allSlots.filter(s => s.section === 'bench');
  const irSlots = allSlots.filter(s => s.section === 'ir');
  const totalSlots = rosterSettings ? totalRosterSize(rosterSettings) : 0;
  const starterSlotCount = rosterSettings ? starterCount(rosterSettings) : 0;
  const filledCount = roster.length;

  // Player weekly scores — fetch team scores for the most recently completed week
  const currentWeek = team?.league_week || league?.week || 1;
  const lastScoredWeek = currentWeek > 1 ? currentWeek - 1 : 0;
  const { data: weekScores } = useSWR(
    team && lastScoredWeek > 0 ? `/teams/${teamId}/scores` : null,
    () => teamsApi.scores(teamId) as Promise<{ week: number; player_scores: { player_id: string; points: number }[] }[]>
  );

  // Build player→points map for the last scored week
  const playerScoreMap = new Map<string, number>();
  if (weekScores) {
    const lastWeekData = weekScores.find(ws => ws.week === lastScoredWeek);
    if (lastWeekData?.player_scores) {
      for (const ps of lastWeekData.player_scores) {
        playerScoreMap.set(ps.player_id, ps.points);
      }
    }
  }

  // Waiver claims
  const { data: myClaims, mutate: mutateClaims } = useSWR(
    isOwner && leagueId ? `/leagues/${leagueId}/waivers/my-claims` : null,
    () => leaguesApi.waiverMyClaims(leagueId)
  );

  // Build slot→player map
  const slotMap = new Map<string, RosterPlayer>();
  const unslotted: RosterPlayer[] = [];
  for (const p of roster) {
    if (p.roster_slot) slotMap.set(p.roster_slot, p);
    else unslotted.push(p);
  }

  // Add player modal state
  const [showAdd, setShowAdd] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [addPosition, setAddPosition] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [addErr, setAddErr] = useState('');
  const [actionErr, setActionErr] = useState('');
  const [actionLoading, setActionLoading] = useState('');

  const { data: available } = useSWR(
    showAdd ? `/teams/${teamId}/available?pos=${addPosition}&q=${addSearch}` : null,
    () => teamsApi.available(teamId, {
      ...(addPosition ? { position: addPosition } : {}),
      ...(addSearch ? { search: addSearch } : {}),
      limit: 30,
    })
  );

  async function handleMoveToSlot(playerId: string, slot: string) {
    setActionLoading(playerId); setActionErr('');
    try { await teamsApi.setSlot(teamId, playerId, slot); mutate(); }
    catch (err) { setActionErr((err as Error).message); }
    finally { setActionLoading(''); }
  }

  async function handleAddPlayer(playerId: string) {
    setAddLoading(true); setAddErr('');
    try { await teamsApi.addPlayer(teamId, playerId); mutate(); setShowAdd(false); setAddSearch(''); setAddPosition(''); }
    catch (err) { setAddErr((err as Error).message); }
    finally { setAddLoading(false); }
  }

  async function handleDropPlayer(playerId: string) {
    setActionLoading(playerId); setActionErr('');
    try { await teamsApi.dropPlayer(teamId, playerId); mutate(); }
    catch (err) { setActionErr((err as Error).message); }
    finally { setActionLoading(''); }
  }

  if (isLoading) {
    return <div className="p-6"><div className="card text-center text-white/40 py-12">Loading roster...</div></div>;
  }
  if (!team) {
    return (
      <div className="p-6"><div className="card text-center text-white/40 py-12">
        Team not found. <Link href={`/dashboard/leagues/${leagueId}/teams`} className="text-gold">Back to teams</Link>
      </div></div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div>
        <Link href={`/dashboard/leagues/${leagueId}/teams`} className="text-white/30 text-xs hover:text-gold transition-colors">← Back to Teams</Link>

        <div className="flex items-center justify-between flex-wrap gap-3 mt-2">
          <div>
            <h2 className="text-white font-black text-xl">{team.name}</h2>
            <p className="text-white/40 text-sm">
              {team.display_name && <span>Manager: {team.display_name} · </span>}
              <span className="font-mono">{team.wins}-{team.losses}{team.ties > 0 ? `-${team.ties}` : ''}</span>
              <span className="text-white/20 mx-2">·</span>
              <span>{Number(team.points_for).toFixed(1)} PF</span>
              <span className="text-white/20 mx-2">·</span>
              <span>Week {team.league_week || league?.week || 1}</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            {isLocked ? (
              <span className="px-3 py-1.5 rounded text-xs font-bold bg-red-500/20 text-red-400 border border-red-500/30">
                Lineup Locked
              </span>
            ) : (
              <span className="px-3 py-1.5 rounded text-xs font-bold bg-green-500/20 text-green-400 border border-green-500/30">
                Lineup Editable
              </span>
            )}
            {canEdit && (
              <button onClick={() => setShowAdd(true)} className="btn-gold text-sm py-2 px-4">+ Add Player</button>
            )}
          </div>
        </div>
      </div>

      {/* ── Roster summary bar ────────────────────────────────────────── */}
      <div className="flex gap-4 text-xs text-white/30 flex-wrap">
        <span>Roster: <span className="text-white font-bold">{filledCount}/{totalSlots}</span></span>
        <span>Starters: <span className="text-gold font-bold">{starterSlotCount}</span></span>
        <span>Bench: <span className="text-white font-bold">{benchSlots.length}</span></span>
        {irSlots.length > 0 && <span>IR: <span className="text-white font-bold">{irSlots.length}</span></span>}
        {lastScoredWeek > 0 && <span>Scores: <span className="text-white/40">Week {lastScoredWeek}</span></span>}
        <span className="text-white/10">Only starters score</span>
      </div>

      {actionErr && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">{actionErr}</div>}

      {/* ── Starters ──────────────────────────────────────────────────── */}
      <div>
        <h3 className="text-gold font-black text-xs uppercase tracking-wider mb-2">Starters</h3>
        <div className="card overflow-hidden p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left text-white/30 text-xs uppercase tracking-wider px-4 py-2 w-14">Slot</th>
                <th className="text-left text-white/30 text-xs uppercase tracking-wider px-4 py-2">Player</th>
                <th className="text-right text-white/30 text-xs uppercase tracking-wider px-4 py-2 w-16">Pts</th>
                {canEdit && <th className="text-right text-white/30 text-xs uppercase tracking-wider px-4 py-2 w-32"></th>}
              </tr>
            </thead>
            <tbody>
              {starterSlots.map((s) => {
                const player = slotMap.get(s.slot);
                return (
                  <tr key={s.slot} className={`border-b border-white/5 ${player ? 'hover:bg-white/[0.03]' : ''} transition-colors`}>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-bold ${POS_COLORS[s.label] || 'text-white/40'}`}>{s.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      {player ? (
                        <div className="flex items-center gap-2">
                          <span className="text-white text-sm font-semibold">{player.full_name}</span>
                          <span className="text-white/20 text-xs">{player.nfl_team}</span>
                          {player.injury_status && <span className="text-red-400 text-xs font-bold">{player.injury_status}</span>}
                        </div>
                      ) : (
                        <span className="text-white/15 text-sm italic">Empty {s.label}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {player ? (() => {
                        const pts = playerScoreMap.get(player.id);
                        return pts !== undefined
                          ? <span className="font-mono text-sm text-gold font-bold">{pts.toFixed(1)}</span>
                          : <span className="font-mono text-sm text-white/15">—</span>;
                      })() : <span className="font-mono text-sm text-white/10">—</span>}
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3 text-right">
                        {player && rosterSettings && (
                          <div className="flex items-center justify-end gap-1">
                            <select className="input-dark py-0.5 text-xs w-20" value=""
                              onChange={(e) => { if (e.target.value) handleMoveToSlot(player.id, e.target.value); }}
                              disabled={actionLoading === player.id}>
                              <option value="">Move</option>
                              {getAllowedSlots(player.position, rosterSettings).filter(sl => sl !== s.slot).map(sl => (
                                <option key={sl} value={sl}>{sl}</option>
                              ))}
                            </select>
                            <button onClick={() => handleDropPlayer(player.id)} disabled={actionLoading === player.id}
                              className="text-red-400/40 hover:text-red-400 text-xs transition-colors">Drop</button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Bench ─────────────────────────────────────────────────────── */}
      <div>
        <h3 className="text-white/40 font-black text-xs uppercase tracking-wider mb-2">Bench</h3>
        <div className="card overflow-hidden p-0">
          <table className="w-full">
            <tbody>
              {benchSlots.map((s) => {
                const player = slotMap.get(s.slot);
                return (
                  <tr key={s.slot} className={`border-b border-white/5 ${player ? 'hover:bg-white/[0.03]' : ''} transition-colors`}>
                    <td className="px-4 py-2.5 w-14">
                      <span className="text-white/15 text-xs font-bold">BE</span>
                    </td>
                    <td className="px-4 py-2.5">
                      {player ? (
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold ${POS_COLORS[player.position] || 'text-white/30'}`}>{player.position}</span>
                          <span className="text-white/60 text-sm">{player.full_name}</span>
                          <span className="text-white/15 text-xs">{player.nfl_team}</span>
                        </div>
                      ) : (
                        <span className="text-white/10 text-sm italic">Empty BE</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right w-16">
                      {player ? (() => {
                        const pts = playerScoreMap.get(player.id);
                        return pts !== undefined
                          ? <span className="font-mono text-xs text-white/30">{pts.toFixed(1)}</span>
                          : <span className="font-mono text-xs text-white/10">—</span>;
                      })() : <span className="font-mono text-xs text-white/10">—</span>}
                    </td>
                    {canEdit && (
                      <td className="px-4 py-2.5 text-right w-32">
                        {player && rosterSettings && (
                          <div className="flex items-center justify-end gap-1">
                            <select className="input-dark py-0.5 text-xs w-20" value=""
                              onChange={(e) => { if (e.target.value) handleMoveToSlot(player.id, e.target.value); }}
                              disabled={actionLoading === player.id}>
                              <option value="">Move</option>
                              {getAllowedSlots(player.position, rosterSettings).filter(sl => sl !== s.slot).map(sl => (
                                <option key={sl} value={sl}>{sl}</option>
                              ))}
                            </select>
                            <button onClick={() => handleDropPlayer(player.id)} disabled={actionLoading === player.id}
                              className="text-red-400/40 hover:text-red-400 text-xs transition-colors">Drop</button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── IR ──────────────────────────────────────────────────────── */}
      {irSlots.length > 0 && (
        <div>
          <h3 className="text-white/30 font-black text-xs uppercase tracking-wider mb-2">Injured Reserve</h3>
          <div className="card overflow-hidden p-0">
            <table className="w-full">
              <tbody>
                {irSlots.map((s) => {
                  const player = slotMap.get(s.slot);
                  return (
                    <tr key={s.slot} className={`border-b border-white/5 ${player ? 'hover:bg-white/[0.03]' : ''} transition-colors`}>
                      <td className="px-4 py-2.5 w-14">
                        <span className="text-white/15 text-xs font-bold">IR</span>
                      </td>
                      <td className="px-4 py-2.5">
                        {player ? (
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-bold ${POS_COLORS[player.position] || 'text-white/30'}`}>{player.position}</span>
                            <span className="text-white/60 text-sm">{player.full_name}</span>
                            <span className="text-white/15 text-xs">{player.nfl_team}</span>
                            {player.injury_status && <span className="text-red-400 text-xs font-bold">{player.injury_status}</span>}
                          </div>
                        ) : (
                          <span className="text-white/10 text-sm italic">Empty IR</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right w-16">
                        <span className="text-white/10 font-mono text-xs">IR</span>
                      </td>
                      {canEdit && (
                        <td className="px-4 py-2.5 text-right w-32">
                          {player && rosterSettings && (
                            <div className="flex items-center justify-end gap-1">
                              <select className="input-dark py-0.5 text-xs w-20" value=""
                                onChange={(e) => { if (e.target.value) handleMoveToSlot(player.id, e.target.value); }}
                                disabled={actionLoading === player.id}>
                                <option value="">Move</option>
                                {getAllowedSlots(player.position, rosterSettings).filter(sl => sl !== s.slot).map(sl => (
                                  <option key={sl} value={sl}>{sl}</option>
                                ))}
                              </select>
                              <button onClick={() => handleDropPlayer(player.id)} disabled={actionLoading === player.id}
                                className="text-red-400/40 hover:text-red-400 text-xs transition-colors">Drop</button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Waiver Claims ─────────────────────────────────────────────── */}
      {isOwner && myClaims && myClaims.length > 0 && (
        <div>
          <h3 className="text-gold font-black text-xs uppercase tracking-wider mb-2">Pending Claims ({myClaims.length})</h3>
          <div className="card overflow-hidden p-0">
            {myClaims.map((c: WaiverClaim) => (
              <div key={c.id} className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold ${POS_COLORS[c.player_position || ''] || 'text-white/30'}`}>{c.player_position}</span>
                  <span className="text-white text-sm">{c.player_name}</span>
                  <span className="text-white/20 text-xs">{c.player_nfl_team}</span>
                </div>
                <button onClick={async () => { try { await leaguesApi.waiverCancel(leagueId, c.id); mutateClaims(); } catch {} }}
                  className="text-red-400/40 hover:text-red-400 text-xs transition-colors">Cancel</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Unslotted ─────────────────────────────────────────────────── */}
      {unslotted.length > 0 && (
        <div>
          <h3 className="text-white/30 font-black text-xs uppercase tracking-wider mb-2">Unassigned ({unslotted.length})</h3>
          <div className="card overflow-hidden p-0">
            {unslotted.map((player) => (
              <div key={player.id} className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold ${POS_COLORS[player.position] || 'text-white/30'}`}>{player.position}</span>
                  <span className="text-white/60 text-sm">{player.full_name}</span>
                </div>
                {canEdit && rosterSettings && (
                  <div className="flex gap-1">
                    <select className="input-dark py-0.5 text-xs w-20" defaultValue=""
                      onChange={(e) => { if (e.target.value) handleMoveToSlot(player.id, e.target.value); }}>
                      <option value="">Move</option>
                      {getAllowedSlots(player.position, rosterSettings).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button onClick={() => handleDropPlayer(player.id)} disabled={actionLoading === player.id}
                      className="text-red-400/40 hover:text-red-400 text-xs transition-colors">Drop</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Add Player Modal ──────────────────────────────────────────── */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowAdd(false)}>
          <div className="card w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-black text-lg">Add Free Agent</h3>
              <button onClick={() => setShowAdd(false)} className="text-white/40 hover:text-white text-lg">✕</button>
            </div>
            {addErr && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-red-400 text-sm">{addErr}</div>}
            <div className="flex gap-2 mb-4">
              <input type="text" placeholder="Search..." className="input-dark flex-1 py-2 text-sm"
                value={addSearch} onChange={(e) => setAddSearch(e.target.value)} />
              <select className="input-dark py-2 text-sm w-24" value={addPosition} onChange={(e) => setAddPosition(e.target.value)}>
                <option value="">All</option>
                <option value="QB">QB</option><option value="RB">RB</option>
                <option value="WR">WR</option><option value="TE">TE</option>
                <option value="K">K</option><option value="DEF">DEF</option>
              </select>
            </div>
            <div className="space-y-1">
              {available?.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2 px-3 rounded hover:bg-white/5 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold ${POS_COLORS[p.position] || 'text-white/30'}`}>{p.position}</span>
                    <span className="text-white text-sm">{p.full_name}</span>
                    <span className="text-white/20 text-xs">{p.nfl_team}</span>
                  </div>
                  <button onClick={() => handleAddPlayer(p.id)} disabled={addLoading} className="btn-gold text-xs py-1 px-3">
                    {addLoading ? '...' : 'Add'}
                  </button>
                </div>
              )) || <p className="text-white/30 text-sm text-center py-4">Loading...</p>}
              {available?.length === 0 && <p className="text-white/30 text-sm text-center py-4">No players found.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
