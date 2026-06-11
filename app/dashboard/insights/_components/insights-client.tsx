'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, PanelLeftClose, PanelLeftOpen, Plus, Send, Settings, Sparkles } from 'lucide-react';
import type { InsightChatMetadata, InsightSessionSummary } from '@/lib/insights/types';
import type { WatchlistItem } from '@/lib/types';
import { sectorForTicker } from '@/lib/watchlist-sectors';
import { DetailModal } from '../../_components/detail-modal';
import { SettingsModal } from '../../_components/settings-modal';
import { InsightsChat, type InsightUiMessage } from './insights-chat';
import { SessionSidebar } from './session-sidebar';

interface AccessState {
  loading: boolean;
  hasAccess: boolean;
  source: 'admin' | 'user' | null;
  isAdmin: boolean;
  adminKeyConfigured: boolean;
}

export function InsightsClient() {
  const [access, setAccess] = useState<AccessState>({
    loading: true,
    hasAccess: false,
    source: null,
    isAdmin: false,
    adminKeyConfigured: false,
  });
  const [sessions, setSessions] = useState<InsightSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<InsightUiMessage[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(true);

  const fetchAccess = useCallback(async () => {
    setAccess((prev) => ({ ...prev, loading: true }));
    const res = await fetch('/api/insights/access', { cache: 'no-store' });
    if (!res.ok) {
      setAccess({ loading: false, hasAccess: false, source: null, isAdmin: false, adminKeyConfigured: false });
      return;
    }
    const data = await res.json();
    setAccess({
      loading: false,
      hasAccess: !!data?.hasAccess,
      source: data?.source ?? null,
      isAdmin: !!data?.isAdmin,
      adminKeyConfigured: !!data?.adminKeyConfigured,
    });
  }, []);

  const fetchSessions = useCallback(async () => {
    const res = await fetch('/api/insights/sessions', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    setSessions(Array.isArray(data) ? data : []);
  }, []);

  const fetchWatchlist = useCallback(async () => {
    const res = await fetch('/api/watchlist', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    setWatchlist(Array.isArray(data) ? data : data?.items ?? []);
  }, []);

  useEffect(() => {
    fetchAccess();
    fetchWatchlist();
  }, [fetchAccess, fetchWatchlist]);

  useEffect(() => {
    if (access.hasAccess) fetchSessions();
  }, [access.hasAccess, fetchSessions]);

  const loadSession = async (sessionId: string) => {
    const res = await fetch(`/api/insights/sessions/${sessionId}`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    setActiveSessionId(data.id);
    setMessages(
      (data?.messages ?? []).map((message: any) => ({
        id: message.id,
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content,
        metadata: message.metadata,
      })),
    );
  };

  const deleteSession = async (sessionId: string) => {
    await fetch(`/api/insights/sessions/${sessionId}`, { method: 'DELETE' });
    setSessions((prev) => prev.filter((session) => session.id !== sessionId));
    if (activeSessionId === sessionId) {
      setActiveSessionId(null);
      setMessages([]);
    }
  };

  const handleNewSession = () => {
    setActiveSessionId(null);
    setMessages([]);
    setInput('');
    setStatus(null);
  };

  const sendMessage = async (value = input) => {
    const text = value.trim();
    if (!text || sending) return;

    setInput('');
    setSending(true);
    setStatus('Starting research...');

    const assistantId = `assistant-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: 'user', content: text },
      { id: assistantId, role: 'assistant', content: '', metadata: {} },
    ]);

    try {
      const res = await fetch('/api/insights/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId: activeSessionId }),
      });

      if (!res.ok || !res.body) {
        const error = await res.json().catch(() => ({}));
        updateAssistant(assistantId, { content: error?.error || 'AI Insights failed to start.' });
        return;
      }

      await readEventStream(res, async (event, data) => {
        if (event === 'session') {
          setActiveSessionId(data?.id ?? null);
          fetchSessions();
        }
        if (event === 'status') setStatus(data?.message ?? null);
        if (event === 'delta') {
          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantId ? { ...message, content: `${message.content}${data?.text ?? ''}` } : message,
            ),
          );
        }
        if (event === 'picks') {
          updateAssistantMetadata(assistantId, { picks: data?.picks ?? [] });
        }
        if (event === 'citations') {
          updateAssistantMetadata(assistantId, { citations: data?.citations ?? [] });
        }
        if (event === 'done') {
          setStatus(null);
          fetchSessions();
        }
        if (event === 'error') {
          updateAssistant(assistantId, { content: data?.message || 'AI Insights failed.' });
        }
      });
    } finally {
      setSending(false);
      setStatus(null);
    }
  };

  const handleToggleWatchlist = async (symbol: string) => {
    const isWatchlisted = watchlist.some((item) => item.ticker === symbol);
    if (isWatchlisted) {
      await fetch(`/api/watchlist?ticker=${symbol}`, { method: 'DELETE' });
    } else {
      await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: symbol, sector: sectorForTicker(symbol) }),
      });
    }
    fetchWatchlist();
  };

  const updateAssistant = (assistantId: string, patch: Partial<InsightUiMessage>) => {
    setMessages((prev) => prev.map((message) => (message.id === assistantId ? { ...message, ...patch } : message)));
  };

  const updateAssistantMetadata = (assistantId: string, metadata: InsightChatMetadata) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === assistantId
          ? { ...message, metadata: { ...(message.metadata ?? {}), ...metadata } }
          : message,
      ),
    );
  };

  if (access.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-[#00c853]" />
          Loading AI Insights...
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="flex h-9 w-9 items-center justify-center rounded-md border border-[#00c853]/30 bg-[#00c853]/10">
              <Sparkles className="h-4 w-4 text-[#00c853]" />
            </div>
            <div>
              <h1 className="font-display text-base font-semibold tracking-tight">AI Insights</h1>
              <p className="text-xs text-muted-foreground">
                {access.isAdmin
                  ? access.adminKeyConfigured
                    ? 'Admin account · server OpenRouter key'
                    : 'Admin account · set OPENROUTER_API_KEY in .env'
                  : access.hasAccess
                    ? 'Using your OpenRouter key'
                    : 'Add your OpenRouter key in Settings'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {access.hasAccess && (
              <button
                type="button"
                onClick={() => setHistoryOpen((open) => !open)}
                className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                title={historyOpen ? 'Hide chat history' : 'Show chat history'}
              >
                {historyOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
              </button>
            )}
            {!historyOpen && access.hasAccess && (
              <button
                type="button"
                onClick={handleNewSession}
                className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                title="New research chat"
              >
                <Plus className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              title="Settings"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {!access.hasAccess ? (
        <main className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-md rounded-xl border border-border bg-card p-6 text-center">
            <Sparkles className="mx-auto mb-3 h-8 w-8 text-[#00c853]" />
            <h2 className="font-display text-lg font-semibold">
              {access.isAdmin ? 'OpenRouter key not configured' : 'OpenRouter key required'}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {access.isAdmin
                ? 'Add OPENROUTER_API_KEY to your server .env file, then restart the app. Your chat history stays private to your account.'
                : 'Add your OpenRouter API key in Settings to use AI Insights. Your key and chat history are private to your account only.'}
            </p>
            {!access.isAdmin && (
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                className="mt-4 rounded-md bg-[#00c853] px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90"
              >
                Add OpenRouter key
              </button>
            )}
          </div>
        </main>
      ) : (
        <div className="flex min-h-0 flex-1">
          <SessionSidebar
            open={historyOpen}
            sessions={sessions}
            activeSessionId={activeSessionId}
            onNew={handleNewSession}
            onSelect={loadSession}
            onDelete={deleteSession}
            onCollapse={() => setHistoryOpen(false)}
          />

          <main className="flex min-w-0 flex-1 flex-col">
            <InsightsChat messages={messages} status={status} loading={sending} onSelectTicker={setSelectedTicker} />

            <div className="border-t border-border bg-card/80 p-4">
              <div className="mx-auto max-w-4xl">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    sendMessage();
                  }}
                  className="flex gap-2"
                >
                  <textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder="Ask AI Insights to analyze your watchlist or research new stock ideas..."
                    rows={2}
                    className="min-h-[52px] flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none ring-[#00c853]/30 placeholder:text-muted-foreground focus:ring-2"
                    disabled={sending}
                  />
                  <button
                    type="submit"
                    disabled={sending || !input.trim()}
                    className="flex h-[52px] w-12 items-center justify-center rounded-lg bg-[#00c853] text-black transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </form>
                <p className="text-[10px] text-muted-foreground">
                  AI Insights surfaces indicators and signals for research only. It is not financial advice or a guarantee of price movement.
                </p>
              </div>
            </div>
          </main>
        </div>
      )}

      {showSettings && (
        <SettingsModal
          onClose={() => {
            setShowSettings(false);
            fetchAccess();
          }}
        />
      )}

      {selectedTicker && (
        <DetailModal
          symbol={selectedTicker}
          onClose={() => setSelectedTicker(null)}
          isWatchlisted={watchlist.some((item) => item.ticker === selectedTicker)}
          onToggleWatchlist={() => handleToggleWatchlist(selectedTicker)}
        />
      )}
    </div>
  );
}

async function readEventStream(response: Response, onEvent: (event: string, data: any) => Promise<void> | void) {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const event = parseSseEvent(part);
      if (event) await onEvent(event.name, event.data);
    }
  }

  if (buffer.trim()) {
    const event = parseSseEvent(buffer);
    if (event) await onEvent(event.name, event.data);
  }
}

function parseSseEvent(raw: string): { name: string; data: any } | null {
  const lines = raw.split(/\r?\n/);
  const name = lines.find((line) => line.startsWith('event:'))?.replace(/^event:\s*/, '').trim();
  const dataLines = lines.filter((line) => line.startsWith('data:')).map((line) => line.replace(/^data:\s*/, ''));
  if (!name) return null;

  try {
    return { name, data: JSON.parse(dataLines.join('\n') || '{}') };
  } catch {
    return { name, data: {} };
  }
}

