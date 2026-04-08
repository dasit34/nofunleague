'use client';
import { use, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { leagues as leaguesApi, teams as teamsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { League, Team, Matchup, AvailablePlayer } from '@/types';

type LeagueData = League & { teams: Team[] };

export default function CorrectionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuthStore();

  const { data: league, mutate: mutateLeague } = useSWR(
    `/leagues/${id}`,
    () => leaguesApi.get(id) as Promise<LeagueData>
  );

  if (!league) return null;
  const isCommissioner = league.commissioner_id === user?.id;
  if (!isCommissioner) {
    return <div className="p-6"><div className="card text-center py-12 text-white/40 text-sm">Commissioner access required.</div></div>;
  }

  const teams = league.teams || [];

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <Link href={`/dashboard/leagues/${id}/league/manager-tools`} className="text-white/30 text-xs hover:text-gold transition-colors">
          &larr; League Manager
        </Link>
        <h2 className="text-white font-black text-lg mt-1">Commissioner Corrections</h2>
        <p className="text-white/30 text-xs mt-1">Tools to fix roster issues, transfer players, and correct scores.</p>
      </div>

      <TransferPlayer leagueId={id} teams={teams} onDone={mutateLeague} />
      <AddPlayer leagueId={id} teams={teams} onDone={mutateLeague} />
      <RemovePlayer leagueId={id} teams={teams} onDone={mutateLeague} />
      <EditScore leagueId={id} currentWeek={league.week} onDone={mutateLeague} />
    </div>
  );
}

// =============================================
// Transfer Player Between Teams
// =============================================

