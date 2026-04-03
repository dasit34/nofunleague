'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { leagues as leaguesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

function JoinForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, token } = useAuthStore();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => { setHydrated(true); }, []);

  // Prefill from query param
  useEffect(() => {
    const qCode = searchParams.get('code');
    if (qCode) setCode(qCode);
  }, [searchParams]);

  // If not authenticated, redirect to login with redirect back here
  useEffect(() => {
    if (!hydrated) return;
    if (!user || !token) {
      const redirectUrl = code
        ? `/join?code=${encodeURIComponent(code)}`
        : '/join';
      router.replace(`/login?redirect=${encodeURIComponent(redirectUrl)}`);
    }
  }, [hydrated, user, token, router, code]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setError('');
    try {
      const result = await leaguesApi.join(code.trim());
      router.push(`/dashboard/leagues/${result.league_id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (!hydrated || !user) return null;

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/dashboard" className="text-gold font-black text-3xl tracking-tighter">NFL</Link>
          <p className="text-white/40 text-sm mt-1">The No Fun League</p>
        </div>

        <div className="card-gold">
          <h1 className="text-2xl font-black text-white mb-2">Join a League</h1>
          <p className="text-white/40 text-sm mb-6">Enter the invite code shared by your commissioner.</p>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-white/60 text-sm font-semibold mb-1.5 block">Invite Code</label>
              <input
                type="text"
                className="input-dark text-center font-mono tracking-widest text-lg uppercase"
                placeholder="ABCD1234"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                required
                autoFocus
              />
            </div>

            <button type="submit" className="btn-gold w-full" disabled={loading || !code.trim()}>
              {loading ? 'Joining...' : 'Join League'}
            </button>
          </form>

          <p className="text-white/40 text-sm text-center mt-6">
            <Link href="/dashboard" className="text-gold hover:underline">
              Back to dashboard
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense>
      <JoinForm />
    </Suspense>
  );
}
