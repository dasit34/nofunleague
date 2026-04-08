'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

interface LeagueTabsProps {
  leagueId: string;
  isCommissioner: boolean;
}

const tabs = [
  { key: '',           label: 'Overview' },
  { key: '/league',    label: 'League' },
  { key: '/teams',     label: 'Teams' },
  { key: '/draft',     label: 'Draft' },
  { key: '/standings', label: 'Standings' },
  { key: '/matchups',  label: 'Matchups' },
  { key: '/players',   label: 'Players' },
  { key: '/trades',    label: 'Trades' },
];

const commissionerTabs = [
  { key: '/settings',  label: 'Settings' },
];

export default function LeagueTabs({ leagueId, isCommissioner }: LeagueTabsProps) {
  const pathname = usePathname();
  const base = `/dashboard/leagues/${leagueId}`;
  const allTabs = isCommissioner ? [...tabs, ...commissionerTabs] : tabs;

  return (
    <div className="border-b border-white/10 px-6 flex gap-1 overflow-x-auto">
      {allTabs.map((tab) => {
        const href = `${base}${tab.key}`;
        const isActive = tab.key === ''
          ? pathname === base
          : pathname === href || pathname.startsWith(href + '/');

        return (
          <Link
            key={tab.key}
            href={href}
            className={clsx(
              'px-4 py-3 text-sm font-semibold whitespace-nowrap transition-colors border-b-2 -mb-px',
              isActive
                ? 'text-gold border-gold'
                : 'text-white/40 border-transparent hover:text-white/70 hover:border-white/20'
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