function TransferPlayer({ leagueId, teams, onDone }: { leagueId: string; teams: Team[]; onDone: () => void }) {
  const [fromTeamId, setFromTeamId] = useState('');
  const [toTeamId, setToTeamId] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // Fetch roster for source team
  const { data: fromTeamData } = useSWR(
    fromTeamId ? `/teams/${fromTeamId}` : null,
    () => teamsApi.get(fromTeamId) as Promise<{ roster: { id: string; full_name: string; position: string }[] }>
  );
  const roster = fromTeamData?.roster || [];

  async function handleTransfer() {
    if (!fromTeamId || !toTeamId || !playerId) { setErr('Select all fields.'); return; }
    if (fromTeamId === toTeamId) { setErr('Source and destination must be different.'); return; }
    setLoading(true); setMsg(''); setErr('');
    try {
      const result = await leaguesApi.commissionerTransfer(leagueId, { player_id: playerId, from_team_id: fromTeamId, to_team_id: toTeamId });
      setMsg(result.message);
      setPlayerId('');
      onDone();
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }

  return (
    <div className="card space-y-4">
      <h3 className="text-white font-semibold text-sm">Transfer Player Between Teams</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-white/40 text-xs block mb-1">From Team</label>
          <select className="input-dark text-sm w-full" value={fromTeamId} onChange={e => { setFromTeamId(e.target.value); setPlayerId(''); }}>
            <option value="">Select team...</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-white/40 text-xs block mb-1">Player</label>
          <select className="input-dark text-sm w-full" value={playerId} onChange={e => setPlayerId(e.target.value)} disabled={!fromTeamId}>
            <option value="">Select player...</option>
            {roster.map((p: { id: string; full_name: string; position: string }) => (
              <option key={p.id} value={p.id}>{p.position} - {p.full_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-white/40 text-xs block mb-1">To Team</label>
          <select className="input-dark text-sm w-full" value={toTeamId} onChange={e => setToTeamId(e.target.value)}>
            <option value="">Select team...</option>
            {teams.filter(t => t.id !== fromTeamId).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={handleTransfer} disabled={loading || !fromTeamId || !toTeamId || !playerId}
          className="btn-gold text-sm py-2 px-4 disabled:opacity-30 disabled:cursor-not-allowed">
          {loading ? 'Transferring...' : 'Transfer Player'}
        </button>
        {msg && <span className="text-green-400 text-sm">{msg}</span>}
        {err && <span className="text-red-400 text-sm">{err}</span>}
      </div>
    </div>
  );
}

// =============================================
// Add Player to Team
// =============================================

function AddPlayer({ leagueId, teams, onDone }: { leagueId: string; teams: Team[]; onDone: () => void }) {
  const [teamId, setTeamId] = useState('');
  const [search, setSearch] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // Fetch available players (free agents)
  const { data: available = [] } = useSWR(
    teamId && search.length >= 2 ? `/teams/${teamId}/available?search=${search}` : null,
    () => teamsApi.available(teamId, { search, limit: 20 }) as Promise<AvailablePlayer[]>
  );

  async function handleAdd() {
    if (!teamId || !playerId) { setErr('Select a team and player.'); return; }
    setLoading(true); setMsg(''); setErr('');
    try {
      const result = await leaguesApi.commissionerRosterAction(leagueId, { team_id: teamId, action: 'add', player_id: playerId });
      setMsg(result.message);
      setPlayerId('');
      setSearch('');
      onDone();
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }

  return (
    <div className="card space-y-4">
      <h3 className="text-white font-semibold text-sm">Add Player to Team</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-white/40 text-xs block mb-1">Team</label>
          <select className="input-dark text-sm w-full" value={teamId} onChange={e => setTeamId(e.target.value)}>
            <option value="">Select team...</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-white/40 text-xs block mb-1">Search Player</label>
          <input type="text" className="input-dark text-sm w-full" placeholder="Type name (min 2 chars)..."
            value={search} onChange={e => { setSearch(e.target.value); setPlayerId(''); }} disabled={!teamId} />
        </div>
        <div>
          <label className="text-white/40 text-xs block mb-1">Player</label>
          <select className="input-dark text-sm w-full" value={playerId} onChange={e => setPlayerId(e.target.value)}
            disabled={available.length === 0}>
            <option value="">Select player...</option>
            {available.map(p => <option key={p.id} value={p.id}>{p.position} - {p.full_name} ({p.nfl_team})</option>)}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={handleAdd} disabled={loading || !teamId || !playerId}
          className="btn-gold text-sm py-2 px-4 disabled:opacity-30 disabled:cursor-not-allowed">
          {loading ? 'Adding...' : 'Add Player'}
        </button>
        {msg && <span className="text-green-400 text-sm">{msg}</span>}
        {err && <span className="text-red-400 text-sm">{err}</span>}
      </div>
    </div>
  );
}

// =============================================
// Remove Player from Team
// =============================================

function RemovePlayer({ leagueId, teams, onDone }: { leagueId: string; teams: Team[]; onDone: () => void }) {
  const [teamId, setTeamId] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const { data: teamData } = useSWR(
    teamId ? `/teams/${teamId}-drop` : null,
    () => teamsApi.get(teamId) as Promise<{ roster: { id: string; full_name: string; position: string; roster_slot: string | null }[] }>
  );
  const roster = teamData?.roster || [];

  async function handleDrop() {
    if (!teamId || !playerId) { setErr('Select a team and player.'); return; }
    setLoading(true); setMsg(''); setErr('');
    try {
      const result = await leaguesApi.commissionerRosterAction(leagueId, { team_id: teamId, action: 'drop', player_id: playerId });
      setMsg(result.message);
      setPlayerId('');
      onDone();
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }

  return (
    <div className="card space-y-4">
      <h3 className="text-white font-semibold text-sm">Remove Player from Team</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-white/40 text-xs block mb-1">Team</label>
          <select className="input-dark text-sm w-full" value={teamId} onChange={e => { setTeamId(e.target.value); setPlayerId(''); }}>
            <option value="">Select team...</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-white/40 text-xs block mb-1">Player</label>
          <select className="input-dark text-sm w-full" value={playerId} onChange={e => setPlayerId(e.target.value)} disabled={!teamId}>
            <option value="">Select player...</option>
            {roster.map((p: { id: string; full_name: string; position: string; roster_slot: string | null }) => (
              <option key={p.id} value={p.id}>{p.position} - {p.full_name}{p.roster_slot ? ` (${p.roster_slot})` : ''}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={handleDrop} disabled={loading || !teamId || !playerId}
          className="border border-red-500/30 text-red-400 hover:bg-red-500/10 rounded-lg text-sm py-2 px-4 font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
          {loading ? 'Removing...' : 'Remove Player'}
        </button>
        {msg && <span className="text-green-400 text-sm">{msg}</span>}
        {err && <span className="text-red-400 text-sm">{err}</span>}
      </div>
    </div>
  );
}

// =============================================
// Edit Matchup Score
// =============================================

function EditScore({ leagueId, currentWeek, onDone }: { leagueId: string; currentWeek: number; onDone: () => void }) {
  const [week, setWeek] = useState(Math.max(1, currentWeek - 1));
  const [matchupId, setMatchupId] = useState('');
  const [homeScore, setHomeScore] = useState('');
  const [awayScore, setAwayScore] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const { data: matchups = [] } = useSWR(
    `/leagues/${leagueId}/matchups/${week}-edit`,
    () => leaguesApi.getMatchups(leagueId, week) as Promise<Matchup[]>
  );

  const selectedMatchup = matchups.find(m => m.id === matchupId);

  function selectMatchup(id: string) {
    setMatchupId(id);
    const m = matchups.find(m => m.id === id);
    if (m) {
      setHomeScore(String(Number(m.home_score) || 0));
      setAwayScore(String(Number(m.away_score) || 0));
    }
  }

  async function handleEdit() {
    if (!matchupId) { setErr('Select a matchup.'); return; }
    const h = parseFloat(homeScore);
    const a = parseFloat(awayScore);
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0) { setErr('Scores must be non-negative numbers.'); return; }

    setLoading(true); setMsg(''); setErr('');
    try {
      const result = await leaguesApi.commissionerEditScore(leagueId, matchupId, { home_score: h, away_score: a });
      setMsg(`${result.message}${result.standings_corrected ? ' Standings updated.' : ''}`);
      onDone();
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }

  return (
    <div className="card space-y-4">
      <h3 className="text-white font-semibold text-sm">Edit Matchup Score</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-white/40 text-xs block mb-1">Week</label>
          <select className="input-dark text-sm w-full" value={week}
            onChange={e => { setWeek(parseInt(e.target.value)); setMatchupId(''); }}>
            {Array.from({ length: Math.max(currentWeek, 1) }, (_, i) => i + 1).map(w => (
              <option key={w} value={w}>Week {w}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-white/40 text-xs block mb-1">Matchup</label>
          <select className="input-dark text-sm w-full" value={matchupId}
            onChange={e => selectMatchup(e.target.value)}>
            <option value="">Select matchup...</option>
            {matchups.map(m => (
              <option key={m.id} value={m.id}>
                {m.home_team_name || 'Home'} vs {m.away_team_name || 'Away'}
                {m.is_complete ? ` (${Number(m.home_score).toFixed(1)}-${Number(m.away_score).toFixed(1)})` : ' (not scored)'}
                {m.is_playoffs ? ' [Playoff]' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selectedMatchup && (
        <div className="bg-white/5 rounded-lg p-4 space-y-3">
          <p className="text-white/60 text-xs">
            {selectedMatchup.home_team_name} vs {selectedMatchup.away_team_name}
            {selectedMatchup.is_playoffs && <span className="text-purple-400 ml-2">[Playoff]</span>}
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-white/40 text-xs block mb-1">{selectedMatchup.home_team_name || 'Home'} Score</label>
              <input type="number" step="0.1" min="0" className="input-dark text-sm w-full"
                value={homeScore} onChange={e => setHomeScore(e.target.value)} />
            </div>
            <div>
              <label className="text-white/40 text-xs block mb-1">{selectedMatchup.away_team_name || 'Away'} Score</label>
              <input type="number" step="0.1" min="0" className="input-dark text-sm w-full"
                value={awayScore} onChange={e => setAwayScore(e.target.value)} />
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={handleEdit} disabled={loading || !matchupId}
          className="btn-gold text-sm py-2 px-4 disabled:opacity-30 disabled:cursor-not-allowed">
          {loading ? 'Saving...' : 'Update Score'}
        </button>
        {msg && <span className="text-green-400 text-sm">{msg}</span>}
        {err && <span className="text-red-400 text-sm">{err}</span>}
      </div>
    </div>
  );
}
