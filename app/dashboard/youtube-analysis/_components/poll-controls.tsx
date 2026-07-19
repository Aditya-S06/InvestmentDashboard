'use client';

import { Loader2, RefreshCw } from 'lucide-react';

interface Props {
  polling: boolean;
  lastPolledAt: string | null;
  youtubeApiConfigured: boolean;
  onPollAll: () => void;
  onPollChannel: (channel: string) => void;
  channels: string[];
}

export function PollControls({
  polling,
  lastPolledAt,
  youtubeApiConfigured,
  onPollAll,
  onPollChannel,
  channels,
}: Props) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Ingest</h2>
        {lastPolledAt && (
          <span className="text-[10px] text-muted-foreground">
            Last poll: {new Date(lastPolledAt).toLocaleString()}
          </span>
        )}
      </div>

      {!youtubeApiConfigured && (
        <p className="text-xs text-amber-400/90 leading-relaxed">
          Set <code className="font-mono">YOUTUBE_API_KEY</code> in <code className="font-mono">.env</code> and
          restart the server to enable polling. Summaries already in the database remain readable.
        </p>
      )}

      <button
        type="button"
        onClick={onPollAll}
        disabled={polling || !youtubeApiConfigured}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-secondary hover:bg-secondary/80 border border-border disabled:opacity-50 transition-colors"
      >
        {polling ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        Poll all channels
      </button>

      {channels.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {channels.map((ch) => (
            <button
              key={ch}
              type="button"
              onClick={() => onPollChannel(ch)}
              disabled={polling || !youtubeApiConfigured}
              className="px-2 py-1 rounded-md text-xs border border-border hover:bg-secondary disabled:opacity-50 transition-colors"
            >
              Poll {ch}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
