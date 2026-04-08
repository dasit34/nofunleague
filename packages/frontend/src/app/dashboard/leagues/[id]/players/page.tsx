'use client';
import { use, useState } from 'react';
import useSWR from 'swr';
import { players as playersApi, leagues as leaguesApi, teams as teamsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { League, Team, Player, WaiverClaim } from '@/types';

type PlayerRow = Player & { on_team_id?: string | null; on_team_name?: string | null };

const POSITIONS = ['', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

const posColors: Record<string, string> = {
  QB: 'text-red-400', RB: 'text-green-400', WR: 'text-blue-400',
  TE: 'text-orange-400', K: 'text-purple-400', DEF: 'text-yellow-400',
};

/**
 * League Players page — shows the FULL player universe with league roster context.
 * Any user can browse. Owners can claim/add. Non-owners see ownership status.
 *
 * If no players are loaded, run: POST /api/players/sync (requires auth)
 */
export default function PlayersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuthStore();

  const [position, setPosition] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [actionId, setActionId] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const { data: league } = useSWR(
    `/leagues/${id}`,
    () => leaguesApi.get(id) as Promise<League & { teams: Team[] }>
  );

  const myTeam = league?.teams?.find((t) => t.user_id === user?.id);
  const isCommissioner = league?.commissioner_id === user?.id;
  const isInSeason = league?.status === 'in_season';

  // Full player list with league roster context (who owns whom)
  const { data: players, isLoading, mutate: mutatePlayers } = useSWR(
    `/players?pos=${position}&q=${search}&league=${id}`,
    () => playersApi.list({
      ...(position ? { position } : {}),
      ...(search ? { search } : {}),
      limit: 100,
      league_id: id,
    }) as Promise<PlayerRow[]>
  );

  // Waiver claims (for in-season leagues)
  const { data: myClaims, mutate: mutateClaims } = useSWR(
    myTeam && isInSeason ? `/leagues/${id}/waivers/my-claims` : null,
    () => leaguesApi.waiverMyClaims(id)
  );
  const { data: allPending } = useSWR(
    isCommissioner && isInSeason ? `/leagues/${id}/waivers/pending` : null,
    () => leaguesApi.waiverList(id, 'pending')
  );

  const pendingPlayerIds = new Set((myClaims || []).map((c) => c.player_id));
  const claimByPlayer = new Map((myClaims || []).map((c) => [c.player_id, c]));

  const [processing, setProcessing] = useState(false);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
  }

  async function handleAdd(playerId: string) {
    if (!myTeam) return;
    setActionId(playerId); setErr(''); setMsg('');
    try {
      if (isInSeason) {
        await leaguesApi.waiverClaim(id, playerId);
        setMsg('Waiver claim submitted');
        mutateClaims();
      } else {
        await teamsApi.addPlayer(myTeam.id, playerId);
        setMsg('Player added to roster');
        mutatePlayers();
      }
      setTimeout(() => setMsg(''), 3000);
    } catch (e) { setErr((e as Error).message); }
    finally { setActionId(''); }
  }

  async function handleCancelClaim(claimId: string) {
    setErr('');
    try { await leaguesApi.waiverCancel(id, claimId); mutateClaims(); mutatePlayers(); }
    catch (e) { setErr((e as Error).message); }
  }

  async function handleProcess() {
    setProcessing(true); setMsg(''); setErr('');
    try {
      const result = await leaguesApi.waiverProcess(id);
      setMsg(result.message); mutateClaims(); mutatePlayers();
    } catch (e) { setErr((e as Error).message); }
    finally { setProcessing(false); }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-white font-black text-lg">Players</h2>
        <div className="flex items-center gap-2">
          {isInSeason && (
            <span className="text-xs px-2 py-1 rounded bg-gold/20 text-gold border border-gold/30">Waiver Wire Active</span>
          )}
          {isCommissioner && isInSeason && (allPending?.length ?? 0) > 0 && (
            <button onClick={handleProcess} disabled={processing} className="btn-gold text-sm py-1.5 px-3">
              {processing ? '...' : `Process (${allPending?.length})`}
            </button>
          )}
        </div>
      </div>

      {/* Pending claims */}
      {myClaims && myClaims.length > 0 && (
        <div className="card border-gold/20 space-y-2">
          <span className="text-gold font-black text-xs uppercase tracking-wider">Your Pending Claims ({myClaims.length})</span>
          {myClaims.map((c) => (
            <div key={c.id} className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold ${posColors[c.player_position || ''] || 'text-white/40'}`}>{c.player_position}</span>
                <span className="text-white text-sm">{c.player_name}</span>
                <span className="text-white/30 text-xs">{c.player_nfl_team}</span>
              </div>
              <button onClick={() => handleCancelClaim(c.id)} className="text-red-400/60 hover:text-red-400 text-xs">Cancel</button>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <form onSubmit={handleSearch} className="flex gap-2 flex-1 min-w-[200px]">
          <input type="text" className="input-dark py-2 text-sm flex-1" placeholder="Search players..."
            value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          <button type="submit" className="btn-outline-gold py-2 px-3 text-sm">Search</button>
        </form>
        <div className="flex gap-1">
          {POSITIONS.map((pos) => (
            <button key={pos || 'all'} onClick={() => setPosition(pos)}
              className={`px-3 py-2 text-xs font-bold rounded transition-colors ${
                position === pos
                  ? 'bg-gold/20 text-gold border border-gold/30'
                  : 'bg-white/5 text-white/40 border border-white/10 hover:text-white/70'
              }`}>
              {pos || 'ALL'}
            </button>
          ))}
        </div>
      </div>

      {err && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">{err}</div>}
      {msg && <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-green-400 text-sm">{msg}</div>}

      {/* Player table */}
      <div className="card overflow-hidden p-0">
        {isLoading ? (
          <div className="text-center text-white/40 py-12">Loading players...</div>
        ) : !players || players.length === 0 ? (
          <div className="text-center py-12 space-y-2">
            <p className="text-white/40 text-sm">
              {search ? `No players found matching "${search}"` : 'No players loaded yet.'}
            </p>
            {!search && (
              <p className="text-white/20 text-xs">
                Run POST /api/players/sync to import NFL players from Sleeper.
              </p>
            )}
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">Player</th>
                <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3 hidden sm:table-cell">Team</th>
                <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3 hidden md:table-cell">Status</th>
                <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">Owner</th>
                <th className="text-right text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3 w-28"></th>
              </tr>
            </thead>
            <tbody>
              {players.map((p: PlayerRow) => {
                const isOnMyTeam = !!myTeam && p.on_team_id === myTeam.id;
                const isOwned = !!p.on_team_id;
                const isFree = !isOwned;
                const isPending = pendingPlayerIds.has(p.id);
                const claim = claimByPlayer.get(p.id);

                return (
                  <tr key={p.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold w-8 ${posColors[p.position] || 'text-white/40'}`}>{p.position}</span>
                        <div>
                          <p className="text-white text-sm font-semibold">{p.full_name}</p>
                          <p className="text-white/20 text-xs sm:hidden">{p.nfl_team || 'FA'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="text-white/50 text-sm font-mono">{p.nfl_team || '—'}</span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {p.injury_status ? (
                        <span className="text-red-400 text-xs font-bold">{p.injury_status}</span>
                      ) : (
                        <span className="text-white/20 text-xs">{p.status || 'Active'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isOnMyTeam ? (
                        <span className="text-gold text-xs font-semibold">My Team</span>
                      ) : isOwned ? (
                        <span className="text-white/30 text-xs">{p.on_team_name}</span>
                      ) : (
                        <span className="text-white/10 text-xs">Free Agent</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isPending ? (
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-gold text-xs">Pending</span>
                          <button onClick={() => claim && handleCancelClaim(claim.id)} className="text-red-400/40 hover:text-red-400 text-xs">✕</button>
                        </div>
                      ) : isFree && myTeam ? (
                        <button onClick={() => handleAdd(p.id)} disabled={actionId === p.id}
                          className={`text-xs py-1 px-3 ${isInSeason ? 'btn-outline-gold' : 'btn-gold'}`}>
                          {actionId === p.id ? '...' : isInSeason ? 'Claim' : 'Add'}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
