'use client';

import { useState, useEffect } from 'react';
import { X, Key, Check, Loader2 } from 'lucide-react';

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [alphaVantageKey, setAlphaVantageKey] = useState('');
  const [polygonKey, setPolygonKey] = useState('');
  const [openRouterKey, setOpenRouterKey] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminKeyConfigured, setAdminKeyConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [existingKeys, setExistingKeys] = useState<{ provider: string; hasKey: boolean }[]>([]);

  useEffect(() => {
    fetch('/api/insights/access')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setIsAdmin(!!data?.isAdmin);
        setAdminKeyConfigured(!!data?.adminKeyConfigured);
      })
      .catch(() => {});

    fetch('/api/settings/apikeys')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setExistingKeys(data ?? []))
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (alphaVantageKey?.trim()) {
        await fetch('/api/settings/apikeys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'alpha_vantage', apiKey: alphaVantageKey.trim() }),
        });
      }
      if (polygonKey?.trim()) {
        await fetch('/api/settings/apikeys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'polygon', apiKey: polygonKey.trim() }),
        });
      }
      if (!isAdmin && openRouterKey?.trim()) {
        await fetch('/api/settings/apikeys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'openrouter', apiKey: openRouterKey.trim() }),
        });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ }
    setSaving(false);
  };

  const canSave =
    alphaVantageKey?.trim() || polygonKey?.trim() || (!isAdmin && openRouterKey?.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-lg w-full max-w-md mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-[#00c853]" />
            <h2 className="font-display font-semibold text-sm">API Settings</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-secondary text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-xs text-muted-foreground">
            Optional market data keys. AI Insights uses OpenRouter — admin uses the server key; other users add their own below.
          </p>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Alpha Vantage API Key</label>
            <input
              type="password"
              value={alphaVantageKey}
              onChange={(e) => setAlphaVantageKey(e.target.value)}
              placeholder={existingKeys?.find((k) => k?.provider === 'alpha_vantage')?.hasKey ? '•••••• (configured)' : 'Enter API key...'}
              className="w-full px-3 py-2 bg-secondary border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#00c853]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Polygon.io API Key</label>
            <input
              type="password"
              value={polygonKey}
              onChange={(e) => setPolygonKey(e.target.value)}
              placeholder={existingKeys?.find((k) => k?.provider === 'polygon')?.hasKey ? '•••••• (configured)' : 'Enter API key...'}
              className="w-full px-3 py-2 bg-secondary border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#00c853]"
            />
          </div>

          {isAdmin ? (
            <div className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
              {adminKeyConfigured
                ? 'Your admin OpenRouter key is loaded from the server .env file (OPENROUTER_API_KEY). It is not stored in the database.'
                : 'Set OPENROUTER_API_KEY in your server .env file and restart the app to enable AI Insights.'}
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">OpenRouter API Key</label>
              <input
                type="password"
                value={openRouterKey}
                onChange={(e) => setOpenRouterKey(e.target.value)}
                placeholder={existingKeys?.find((k) => k?.provider === 'openrouter')?.hasKey ? '•••••• (configured)' : 'Enter OpenRouter key...'}
                className="w-full px-3 py-2 bg-secondary border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#00c853]"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">Stored for your account only. Used server-side for your AI Insights requests.</p>
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving || !canSave}
            className="w-full py-2 bg-[#00c853] hover:bg-[#00c853]/90 text-white font-medium rounded-md text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : null}
            {saved ? 'Saved!' : 'Save Keys'}
          </button>
        </div>
      </div>
    </div>
  );
}
