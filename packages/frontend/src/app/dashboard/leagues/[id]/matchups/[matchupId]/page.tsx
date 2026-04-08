'use client';
import { use, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { leagues as leaguesApi, teams as teamsApi } from '@/lib/api';
import type { League, Team, Matchup, RosterPlayer, RosterSettings } from '@/types';
import { getRosterFromSettings } from '@/types';

type TeamWithRoster = Team & { roster: RosterPlayer[] };

interface PlayerScoreData {
  playerId: string;
  points: number;
  isStarter: boolean;
  statBreakdown: Record<string, number>;
}

interface TeamScoreData {
  total: number;
  players: PlayerScoreData[];
}

// ─── Build position rows from roster settings ───────────────────────────────

interface SlotRow { label: string; posMatch: string }

function buildStarterRows(r: RosterSettings): SlotRow[] {
  const rows: SlotRow[] = [];
  for (let i = 0; i < r.qb_slots; i++)   rows.push({ label: 'QB', posMatch: 'QB' });
  for (let i = 0; i < r.rb_slots; i++)   rows.push({ label: 'RB', posMatch: 'RB' });
  for (let i = 0; i < r.wr_slots; i++)   rows.push({ label: 'WR', posMatch: 'WR' });
  for (let i = 0; i < r.te_slots; i++)   rows.push({ label: 'TE', posMatch: 'TE' });
  for (let i = 0; i < r.flex_slots; i++) rows.push({ label: 'FLEX', posMatch: 'FLEX' });
  if (r.superflex_slots) for (let i = 0; i < r.superflex_slots; i++) rows.push({ label: 'SF', posMatch: 'SUPERFLEX' });
  for (let i = 0; i < r.def_slots; i++)  rows.push({ label: 'D/ST', posMatch: 'DEF' });
  for (let i = 0; i < r.k_slots; i++)    rows.push({ label: 'K', posMatch: 'K' });
  return rows;
}

function matchStartersToSlots(
  roster: RosterPlayer[],
  rows: SlotRow[],
  scoreMap: Map<string, PlayerScoreData>,
): { player: RosterPlayer | null; score: PlayerScoreData | null }[] {
  const starters = roster.filter(p => p.is_starter);
  const pool = starters.length > 0 ? starters : roster;
  const used = new Set<string>();

  return rows.map((row) => {
    const posMap: Record<string, string> = { 'D/ST': 'DEF', 'SF': 'SUPERFLEX' };
    const pos = posMap[row.label] || row.label;

    for (const p of pool) {
      if (used.has(p.id)) continue;
      const slotBase = (p.roster_slot || '').replace(/\d+$/, '');
      if (slotBase === pos || (pos === 'FLEX' && slotBase === 'FLEX') || (pos === 'SUPERFLEX' && slotBase === 'SUPERFLEX')) {
        used.add(p.id);
        return { player: p, score: scoreMap.get(p.id) ?? null };
      }
      // Fallback: match by position
      const flexPositions = ['RB', 'WR', 'TE'];
      if (starters.length === 0 && (p.position === pos || (pos === 'FLEX' && flexPositions.includes(p.position)))) {
        used.add(p.id);
        return { player: p, score: scoreMap.get(p.id) ?? null };
      }
    }
    return { player: null, score: null };
  });
}

const POS_COLORS: Record<string, string> = {
  QB: 'text-red-400', RB: 'text-green-400', WR: 'text-blue-400',
  TE: 'text-orange-400', FLEX: 'text-purple-400', SF: 'text-purple-400',
  'D/ST': 'text-yellow-400', K: 'text-cyan-400',
};

const STAT_LABELS: Record<string, string> = {
  pass_yd: 'Pass Yds', pass_td: 'Pass TD', pass_int: 'INT', pass_2pt: 'Pass 2PT',
  rush_yd: 'Rush Yds', rush_td: 'Rush TD', rush_2pt: 'Rush 2PT',
  rec: 'Rec', rec_yd: 'Rec Yds', rec_td: 'Rec TD', rec_2pt: 'Rec 2PT',
  fum_lost: 'Fum Lost',
  fg_0_19: 'FG 0-19', fg_20_29: 'FG 20-29', fg_30_39: 'FG 30-39', fg_40_49: 'FG 40-49', fg_50p: 'FG 50+',
  xpt: 'XP', xpt_miss: 'XP Miss',
  def_sack: 'Sack', def_int: 'DEF INT', def_fum_rec: 'Fum Rec', def_td: 'DEF TD',
  def_st_td: 'ST TD', def_safe: 'Safety', def_blk_kick: 'Blk Kick',
  mock: 'Mock',
};

// ─── Page ───────────────────────────────────────────────────────────────────

export default function MatchupDetailPage({ params }: { params: Promise<{ id: string; matchupId: string }> }) {
  const { id: leagueId, matchupId } = use(params);

  const { data: league } = useSWR(`/leagues/${leagueId}`, () => leaguesApi.get(leagueId) as Promise<League & { teams: Team[] }>);

  // Fetch matchup with per-player score breakdowns
  const { data: matchupData } = useSWR(
    league ? `matchup-scores-${matchupId}` : null,
    () => leaguesApi.getMatchupScores(leagueId, matchupId)
  );

  const matchup = matchupData?.matchup as Matchup | undefined;
  const homeScoreData = matchupData?.home as TeamScoreData | null;
  const awayScoreData = matchupData?.away as TeamScoreData | null;

  // Build score maps for quick lookup
  const homeScoreMap = new Map<string, PlayerScoreData>();
  const awayScoreMap = new Map<string, PlayerScoreData>();
  if (homeScoreData) for (const p of homeScoreData.players) homeScoreMap.set(p.playerId, p);
  if (awayScoreData) for (const p of awayScoreData.players) awayScoreMap.set(p.playerId, p);

  const week = matchup?.week ?? 0;

  // Fetch rosters
  const { data: homeTeam } = useSWR(matchup ? `/teams/${matchup.home_team_id}` : null,
    () => teamsApi.get(matchup!.home_team_id) as Promise<TeamWithRoster>);
  const { data: awayTeam } = useSWR(matchup ? `/teams/${matchup.away_team_id}` : null,
    () => teamsApi.get(matchup!.away_team_id) as Promise<TeamWithRoster>);

  const homeName = matchup?.home_team_name || homeTeam?.name || 'Home Team';
  const awayName = matchup?.away_team_name || awayTeam?.name || 'Away Team';
  const isComplete = matchup?.is_complete ?? false;
  const homeScore = isComplete ? Number(matchup!.home_score).toFixed(1) : '—';
  const awayScore = isComplete ? Number(matchup!.away_score).toFixed(1) : '—';
  const homeWon = isComplete && matchup!.winner_team_id === matchup!.home_team_id;
  const awayWon = isComplete && matchup!.winner_team_id === matchup!.away_team_id;

  const rosterSettings = league ? getRosterFromSettings(league.settings) : null;
  const starterRows = rosterSettings ? buildStarterRows(rosterSettings) : [
    { label: 'QB', posMatch: 'QB' }, { label: 'RB', posMatch: 'RB' }, { label: 'RB', posMatch: 'RB' },
    { label: 'WR', posMatch: 'WR' }, { label: 'WR', posMatch: 'WR' }, { label: 'TE', posMatch: 'TE' },
    { label: 'FLEX', posMatch: 'FLEX' },
  ];

  const homeRoster = homeTeam?.roster || [];
  const awayRoster = awayTeam?.roster || [];
  const homeStarters = matchStartersToSlots(homeRoster, starterRows, homeScoreMap);
  const awayStarters = matchStartersToSlots(awayRoster, starterRows, awayScoreMap);
  const homeBench = homeRoster.filter(p => !p.is_starter);
  const awayBench = awayRoster.filter(p => !p.is_starter);

  if (!matchup) {
    return (
      <div className="p-6 space-y-4">
        <Link href={`/dashboard/leagues/${leagueId}/matchups`} className="text-white/30 text-xs hover:text-gold transition-colors">&larr; Back to Matchups</Link>
        <div className="card text-center py-12 text-white/40 text-sm">Loading matchup...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <Link href={`/dashboard/leagues/${leagueId}/matchups`} className="text-white/30 text-xs hover:text-gold transition-colors">
        &larr; Back to Matchups
      </Link>

      {/* Scoreboard Header */}
      <div className="card">
        <p className="text-center text-white/30 text-xs uppercase tracking-wider mb-3">
          Week {week} {isComplete ? '— Final' : ''} {matchup.is_playoffs ? '— Playoffs' : ''}
        </p>
        <div className="flex items-center justify-center gap-4 sm:gap-8">
          <div className="flex-1 text-right">
            <p className={`text-base sm:text-lg font-black truncate ${homeWon ? 'text-gold' : 'text-white'}`}>{homeName}</p>
            <p className="text-white/20 text-xs font-mono">{homeTeam ? `${homeTeam.wins}-${homeTeam.losses}` : ''}</p>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <span className={`text-2xl sm:text-3xl font-black font-mono ${homeWon ? 'text-gold' : 'text-white/50'}`}>{homeScore}</span>
            <span className="text-white/15 text-sm">vs</span>
            <span className={`text-2xl sm:text-3xl font-black font-mono ${awayWon ? 'text-gold' : 'text-white/50'}`}>{awayScore}</span>
          </div>
          <div className="flex-1">
            <p className={`text-base sm:text-lg font-black truncate ${awayWon ? 'text-gold' : 'text-white'}`}>{awayName}</p>
            <p className="text-white/20 text-xs font-mono">{awayTeam ? `${awayTeam.wins}-${awayTeam.losses}` : ''}</p>
          </div>
        </div>
        <div className="flex justify-center gap-2 mt-3">
          {matchup.is_playoffs && <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30 font-bold">Playoffs</span>}
          {matchup.scoring_source && <span className={`text-xs px-2 py-0.5 rounded ${matchup.scoring_source === 'real' ? 'bg-green-500/10 text-green-400/60' : 'bg-yellow-500/10 text-yellow-400/60'}`}>{matchup.scoring_source === 'real' ? 'real stats' : matchup.scoring_source}</span>}
        </div>
      </div>

      {/* Not scored state */}
      {!isComplete && !homeScoreData && (
        <div className="card text-center py-8">
          <p className="text-white/30 text-sm">Week not simulated yet. Scores will appear after the commissioner scores this week.</p>
        </div>
      )}

      {/* Starter Grid with scores */}
      <div className="card overflow-hidden p-0">
        <div className="grid grid-cols-[1fr_auto_1fr] border-b border-white/10">
          <div className="px-4 py-2 text-right"><span className="text-white/30 text-xs font-semibold uppercase tracking-wider">{homeName}</span></div>
          <div className="px-3 py-2 text-center border-x border-white/5 w-14"><span className="text-white/30 text-xs uppercase">Pos</span></div>
          <div className="px-4 py-2"><span className="text-white/30 text-xs font-semibold uppercase tracking-wider">{awayName}</span></div>
        </div>

        {starterRows.map((row, i) => {
          const hs = homeStarters[i];
          const as_ = awayStarters[i];
          return (
            <div key={i} className="grid grid-cols-[1fr_auto_1fr] border-b border-white/5 hover:bg-white/[0.02] transition-colors">
              <PlayerScoreCell player={hs.player} score={hs.score} side="home" />
              <div className="px-3 py-3 text-center border-x border-white/5 w-14 flex items-center justify-center">
                <span className={`text-xs font-bold ${POS_COLORS[row.label] || 'text-white/30'}`}>{row.label}</span>
              </div>
              <PlayerScoreCell player={as_.player} score={as_.score} side="away" />
            </div>
          );
        })}

        {/* Totals row */}
        <div className="grid grid-cols-[1fr_auto_1fr] border-t border-white/10 bg-white/[0.03]">
          <div className="px-4 py-3 text-right">
            <span className={`text-lg font-black font-mono ${homeWon ? 'text-gold' : 'text-white'}`}>{homeScore}</span>
          </div>
          <div className="px-3 py-3 text-center border-x border-white/5 w-14">
            <span className="text-white/30 text-xs font-bold">TOT</span>
          </div>
          <div className="px-4 py-3">
            <span className={`text-lg font-black font-mono ${awayWon ? 'text-gold' : 'text-white'}`}>{awayScore}</span>
          </div>
        </div>
      </div>

      {/* Bench */}
      <div className="grid grid-cols-2 gap-4">
        <BenchColumn label={`${homeName} Bench`} players={homeBench} scoreMap={homeScoreMap} />
        <BenchColumn label={`${awayName} Bench`} players={awayBench} scoreMap={awayScoreMap} />
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function PlayerScoreCell({ player, score, side }: { player: RosterPlayer | null; score: PlayerScoreData | null; side: 'home' | 'away' }) {
  const [expanded, setExpanded] = useState(false);
  const isHome = side === 'home';
  const pts = score ? score.points.toFixed(1) : '—';
  const hasBreakdown = score && Object.keys(score.statBreakdown).length > 0 && !score.statBreakdown.mock;

  if (!player) {
    return (
      <div className={`px-4 py-3 flex items-center ${isHome ? 'justify-end' : ''}`}>
        <span className="text-white/10 text-sm italic">Empty</span>
      </div>
    );
  }

  return (
    <div className={`px-4 py-3 ${isHome ? 'text-right' : ''}`}>
      <div
        className={`flex items-center gap-2 ${isHome ? 'justify-end' : ''} ${hasBreakdown ? 'cursor-pointer' : ''}`}
        onClick={() => hasBreakdown && setExpanded(!expanded)}
      >
        {isHome && <span className={`font-mono text-xs font-bold ${score && score.points > 0 ? 'text-gold' : 'text-white/20'}`}>{pts}</span>}
        <div className={isHome ? 'text-right' : ''}>
          <p className="text-white text-sm font-semibold">{player.full_name}</p>
          <p className="text-white/20 text-xs">{player.nfl_team || '—'}</p>
        </div>
        {!isHome && <span className={`font-mono text-xs font-bold ${score && score.points > 0 ? 'text-gold' : 'text-white/20'}`}>{pts}</span>}
      </div>
      {expanded && hasBreakdown && score && (
        <div className={`mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] ${isHome ? 'justify-end' : ''}`}>
          {Object.entries(score.statBreakdown)
            .filter(([, v]) => v !== 0)
            .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
            .map(([key, val]) => (
              <span key={key} className={val > 0 ? 'text-green-400/60' : 'text-red-400/60'}>
                {STAT_LABELS[key] || key}: {val > 0 ? '+' : ''}{val.toFixed(1)}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

function BenchColumn({ label, players, scoreMap }: { label: string; players: RosterPlayer[]; scoreMap: Map<string, PlayerScoreData> }) {
  const POS_COLORS_BENCH: Record<string, string> = {
    QB: 'text-red-400', RB: 'text-green-400', WR: 'text-blue-400',
    TE: 'text-orange-400', K: 'text-cyan-400', DEF: 'text-yellow-400',
  };

  if (players.length === 0) return null;

  return (
    <div>
      <h3 className="text-white/30 text-xs font-semibold uppercase tracking-wider mb-2">{label}</h3>
      <div className="card overflow-hidden p-0">
        {players.map((p) => {
          const score = scoreMap.get(p.id);
          return (
            <div key={p.id} className="px-4 py-2 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold ${POS_COLORS_BENCH[p.position] || 'text-white/20'}`}>{p.position}</span>
                <span className="text-white/50 text-sm">{p.full_name}</span>
              </div>
              <span className="text-white/20 font-mono text-xs">{score ? score.points.toFixed(1) : 'BE'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
