'use client';

import { useState } from 'react';
import { Link2, Loader2 } from 'lucide-react';

interface Props {
  busy?: boolean;
  defaultChannel?: string;
  onSubmit: (payload: {
    url: string;
    transcript?: string;
    channel?: string;
  }) => Promise<void>;
}

export function ManualAddPanel({ busy, defaultChannel, onSubmit }: Props) {
  const [url, setUrl] = useState('');
  const [transcript, setTranscript] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);

  const submitting = busy || localBusy;

  const handleSubmit = async () => {
    const trimmed = url.trim();
    if (!trimmed || submitting) return;
    setLocalBusy(true);
    try {
      await onSubmit({
        url: trimmed,
        transcript: transcript.trim() || undefined,
        channel: defaultChannel || undefined,
      });
      setUrl('');
      setTranscript('');
      setShowTranscript(false);
    } finally {
      setLocalBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Link2 className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Add video manually</h2>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Paste a YouTube link to ingest a missed video. Optionally paste a transcript if auto-captions failed.
      </p>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://www.youtube.com/watch?v=..."
        className="w-full px-2 py-1.5 text-sm rounded-md bg-background border border-border focus:outline-none focus:ring-1 focus:ring-[#00c853]/50"
      />
      <button
        type="button"
        onClick={() => setShowTranscript((v) => !v)}
        className="text-[11px] text-muted-foreground hover:text-foreground"
      >
        {showTranscript ? 'Hide transcript field' : 'Also paste transcript (optional)'}
      </button>
      {showTranscript && (
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          rows={6}
          placeholder="Paste full transcript or captions text here..."
          className="w-full px-2 py-1.5 text-xs rounded-md bg-background border border-border font-mono resize-y focus:outline-none focus:ring-1 focus:ring-[#00c853]/50"
        />
      )}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting || !url.trim()}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-[#00c853]/15 text-[#00c853] border border-[#00c853]/30 hover:bg-[#00c853]/25 disabled:opacity-50 transition-colors"
      >
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
        {transcript.trim() ? 'Add & summarize transcript' : 'Add & auto-summarize'}
      </button>
    </div>
  );
}
