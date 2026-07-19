'use client';

import { useState } from 'react';
import { Plus, Trash2, Save, Loader2 } from 'lucide-react';

interface Props {
  channels: string[];
  defaultLimit: number;
  sinceDays: number;
  saving: boolean;
  onSave: (next: { channels: string[]; default_limit: number; since_days: number }) => Promise<void>;
}

export function ChannelManager({ channels, defaultLimit, sinceDays, saving, onSave }: Props) {
  const [draft, setDraft] = useState(channels.join('\n'));
  const [limit, setLimit] = useState(defaultLimit);
  const [days, setDays] = useState(sinceDays);
  const [newChannel, setNewChannel] = useState('');

  const syncFromProps = () => {
    setDraft(channels.join('\n'));
    setLimit(defaultLimit);
    setDays(sinceDays);
  };

  const parsedChannels = draft
    .split(/[\n,]+/)
    .map((c) => c.trim())
    .filter(Boolean);

  const addChannel = () => {
    const value = newChannel.trim();
    if (!value) return;
    const handle = value.startsWith('@') || value.startsWith('UC') ? value : `@${value}`;
    if (!parsedChannels.includes(handle)) {
      setDraft([...parsedChannels, handle].join('\n'));
    }
    setNewChannel('');
  };

  const removeChannel = (handle: string) => {
    setDraft(parsedChannels.filter((c) => c !== handle).join('\n'));
  };

  const handleSave = async () => {
    await onSave({
      channels: parsedChannels,
      default_limit: limit,
      since_days: days,
    });
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Watched channels</h2>
        <button
          type="button"
          onClick={syncFromProps}
          className="text-[10px] text-muted-foreground hover:text-foreground"
        >
          Reset
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {parsedChannels.map((ch) => (
          <span
            key={ch}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-secondary border border-border"
          >
            {ch}
            <button
              type="button"
              onClick={() => removeChannel(ch)}
              className="text-muted-foreground hover:text-red-400"
              title="Remove"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </span>
        ))}
        {parsedChannels.length === 0 && (
          <p className="text-xs text-muted-foreground">No channels configured.</p>
        )}
      </div>

      <div className="flex gap-2">
        <input
          value={newChannel}
          onChange={(e) => setNewChannel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addChannel()}
          placeholder="@CNBC"
          className="flex-1 px-2 py-1.5 text-sm rounded-md bg-background border border-border focus:outline-none focus:ring-1 focus:ring-[#00c853]/50"
        />
        <button
          type="button"
          onClick={addChannel}
          className="px-2 py-1.5 rounded-md bg-secondary hover:bg-secondary/80 text-sm"
          title="Add channel"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Videos per poll</span>
          <input
            type="number"
            min={1}
            max={25}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value) || 5)}
            className="w-full px-2 py-1.5 text-sm rounded-md bg-background border border-border"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Since days</span>
          <input
            type="number"
            min={1}
            max={30}
            value={days}
            onChange={(e) => setDays(Number(e.target.value) || 2)}
            className="w-full px-2 py-1.5 text-sm rounded-md bg-background border border-border"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving || parsedChannels.length === 0}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-[#00c853]/15 text-[#00c853] border border-[#00c853]/30 hover:bg-[#00c853]/25 disabled:opacity-50 transition-colors"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Save channels
      </button>
    </div>
  );
}
