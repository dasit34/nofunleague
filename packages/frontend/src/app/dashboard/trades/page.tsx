'use client';
import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { trades as tradesApi, teams as teamsApi } from '@/lib/api';
import { leagues as leaguesApi } from '@/lib/api';
import { useAuthStore, useLeagueStore } from '@/lib/store';
import TopBar from '@/components/layout/TopBar';
import type { League, Team, RosterPlayer, Trade, TradeItem } from '@/types';
import clsx from 'clsx';

// =============================================
// Status badge
// =============================================
const STATUS_STYLES: Record<string, string> = {
  pending:  'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  accepted: 'bg-blue-500/15  text-blue-400  border-blue-500/30',
  rejected: 'bg-red-500/15   text-red-400   border-red-500/30',
  approved: 'bg-green-500/15 text-green-400 border-green-500/30',
  vetoed:   'bg-red-700/15   text-red-500   border-red-700/30',
};

function StatusBadge({ status }: { status: Trade['status'] }) {
  return (
    <span className={clsx('badge border text-xs capitalize', STATUS_STYLES[status] || 'text-white/40')}>
      {status}
    </span>
  );
}

// =============================================
// Trade card — shows players exchanged
// =============================================
function TradeCard({
  trade,
  myTeamId,
  isCommissioner,
  onRespond,
  onApprove,
}: {
  trade: Trade;
  myTeamId?: string;
  isCommissioner: boolean;
  onRespond?: (id: string, action: 'accept' | 'reject') => void;
  onApprove?: (id: string, action: 'approve' | 'veto') => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const propItems = trade.items.filter((i) => i.from_team_id === trade.proposing_team_id);
  const recvItems = trade.items.filter((i) => i.from_team_id === trade.receiving_team_id);

  const isReceiver   = myTeamId === trade.receiving_team_id;
  const canRespond   = trade.status === 'pending' && isReceiver && !!onRespond;
  const canApprove   = trade.status === 'accepted' && isCommissioner && !!onApprove;

  async function doRespond(action: 'accept' | 'reject') {
    setBusy(true);
    try { onRespond?.(trade.id, action); } finally { setBusy(false); }
  }

  async function doApprove(action: 'approve' | 'veto') {
    setBusy(true);
    try { onApprove?.(trade.id, action); } finally { setBusy(false); }
  }

  return (
    <div className="card space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-white font-bold text-sm">{trade.proposing_team_name}</span>
          <span className="text-white/30 text-xs">→</span>
          <span className="text-white font-bold text-sm">{trade.receiving_team_name}</span>
        </div>
        <StatusBadge status={trade.status} />
      </div>

      {/* Players */}
      <div className="grid grid-cols-2 gap-3">
        <PlayerColumn
          title={`${trade.proposing_team_name} gives`}
          items={propItems}
        />
        <PlayerColumn
          title={`${trade.receiving_team_name} gives`}
          items={recvItems}
        />
      </div>

      {/* Notes */}
      {trade.proposer_note && (
        <p className="text-white/50 text-xs italic border-t border-white/10 pt-3">
          "{trade.proposer_note}"
        </p>
      )}
      {trade.response_note && (
        <p className="text-white/50 text-xs italic">
          Response: "{trade.response_note}"
        </p>
      )}
      {trade.commissioner_note && (
        <p className="text-white/50 text-xs italic">
          Commissioner: "{trade.commissioner_note}"
        </p>
      )}

      <div className="text-white/20 text-xs">
        Proposed {new Date(trade.proposed_at).toLocaleDateString()}
        {trade.responded_at && ` · Responded ${new Date(trade.responded_at).toLocaleDateString()}`}
        {trade.decided_at && ` · Decided ${new Date(trade.decided_at).toLocaleDateString()}`}
      </div>

      {/* Receiver actions */}
      {canRespond && (
        <div className="space-y-2 border-t border-white/10 pt-3">
          <textarea
            className="input-dark resize-none text-sm"
            rows={2}
            placeholder="Optional response note..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              onClick={() => doRespond('accept')}
              disabled={busy}
              className="btn-gold flex-1 text-sm py-2"
            >
              Accept
            </button>
            <button
              onClick={() => doRespond('reject')}
              disabled={busy}
              className="border border-red-500/40 text-red-400 hover:bg-red-500/10 font-semibold px-4 py-2 rounded-lg transition-all text-sm flex-1"
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {/* Commissioner actions */}
      {canApprove && (
        <div className="space-y-2 border-t border-white/10 pt-3">
          <textarea
            className="input-dark resize-none text-sm"
            rows={2}
            placeholder="Commissioner note (optional)..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              onClick={() => doApprove('approve')}
              disabled={busy}
              className="btn-gold flex-1 text-sm py-2"
            >
              ✓ Approve Trade
            </button>
            <button
              onClick={() => doApprove('veto')}
              disabled={busy}
              className="border border-red-500/40 text-red-400 hover:bg-red-500/10 font-semibold px-4 py-2 rounded-lg transition-all text-sm flex-1"
            >
              ✗ Veto Trade
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerColumn({ title, items }: { title: string; items: TradeItem[] }) {
  return (
    <div className="space-y-2">
      <p className="text-white/40 text-xs font-semibold uppercase tracking-wider">{title}</p>
      {items.length === 0 ? (
        <p className="text-white/20 text-xs italic">None</p>
      ) : (
        items.map((item) => (
          <div key={item.id} className="bg-white/5 rounded-lg px-3 py-2">
            <p className="text-white text-sm font-semibold">{item.player_name}</p>
            <p className="text-white/40 text-xs">{item.position} · {item.nfl_team}</p>
          </div>
        ))
      )}
    </div>
  );
}

// =============================================
// Propose Tab
// =============================================
function ProposeTab({
  myTeam,
  leagueTeams,
  leagueId,
  week,
  onSuccess,
}: {
  myTeam: Team;
  leagueTeams: Team[];
  leagueId: string;
  week: number;
  onSuccess: () => void;
}) {
  const [opponentId, setOpponentId] = useState('');
  const [givingIds, setGivingIds] = useState<Set<string>>(new Set());
  const [wantingIds, setWantingIds] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { data: myRosterData } = useSWR(
    `/teams/${myTeam.id}`,
    () => teamsApi.get(myTeam.id) as Promise<Team & { roster: RosterPlayer[] }>
  );

  const { data: oppRosterData } = useSWR(
    opponentId ? `/teams/${opponentId}` : null,
    () => teamsApi.get(opponentId) as Promise<Team & { roster: RosterPlayer[] }>
  );

  const opponents = leagueTeams.filter((t) => t.id !== myTeam.id);
  const myRoster = myRosterData?.roster || [];
  const oppRoster = oppRosterData?.roster || [];

  function toggleGiving(id: string) {
    setGivingIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleWanting(id: string) {
    setWantingIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!opponentId) { setError('Select an opponent team'); return; }
    if (givingIds.size === 0) { setError('Select at least one player to give'); return; }
    if (wantingIds.size === 0) { setError('Select at least one player to receive'); return; }

    setLoading(true);
    try {
      await tradesApi.propose({
        league_id: leagueId,
        proposing_team_id: myTeam.id,
        receiving_team_id: opponentId,
        proposing_player_ids: Array.from(givingIds),
        receiving_player_ids: Array.from(wantingIds),
        proposer_note: note || undefined,
      });
      setGivingIds(new Set());
      setWantingIds(new Set());
      setOpponentId('');
      setNote('');
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Select opponent */}
      <div>
        <label className="text-white/60 text-sm font-semibold mb-1.5 block">Trade with</label>
        <select
          className="input-dark"
          value={opponentId}
          onChange={(e) => { setOpponentId(e.target.value); setWantingIds(new Set()); }}
        >
          <option value="">Select team...</option>
          {opponents.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      {/* Player pickers */}
      <div className="grid grid-cols-2 gap-4">
        {/* My players */}
        <div>
          <label className="text-white/60 text-sm font-semibold mb-1.5 block">
            You give
            {givingIds.size > 0 && (
              <span className="ml-2 text-gold">{givingIds.size} selected</span>
            )}
          </label>
          <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
            {myRoster.length === 0 ? (
              <p className="text-white/30 text-xs py-4 text-center">No players on roster</p>
            ) : (
              myRoster.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggleGiving(p.id)}
                  className={clsx(
                    'w-full text-left px-3 py-2 rounded-lg border text-sm transition-all',
                    givingIds.has(p.id)
                      ? 'border-gold bg-gold/10 text-white'
                      : 'border-white/10 text-white/70 hover:border-white/30'
                  )}
                >
                  <span className="font-semibold">{p.full_name}</span>
                  <span className="text-white/40 text-xs ml-2">{p.position} · {p.nfl_team}</span>
                  {p.injury_status && (
                    <span className="text-yellow-400 text-xs ml-1">[{p.injury_status}]</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Their players */}
        <div>
          <label className="text-white/60 text-sm font-semibold mb-1.5 block">
            You receive
            {wantingIds.size > 0 && (
              <span className="ml-2 text-gold">{wantingIds.size} selected</span>
            )}
          </label>
          <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
            {!opponentId ? (
              <p className="text-white/30 text-xs py-4 text-center">Select a team first</p>
            ) : oppRoster.length === 0 ? (
              <p className="text-white/30 text-xs py-4 text-center">No players on their roster</p>
            ) : (
              oppRoster.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggleWanting(p.id)}
                  className={clsx(
                    'w-full text-left px-3 py-2 rounded-lg border text-sm transition-all',
                    wantingIds.has(p.id)
                      ? 'border-gold bg-gold/10 text-white'
                      : 'border-white/10 text-white/70 hover:border-white/30'
                  )}
                >
                  <span className="font-semibold">{p.full_name}</span>
                  <span className="text-white/40 text-xs ml-2">{p.position} · {p.nfl_team}</span>
                  {p.injury_status && (
                    <span className="text-yellow-400 text-xs ml-1">[{p.injury_status}]</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Summary */}
      {(givingIds.size > 0 || wantingIds.size > 0) && (
        <div className="card-gold text-sm space-y-1">
          {givingIds.size > 0 && (
            <p className="text-white/70">
              <span className="text-white font-semibold">Giving:</span>{' '}
              {myRoster.filter((p) => givingIds.has(p.id)).map((p) => p.full_name).join(', ')}
            </p>
          )}
          {wantingIds.size > 0 && (
            <p className="text-white/70">
              <span className="text-white font-semibold">Receiving:</span>{' '}
              {oppRoster.filter((p) => wantingIds.has(p.id)).map((p) => p.full_name).join(', ')}
            </p>
          )}
        </div>
      )}

      {/* Note */}
      <div>
        <label className="text-white/60 text-sm font-semibold mb-1.5 block">
          Note <span className="font-normal text-white/30">optional</span>
        </label>
        <textarea
          className="input-dark resize-none"
          rows={2}
          placeholder="Add a message to your trade offer..."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
        />
      </div>

      <button
        type="submit"
        disabled={loading || givingIds.size === 0 || wantingIds.size === 0 || !opponentId}
        className="btn-gold w-full"
      >
        {loading ? 'Sending Trade...' : 'Propose Trade'}
      </button>
    </form>
  );
}

// =============================================
// Main Page
// =============================================
type Tab = 'propose' | 'inbox' | 'commissioner' | 'history';

export default function TradesPage() {
  const { user } = useAuthStore();
  const activeLeague = useLeagueStore((s) => s.activeLeague);
  const [tab, setTab] = useState<Tab>('inbox');
  const [successMsg, setSuccessMsg] = useState('');
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<Record<string, string>>({});

  const { data: leagueData } = useSWR(
    activeLeague && user ? `/leagues/${activeLeague.id}/full` : null,
    () => leaguesApi.get(activeLeague!.id) as Promise<League & { teams: Team[] }>
  );

  const myTeam = leagueData?.teams?.find((t) => t.user_id === user?.id);
  const isCommissioner = !!leagueData && leagueData.commissioner_id === user?.id;

  const inboxKey      = activeLeague ? `/trades/inbox/${activeLeague.id}` : null;
  const historyKey    = activeLeague ? `/trades/history/${activeLeague.id}` : null;
  const approvalKey   = activeLeague && isCommissioner ? `/trades/approval/${activeLeague.id}` : null;

  const { data: inboxTrades,    mutate: mutateInbox    } = useSWR(inboxKey,    () => tradesApi.inbox(activeLeague!.id));
  const { data: historyTrades,  mutate: mutateHistory  } = useSWR(historyKey,  () => tradesApi.history(activeLeague!.id));
  const { data: approvalTrades, mutate: mutateApproval } = useSWR(approvalKey, () => tradesApi.pendingApproval(activeLeague!.id));

  function refreshAll() {
    mutateInbox();
    mutateHistory();
    mutateApproval();
  }

  async function handleRespond(tradeId: string, action: 'accept' | 'reject') {
    setActionBusy(tradeId);
    try {
      await tradesApi.respond(tradeId, action, actionNote[tradeId]);
      refreshAll();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setActionBusy(null);
    }
  }

  async function handleApprove(tradeId: string, action: 'approve' | 'veto') {
    setActionBusy(tradeId);
    try {
      await tradesApi.approve(tradeId, action, actionNote[tradeId]);
      refreshAll();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setActionBusy(null);
    }
  }

  const tabs: { id: Tab; label: string; count?: number; hidden?: boolean }[] = [
    { id: 'propose',      label: 'Propose',     hidden: !myTeam },
    { id: 'inbox',        label: 'Inbox',        count: inboxTrades?.length },
    { id: 'commissioner', label: 'Commissioner', count: approvalTrades?.length, hidden: !isCommissioner },
    { id: 'history',      label: 'History' },
  ];

  if (!activeLeague) {
    return (
      <div>
        <TopBar title="Trades" subtitle="Player exchanges" />
        <div className="p-6">
          <div className="card text-center text-white/40 py-12">Select a league to view trades</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <TopBar
        title="Trades"
        subtitle={`${activeLeague.name} · Week ${activeLeague.week}`}
      />

      <div className="p-6 space-y-5">
        {/* Tab bar */}
        <div className="flex gap-1 bg-white/5 rounded-xl p-1 w-fit">
          {tabs.filter((t) => !t.hidden).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={clsx(
                'px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-1.5',
                tab === t.id
                  ? 'bg-gold text-black'
                  : 'text-white/50 hover:text-white'
              )}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className={clsx(
                  'text-xs rounded-full px-1.5 py-0.5 font-bold',
                  tab === t.id ? 'bg-black/20 text-black' : 'bg-gold/20 text-gold'
                )}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {successMsg && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-green-400 text-sm flex items-center justify-between">
            {successMsg}
            <button onClick={() => setSuccessMsg('')} className="text-green-400/60 hover:text-green-400 ml-4">✕</button>
          </div>
        )}

        {/* Propose */}
        {tab === 'propose' && myTeam && leagueData?.teams && (
          <div className="card">
            <h3 className="text-white font-black text-lg mb-4">Propose a Trade</h3>
            <ProposeTab
              myTeam={myTeam}
              leagueTeams={leagueData.teams}
              leagueId={activeLeague.id}
              week={activeLeague.week}
              onSuccess={() => {
                setSuccessMsg('Trade proposal sent!');
                setTab('inbox');
                refreshAll();
              }}
            />
          </div>
        )}

        {/* Inbox */}
        {tab === 'inbox' && (
          <div className="space-y-4">
            {!inboxTrades ? (
              <div className="card text-center text-white/40 py-12">Loading...</div>
            ) : inboxTrades.length === 0 ? (
              <div className="card text-center py-12">
                <p className="text-white/40">No active trades</p>
                {myTeam && (
                  <button
                    onClick={() => setTab('propose')}
                    className="mt-3 text-gold text-sm hover:text-gold/70 transition-colors"
                  >
                    Propose a trade →
                  </button>
                )}
              </div>
            ) : (
              inboxTrades.map((trade) => (
                <TradeCard
                  key={trade.id}
                  trade={trade}
                  myTeamId={myTeam?.id}
                  isCommissioner={isCommissioner}
                  onRespond={handleRespond}
                />
              ))
            )}
          </div>
        )}

        {/* Commissioner panel */}
        {tab === 'commissioner' && isCommissioner && (
          <div className="space-y-4">
            <div className="card-gold">
              <p className="text-gold font-black">Commissioner Review</p>
              <p className="text-white/50 text-sm mt-1">
                These trades have been accepted by both teams and are awaiting your approval.
                Approved trades are executed immediately and cannot be undone.
              </p>
            </div>
            {!approvalTrades ? (
              <div className="card text-center text-white/40 py-12">Loading...</div>
            ) : approvalTrades.length === 0 ? (
              <div className="card text-center text-white/40 py-12">
                No trades pending approval
              </div>
            ) : (
              approvalTrades.map((trade) => (
                <TradeCard
                  key={trade.id}
                  trade={trade}
                  myTeamId={myTeam?.id}
                  isCommissioner={isCommissioner}
                  onApprove={handleApprove}
                />
              ))
            )}
          </div>
        )}

        {/* History */}
        {tab === 'history' && (
          <div className="space-y-4">
            {!historyTrades ? (
              <div className="card text-center text-white/40 py-12">Loading...</div>
            ) : historyTrades.length === 0 ? (
              <div className="card text-center text-white/40 py-12">No trades yet this season</div>
            ) : (
              historyTrades.map((trade) => (
                <TradeCard
                  key={trade.id}
                  trade={trade}
                  myTeamId={myTeam?.id}
                  isCommissioner={false}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
