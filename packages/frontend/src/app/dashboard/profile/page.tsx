'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth as authApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import TopBar from '@/components/layout/TopBar';
import type { User } from '@/types';

const STYLES: { value: User['trash_talk_style']; label: string; desc: string }[] = [
  { value: 'aggressive', label: 'Aggressive', desc: 'No mercy. Pure savagery.' },
  { value: 'petty',      label: 'Petty',      desc: 'Backhanded. Passive-aggressive.' },
  { value: 'poetic',     label: 'Poetic',     desc: 'Dramatic. Shakespearean.' },
  { value: 'silent',     label: 'Silent',     desc: 'Cold. Dismissive. Devastating.' },
];

export default function ProfilePage() {
  const router = useRouter();
  const { user, updateUser, clearAuth } = useAuthStore();

  const [profile, setProfile] = useState({
    display_name: user?.display_name || '',
    avatar_url: user?.avatar_url || '',
    sleeper_user_id: user?.sleeper_user_id || '',
    trash_talk_style: user?.trash_talk_style || 'aggressive',
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [profileErr, setProfileErr] = useState('');

  const [passwords, setPasswords] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState('');
  const [pwErr, setPwErr] = useState('');

  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault();
    setProfileSaving(true);
    setProfileMsg('');
    setProfileErr('');
    try {
      const updated = await authApi.updateProfile({
        display_name: profile.display_name || undefined,
        avatar_url: profile.avatar_url || null,
        sleeper_user_id: profile.sleeper_user_id || null,
        trash_talk_style: profile.trash_talk_style as User['trash_talk_style'],
      });
      updateUser(updated as Partial<User>);
      setProfileMsg('Profile saved.');
    } catch (err) {
      setProfileErr((err as Error).message);
    } finally {
      setProfileSaving(false);
    }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg('');
    setPwErr('');

    if (passwords.new_password !== passwords.confirm_password) {
      setPwErr('New passwords do not match.');
      return;
    }
    if (passwords.new_password.length < 8) {
      setPwErr('New password must be at least 8 characters.');
      return;
    }

    setPwSaving(true);
    try {
      const { token } = await authApi.changePassword({
        current_password: passwords.current_password,
        new_password: passwords.new_password,
      });
      // Store the fresh token issued after password change
      localStorage.setItem('nfl_token', token);
      setPasswords({ current_password: '', new_password: '', confirm_password: '' });
      setPwMsg('Password changed successfully.');
    } catch (err) {
      setPwErr((err as Error).message);
    } finally {
      setPwSaving(false);
    }
  }

  async function handleSignOut() {
    try { await authApi.logout(); } catch { /* ignore */ }
    clearAuth();
    router.push('/');
  }

  return (
    <div>
      <TopBar title="Profile & Settings" subtitle={`@${user?.username}`} />

      <div className="p-6 max-w-2xl space-y-6">

        {/* Avatar preview */}
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-gold/20 border-2 border-gold/30 flex items-center justify-center overflow-hidden shrink-0">
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt="avatar" className="w-full h-full object-cover" />
            ) : (
              <span className="text-gold font-black text-2xl">
                {user?.display_name?.[0]?.toUpperCase() || '?'}
              </span>
            )}
          </div>
          <div>
            <p className="text-white font-black text-lg">{user?.display_name}</p>
            <p className="text-white/40 text-sm">@{user?.username} · {user?.email}</p>
            <p className="text-white/30 text-xs mt-0.5">
              Member since {user?.created_at ? new Date(user.created_at).getFullYear() : '—'}
            </p>
          </div>
        </div>

        {/* Profile form */}
        <div className="card">
          <h2 className="text-white font-black text-lg mb-4">Profile</h2>

          {profileMsg && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 mb-4 text-green-400 text-sm">
              {profileMsg}
            </div>
          )}
          {profileErr && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-red-400 text-sm">
              {profileErr}
            </div>
          )}

          <form onSubmit={handleProfileSave} className="space-y-4">
            <div>
              <label className="text-white/60 text-sm font-semibold mb-1.5 block">Display Name</label>
              <input
                type="text"
                className="input-dark"
                value={profile.display_name}
                onChange={(e) => setProfile({ ...profile, display_name: e.target.value })}
                maxLength={100}
              />
            </div>

            <div>
              <label className="text-white/60 text-sm font-semibold mb-1.5 block">
                Avatar URL
                <span className="text-white/30 font-normal ml-2">optional</span>
              </label>
              <input
                type="url"
                className="input-dark"
                placeholder="https://example.com/avatar.jpg"
                value={profile.avatar_url}
                onChange={(e) => setProfile({ ...profile, avatar_url: e.target.value })}
              />
            </div>

            <div>
              <label className="text-white/60 text-sm font-semibold mb-1.5 block">
                Sleeper Username
                <span className="text-white/30 font-normal ml-2">links your Sleeper account</span>
              </label>
              <input
                type="text"
                className="input-dark"
                placeholder="your_sleeper_username"
                value={profile.sleeper_user_id}
                onChange={(e) => setProfile({ ...profile, sleeper_user_id: e.target.value })}
              />
            </div>

            <div>
              <label className="text-white/60 text-sm font-semibold mb-2 block">AI Trash Talk Style</label>
              <div className="grid grid-cols-2 gap-2">
                {STYLES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setProfile({ ...profile, trash_talk_style: s.value })}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      profile.trash_talk_style === s.value
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

            <button type="submit" className="btn-gold w-full" disabled={profileSaving}>
              {profileSaving ? 'Saving...' : 'Save Profile'}
            </button>
          </form>
        </div>

        {/* Password form */}
        <div className="card">
          <h2 className="text-white font-black text-lg mb-4">Change Password</h2>

          {pwMsg && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 mb-4 text-green-400 text-sm">
              {pwMsg}
            </div>
          )}
          {pwErr && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-red-400 text-sm">
              {pwErr}
            </div>
          )}

          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div>
              <label className="text-white/60 text-sm font-semibold mb-1.5 block">Current Password</label>
              <input
                type="password"
                className="input-dark"
                placeholder="••••••••"
                value={passwords.current_password}
                onChange={(e) => setPasswords({ ...passwords, current_password: e.target.value })}
                autoComplete="current-password"
                required
              />
            </div>
            <div>
              <label className="text-white/60 text-sm font-semibold mb-1.5 block">New Password</label>
              <input
                type="password"
                className="input-dark"
                placeholder="Min 8 characters"
                value={passwords.new_password}
                onChange={(e) => setPasswords({ ...passwords, new_password: e.target.value })}
                autoComplete="new-password"
                required
                minLength={8}
              />
            </div>
            <div>
              <label className="text-white/60 text-sm font-semibold mb-1.5 block">Confirm New Password</label>
              <input
                type="password"
                className="input-dark"
                placeholder="••••••••"
                value={passwords.confirm_password}
                onChange={(e) => setPasswords({ ...passwords, confirm_password: e.target.value })}
                autoComplete="new-password"
                required
              />
            </div>
            <button type="submit" className="btn-outline-gold w-full" disabled={pwSaving}>
              {pwSaving ? 'Changing...' : 'Change Password'}
            </button>
          </form>
        </div>

        {/* Danger zone */}
        <div className="card border-red-500/20">
          <h2 className="text-white font-black text-lg mb-1">Sign Out</h2>
          <p className="text-white/40 text-sm mb-4">End your current session on this device.</p>
          <button
            onClick={handleSignOut}
            className="border border-red-500/40 text-red-400 hover:bg-red-500/10 font-semibold px-6 py-2.5 rounded-lg transition-all text-sm"
          >
            Sign Out
          </button>
        </div>

      </div>
    </div>
  );
}
