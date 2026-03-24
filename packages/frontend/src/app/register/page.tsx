'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { User } from '@/types';

const STYLES = [
  { value: 'aggressive', label: 'Aggressive', desc: 'No mercy. Pure savagery.' },
  { value: 'petty', label: 'Petty', desc: 'Backhanded and passive-aggressive.' },
  { value: 'poetic', label: 'Poetic', desc: 'Dramatic. Shakespearean suffering.' },
  { value: 'silent', label: 'Silent', desc: 'Cold. Dismissive. Devastating.' },
];

export default function RegisterPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    display_name: '',
    trash_talk_style: 'aggressive',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { user, token } = await auth.register(form);
      setAuth(user as User, token);
      router.push('/dashboard');
    } catch (err) {
      setError((err as Error).message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="text-gold font-black text-3xl tracking-tighter">NFL</Link>
          <p className="text-white/40 text-sm mt-1">Join The No Fun League</p>
        </div>

        <div className="card-gold">
          <h1 className="text-2xl font-black text-white mb-6">Create Account</h1>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-white/60 text-sm font-semibold mb-1.5 block">Username</label>
              <input
                type="text"
                className="input-dark"
                placeholder="ChaosMaster99"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                required
                minLength={3}
              />
            </div>
            <div>
              <label className="text-white/60 text-sm font-semibold mb-1.5 block">Display Name</label>
              <input
                type="text"
                className="input-dark"
                placeholder="Your team manager name"
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              />
            </div>
            <div>
              <label className="text-white/60 text-sm font-semibold mb-1.5 block">Email</label>
              <input
                type="email"
                className="input-dark"
                placeholder="you@nofunleague.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="text-white/60 text-sm font-semibold mb-1.5 block">Password</label>
              <input
                type="password"
                className="input-dark"
                placeholder="Min 8 characters"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                minLength={8}
              />
            </div>

            {/* Trash Talk Style */}
            <div>
              <label className="text-white/60 text-sm font-semibold mb-2 block">
                AI Trash Talk Style
              </label>
              <div className="grid grid-cols-2 gap-2">
                {STYLES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setForm({ ...form, trash_talk_style: s.value })}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      form.trash_talk_style === s.value
                        ? 'border-gold bg-gold/10 text-gold'
                        : 'border-white/10 text-white/60 hover:border-white/30'
                    }`}
                  >
                    <div className="font-bold text-sm">{s.label}</div>
                    <div className="text-xs opacity-70 mt-0.5">{s.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <button type="submit" className="btn-gold w-full mt-2" disabled={loading}>
              {loading ? 'Creating account...' : 'Join the League'}
            </button>
          </form>

          <p className="text-white/40 text-sm text-center mt-6">
            Already in?{' '}
            <Link href="/login" className="text-gold hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
