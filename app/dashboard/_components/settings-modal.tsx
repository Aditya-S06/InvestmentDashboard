'use client';

import { useState, useEffect } from 'react';
import { X, Key, Check, Loader2 } from 'lucide-react';

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [alphaVantageKey, setAlphaVantageKey] = useState('');
  const [polygonKey, setPolygonKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [existingKeys, setExistingKeys] = useState<{ provider: string; hasKey: boolean }[]>([]);

  useEffect(() => {
    fetch('/api/settings/apikeys')
      .then(r => r.ok ? r.json() : [])
      .then(data => setExistingKeys(data ?? []))
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
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ }
    setSaving(false);
  };

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
            Optional API keys for enhanced data. All features work without them using Yahoo Finance.
          </p>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Alpha Vantage API Key</label>
            <input
              type="password"
              value={alphaVantageKey}
              onChange={(e) => setAlphaVantageKey(e.target.value)}
              placeholder={existingKeys?.find(k => k?.provider === 'alpha_vantage')?.hasKey ? '•••••• (configured)' : 'Enter API key...'}
              className="w-full px-3 py-2 bg-secondary border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#00c853]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Polygon.io API Key</label>
            <input
              type="password"
              value={polygonKey}
              onChange={(e) => setPolygonKey(e.target.value)}
              placeholder={existingKeys?.find(k => k?.provider === 'polygon')?.hasKey ? '•••••• (configured)' : 'Enter API key...'}
              className="w-full px-3 py-2 bg-secondary border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#00c853]"
            />
          </div>

          <button
            onClick={handleSave}
            disabled={saving || (!alphaVantageKey?.trim() && !polygonKey?.trim())}
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
