'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore, useLeagueStore } from '@/lib/store';
import { auth as authApi } from '@/lib/api';
import clsx from 'clsx';

const navItems = [
  { href: '/dashboard',            label: 'Dashboard',   icon: '🏠' },
  { href: '/dashboard/matchups',   label: 'Matchups',    icon: '⚔️' },
  { href: '/dashboard/standings',  label: 'Standings',   icon: '🏆' },
  { href: '/dashboard/roster',     label: 'My Roster',   icon: '👥' },
  { href: '/dashboard/players',    label: 'Players',     icon: '🏈' },
  { href: '/dashboard/trades',     label: 'Trades',      icon: '🔄' },
  { href: '/dashboard/chat',       label: 'League Chat', icon: '💬' },
  { href: '/dashboard/ai',         label: 'AI Chaos',    icon: '🤖' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearAuth } = useAuthStore();
  const activeLeague = useLeagueStore((s) => s.activeLeague);

  async function handleSignOut() {
    try { await authApi.logout(); } catch { /* ignore — stateless JWT */ }
    clearAuth();
    router.push('/');
  }

  return (
    <aside className="w-64 bg-dark-50 border-r border-white/10 flex flex-col min-h-screen">
      {/* Logo */}
      <div className="p-6 border-b border-white/10">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="text-gold font-black text-2xl tracking-tighter">NFL</span>
        </Link>
        {activeLeague && (
          <p className="text-white/40 text-xs mt-1 truncate">{activeLeague.name}</p>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
              pathname === item.href
                ? 'bg-gold/15 text-gold border border-gold/20'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            )}
          >
            <span className="text-base">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>

      {/* User */}
      <div className="p-4 border-t border-white/10">
        <Link
          href="/dashboard/profile"
          className={clsx(
            'flex items-center gap-3 mb-3 rounded-lg px-2 py-1.5 transition-all group',
            pathname === '/dashboard/profile'
              ? 'bg-gold/10'
              : 'hover:bg-white/5'
          )}
        >
          {/* Avatar */}
          <div className="w-8 h-8 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center overflow-hidden shrink-0">
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="avatar" className="w-full h-full object-cover" />
            ) : (
              <span className="text-gold font-bold text-sm">
                {user?.display_name?.[0]?.toUpperCase() || '?'}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-semibold truncate group-hover:text-gold transition-colors">
              {user?.display_name}
            </p>
            <p className="text-white/40 text-xs truncate">@{user?.username}</p>
          </div>
          <span className="text-white/20 text-xs group-hover:text-gold/60 transition-colors">⚙</span>
        </Link>

        <button
          onClick={handleSignOut}
          className="w-full text-white/30 hover:text-red-400 text-xs text-left transition-colors px-2"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
