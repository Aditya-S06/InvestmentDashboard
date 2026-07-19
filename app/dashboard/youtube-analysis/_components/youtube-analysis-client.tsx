'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Settings, Youtube } from 'lucide-react';
import { useDashboard } from '../../_components/dashboard-provider';
import { DetailModal } from '../../_components/detail-modal';
import { SettingsModal } from '../../_components/settings-modal';
import { ChannelManager } from './channel-manager';
import { ManualAddPanel } from './manual-add-panel';
import { PollControls } from './poll-controls';
import { VideoSummaryCard, type VideoSummaryItem } from './video-summary-card';

interface ChannelsState {
  channels: string[];
  default_limit: number;
  since_days: number;
  youtubeApiConfigured: boolean;
  openRouterConfigured: boolean;
}

export function YoutubeAnalysisClient() {
  const { watchlist, toggleWatchlist } = useDashboard();
  const [items, setItems] = useState<VideoSummaryItem[]>([]);
  const [channels, setChannels] = useState<ChannelsState>({
    channels: [],
    default_limit: 5,
    since_days: 2,
    youtubeApiConfigured: false,
    openRouterConfigured: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [polling, setPolling] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [resummarizingId, setResummarizingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [lastPolledAt, setLastPolledAt] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  const [filterChannel, setFilterChannel] = useState('');
  const [filterTicker, setFilterTicker] = useState('');
  const [filterDays, setFilterDays] = useState(7);

  const fetchChannels = useCallback(async () => {
    const res = await fetch('/api/youtube/channels', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    setChannels({
      channels: Array.isArray(data.channels) ? data.channels : [],
      default_limit: data.default_limit ?? 5,
      since_days: data.since_days ?? 2,
      youtubeApiConfigured: !!data.youtubeApiConfigured,
      openRouterConfigured: !!data.openRouterConfigured,
    });
  }, []);

  const fetchSummaries = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterChannel) params.set('channel', filterChannel);
    if (filterTicker) params.set('ticker', filterTicker.trim().toUpperCase());
    if (filterDays > 0) params.set('since_days', String(filterDays));
    params.set('limit', '50');

    const res = await fetch(`/api/youtube/summaries?${params.toString()}`, { cache: 'no-store' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error || 'Failed to load summaries');
    }
    const data = await res.json();
    setItems(Array.isArray(data.items) ? data.items : []);
  }, [filterChannel, filterTicker, filterDays]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([fetchChannels(), fetchSummaries()]);
    } catch (err: any) {
      setError(err?.message || 'Failed to load YouTube analysis');
    } finally {
      setLoading(false);
    }
  }, [fetchChannels, fetchSummaries]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveChannels = async (next: {
    channels: string[];
    default_limit: number;
    since_days: number;
  }) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/youtube/channels', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Save failed');
      setChannels({
        channels: data.channels ?? next.channels,
        default_limit: data.default_limit ?? next.default_limit,
        since_days: data.since_days ?? next.since_days,
        youtubeApiConfigured: !!data.youtubeApiConfigured,
        openRouterConfigured: !!data.openRouterConfigured,
      });
      setStatus('Channels saved');
    } catch (err: any) {
      setError(err?.message || 'Failed to save channels');
    } finally {
      setSaving(false);
    }
  };

  const runPoll = async (payload: { all?: boolean; channel?: string }) => {
    setPolling(true);
    setError(null);
    setStatus(payload.channel ? `Polling ${payload.channel}...` : 'Polling all channels...');
    try {
      const res = await fetch('/api/youtube/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Poll failed');
      setLastPolledAt(data.polledAt || new Date().toISOString());
      setStatus(`Ingested ${data.upserted ?? 0} videos (${data.skipped ?? 0} skipped)`);
      await fetchSummaries();
    } catch (err: any) {
      setError(err?.message || 'Poll failed');
      setStatus(null);
    } finally {
      setPolling(false);
    }
  };

  const runIngest = async (payload: {
    url: string;
    transcript?: string;
    channel?: string;
    videoId?: string;
    title?: string;
  }) => {
    setIngesting(true);
    setError(null);
    setStatus(payload.transcript ? 'Summarizing pasted transcript...' : 'Ingesting video...');
    try {
      const res = await fetch('/api/youtube/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Ingest failed');

      const item = data?.item as VideoSummaryItem | null;
      if (item?.videoId) {
        // If active filters would hide it, widen them so later refreshes keep it visible
        if (filterChannel && item.channelHandle) {
          const a = filterChannel.replace(/^@/, '').toLowerCase();
          const b = item.channelHandle.replace(/^@/, '').toLowerCase();
          if (a !== b) setFilterChannel('');
        }
        if (filterDays > 0 && item.publishedAt) {
          const ageDays =
            (Date.now() - new Date(item.publishedAt).getTime()) / (1000 * 60 * 60 * 24);
          if (Number.isFinite(ageDays) && ageDays > filterDays) {
            setFilterDays(Math.min(30, Math.ceil(ageDays) + 1));
          }
        }
      }

      const thesis = (item?.summary as any)?.key_thesis || '';
      setStatus(
        payload.transcript
          ? `Re-summarized: ${item?.title || 'video'}${thesis ? ` — ${String(thesis).slice(0, 80)}` : ''}`
          : `Added: ${item?.title || 'video'}`,
      );

      // Refresh list, then force-merge this item so filters can't hide a just-saved card
      await fetchSummaries();
      if (item?.videoId) {
        setItems((prev) => {
          const idx = prev.findIndex((row) => row.videoId === item.videoId);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = item;
            return next;
          }
          return [item, ...prev];
        });
      }
    } catch (err: any) {
      setError(err?.message || 'Ingest failed');
      setStatus(null);
    } finally {
      setIngesting(false);
    }
  };

  const resummarizeWithTranscript = async (payload: {
    videoId: string;
    url: string;
    transcript: string;
    title?: string;
    channel?: string;
  }) => {
    setResummarizingId(payload.videoId);
    try {
      await runIngest({
        url: payload.url || payload.videoId,
        videoId: payload.videoId,
        transcript: payload.transcript,
        title: payload.title,
        channel: payload.channel || filterChannel || undefined,
      });
    } finally {
      setResummarizingId(null);
    }
  };

  const emptyHint = useMemo(() => {
    if (!channels.youtubeApiConfigured) {
      return 'Add YOUTUBE_API_KEY to your server .env, install Python deps (google-api-python-client, youtube-transcript-api, yt-dlp, httpx), then poll channels.';
    }
    if (items.length === 0) {
      return 'No summaries yet. Poll a channel, or use Add video manually with a YouTube link.';
    }
    return null;
  }, [channels.youtubeApiConfigured, items.length]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-50 bg-card/95 backdrop-blur-sm border-b border-border">
        <div className="flex items-center justify-between px-4 py-2 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/dashboard"
              className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title="Back to dashboard"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-md bg-red-500/10 border border-red-500/30 flex items-center justify-center shrink-0">
                <Youtube className="w-4 h-4 text-red-400" />
              </div>
              <div className="min-w-0">
                <h1 className="font-display font-bold text-base tracking-tight truncate">YouTube Analysis</h1>
                <p className="text-[11px] text-muted-foreground truncate">
                  Financial channel monitoring · feeds AI Insights
                </p>
              </div>
            </div>
          </div>
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-0">
        <aside className="border-b lg:border-b-0 lg:border-r border-border p-4 space-y-4 bg-card/30">
          <ChannelManager
            key={`${channels.channels.join(',')}-${channels.default_limit}-${channels.since_days}`}
            channels={channels.channels}
            defaultLimit={channels.default_limit}
            sinceDays={channels.since_days}
            saving={saving}
            onSave={saveChannels}
          />
          <PollControls
            polling={polling}
            lastPolledAt={lastPolledAt}
            youtubeApiConfigured={channels.youtubeApiConfigured}
            channels={channels.channels}
            onPollAll={() => runPoll({ all: true })}
            onPollChannel={(channel) => runPoll({ channel })}
          />
          <ManualAddPanel
            busy={ingesting}
            defaultChannel={filterChannel || channels.channels[0]}
            onSubmit={runIngest}
          />
          {!channels.openRouterConfigured && (
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Tip: set <code className="font-mono">OPENROUTER_API_KEY</code> for LLM summaries. Without it,
              ingest still stores metadata with low-confidence fallbacks.
            </p>
          )}
        </aside>

        <main className="p-4 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Channel</span>
              <select
                value={filterChannel}
                onChange={(e) => setFilterChannel(e.target.value)}
                className="block px-2 py-1.5 text-sm rounded-md bg-background border border-border min-w-[140px]"
              >
                <option value="">All channels</option>
                {channels.channels.map((ch) => (
                  <option key={ch} value={ch}>
                    {ch}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Ticker</span>
              <input
                value={filterTicker}
                onChange={(e) => setFilterTicker(e.target.value)}
                placeholder="NVDA"
                className="block px-2 py-1.5 text-sm rounded-md bg-background border border-border w-28 font-mono uppercase"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Since days</span>
              <input
                type="number"
                min={1}
                max={30}
                value={filterDays}
                onChange={(e) => setFilterDays(Number(e.target.value) || 7)}
                className="block px-2 py-1.5 text-sm rounded-md bg-background border border-border w-20"
              />
            </label>
            <button
              type="button"
              onClick={() => refresh()}
              className="px-3 py-1.5 text-sm rounded-md bg-secondary hover:bg-secondary/80 border border-border"
            >
              Apply filters
            </button>
          </div>

          {status && <p className="text-xs text-[#00c853]">{status}</p>}
          {error && <p className="text-xs text-red-400">{error}</p>}

          {loading ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Loading summaries...</span>
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-10 text-center space-y-2">
              <Youtube className="w-8 h-8 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground max-w-md mx-auto">{emptyHint}</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-1 xl:grid-cols-2">
              {items.map((item) => (
                <VideoSummaryCard
                  key={item.id}
                  item={item}
                  onSelectTicker={setSelectedTicker}
                  onResummarize={resummarizeWithTranscript}
                  resummarizing={resummarizingId === item.videoId}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {selectedTicker && (
        <DetailModal
          symbol={selectedTicker}
          onClose={() => setSelectedTicker(null)}
          isWatchlisted={watchlist.some((w) => w.ticker === selectedTicker)}
          onToggleWatchlist={() => toggleWatchlist(selectedTicker)}
        />
      )}
    </div>
  );
}
