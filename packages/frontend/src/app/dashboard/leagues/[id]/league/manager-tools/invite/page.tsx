'use client';
import { use, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { leagues as leaguesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { League, LeagueMember } from '@/types';

type LeagueData = League & { members: LeagueMember[] };

export default function InvitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuthStore();
  const { data: league } = useSWR(`/leagues/${id}`, () => leaguesApi.get(id) as Promise<LeagueData>);
  const [copied, setCopied] = useState(false);

  if (!league) return null;
  const isCommissioner = league.commissioner_id === user?.id;
  if (!isCommissioner) return (
    <div className="p-6"><div className="card text-center py-12 text-white/40 text-sm">Commissioner access required.</div></div>
  );

  const members = league.members || [];
  const openSlots = Math.max(0, league.league_size - members.length);
  const joinUrl = typeof window !== 'undefined' ? `${window.location.origin}/join?code=${league.invite_code}` : '';

  function copyLink() {
    navigator.clipboard.writeText(joinUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link href={`/dashboard/leagues/${id}/league/manager-tools`} className="text-white/30 text-xs hover:text-gold transition-colors">← Manager Tools</Link>
        <h2 className="text-white font-black text-lg mt-1">Invite Players</h2>
      </div>

      <div className="card space-y-5">
        {/* Slots info */}
        <div className="flex items-center gap-4">
          <div className="bg-white/5 rounded-lg px-4 py-3 text-center">
            <p className="text-2xl font-black text-gold">{openSlots}</p>
            <p className="text-white/40 text-xs">open slots</p>
          </div>
          <div>
            <p className="text-white text-sm">{members.length} of {league.league_size} spots filled</p>
            {openSlots === 0 && <p className="text-white/30 text-xs mt-1">League is full</p>}
          </div>
        </div>

        {/* Invite code */}
        <div>
          <label className="text-white/40 text-xs font-semibold uppercase tracking-wider block mb-1.5">Invite Code</label>
          <div className="flex items-center gap-3 bg-white/5 rounded-lg px-4 py-3">
            <span className="text-gold font-mono font-bold tracking-widest text-lg flex-1">
              {league.invite_code || 'None'}
            </span>
          </div>
        </div>

        {/* Join link */}
        <div>
          <label className="text-white/40 text-xs font-semibold uppercase tracking-wider block mb-1.5">Share Link</label>
          <div className="flex gap-2">
            <input type="text" readOnly value={joinUrl} className="input-dark flex-1 text-sm font-mono text-white/60" />
            <button onClick={copyLink} className="btn-gold text-sm py-2 px-4 shrink-0">
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
          </div>
        </div>

        {/* Helper text */}
        <div className="bg-white/5 rounded-lg p-4 text-sm text-white/30 space-y-2">
          <p>Share the invite code or link with players you want to join your league.</p>
          <p>Players must create an account first, then use the code to join.</p>
          <p>Each player gets a team automatically when they join.</p>
        </div>
      </div>
    </div>
  );
}
