'use client';
import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { leagues as leaguesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { League } from '@/types';

/**
 * Legacy settings page — redirects commissioners to League Manager,
 * shows read-only info for non-commissioners.
 */
export default function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuthStore();
  const router = useRouter();

  const { data: league } = useSWR(
    `/leagues/${id}`,
    () => leaguesApi.get(id) as Promise<League>
  );

  const isCommissioner = league?.commissioner_id === user?.id;

  useEffect(() => {
    if (isCommissioner) {
      router.replace(`/dashboard/leagues/${id}/league/manager-tools`);
    }
  }, [isCommissioner, id, router]);

  if (!league) return null;

  // Non-commissioners see a basic read-only view
  if (!isCommissioner) {
    return (
      <div className="p-6 space-y-6">
        <h2 className="text-white font-black text-lg">League Settings</h2>
        <div className="card space-y-4">
          <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider">League Info</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InfoField label="League Name" value={league.name} />
            <InfoField label="Season" value={league.season} />
            <InfoField label="Teams" value={league.league_size} />
            <InfoField label="Scoring" value={(league.scoring_type ?? 'standard').replace('_', ' ').toUpperCase()} />
            <InfoField label="Status" value={(league.status ?? '').replace(/_/g, ' ')} />
          </div>
        </div>
        <p className="text-white/20 text-xs text-center">
          Only the commissioner can modify league settings.
        </p>
      </div>
    );
  }

  // Commissioner is being redirected
  return (
    <div className="p-6">
      <div className="card text-center py-12">
        <p className="text-white/40 text-sm">Redirecting to League Manager...</p>
      </div>
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <label className="text-white/40 text-xs uppercase tracking-wider block mb-1">{label}</label>
      <p className="text-white text-sm">{value}</p>
    </div>
  );
}
