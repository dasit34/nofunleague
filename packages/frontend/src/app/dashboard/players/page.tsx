'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { players as playersApi } from '@/lib/api';
import TopBar from '@/components/layout/TopBar';
import type { Player } from '@/types';

const POSITIONS = ['', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

const INJURY_COLORS: Record<string, string> = {
  Q: 'text-yellow-400',
  D: 'text-orange-400',
  O: 'text-red-400',
  IR: 'text-red-600',
};

export default function PlayersPage() {
  const [position, setPosition] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const { data: players, isLoading } = useSWR(
    `/players?pos=${position}&q=${search}`,
    () => playersApi.list({ position: position || undefined, search: search || undefined, limit: 100 }) as Promise<Player[]>
  );

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
  }

  return (
    <div>
      <TopBar title="NFL Players" subtitle="Sleeper-powered player database" />

      <div className="p-6 space-y-4">
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
          <div className="flex gap-2">
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

        {/* Player List */}
        <div className="card overflow-hidden p-0">
          {isLoading ? (
            <div className="text-center text-white/40 py-12">Loading players...</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">Player</th>
                  <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">Pos</th>
                  <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">Team</th>
                  <th className="text-left text-white/40 text-xs font-semibold uppercase tracking-wider px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {players?.map((p) => (
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
                  </tr>
                ))}
                {!isLoading && (!players || players.length === 0) && (
                  <tr>
                    <td colSpan={4} className="text-center text-white/30 py-8 text-sm">
                      No players found. Sync players from Sleeper first.
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
