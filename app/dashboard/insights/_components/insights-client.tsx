'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ChevronDown,
  ImagePlus,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Send,
  Settings,
  Sparkles,
  X,
} from 'lucide-react';
import {
  DEFAULT_INSIGHTS_MODEL_ID,
  INSIGHTS_MODEL_OPTIONS,
  type InsightsModelId,
} from '@/lib/insights/models';
import type { InsightChatMetadata, InsightImageAttachment, InsightSessionSummary } from '@/lib/insights/types';
import { useDashboard } from '../../_components/dashboard-provider';
import { DetailModal } from '../../_components/detail-modal';
import { SettingsModal } from '../../_components/settings-modal';
import { InsightsChat, type InsightUiMessage } from './insights-chat';
import { SessionSidebar } from './session-sidebar';

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

interface AccessState {
  loading: boolean;
  hasAccess: boolean;
  source: 'admin' | 'user' | null;
  isAdmin: boolean;
  adminKeyConfigured: boolean;
}

interface PendingImage extends InsightImageAttachment {
  id: string;
}

export function InsightsClient() {
  const { watchlist, toggleWatchlist } = useDashboard();
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
  const [historyOpen, setHistoryOpen] = useState(true);
  const [modelId, setModelId] = useState<InsightsModelId>(DEFAULT_INSIGHTS_MODEL_ID);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  const selectedModel = INSIGHTS_MODEL_OPTIONS.find((option) => option.id === modelId) ?? INSIGHTS_MODEL_OPTIONS[0];

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

  useEffect(() => {
    fetchAccess();
  }, [fetchAccess]);

  useEffect(() => {
    if (access.hasAccess) fetchSessions();
  }, [access.hasAccess, fetchSessions]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!modelMenuRef.current?.contains(event.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

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
    setPendingImages([]);
    setAttachError(null);
  };

  const addImageFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;

    setAttachError(null);
    const remaining = MAX_IMAGES - pendingImages.length;
    if (remaining <= 0) {
      setAttachError(`You can attach up to ${MAX_IMAGES} images.`);
      return;
    }

    const next: PendingImage[] = [];
    for (const file of list.slice(0, remaining)) {
      if (!file.type.startsWith('image/')) {
        setAttachError('Only image files are supported.');
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setAttachError('Each image must be under 4MB.');
        continue;
      }
      const url = await readFileAsDataUrl(file);
      next.push({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
        url,
        mimeType: file.type,
        name: file.name,
      });
    }

    if (next.length > 0) {
      setPendingImages((prev) => [...prev, ...next].slice(0, MAX_IMAGES));
    }
  };

  const removePendingImage = (id: string) => {
    setPendingImages((prev) => prev.filter((image) => image.id !== id));
  };

  const sendMessage = async (value = input) => {
    const text = value.trim();
    if ((!text && pendingImages.length === 0) || sending) return;

    const imagesToSend = pendingImages.map(({ url, mimeType, name }) => ({ url, mimeType, name }));
    const displayText = text || 'Please analyze the attached image(s).';

    setInput('');
    setPendingImages([]);
    setAttachError(null);
    setSending(true);
    setStatus('Starting research...');
    setModelMenuOpen(false);

    const assistantId = `assistant-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        role: 'user',
        content: displayText,
        metadata: imagesToSend.length > 0 ? { images: imagesToSend } : undefined,
      },
      { id: assistantId, role: 'assistant', content: '', metadata: {} },
    ]);

    try {
      const res = await fetch('/api/insights/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          sessionId: activeSessionId,
          modelId,
          images: imagesToSend,
        }),
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
    await toggleWatchlist(symbol);
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
                {pendingImages.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {pendingImages.map((image) => (
                      <div key={image.id} className="group relative h-16 w-16 overflow-hidden rounded-md border border-border">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={image.url} alt={image.name || 'Attachment'} className="h-full w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removePendingImage(image.id)}
                          className="absolute right-0.5 top-0.5 rounded-full bg-black/70 p-0.5 text-white opacity-80 transition-opacity hover:opacity-100"
                          title="Remove image"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    sendMessage();
                  }}
                  className="rounded-lg border border-border bg-background focus-within:ring-2 focus-within:ring-[#00c853]/30"
                >
                  <textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onPaste={(event) => {
                      const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
                        file.type.startsWith('image/'),
                      );
                      if (files.length > 0) {
                        event.preventDefault();
                        void addImageFiles(files);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void sendMessage();
                      }
                    }}
                    placeholder="Research a ticker, ask for ideas, or attach a chart/screenshot..."
                    rows={2}
                    className="min-h-[52px] w-full resize-none bg-transparent px-3 pt-2.5 text-sm outline-none placeholder:text-muted-foreground"
                    disabled={sending}
                  />

                  <div className="flex items-center justify-between gap-2 px-2 pb-2">
                    <div className="flex min-w-0 items-center gap-1">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(event) => {
                          if (event.target.files) void addImageFiles(event.target.files);
                          event.target.value = '';
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={sending || pendingImages.length >= MAX_IMAGES}
                        className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
                        title="Attach image"
                      >
                        <ImagePlus className="h-4 w-4" />
                      </button>

                      <div className="relative" ref={modelMenuRef}>
                        <button
                          type="button"
                          onClick={() => setModelMenuOpen((open) => !open)}
                          disabled={sending}
                          className="flex max-w-[200px] items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
                          title="Select model"
                        >
                          <span className="truncate">{selectedModel.label}</span>
                          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                        </button>
                        {modelMenuOpen && (
                          <div className="absolute bottom-full left-0 z-50 mb-1 min-w-[220px] overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                            {INSIGHTS_MODEL_OPTIONS.map((option) => (
                              <button
                                key={option.id}
                                type="button"
                                onClick={() => {
                                  setModelId(option.id);
                                  setModelMenuOpen(false);
                                }}
                                className={`flex w-full flex-col items-start px-3 py-2 text-left text-sm transition-colors hover:bg-secondary ${
                                  option.id === modelId ? 'bg-[#00c853]/10 text-foreground' : 'text-foreground'
                                }`}
                              >
                                <span className="font-medium">{option.label}</span>
                                <span className="text-[10px] text-muted-foreground">{option.id}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={sending || (!input.trim() && pendingImages.length === 0)}
                      className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#00c853] text-black transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </button>
                  </div>
                </form>

                {attachError && <p className="mt-1 text-[10px] text-red-500">{attachError}</p>}
                <p className="mt-1 text-[10px] text-muted-foreground">
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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'));
    reader.readAsDataURL(file);
  });
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
