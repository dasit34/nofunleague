'use client';
import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { players as playersApi, leagues as leaguesApi, teams as teamsApi } from '@/lib/api';
import { useAuthStore, useLeagueStore } from '@/lib/store';
import TopBar from '@/components/layout/TopBar';
import type { League, Team, Player } from '@/types';

type PlayerRow = Player & { on_team_id?: string | null; on_team_name?: string | null };

const POSITIONS = ['', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

const INJURY_COLORS: Record<string, string> = {
  Q:  'text-yellow-400',
  D:  'text-orange-400',
  O:  'text-red-400',
  IR: 'text-red-600',
};

export default function PlayersPage() {
  const { user }        = useAuthStore();
  const activeLeague    = useLeagueStore((s) => s.activeLeague);

  const [position, setPosition]       = useState('');
  const [search, setSearch]           = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [adding, setAdding]           = useState<string | null>(null);
  const [dropping, setDropping]       = useState<string | null>(null);
  const [actionMsg, setActionMsg]     = useState('');
  const [actionErr, setActionErr]     = useState('');

  // Find user's team in the active league
  const { data: leagueData } = useSWR(
    activeLeague && user ? `/leagues/${activeLeague.id}/full` : null,
    () => leaguesApi.get(activeLeague!.id) as Promise<League & { teams: Team[] }>
  );
  const myTeam = leagueData?.teams?.find((t) => t.user_id === user?.id);

  // Player list — include league_id to get roster context
  const { data: players, isLoading, mutate: mutatePlayers } = useSWR(
    `/players?pos=${position}&q=${search}&league=${activeLeague?.id ?? ''}`,
    () => playersApi.list({
      position:  position || undefined,
      search:    search   || undefined,
      limit:     100,
      league_id: activeLeague?.id,
    }) as Promise<PlayerRow[]>
  );

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
  }

  async function handleAdd(playerId: string) {
    if (!myTeam) return;
    setAdding(playerId);
    setActionMsg('');
    setActionErr('');
    try {
      await teamsApi.addPlayer(myTeam.id, playerId);
      setActionMsg('Player added to your roster.');
      await mutatePlayers();
      await mutate(`/teams/${myTeam.id}`);
    } catch (err) {
      setActionErr((err as Error).message);
    } finally {
      setAdding(null);
    }
  }

  async function handleDrop(playerId: string) {
    if (!myTeam) return;
    setDropping(playerId);
    setActionMsg('');
    setActionErr('');
    try {
      await teamsApi.dropPlayer(myTeam.id, playerId);
      setActionMsg('Player dropped.');
      await mutatePlayers();
      await mutate(`/teams/${myTeam.id}`);
    } catch (err) {
      setActionErr((err as Error).message);
    } finally {
      setDropping(null);
    }
  }

  const noLeague = !activeLeague;
  const noTeam   = activeLeague && !myTeam;

  return (
    <div>
      <TopBar title="Players" subtitle={activeLeague ? activeLeague.name : 'Select a league to see roster status'} />

      <div className="p-6 space-y-4">
        {/* League context banners */}
        {noLeague && (
          <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-white/50 text-sm">
            Select a league from the dashboard to see free agent / roster status and add players.
          </div>
        )}
        {noTeam && (
          <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-white/50 text-sm">
            You don't have a team in {activeLeague!.name} — you can browse players but can't add them.
          </div>
        )}

        {/* Feedback */}
        {actionMsg && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-green-400 text-sm">
            {actionMsg}
          </div>
        )}
        {actionErr && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
            {actionErr}
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <form onSubmit={handleSearch} className="flex gap-2 flex-1 min-w-48">
            <input
              type="text"
              className="input-dark flex-1"
              placeholder="Search players..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <button type="submit" className="btn-outline-gold py-2 px-4 text-sm">Search</button>
          </form>
          <div className="flex gap-2 flex-wrap">
            {POSITIONS.map((pos) => (
              <button
                key={pos || 'all'}
                onClick={() => setPosition(pos)}
                className={`py-2 px-3 rounded-lg border text-sm font-semibold transition-all ${
                  position === pos
                    ? 'border-gold bg-gold/10 text-gold'
                    : 'border-white/10 text-white/50 hover:border-white/30'
                }`}
              >
                {pos || 'ALL'}
              </button>
            ))}
          </div>
        </div>

        {/* Player list */}
        <div className="card overflow-hidden p-0">
          {isLoading ? (
            <div className="text-center text-white/40 py-12">Loading players...</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">Player</th>
                  <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">Pos</th>
                  <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">NFL Team</th>
                  <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">Status</th>
                  {activeLeague && (
                    <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">
                      {activeLeague.name}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {players?.map((p) => {
                  const isOnMyTeam = !!myTeam && p.on_team_id === myTeam.id;
                  const isOnOther  = !!p.on_team_id && !isOnMyTeam;
                  const isFreeAgent = activeLeague && !p.on_team_id;

                  return (
                    <tr key={p.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3">
                        <p className="text-white font-semibold text-sm">{p.full_name}</p>
                        {p.age && <p className="text-white/30 text-xs">Age {p.age}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="badge-gold text-xs">{p.position}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-white/70 text-sm font-mono">{p.nfl_team || '—'}</span>
                      </td>
                      <td className="px-4 py-3">
                        {p.injury_status ? (
                          <span className={`text-xs font-bold ${INJURY_COLORS[p.injury_status] || 'text-white/40'}`}>
                            {p.injury_status}
                          </span>
                        ) : (
                          <span className="text-green-400 text-xs">{p.status || 'Active'}</span>
                        )}
                      </td>

                      {activeLeague && (
                        <td className="px-4 py-3">
                          {isOnMyTeam ? (
                            <button
                              disabled={dropping === p.id}
                              onClick={() => handleDrop(p.id)}
                              className="text-xs text-red-400 hover:text-red-300 disabled:opacity-40 border border-red-400/30 rounded px-2 py-1 transition-colors"
                            >
                              {dropping === p.id ? '…' : 'Drop'}
                            </button>
                          ) : isOnOther ? (
                            <span className="text-white/30 text-xs">{p.on_team_name}</span>
                          ) : isFreeAgent && myTeam ? (
                            <button
                              disabled={adding === p.id}
                              onClick={() => handleAdd(p.id)}
                              className="text-xs bg-gold/20 text-gold hover:bg-gold/30 disabled:opacity-40 border border-gold/30 rounded px-2 py-1 transition-colors"
                            >
                              {adding === p.id ? '…' : 'Add'}
                            </button>
                          ) : isFreeAgent ? (
                            <span className="text-white/20 text-xs">Free Agent</span>
                          ) : null}
                        </td>
                      )}
                    </tr>
                  );
                })}
                {!isLoading && (!players || players.length === 0) && (
                  <tr>
                    <td colSpan={activeLeague ? 5 : 4} className="text-center text-white/30 py-8 text-sm">
                      No players found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
