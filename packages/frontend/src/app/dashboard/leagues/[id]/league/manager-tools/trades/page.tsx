'use client';
import { use, useState, useEffect } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { leagues as leaguesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { League, TradeSettings } from '@/types';
import { getLeagueSettings } from '@/types';

const REVIEW_PERIOD_OPTIONS = [
  { value: 0, label: 'No review period' },
  { value: 12, label: '12 hours' },
  { value: 24, label: '24 hours' },
  { value: 48, label: '48 hours' },
  { value: 72, label: '72 hours' },
  { value: 168, label: '1 week' },
];

export default function TradeSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuthStore();
  const { data: league, mutate } = useSWR(`/leagues/${id}`, () => leaguesApi.get(id) as Promise<League>);

  const [approvalType, setApprovalType] = useState<'commissioner' | 'league_vote' | 'none'>('commissioner');
  const [reviewPeriodHours, setReviewPeriodHours] = useState(24);
  const [tradeDeadlineWeek, setTradeDeadlineWeek] = useState(0);
  const [votesToVeto, setVotesToVeto] = useState(4);
  const [allowDraftPickTrades, setAllowDraftPickTrades] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (league) {
      const settings = getLeagueSettings(league.settings);
      setApprovalType(settings.trades.approval_type);
      setReviewPeriodHours(settings.trades.review_period_hours);
      setTradeDeadlineWeek(settings.trades.trade_deadline_week);
      setVotesToVeto(settings.trades.votes_to_veto);
      setAllowDraftPickTrades(settings.trades.allow_draft_pick_trades);
      setDirty(false);
    }
  }, [league]);

  if (!league) return null;
  const isCommissioner = league.commissioner_id === user?.id;
  if (!isCommissioner) {
    return <div className="p-6"><div className="card text-center py-12 text-white/40 text-sm">Commissioner access required.</div></div>;
  }

  // Trades section is NOT locked after draft — editable anytime
  const canEdit = true;

  async function handleSave() {
    setSaving(true); setMsg(''); setErr('');
    try {
      await leaguesApi.updateSettings(id, 'trades', {
        approval_type: approvalType,
        review_period_hours: reviewPeriodHours,
        trade_deadline_week: tradeDeadlineWeek,
        votes_to_veto: votesToVeto,
        allow_draft_pick_trades: allowDraftPickTrades,
      } satisfies TradeSettings);
      setMsg('Trade settings saved.');
      setDirty(false);
      mutate();
    } catch (e) { setErr((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <Link href={`/dashboard/leagues/${id}/league/manager-tools`} className="text-white/30 text-xs hover:text-gold transition-colors">
          &larr; League Manager
        </Link>
        <h2 className="text-white font-black text-lg mt-1">Trade Settings</h2>
        <p className="text-white/30 text-xs mt-1">Configure how trades are reviewed and processed in your league.</p>
      </div>

      {/* Approval Type */}
      <div className="card space-y-4">
        <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider">Trade Approval</h3>
        <div className="flex gap-2 flex-wrap">
          {([
            { value: 'none' as const, label: 'No Approval', desc: 'Trades execute immediately after both teams accept.' },
            { value: 'commissioner' as const, label: 'Commissioner', desc: 'Commissioner must approve every accepted trade.' },
            { value: 'league_vote' as const, label: 'League Vote', desc: 'League members can vote to veto accepted trades.' },
          ]).map(opt => (
            <button key={opt.value} onClick={() => { setApprovalType(opt.value); setDirty(true); }}
              className={`px-4 py-2 rounded text-sm font-semibold transition-colors ${
                approvalType === opt.value
                  ? 'bg-gold/20 text-gold border border-gold/40'
                  : 'bg-white/5 text-white/40 border border-white/10 hover:border-white/20'
              }`}>
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-white/20 text-xs">
          {approvalType === 'none' && 'Trades execute immediately after both teams accept.'}
          {approvalType === 'commissioner' && 'Commissioner must approve every accepted trade before it processes.'}
          {approvalType === 'league_vote' && 'Accepted trades are open for league members to veto.'}
        </p>
      </div>

      {/* Review Period */}
      <div className="card space-y-4">
        <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider">Review Period</h3>
        <select className="input-dark text-sm w-full md:w-64" value={reviewPeriodHours}
          onChange={e => { setReviewPeriodHours(parseInt(e.target.value)); setDirty(true); }}>
          {REVIEW_PERIOD_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <p className="text-white/20 text-xs">
          How long after a trade is accepted before it processes. Gives time for review or veto.
        </p>
      </div>

      {/* Votes to Veto (only shown for league_vote) */}
      {approvalType === 'league_vote' && (
        <div className="card space-y-4">
          <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider">Votes to Veto</h3>
          <select className="input-dark text-sm w-full md:w-64" value={votesToVeto}
            onChange={e => { setVotesToVeto(parseInt(e.target.value)); setDirty(true); }}>
            {Array.from({ length: 15 }, (_, i) => i + 1).map(n => (
              <option key={n} value={n}>{n} vote{n > 1 ? 's' : ''}</option>
            ))}
          </select>
          <p className="text-white/20 text-xs">
            Number of league member votes required to veto an accepted trade.
          </p>
        </div>
      )}

      {/* Trade Deadline */}
      <div className="card space-y-4">
        <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider">Trade Deadline</h3>
        <select className="input-dark text-sm w-full md:w-64" value={tradeDeadlineWeek}
          onChange={e => { setTradeDeadlineWeek(parseInt(e.target.value)); setDirty(true); }}>
          <option value={0}>No deadline</option>
          {Array.from({ length: 18 }, (_, i) => i + 1).map(w => (
            <option key={w} value={w}>Week {w}</option>
          ))}
        </select>
        <p className="text-white/20 text-xs">
          {tradeDeadlineWeek > 0
            ? `No trades allowed after week ${tradeDeadlineWeek}.`
            : 'Trades are allowed throughout the entire season.'}
        </p>
      </div>

      {/* Draft Pick Trades */}
      <div className="card space-y-4">
        <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider">Draft Pick Trades</h3>
        <div className="flex gap-2">
          <button onClick={() => { setAllowDraftPickTrades(true); setDirty(true); }}
            className={`px-4 py-2 rounded text-sm font-semibold transition-colors ${
              allowDraftPickTrades
                ? 'bg-gold/20 text-gold border border-gold/40'
                : 'bg-white/5 text-white/40 border border-white/10 hover:border-white/20'
            }`}>
            Allowed
          </button>
          <button onClick={() => { setAllowDraftPickTrades(false); setDirty(true); }}
            className={`px-4 py-2 rounded text-sm font-semibold transition-colors ${
              !allowDraftPickTrades
                ? 'bg-gold/20 text-gold border border-gold/40'
                : 'bg-white/5 text-white/40 border border-white/10 hover:border-white/20'
            }`}>
            Not Allowed
          </button>
        </div>
        <p className="text-white/20 text-xs">
          {allowDraftPickTrades
            ? 'Teams can include future draft picks in trade proposals.'
            : 'Only players can be traded. Draft picks are not tradeable.'}
        </p>
      </div>

      {/* Summary */}
      <div className="card space-y-3">
        <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider">Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <SummaryPill label="Approval" value={
            approvalType === 'commissioner' ? 'Commissioner' :
            approvalType === 'league_vote' ? 'League Vote' : 'None'
          } />
          <SummaryPill label="Review" value={
            REVIEW_PERIOD_OPTIONS.find(o => o.value === reviewPeriodHours)?.label ?? `${reviewPeriodHours}h`
          } />
          <SummaryPill label="Deadline" value={tradeDeadlineWeek > 0 ? `Week ${tradeDeadlineWeek}` : 'None'} />
          {approvalType === 'league_vote' && (
            <SummaryPill label="Veto Votes" value={`${votesToVeto}`} />
          )}
          <SummaryPill label="Pick Trades" value={allowDraftPickTrades ? 'Yes' : 'No'} />
        </div>
      </div>

      {/* Save */}
      {canEdit && (
        <div className="flex items-center gap-3">
          <button onClick={handleSave} disabled={saving || !dirty}
            className={`text-sm py-2 px-6 rounded font-bold transition-colors ${
              saving || !dirty
                ? 'bg-white/10 text-white/30 cursor-not-allowed'
                : 'btn-gold'
            }`}>
            {saving ? 'Saving...' : !dirty ? 'No Changes' : 'Save Trade Settings'}
          </button>
          {msg && <span className="text-green-400 text-sm">{msg}</span>}
          {err && <span className="text-red-400 text-sm">{err}</span>}
        </div>
      )}
    </div>
  );
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/5 rounded px-2 py-1.5">
      <p className="text-white/30 text-[10px] uppercase tracking-wider">{label}</p>
      <p className="text-white text-sm font-bold">{value}</p>
    </div>
  );
}
