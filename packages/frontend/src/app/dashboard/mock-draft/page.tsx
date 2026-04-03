'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useAuthStore, useLeagueStore } from '@/lib/store';
import type { League } from '@/types';

interface PickEntry {
  pick: number;
  round: number;
  team: string;
  player: string;
  position: string;
}

interface RosterCount {
  team_name: string;
  player_count: number;
}

interface MockDraftResult {
  league_id: string;
  league_name: string;
  teams: number;
  rounds: number;
  picks_made: number;
  my_team_name: string | null;
  roster_counts: RosterCount[];
  pick_log: PickEntry[];
}

export default function MockDraftPage() {
  const { user }        = useAuthStore();
  const setActiveLeague = useLeagueStore((s) => s.setActiveLeague);

  const [result, setResult]     = useState<MockDraftResult | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg]   = useState('');

  async function resetDevData() {
    setResetting(true);
    setResetMsg('');
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/admin/reset-dev', {
        method: 'POST',
        headers: { 'X-Admin-Secret': 'nfl-admin-dev-2026' },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setResetMsg(`Cleared: ${body.mock_users_deleted} mock users, ${body.orphaned_leagues_deleted} orphaned leagues.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResetting(false);
    }
  }

  async function runMockDraft() {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/admin/mock-draft', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Secret': 'nfl-admin-dev-2026',
        },
        body: JSON.stringify({
          teams: 4,
          rounds: 5,
          commissioner_user_id: user?.id,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data: MockDraftResult = await res.json();
      setResult(data);
      setActiveLeague({ id: data.league_id, name: data.league_name } as League);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const byRound: Record<number, PickEntry[]> = {};
  if (result) {
    for (const p of result.pick_log) {
      (byRound[p.round] ??= []).push(p);
    }
  }

  const myTeamName = result?.my_team_name ?? null;

  return (
    <div style={{ padding: '24px', fontFamily: 'monospace' }}>
      <h1>Mock Draft</h1>
      <p style={{ color: '#888', fontSize: '13px', marginBottom: '16px' }}>
        Creates a 4-team/5-round league where <strong>you</strong> are team 1 (commissioner).
        Sets it as your active league so all dashboard pages work immediately.
      </p>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
        <button
          onClick={runMockDraft}
          disabled={loading || !user}
          style={{ padding: '8px 16px', cursor: (loading || !user) ? 'default' : 'pointer' }}
        >
          {loading ? 'Running…' : 'Run Mock Draft'}
        </button>
        <button
          onClick={resetDevData}
          disabled={resetting}
          style={{ padding: '8px 16px', cursor: resetting ? 'default' : 'pointer', opacity: 0.7 }}
          title="Deletes all @mock.invalid users and their data. Keeps demo users."
        >
          {resetting ? 'Resetting…' : 'Reset Mock Data'}
        </button>
      </div>
      {!user && <p style={{ color: '#f0b429', fontSize: '12px' }}>Not logged in — sign in first.</p>}

      {resetMsg && <p style={{ color: '#4ade80', fontSize: '12px', marginBottom: '8px' }}>{resetMsg}</p>}
      {error && <p style={{ color: 'red', marginTop: '8px' }}>{error}</p>}

      {result && (
        <div>
          {/* Summary */}
          <p style={{ marginTop: '16px' }}>
            <strong>{result.league_name}</strong>
            {' '}| {result.teams} teams | {result.rounds} rounds | {result.picks_made} picks
          </p>
          <p style={{ fontSize: '12px', color: '#888' }}>league_id: {result.league_id}</p>
          {myTeamName && (
            <p style={{ fontSize: '12px', color: '#f0b429' }}>Your team: {myTeamName}</p>
          )}

          {/* Roster verification */}
          {result.roster_counts.length > 0 && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#888' }}>
              Roster assignments:{' '}
              {result.roster_counts.map((r) => (
                <span
                  key={r.team_name}
                  style={{ marginRight: '12px', color: r.team_name === myTeamName ? '#f0b429' : '#888' }}
                >
                  {r.team_name}: {r.player_count} players
                </span>
              ))}
            </div>
          )}

          {/* Nav links */}
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap' }}>
            {[
              { href: '/dashboard/roster',    label: 'My Roster' },
              { href: '/dashboard/standings', label: 'Standings' },
              { href: '/dashboard/matchups',  label: 'Matchups'  },
              { href: `/dashboard/leagues/${result.league_id}`, label: 'League Page' },
            ].map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                style={{
                  background: '#f0b429', color: '#000',
                  padding: '6px 14px', fontWeight: 'bold',
                  textDecoration: 'none', borderRadius: '4px',
                  fontSize: '13px',
                }}
              >
                {label} →
              </Link>
            ))}
          </div>

          {/* Pick log grouped by round */}
          {Object.entries(byRound).map(([round, picks]) => (
            <div key={round} style={{ marginTop: '20px' }}>
              <h3 style={{ marginBottom: '4px' }}>Round {round}</h3>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #444' }}>
                    <th style={{ padding: '4px 8px' }}>#</th>
                    <th style={{ padding: '4px 8px' }}>Team</th>
                    <th style={{ padding: '4px 8px' }}>Player</th>
                    <th style={{ padding: '4px 8px' }}>Pos</th>
                  </tr>
                </thead>
                <tbody>
                  {picks.map((p) => {
                    const isMine = myTeamName ? p.team === myTeamName : false;
                    return (
                      <tr
                        key={p.pick}
                        style={{
                          borderBottom: '1px solid #222',
                          background: isMine ? 'rgba(240,180,41,0.08)' : undefined,
                        }}
                      >
                        <td style={{ padding: '4px 8px', color: '#888' }}>{p.pick}</td>
                        <td style={{ padding: '4px 8px', color: isMine ? '#f0b429' : undefined }}>
                          {p.team}{isMine ? ' ★' : ''}
                        </td>
                        <td style={{ padding: '4px 8px' }}>{p.player}</td>
                        <td style={{ padding: '4px 8px' }}>{p.position}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
