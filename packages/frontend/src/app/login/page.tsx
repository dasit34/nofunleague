'use client';
import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { auth } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setAuth, user } = useAuthStore();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) router.replace('/dashboard');
  }, [user, router]);

  useEffect(() => {
    if (searchParams.get('session') === 'expired') {
      setInfo('Your session expired. Please sign in again.');
    }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setInfo('');
    try {
      const { user, token } = await auth.login(form);
      setAuth(user, token);
      const redirect = searchParams.get('redirect');
      router.push(redirect || '/dashboard');
    } catch (err) {
      setError((err as Error).message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="text-gold font-black text-3xl tracking-tighter">NFL</Link>
          <p className="text-white/40 text-sm mt-1">The No Fun League</p>
        </div>

        <div className="card-gold">
          <h1 className="text-2xl font-black text-white mb-6">Sign In</h1>

          {info && (
            <div className="bg-gold/10 border border-gold/30 rounded-lg p-3 mb-4 text-gold text-sm">
              {info}
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-white/60 text-sm font-semibold mb-1.5 block">Email</label>
              <input
                type="email"
                className="input-dark"
                placeholder="you@nofunleague.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
                autoComplete="email"
              />
            </div>
            <div>
              <label className="text-white/60 text-sm font-semibold mb-1.5 block">Password</label>
              <input
                type="password"
                className="input-dark"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                autoComplete="current-password"
              />
            </div>
            <button type="submit" className="btn-gold w-full mt-2" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <p className="text-white/40 text-sm text-center mt-6">
            No account?{' '}
            <Link href="/register" className="text-gold hover:underline">
              Join the league
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
