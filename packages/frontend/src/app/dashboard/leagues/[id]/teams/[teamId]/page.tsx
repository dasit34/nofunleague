'use client';
import { use, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { teams as teamsApi, leagues as leaguesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { Team, RosterPlayer, AvailablePlayer, WaiverClaim } from '@/types';

// Ordered roster layout
const ROSTER_SLOTS = [
  { slot: 'QB',   label: 'QB',   positions: ['QB'] },
  { slot: 'RB1',  label: 'RB',   positions: ['RB'] },
  { slot: 'RB2',  label: 'RB',   positions: ['RB'] },
  { slot: 'WR1',  label: 'WR',   positions: ['WR'] },
  { slot: 'WR2',  label: 'WR',   positions: ['WR'] },
  { slot: 'TE',   label: 'TE',   positions: ['TE'] },
  { slot: 'FLEX', label: 'FLEX', positions: ['RB', 'WR', 'TE'] },
];

const BENCH_SLOTS = [
  { slot: 'BN1', label: 'BN' },
  { slot: 'BN2', label: 'BN' },
  { slot: 'BN3', label: 'BN' },
  { slot: 'BN4', label: 'BN' },
  { slot: 'BN5', label: 'BN' },
  { slot: 'BN6', label: 'BN' },
];

type TeamWithRoster = Team & {
  roster: RosterPlayer[];
  lineup_locked: boolean;
  league_week: number;
  lineup_locked_week: number;
};

export default function TeamRosterPage({
  params,
}: {
  params: Promise<{ id: string; teamId: string }>;
}) {
  const { id: leagueId, teamId } = use(params);
  const { user } = useAuthStore();

  const { data: team, mutate, isLoading } = useSWR(
    `/teams/${teamId}`,
    () => teamsApi.get(teamId) as Promise<TeamWithRoster>
  );

  const isOwner = !!team && team.user_id === user?.id;
  const isLocked = team?.lineup_locked ?? false;
  const canEdit = isOwner && !isLocked;
  const roster = team?.roster || [];

  // Pending waiver claims for this team's league
  const { data: myClaims, mutate: mutateClaims } = useSWR(
    isOwner && leagueId ? `/leagues/${leagueId}/waivers/my-claims` : null,
    () => leaguesApi.waiverMyClaims(leagueId)
  );

  // Build slot→player map
  const slotMap = new Map<string, RosterPlayer>();
  const unslotted: RosterPlayer[] = [];
  for (const p of roster) {
    if (p.roster_slot) {
      slotMap.set(p.roster_slot, p);
    } else {
      unslotted.push(p);
    }
  }

  // State for add player modal
  const [showAdd, setShowAdd] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [addPosition, setAddPosition] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [addErr, setAddErr] = useState('');

  const { data: available } = useSWR(
    showAdd ? `/teams/${teamId}/available?pos=${addPosition}&q=${addSearch}` : null,
    () => teamsApi.available(teamId, {
      position: addPosition || undefined,
      search: addSearch || undefined,
      limit: 30,
    })
  );

  const [actionErr, setActionErr] = useState('');
  const [actionLoading, setActionLoading] = useState('');

  async function handleMoveToSlot(playerId: string, slot: string) {
    setActionLoading(playerId);
    setActionErr('');
    try {
      await teamsApi.setSlot(teamId, playerId, slot);
      mutate();
    } catch (err) {
      setActionErr((err as Error).message);
    } finally {
      setActionLoading('');
    }
  }

  async function handleAddPlayer(playerId: string) {
    setAddLoading(true);
    setAddErr('');
    try {
      await teamsApi.addPlayer(teamId, playerId);
      mutate();
      setShowAdd(false);
      setAddSearch('');
      setAddPosition('');
    } catch (err) {
      setAddErr((err as Error).message);
    } finally {
      setAddLoading(false);
    }
  }

  async function handleDropPlayer(playerId: string) {
    setActionLoading(playerId);
    setActionErr('');
    try {
      await teamsApi.dropPlayer(teamId, playerId);
      mutate();
    } catch (err) {
      setActionErr((err as Error).message);
    } finally {
      setActionLoading('');
    }
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="card text-center text-white/40 py-12">Loading roster...</div>
      </div>
    );
  }

  if (!team) {
    return (
      <div className="p-6">
        <div className="card text-center text-white/40 py-12">
          Team not found. <Link href={`/dashboard/leagues/${leagueId}/teams`} className="text-gold">Back to teams</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link href={`/dashboard/leagues/${leagueId}/teams`} className="text-white/40 text-xs hover:text-gold transition-colors">
            ← Back to Teams
          </Link>
          <h2 className="text-white font-black text-lg mt-1">{team.name}</h2>
          <p className="text-white/40 text-sm">
            {team.display_name ? `Owner: ${team.display_name}` : ''}
            {' · '}
            {team.wins}-{team.losses}{team.ties > 0 ? `-${team.ties}` : ''} · {Number(team.points_for).toFixed(1)} PF
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Lock status badge */}
          {isLocked ? (
            <span className="px-3 py-1.5 rounded text-xs font-bold bg-red-500/20 text-red-400 border border-red-500/30">
              Lineup Locked — Week {team.league_week}
            </span>
          ) : (
            <span className="px-3 py-1.5 rounded text-xs font-bold bg-green-500/20 text-green-400 border border-green-500/30">
              Lineup Editable
            </span>
          )}
          {canEdit && (
            <button onClick={() => setShowAdd(true)} className="btn-gold text-sm py-2 px-4">
              + Add Player
            </button>
          )}
        </div>
      </div>

      {actionErr && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">{actionErr}</div>
      )}

      {/* Scoring note */}
      <div className="text-white/30 text-xs">
        Only players in <span className="text-gold font-semibold">starter slots</span> (QB, RB, WR, TE, FLEX) contribute to your weekly score. Bench players do not score.
      </div>

      {/* Starters */}
      <div>
        <h3 className="text-gold font-black text-sm uppercase tracking-wider mb-3">
          Starters <span className="text-white/30 font-normal">(scoring)</span>
        </h3>
        <div className="space-y-2">
          {ROSTER_SLOTS.map(({ slot, label }) => {
            const player = slotMap.get(slot);
            return (
              <RosterSlotRow
                key={slot}
                slot={slot}
                label={label}
                player={player}
                canEdit={canEdit}
                actionLoading={actionLoading}
                roster={roster}
                onMove={handleMoveToSlot}
                onDrop={handleDropPlayer}
              />
            );
          })}
        </div>
      </div>

      {/* Bench */}
      <div>
        <h3 className="text-white/60 font-black text-sm uppercase tracking-wider mb-3">
          Bench <span className="text-white/20 font-normal">(not scoring)</span>
        </h3>
        <div className="space-y-2">
          {BENCH_SLOTS.map(({ slot, label }) => {
            const player = slotMap.get(slot);
            return (
              <RosterSlotRow
                key={slot}
                slot={slot}
                label={label}
                player={player}
                canEdit={canEdit}
                actionLoading={actionLoading}
                roster={roster}
                onMove={handleMoveToSlot}
                onDrop={handleDropPlayer}
              />
            );
          })}
        </div>
      </div>

      {/* Pending Waiver Claims */}
      {isOwner && myClaims && myClaims.length > 0 && (
        <div>
          <h3 className="text-gold font-black text-sm uppercase tracking-wider mb-3">
            Pending Waiver Claims ({myClaims.length})
          </h3>
          <div className="space-y-2">
            {myClaims.map((c: WaiverClaim) => (
              <div key={c.id} className="card py-2 px-4 flex items-center justify-between border-gold/20">
                <div className="flex items-center gap-3">
                  <span className="text-gold text-xs font-mono w-10 font-bold">CLAIM</span>
                  <PlayerBadge player={{ full_name: c.player_name, position: c.player_position, nfl_team: c.player_nfl_team }} />
                </div>
                <button
                  onClick={async () => {
                    try {
                      await leaguesApi.waiverCancel(leagueId, c.id);
                      mutateClaims();
                    } catch {}
                  }}
                  className="text-red-400/60 hover:text-red-400 text-xs transition-colors"
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unslotted */}
      {unslotted.length > 0 && (
        <div>
          <h3 className="text-white/40 font-black text-sm uppercase tracking-wider mb-3">Unassigned</h3>
          <div className="space-y-2">
            {unslotted.map((player) => (
              <div key={player.id} className="card py-2 px-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-white/20 text-xs font-mono w-10">—</span>
                  <PlayerBadge player={player} />
                </div>
                {canEdit && (
                  <div className="flex gap-2">
                    <select
                      className="input-dark py-1 text-xs w-24"
                      defaultValue=""
                      onChange={(e) => { if (e.target.value) handleMoveToSlot(player.id, e.target.value); }}
                    >
                      <option value="">Move to...</option>
                      {getAllowedSlots(player.position).map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleDropPlayer(player.id)}
                      disabled={actionLoading === player.id}
                      className="text-red-400/60 hover:text-red-400 text-xs transition-colors"
                    >
                      Drop
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Player Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowAdd(false)}>
          <div className="card w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-black text-lg">Add Free Agent</h3>
              <button onClick={() => setShowAdd(false)} className="text-white/40 hover:text-white text-lg">✕</button>
            </div>

            {addErr && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-red-400 text-sm">{addErr}</div>
            )}

            <div className="flex gap-2 mb-4">
              <input
                type="text"
                placeholder="Search player..."
                className="input-dark flex-1 py-2 text-sm"
                value={addSearch}
                onChange={(e) => setAddSearch(e.target.value)}
              />
              <select
                className="input-dark py-2 text-sm w-24"
                value={addPosition}
                onChange={(e) => setAddPosition(e.target.value)}
              >
                <option value="">All</option>
                <option value="QB">QB</option>
                <option value="RB">RB</option>
                <option value="WR">WR</option>
                <option value="TE">TE</option>
                <option value="K">K</option>
                <option value="DEF">DEF</option>
              </select>
            </div>

            <div className="space-y-1">
              {available?.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2 px-3 rounded hover:bg-white/5 transition-colors">
                  <PlayerBadge player={p} />
                  <button onClick={() => handleAddPlayer(p.id)} disabled={addLoading} className="btn-gold text-xs py-1 px-3">
                    {addLoading ? '...' : 'Add'}
                  </button>
                </div>
              )) || (
                <p className="text-white/30 text-sm text-center py-4">Loading players...</p>
              )}
              {available?.length === 0 && (
                <p className="text-white/30 text-sm text-center py-4">No available players found.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function RosterSlotRow({
  slot, label, player, canEdit, actionLoading, roster, onMove, onDrop,
}: {
  slot: string; label: string; player: RosterPlayer | undefined;
  canEdit: boolean; actionLoading: string; roster: RosterPlayer[];
  onMove: (playerId: string, slot: string) => void;
  onDrop: (playerId: string) => void;
}) {
  const isStarter = !slot.startsWith('BN');

  return (
    <div className={`card py-2 px-4 flex items-center justify-between ${!player ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-3">
        <span className={`text-xs font-mono w-10 font-bold ${isStarter ? 'text-gold' : 'text-white/30'}`}>
          {label}
        </span>
        {player ? (
          <PlayerBadge player={player} />
        ) : (
          <span className="text-white/20 text-sm italic">Empty</span>
        )}
      </div>

      {canEdit && player && (
        <div className="flex gap-2 items-center">
          <select
            className="input-dark py-1 text-xs w-24"
            value=""
            onChange={(e) => { if (e.target.value) onMove(player.id, e.target.value); }}
            disabled={actionLoading === player.id}
          >
            <option value="">Move to...</option>
            {getAllowedSlots(player.position)
              .filter((s) => s !== slot)
              .map((s) => {
                const occupant = roster.find((p) => p.roster_slot === s);
                return (
                  <option key={s} value={s}>
                    {s}{occupant ? ` (swap: ${occupant.full_name?.split(' ').pop()})` : ''}
                  </option>
                );
              })}
          </select>
          <button
            onClick={() => onDrop(player.id)}
            disabled={actionLoading === player.id}
            className="text-red-400/60 hover:text-red-400 text-xs transition-colors"
          >
            Drop
          </button>
        </div>
      )}

      {!canEdit && player && isStarter && (
        <span className="text-gold/40 text-xs">scoring</span>
      )}
    </div>
  );
}

function PlayerBadge({ player }: { player: { full_name?: string; position?: string; nfl_team?: string; injury_status?: string } }) {
  const posColors: Record<string, string> = {
    QB: 'text-red-400', RB: 'text-green-400', WR: 'text-blue-400',
    TE: 'text-orange-400', K: 'text-purple-400', DEF: 'text-yellow-400',
  };
  return (
    <div className="flex items-center gap-2">
      <span className={`text-xs font-bold ${posColors[player.position || ''] || 'text-white/40'}`}>{player.position}</span>
      <span className="text-white text-sm font-semibold">{player.full_name}</span>
      <span className="text-white/30 text-xs">{player.nfl_team}</span>
      {player.injury_status && <span className="text-red-400 text-xs font-bold">{player.injury_status}</span>}
    </div>
  );
}

function getAllowedSlots(position: string): string[] {
  const slots: string[] = [];
  const map: Record<string, string[]> = {
    QB: ['QB'], RB: ['RB1', 'RB2', 'FLEX'], WR: ['WR1', 'WR2', 'FLEX'], TE: ['TE', 'FLEX'],
  };
  slots.push(...(map[position] || []));
  for (let i = 1; i <= 6; i++) slots.push(`BN${i}`);
  return slots;
}
