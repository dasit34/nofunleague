'use client';
import { useLeagueStore } from '@/lib/store';

interface TopBarProps {
  title?: string;
  subtitle?: string;
}

export default function TopBar({ title, subtitle }: TopBarProps) {
  const activeLeague = useLeagueStore((s) => s.activeLeague);

  return (
    <div className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
      <div>
        {title && <h1 className="text-xl font-black text-white">{title}</h1>}
        {subtitle && <p className="text-white/40 text-sm">{subtitle}</p>}
      </div>
      {activeLeague && (
        <div className="flex items-center gap-2">
          <span className="text-white/40 text-sm">Week</span>
          <span className="badge-gold">{activeLeague.week}</span>
          <span className="text-white/20 mx-1">|</span>
          <span className={`badge ${
            activeLeague.status === 'in_season'
              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
              : 'badge-dark'
          }`}>
            {activeLeague.status.replace('_', ' ')}
          </span>
        </div>
      )}
    </div>
  );
}
