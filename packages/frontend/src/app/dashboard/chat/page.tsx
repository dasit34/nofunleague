'use client';
import { useState, useEffect, useRef } from 'react';
import useSWR from 'swr';
import { chat as chatApi } from '@/lib/api';
import { useLeagueStore, useAuthStore } from '@/lib/store';
import TopBar from '@/components/layout/TopBar';
import { formatDistanceToNow } from 'date-fns';
import type { ChatMessage } from '@/types';
import clsx from 'clsx';

export default function ChatPage() {
  const { user } = useAuthStore();
  const activeLeague = useLeagueStore((s) => s.activeLeague);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: messages, mutate } = useSWR(
    activeLeague ? `/chat/${activeLeague.id}` : null,
    () => chatApi.getMessages(activeLeague!.id, { limit: 100 }) as Promise<ChatMessage[]>,
    { refreshInterval: 10000 }
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim() || !activeLeague) return;
    setSending(true);
    try {
      await chatApi.send(activeLeague.id, { message: message.trim(), week: activeLeague.week });
      setMessage('');
      mutate();
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col h-screen">
      <TopBar title="League Chat" subtitle={activeLeague?.name} />

      {!activeLeague ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-white/40">Select a league to view chat</p>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages?.map((msg) => (
              <div key={msg.id} className="animate-slide-up">
                {msg.is_ai ? (
                  <div className="flex gap-3">
                    <div className="w-8 h-8 bg-gold/20 border border-gold/30 rounded-full flex items-center justify-center text-gold text-xs font-black shrink-0 mt-1">
                      AI
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-gold font-bold text-sm">CHAOS</span>
                        <span className={clsx('badge text-xs', {
                          'bg-red-500/20 text-red-400 border border-red-500/30': msg.message_type === 'trash_talk',
                          'bg-blue-500/20 text-blue-400 border border-blue-500/30': msg.message_type === 'weekly_recap',
                          'badge-dark': msg.message_type === 'system',
                        })}>
                          {msg.message_type.replace('_', ' ')}
                        </span>
                        {msg.target_team_name && (
                          <span className="text-white/30 text-xs">targeting {msg.target_team_name}</span>
                        )}
                        <span className="text-white/20 text-xs ml-auto">
                          {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      <div className="chat-bubble-ai">
                        <p className="text-white/90 text-sm leading-relaxed whitespace-pre-wrap">{msg.message}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className={clsx('flex gap-3', { 'flex-row-reverse': msg.user_id === user?.id })}>
                    <div className="w-8 h-8 bg-white/10 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 mt-1">
                      {msg.display_name?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div className={clsx('flex-1', { 'items-end flex flex-col': msg.user_id === user?.id })}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-white/60 text-sm font-semibold">{msg.display_name}</span>
                        <span className="text-white/20 text-xs">
                          {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      <div className="chat-bubble-user inline-block max-w-md">
                        <p className="text-white text-sm leading-relaxed">{msg.message}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {(!messages || messages.length === 0) && (
              <div className="text-center text-white/30 py-12">
                <p className="text-4xl mb-3">💬</p>
                <p>No messages yet. Start the chaos.</p>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={handleSend} className="p-4 border-t border-white/10 flex gap-3">
            <input
              type="text"
              className="input-dark flex-1"
              placeholder="Talk your trash..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={sending}
            />
            <button type="submit" className="btn-gold px-6" disabled={sending || !message.trim()}>
              {sending ? '...' : 'Send'}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
