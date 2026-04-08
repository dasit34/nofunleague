'use client';
import { use, useState } from 'react';
import useSWR from 'swr';
import { trades as tradesApi, teams as teamsApi, leagues as leaguesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { League, Team, RosterPlayer, Trade, TradeItem } from '@/types';
import clsx from 'clsx';

// ─── Status badge ──────────────────────────────────────────────────────────
const STATUS_STYLES: Record<string, string> = {
  pending:  'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  accepted: 'bg-blue-500/15  text-blue-400  border-blue-500/30',
  rejected: 'bg-red-500/15   text-red-400   border-red-500/30',
  approved: 'bg-green-500/15 text-green-400 border-green-500/30',
  vetoed:   'bg-red-700/15   text-red-500   border-red-700/30',
};

// ─── Trade Card ────────────────────────────────────────────────────────────
function TradeCard({
  trade, myTeamId, isCommissioner, onRespond, onApprove, onCancel,
}: {
  trade: Trade; myTeamId?: string; isCommissioner: boolean;
  onRespond?: (id: string, action: 'accept' | 'reject') => void;
  onApprove?: (id: string, action: 'approve' | 'veto') => void;
  onCancel?: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const propItems = trade.items.filter((i) => i.from_team_id === trade.proposing_team_id);
  const recvItems = trade.items.filter((i) => i.from_team_id === trade.receiving_team_id);
  const isProposer = myTeamId === trade.proposing_team_id;
  const isReceiver = myTeamId === trade.receiving_team_id;
  const canRespond = trade.status === 'pending' && isReceiver && !!onRespond;
  const canApprove = trade.status === 'accepted' && isCommissioner && !!onApprove;
  const canCancel = trade.status === 'pending' && isProposer && !!onCancel;

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-white font-bold text-sm">{trade.proposing_team_name}</span>
          <span className="text-white/30 text-xs">→</span>
          <span className="text-white font-bold text-sm">{trade.receiving_team_name}</span>
        </div>
        <span className={clsx('badge border text-xs capitalize', STATUS_STYLES[trade.status] || 'text-white/40')}>
          {trade.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <p className="text-white/40 text-xs font-semibold uppercase tracking-wider">{trade.proposing_team_name} gives</p>
          {propItems.map((i) => (
            <div key={i.id} className="bg-white/5 rounded-lg px-3 py-2">
              <p className="text-white text-sm font-semibold">{i.player_name}</p>
              <p className="text-white/40 text-xs">{i.position} · {i.nfl_team}</p>
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <p className="text-white/40 text-xs font-semibold uppercase tracking-wider">{trade.receiving_team_name} gives</p>
          {recvItems.map((i) => (
            <div key={i.id} className="bg-white/5 rounded-lg px-3 py-2">
              <p className="text-white text-sm font-semibold">{i.player_name}</p>
              <p className="text-white/40 text-xs">{i.position} · {i.nfl_team}</p>
            </div>
          ))}
        </div>
      </div>

      {trade.proposer_note && <p className="text-white/50 text-xs italic border-t border-white/10 pt-3">"{trade.proposer_note}"</p>}
      {trade.response_note && <p className="text-white/50 text-xs italic">Response: "{trade.response_note}"</p>}
      {trade.commissioner_note && <p className="text-white/50 text-xs italic">Commissioner: "{trade.commissioner_note}"</p>}

      <div className="text-white/20 text-xs">
        Proposed {new Date(trade.proposed_at).toLocaleDateString()}
        {trade.responded_at && ` · Responded ${new Date(trade.responded_at).toLocaleDateString()}`}
        {trade.decided_at && ` · Decided ${new Date(trade.decided_at).toLocaleDateString()}`}
      </div>

      {canRespond && (
        <div className="flex gap-2 border-t border-white/10 pt-3">
          <button onClick={async () => { setBusy(true); onRespond?.(trade.id, 'accept'); setBusy(false); }} disabled={busy} className="btn-gold flex-1 text-sm py-2">Accept</button>
          <button onClick={async () => { setBusy(true); onRespond?.(trade.id, 'reject'); setBusy(false); }} disabled={busy} className="border border-red-500/40 text-red-400 hover:bg-red-500/10 font-semibold px-4 py-2 rounded-lg transition-all text-sm flex-1">Reject</button>
        </div>
      )}

      {canApprove && (
        <div className="flex gap-2 border-t border-white/10 pt-3">
          <button onClick={async () => { setBusy(true); onApprove?.(trade.id, 'approve'); setBusy(false); }} disabled={busy} className="btn-gold flex-1 text-sm py-2">Approve</button>
          <button onClick={async () => { setBusy(true); onApprove?.(trade.id, 'veto'); setBusy(false); }} disabled={busy} className="border border-red-500/40 text-red-400 hover:bg-red-500/10 font-semibold px-4 py-2 rounded-lg transition-all text-sm flex-1">Veto</button>
        </div>
      )}

      {canCancel && (
        <div className="border-t border-white/10 pt-3">
          <button onClick={async () => { setBusy(true); onCancel?.(trade.id); setBusy(false); }} disabled={busy}
            className="text-white/30 hover:text-red-400 text-xs transition-colors">Cancel Trade</button>
        </div>
      )}
    </div>
  );
}

// ─── Propose Tab ───────────────────────────────────────────────────────────
function ProposeTab({
  myTeam, leagueTeams, leagueId, onSuccess,
}: {
  myTeam: Team; leagueTeams: Team[]; leagueId: string; onSuccess: () => void;
}) {
  const [opponentId, setOpponentId] = useState('');
  const [givingIds, setGivingIds] = useState<Set<string>>(new Set());
  const [wantingIds, setWantingIds] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { data: myRosterData } = useSWR(`/teams/${myTeam.id}`, () => teamsApi.get(myTeam.id) as Promise<Team & { roster: RosterPlayer[] }>);
  const { data: oppRosterData } = useSWR(opponentId ? `/teams/${opponentId}` : null, () => teamsApi.get(opponentId) as Promise<Team & { roster: RosterPlayer[] }>);

  const opponents = leagueTeams.filter((t) => t.id !== myTeam.id);
  const myRoster = myRosterData?.roster || [];
  const oppRoster = oppRosterData?.roster || [];

  function toggle(set: Set<string>, id: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    setter(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!opponentId || givingIds.size === 0 || wantingIds.size === 0) {
      setError('Select an opponent and at least one player from each side');
      return;
    }
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
      setGivingIds(new Set()); setWantingIds(new Set()); setOpponentId(''); setNote('');
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">{error}</div>}

      <div>
        <label className="text-white/60 text-sm font-semibold mb-1.5 block">Trade with</label>
        <select className="input-dark" value={opponentId} onChange={(e) => { setOpponentId(e.target.value); setWantingIds(new Set()); }}>
          <option value="">Select team...</option>
          {opponents.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-white/60 text-sm font-semibold mb-1.5 block">
            You give {givingIds.size > 0 && <span className="text-gold ml-1">{givingIds.size} selected</span>}
          </label>
          <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
            {myRoster.length === 0 ? (
              <p className="text-white/30 text-xs py-4 text-center">No players</p>
            ) : myRoster.map((p) => (
              <button key={p.id} type="button" onClick={() => toggle(givingIds, p.id, setGivingIds)}
                className={clsx('w-full text-left px-3 py-2 rounded-lg border text-sm transition-all',
                  givingIds.has(p.id) ? 'border-gold bg-gold/10 text-white' : 'border-white/10 text-white/70 hover:border-white/30')}>
                <span className="font-semibold">{p.full_name}</span>
                <span className="text-white/40 text-xs ml-2">{p.position} · {p.nfl_team}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-white/60 text-sm font-semibold mb-1.5 block">
            You receive {wantingIds.size > 0 && <span className="text-gold ml-1">{wantingIds.size} selected</span>}
          </label>
          <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
            {!opponentId ? (
              <p className="text-white/30 text-xs py-4 text-center">Select a team first</p>
            ) : oppRoster.length === 0 ? (
              <p className="text-white/30 text-xs py-4 text-center">No players</p>
            ) : oppRoster.map((p) => (
              <button key={p.id} type="button" onClick={() => toggle(wantingIds, p.id, setWantingIds)}
                className={clsx('w-full text-left px-3 py-2 rounded-lg border text-sm transition-all',
                  wantingIds.has(p.id) ? 'border-gold bg-gold/10 text-white' : 'border-white/10 text-white/70 hover:border-white/30')}>
                <span className="font-semibold">{p.full_name}</span>
                <span className="text-white/40 text-xs ml-2">{p.position} · {p.nfl_team}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <label className="text-white/60 text-sm font-semibold mb-1.5 block">Note <span className="font-normal text-white/30">optional</span></label>
        <textarea className="input-dark resize-none" rows={2} placeholder="Add a message..." value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </div>

      <button type="submit" disabled={loading || givingIds.size === 0 || wantingIds.size === 0 || !opponentId} className="btn-gold w-full">
        {loading ? 'Sending...' : 'Propose Trade'}
      </button>
    </form>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────
type Tab = 'propose' | 'inbox' | 'commissioner' | 'history';

export default function LeagueTradesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = use(params);
  const { user } = useAuthStore();
  const [tab, setTab] = useState<Tab>('inbox');
  const [successMsg, setSuccessMsg] = useState('');
  const [actionErr, setActionErr] = useState('');

  const { data: leagueData } = useSWR(
    `/leagues/${leagueId}`,
    () => leaguesApi.get(leagueId) as Promise<League & { teams: Team[] }>
  );

  const myTeam = leagueData?.teams?.find((t) => t.user_id === user?.id);
  const isCommissioner = !!leagueData && leagueData.commissioner_id === user?.id;

  const { data: inboxTrades, mutate: mutateInbox } = useSWR(
    `/trades/inbox/${leagueId}`, () => tradesApi.inbox(leagueId)
  );
  const { data: historyTrades, mutate: mutateHistory } = useSWR(
    `/trades/history/${leagueId}`, () => tradesApi.history(leagueId)
  );
  const { data: approvalTrades, mutate: mutateApproval } = useSWR(
    isCommissioner ? `/trades/approval/${leagueId}` : null,
    () => tradesApi.pendingApproval(leagueId)
  );

  function refreshAll() { mutateInbox(); mutateHistory(); mutateApproval(); }

  async function handleRespond(tradeId: string, action: 'accept' | 'reject') {
    setActionErr('');
    try { await tradesApi.respond(tradeId, action); refreshAll(); }
    catch (err) { setActionErr((err as Error).message); }
  }

  async function handleApprove(tradeId: string, action: 'approve' | 'veto') {
    setActionErr('');
    try { await tradesApi.approve(tradeId, action); refreshAll(); }
    catch (err) { setActionErr((err as Error).message); }
  }

  async function handleCancel(tradeId: string) {
    setActionErr('');
    try { await tradesApi.cancel(tradeId); refreshAll(); }
    catch (err) { setActionErr((err as Error).message); }
  }

  const tabDefs: { id: Tab; label: string; count?: number; hidden?: boolean }[] = [
    { id: 'propose', label: 'Propose', hidden: !myTeam },
    { id: 'inbox', label: 'Inbox', count: inboxTrades?.length },
    { id: 'commissioner', label: 'Commissioner', count: approvalTrades?.length, hidden: !isCommissioner },
    { id: 'history', label: 'History' },
  ];

  return (
    <div className="p-6 space-y-5">
      {/* Tab bar */}
      <div className="flex gap-1 bg-white/5 rounded-xl p-1 w-fit">
        {tabDefs.filter((t) => !t.hidden).map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={clsx('px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-1.5',
              tab === t.id ? 'bg-gold text-black' : 'text-white/50 hover:text-white')}>
            {t.label}
            {(t.count ?? 0) > 0 && (
              <span className={clsx('text-xs rounded-full px-1.5 py-0.5 font-bold',
                tab === t.id ? 'bg-black/20 text-black' : 'bg-gold/20 text-gold')}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {actionErr && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm flex items-center justify-between">
          {actionErr}
          <button onClick={() => setActionErr('')} className="text-red-400/60 hover:text-red-400 ml-4">✕</button>
        </div>
      )}

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
          <ProposeTab myTeam={myTeam} leagueTeams={leagueData.teams} leagueId={leagueId}
            onSuccess={() => { setSuccessMsg('Trade proposal sent!'); setTab('inbox'); refreshAll(); }} />
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
              {myTeam && <button onClick={() => setTab('propose')} className="mt-3 text-gold text-sm hover:text-gold/70">Propose a trade →</button>}
            </div>
          ) : inboxTrades.map((trade) => (
            <TradeCard key={trade.id} trade={trade} myTeamId={myTeam?.id} isCommissioner={isCommissioner} onRespond={handleRespond} onCancel={handleCancel} />
          ))}
        </div>
      )}

      {/* Commissioner */}
      {tab === 'commissioner' && isCommissioner && (
        <div className="space-y-4">
          <div className="card-gold">
            <p className="text-gold font-black">Commissioner Review</p>
            <p className="text-white/50 text-sm mt-1">Approved trades are executed immediately.</p>
          </div>
          {!approvalTrades ? (
            <div className="card text-center text-white/40 py-12">Loading...</div>
          ) : approvalTrades.length === 0 ? (
            <div className="card text-center text-white/40 py-12">No trades pending approval</div>
          ) : approvalTrades.map((trade) => (
            <TradeCard key={trade.id} trade={trade} myTeamId={myTeam?.id} isCommissioner={isCommissioner} onApprove={handleApprove} />
          ))}
        </div>
      )}

      {/* History */}
      {tab === 'history' && (
        <div className="space-y-4">
          {!historyTrades ? (
            <div className="card text-center text-white/40 py-12">Loading...</div>
          ) : historyTrades.length === 0 ? (
            <div className="card text-center text-white/40 py-12">No trades yet</div>
          ) : historyTrades.map((trade) => (
            <TradeCard key={trade.id} trade={trade} myTeamId={myTeam?.id} isCommissioner={false} />
          ))}
        </div>
      )}
    </div>
  );
}
