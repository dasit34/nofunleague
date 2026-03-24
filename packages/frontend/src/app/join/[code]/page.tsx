'use client';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import Link from 'next/link';
import { useAuthStore } from '@/lib/store';
import { invites as invitesApi } from '@/lib/api';
import type { LeagueInvite } from '@/types';

export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router   = useRouter();
  const { user } = useAuthStore();

  const [joining, setJoining] = useState(false);
  const [joinErr, setJoinErr] = useState('');

  const { data: invite, error, isLoading } = useSWR<LeagueInvite>(
    code ? `/invites/${code}` : null,
    () => invitesApi.preview(code) as Promise<LeagueInvite>
  );

  async function handleJoin() {
    if (!user) {
      router.push(`/login?redirect=/join/${code}`);
      return;
    }
    setJoining(true);
    setJoinErr('');
    try {
      const result = await invitesApi.join(code);
      router.push(`/dashboard/leagues/${result.league_id}`);
    } catch (err) {
      const msg = (err as Error).message;
      // If already a member, just go to the league
      if (msg.toLowerCase().includes('already')) {
        const e = err as any;
        if (e.league_id) { router.push(`/dashboard/leagues/${e.league_id}`); return; }
      }
      setJoinErr(msg);
      setJoining(false);
    }
  }

  const statusLabel: Record<string, string> = {
    pre_draft:   'Pre-Draft',
    drafting:    'Drafting',
    in_season:   'In Season',
    post_season: 'Post Season',
    complete:    'Complete',
  };

  return (
    <div className="min-h-screen bg-dark-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo */}
        <div className="text-center">
          <Link href="/" className="text-gold font-black text-3xl tracking-tighter">NFL</Link>
          <p className="text-white/40 text-sm mt-1">The No Fun League</p>
        </div>

        <div className="card space-y-6">
          {isLoading && (
            <div className="text-center text-white/40 py-8">Loading invite...</div>
          )}

          {error && (
            <div className="text-center space-y-3 py-4">
              <p className="text-red-400 font-semibold">
                {error.message || 'This invite is invalid or no longer active.'}
              </p>
              <Link href="/dashboard" className="text-gold text-sm hover:text-gold/70">
                Go to dashboard →
              </Link>
            </div>
          )}

          {invite && !error && (
            <>
              <div className="text-center space-y-1">
                <p className="text-white/50 text-sm">You've been invited to join</p>
                <h1 className="text-white font-black text-2xl">{invite.league_name}</h1>
                <p className="text-white/40 text-sm">
                  Invited by <span className="text-white/70">{invite.commissioner_name}</span>
                </p>
              </div>

              {/* League stats */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Season',  value: invite.season },
                  { label: 'Teams',   value: `${invite.team_count}/${invite.max_teams}` },
                  { label: 'Status',  value: statusLabel[invite.league_status || ''] || invite.league_status },
                ].map((s) => (
                  <div key={s.label} className="bg-white/5 rounded-lg p-3 text-center">
                    <div className="text-white font-bold text-lg">{s.value}</div>
                    <div className="text-white/40 text-xs mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Invite code badge */}
              <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2">
                <span className="text-white/40 text-xs">Invite code:</span>
                <span className="text-gold font-mono font-bold tracking-widest text-sm">{invite.code}</span>
              </div>

              {/* Actions */}
              {invite.already_member ? (
                <div className="space-y-3">
                  <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-green-400 text-sm text-center">
                    You're already a member of this league.
                  </div>
                  <Link
                    href={`/dashboard/leagues/${invite.league_id}`}
                    className="btn-gold w-full text-center block"
                  >
                    Go to League →
                  </Link>
                </div>
              ) : !user ? (
                <div className="space-y-3">
                  <p className="text-white/50 text-sm text-center">
                    Sign in to join this league.
                  </p>
                  <Link
                    href={`/login?redirect=/join/${code}`}
                    className="btn-gold w-full text-center block"
                  >
                    Sign In to Join
                  </Link>
                  <Link
                    href={`/register?redirect=/join/${code}`}
                    className="btn-dark border border-white/10 w-full text-center block text-sm py-2"
                  >
                    Create Account
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-white/60 text-sm text-center">
                    Joining as <span className="text-white font-semibold">{user.display_name}</span>
                  </p>
                  {joinErr && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                      {joinErr}
                    </div>
                  )}
                  <button
                    onClick={handleJoin}
                    disabled={joining}
                    className="btn-gold w-full"
                  >
                    {joining ? 'Joining...' : 'Join League'}
                  </button>
                  <Link
                    href="/dashboard"
                    className="block text-center text-white/30 text-sm hover:text-white/60 transition-colors"
                  >
                    Back to dashboard
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
