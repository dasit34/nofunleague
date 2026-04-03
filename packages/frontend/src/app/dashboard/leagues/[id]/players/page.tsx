'use client';
import { use, useState } from 'react';
import useSWR from 'swr';
import { leagues as leaguesApi, teams as teamsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { League, Team, AvailablePlayer, WaiverClaim } from '@/types';

const POSITIONS = ['', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

const posColors: Record<string, string> = {
  QB: 'text-red-400', RB: 'text-green-400', WR: 'text-blue-400',
  TE: 'text-orange-400', K: 'text-purple-400', DEF: 'text-yellow-400',
};

export default function PlayersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuthStore();

  const [position, setPosition] = useState('');
  const [search, setSearch] = useState('');
  const [claimingId, setClaimingId] = useState('');
  const [err, setErr] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const { data: league } = useSWR(
    `/leagues/${id}`,
    () => leaguesApi.get(id) as Promise<League & { teams: Team[] }>
  );

  const myTeam = league?.teams?.find((t) => t.user_id === user?.id);
  const isCommissioner = league?.commissioner_id === user?.id;
  const isInSeason = league?.status === 'in_season';

  // Free agents
  const { data: players, mutate: mutatePlayers } = useSWR(
    myTeam ? `/teams/${myTeam.id}/available?pos=${position}&q=${search}` : null,
    () => myTeam ? teamsApi.available(myTeam.id, {
      position: position || undefined,
      search: search || undefined,
      limit: 50,
    }) : Promise.resolve([])
  );

  // My pending claims — used to show "Pending" status on claimed players
  const { data: myClaims, mutate: mutateClaims } = useSWR(
    myTeam ? `/leagues/${id}/waivers/my-claims` : null,
    () => leaguesApi.waiverMyClaims(id)
  );

  // All pending claims (for commissioner processing view)
  const { data: allPending } = useSWR(
    isCommissioner ? `/leagues/${id}/waivers/pending` : null,
    () => leaguesApi.waiverList(id, 'pending')
  );

  const pendingPlayerIds = new Set((myClaims || []).map((c) => c.player_id));
  const claimByPlayer = new Map((myClaims || []).map((c) => [c.player_id, c]));

  // Process waivers state
  const [processing, setProcessing] = useState(false);
  const [processMsg, setProcessMsg] = useState('');

  async function handleClaim(playerId: string) {
    setClaimingId(playerId);
    setErr('');
    setSuccessMsg('');
    try {
      await leaguesApi.waiverClaim(id, playerId);
      setSuccessMsg('Waiver claim submitted');
      mutateClaims();
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setClaimingId('');
    }
  }

  async function handleCancelClaim(claimId: string) {
    setErr('');
    try {
      await leaguesApi.waiverCancel(id, claimId);
      mutateClaims();
      mutatePlayers();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function handleProcess() {
    setProcessing(true);
    setProcessMsg('');
    setErr('');
    try {
      const result = await leaguesApi.waiverProcess(id);
      setProcessMsg(result.message);
      mutateClaims();
      mutatePlayers();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-white font-black text-lg">
          {isInSeason ? 'Waiver Wire' : 'Free Agents'}
        </h2>
        {isCommissioner && isInSeason && (allPending?.length ?? 0) > 0 && (
          <button onClick={handleProcess} disabled={processing} className="btn-gold text-sm py-2 px-4">
            {processing ? 'Processing...' : `Process Waivers (${allPending?.length} pending)`}
          </button>
        )}
      </div>

      {!myTeam ? (
        <div className="card text-center text-white/30 py-12 text-sm">
          You need a team in this league to view and claim players.
        </div>
      ) : (
        <>
          {/* My pending claims */}
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
                  <button onClick={() => handleCancelClaim(c.id)} className="text-red-400/60 hover:text-red-400 text-xs transition-colors">
                    Cancel
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Filters */}
          <div className="flex gap-3 flex-wrap">
            <input
              type="text"
              placeholder="Search players..."
              className="input-dark py-2 text-sm flex-1 min-w-[200px]"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="flex gap-1">
              {POSITIONS.map((pos) => (
                <button
                  key={pos || 'all'}
                  onClick={() => setPosition(pos)}
                  className={`px-3 py-2 text-xs font-bold rounded transition-colors ${
                    position === pos
                      ? 'bg-gold/20 text-gold border border-gold/30'
                      : 'bg-white/5 text-white/40 border border-white/10 hover:text-white/70'
                  }`}
                >
                  {pos || 'ALL'}
                </button>
              ))}
            </div>
          </div>

          {err && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">{err}</div>}
          {successMsg && <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-green-400 text-sm">{successMsg}</div>}
          {processMsg && <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-green-400 text-sm">{processMsg}</div>}

          {/* Player list */}
          <div className="card overflow-hidden p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">Player</th>
                  <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3 hidden sm:table-cell">Team</th>
                  <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3 hidden sm:table-cell">Status</th>
                  <th className="text-right text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3 w-32"></th>
                </tr>
              </thead>
              <tbody>
                {players?.map((p: AvailablePlayer) => {
                  const isPending = pendingPlayerIds.has(p.id);
                  const claim = claimByPlayer.get(p.id);
                  return (
                    <tr key={p.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold ${posColors[p.position] || 'text-white/40'}`}>{p.position}</span>
                          <span className="text-white text-sm font-semibold">{p.full_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className="text-white/40 text-sm">{p.nfl_team || '—'}</span>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className={`text-xs ${p.injury_status ? 'text-red-400 font-bold' : 'text-white/30'}`}>
                          {p.injury_status || p.status || 'Active'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isPending ? (
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-gold text-xs font-semibold">Pending</span>
                            <button
                              onClick={() => claim && handleCancelClaim(claim.id)}
                              className="text-red-400/50 hover:text-red-400 text-xs"
                            >
                              ✕
                            </button>
                          </div>
                        ) : isInSeason ? (
                          <button
                            onClick={() => handleClaim(p.id)}
                            disabled={claimingId === p.id}
                            className="btn-outline-gold text-xs py-1 px-3"
                          >
                            {claimingId === p.id ? '...' : 'Claim'}
                          </button>
                        ) : (
                          <button
                            onClick={() => handleClaim(p.id)}
                            disabled={claimingId === p.id}
                            className="btn-gold text-xs py-1 px-3"
                          >
                            {claimingId === p.id ? '...' : '+ Add'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {players?.length === 0 && (
                  <tr><td colSpan={4} className="text-center text-white/30 py-8 text-sm">No free agents found.</td></tr>
                )}
                {!players && (
                  <tr><td colSpan={4} className="text-center text-white/30 py-8 text-sm">Loading players...</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
