'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Save, X } from 'lucide-react';
import { Area, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { PaperTrade } from './journal-types';

interface TradeDetailDrawerProps {
  trade: PaperTrade | null;
  onClose: () => void;
  onChanged: () => void;
}

const EMOTIONS = ['calm', 'focused', 'confident', 'anxious', 'fomo', 'frustrated', 'revenge'];
const MISTAKES = ['early_entry', 'late_entry', 'moved_stop', 'oversized', 'early_exit', 'late_exit', 'overtraded'];

function money(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return `${Number(value) >= 0 ? '' : '-'}$${Math.abs(Number(value)).toFixed(2)}`;
}

function metric(value: number | null | undefined, suffix = '') {
  return value == null || !Number.isFinite(Number(value)) ? '—' : `${Number(value).toFixed(2)}${suffix}`;
}

function unwrapTrade(data: any): PaperTrade {
  const trade = data?.trade ?? data;
  const numberOrNull = (value: unknown) => value == null ? null : Number(value);
  const plannedRisk = Number(trade?.plannedRisk ?? 0);
  return {
    ...trade,
    qty: Number(trade?.qty ?? 0),
    avgEntry: numberOrNull(trade?.avgEntry),
    avgExit: numberOrNull(trade?.avgExit),
    realizedPnl: numberOrNull(trade?.realizedPnl),
    realizedR: numberOrNull(trade?.realizedR),
    plannedEntry: numberOrNull(trade?.plannedEntry),
    plannedStop: numberOrNull(trade?.plannedStop),
    plannedTarget: numberOrNull(trade?.plannedTarget),
    plannedRisk: numberOrNull(trade?.plannedRisk),
    stopPrice: numberOrNull(trade?.stopPrice ?? trade?.stop),
    targetPrice: numberOrNull(trade?.targetPrice ?? trade?.target),
    mfe: numberOrNull(trade?.mfe),
    mae: numberOrNull(trade?.mae),
    mfeR: trade?.mfeR == null && plannedRisk > 0 && trade?.mfe != null ? Number(trade.mfe) / plannedRisk : numberOrNull(trade?.mfeR),
    maeR: trade?.maeR == null && plannedRisk > 0 && trade?.mae != null ? Number(trade.mae) / plannedRisk : numberOrNull(trade?.maeR),
    exitEfficiency: numberOrNull(trade?.exitEfficiency),
    fills: Array.isArray(trade?.fills) ? trade.fills.map((fill: any) => ({
      ...fill,
      action: fill.action ?? fill.side,
      kind: fill.kind ?? fill.type,
      qty: Number(fill.qty),
      price: Number(fill.price),
    })) : [],
  } as PaperTrade;
}

export function TradeDetailDrawer({ trade, onClose, onChanged }: TradeDetailDrawerProps) {
  const [current, setCurrent] = useState<PaperTrade | null>(trade);
  const [history, setHistory] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fillKind, setFillKind] = useState<'ADD' | 'REDUCE'>('ADD');
  const [fillQty, setFillQty] = useState('');
  const [fillPrice, setFillPrice] = useState('');
  const [workingStop, setWorkingStop] = useState('');
  const [workingTarget, setWorkingTarget] = useState('');
  const [planFollowed, setPlanFollowed] = useState<boolean | null>(null);
  const [rating, setRating] = useState('');
  const [emotionTags, setEmotionTags] = useState<string[]>([]);
  const [mistakeTags, setMistakeTags] = useState<string[]>([]);
  const [managementNotes, setManagementNotes] = useState('');
  const [postNotes, setPostNotes] = useState('');

  useEffect(() => {
    setCurrent(trade);
    setPlanFollowed(trade?.planFollowed ?? null);
    setRating(trade?.rating ? String(trade.rating) : '');
    setEmotionTags(trade?.emotionTags ?? []);
    setMistakeTags(trade?.mistakeTags ?? []);
    setManagementNotes(trade?.managementNotes ?? '');
    setPostNotes(trade?.postNotes ?? '');
    setFillQty('');
    setFillPrice(trade?.currentPrice ? String(trade.currentPrice) : '');
    setWorkingStop(trade?.stopPrice ? String(trade.stopPrice) : '');
    setWorkingTarget(trade?.targetPrice ? String(trade.targetPrice) : '');
    setError(null);
    if (!trade) return;
    void fetch(`/api/market/historical?symbol=${encodeURIComponent(trade.symbol)}&period=1y`, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : [])
      .then((data) => setHistory(Array.isArray(data) ? data : data?.items ?? []));
  }, [trade]);

  const chartData = useMemo(() => history.map((bar) => ({
    date: bar?.date ?? '',
    close: Number(bar?.close ?? 0),
  })).filter((bar) => bar.close > 0), [history]);

  const patch = async (body: Record<string, unknown>) => {
    if (!current) return null;
    const response = await fetch(`/api/paper/trades/${current.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || 'Could not update the trade.');
    const updated = unwrapTrade(data);
    setCurrent(updated);
    return updated;
  };

  const saveReview = async () => {
    setSaving(true);
    setError(null);
    try {
      await patch({
        planFollowed,
        rating: rating ? Number(rating) : null,
        emotionTags,
        mistakeTags,
        managementNotes: managementNotes.trim() || null,
        postNotes: postNotes.trim() || null,
      });
      onChanged();
    } catch (saveError: any) {
      setError(saveError?.message || 'Could not save journal notes.');
    } finally {
      setSaving(false);
    }
  };

  const addFill = async () => {
    if (!current) return;
    const qty = Number(fillQty);
    const price = Number(fillPrice);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) {
      setError('Fill quantity and price must be positive.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const opening = fillKind === 'ADD';
      const action = current.side === 'LONG'
        ? opening ? 'BUY' : 'SELL'
        : opening ? 'SELL' : 'BUY';
      const response = await fetch(`/api/paper/trades/${current.id}/fills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: fillKind, side: action, qty, price, filledAt: new Date().toISOString() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Could not add the fill.');
      setCurrent(unwrapTrade(data));
      setFillQty('');
      onChanged();
    } catch (fillError: any) {
      setError(fillError?.message || 'Could not add the fill.');
    } finally {
      setSaving(false);
    }
  };

  const saveLevels = async () => {
    const stop = Number(workingStop);
    const target = Number(workingTarget);
    if (!Number.isFinite(stop) || stop <= 0 || !Number.isFinite(target) || target <= 0) {
      setError('Stop and target must be positive.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await patch({ stop, target });
      onChanged();
    } catch (levelError: any) {
      setError(levelError?.message || 'Could not update stop and target.');
    } finally {
      setSaving(false);
    }
  };

  const closeTrade = async () => {
    if (!current) return;
    const price = Number(fillPrice || current.currentPrice);
    if (!Number.isFinite(price) || price <= 0) {
      setError('Enter a valid exit price.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/paper/trades/${current.id}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price, filledAt: new Date().toISOString() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Could not close the trade.');
      setCurrent(unwrapTrade(data));
      onChanged();
    } catch (closeError: any) {
      setError(closeError?.message || 'Could not close the trade.');
    } finally {
      setSaving(false);
    }
  };

  if (!current) return null;

  const toggleTag = (tag: string, values: string[], setter: (next: string[]) => void) => {
    setter(values.includes(tag) ? values.filter((value) => value !== tag) : [...values, tag]);
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/60" onClick={onClose}>
      <aside className="ml-auto h-full w-full max-w-3xl overflow-y-auto border-l border-border bg-card shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 px-5 py-4 backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xl font-bold text-[#00c853]">{current.symbol}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${current.side === 'LONG' ? 'bg-[#00c853]/10 text-[#00c853]' : 'bg-[#ff1744]/10 text-[#ff1744]'}`}>{current.side}</span>
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{current.status}</span>
          </div>
          <button onClick={onClose} className="rounded-md p-2 text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
        </header>

        <div className="space-y-5 p-5">
          <section className="grid gap-3 sm:grid-cols-4">
            {[
              ['Quantity', Number(current.qty || 0).toLocaleString()],
              ['Average entry', money(current.avgEntry)],
              [current.status === 'CLOSED' ? 'Realized P&L' : 'Unrealized P&L', money(current.status === 'CLOSED' ? current.realizedPnl : current.unrealizedPnl)],
              [current.status === 'CLOSED' ? 'Realized R' : 'Unrealized R', metric(current.status === 'CLOSED' ? current.realizedR : current.unrealizedR, 'R')],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border bg-secondary/30 p-3">
                <p className="text-[10px] text-muted-foreground">{label}</p>
                <p className="mt-1 font-mono text-sm font-semibold">{value}</p>
              </div>
            ))}
          </section>

          <section className="h-56 rounded-lg border border-border bg-secondary/20 p-3">
            {chartData.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#777' }} interval="preserveStartEnd" />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 9, fill: '#777' }} width={50} />
                  <Tooltip contentStyle={{ background: '#171720', border: '1px solid #2a2a35', borderRadius: 8, fontSize: 11 }} />
                  <Area dataKey="close" stroke="#60B5FF" fill="#60B5FF18" dot={false} />
                  {current.avgEntry != null && <ReferenceLine y={current.avgEntry} stroke="#00c853" strokeDasharray="4 4" label={{ value: 'Entry', fill: '#00c853', fontSize: 9 }} />}
                  {current.stopPrice != null && <ReferenceLine y={current.stopPrice} stroke="#ff1744" strokeDasharray="4 4" label={{ value: 'Stop', fill: '#ff1744', fontSize: 9 }} />}
                  {current.targetPrice != null && <ReferenceLine y={current.targetPrice} stroke="#ffa726" strokeDasharray="4 4" label={{ value: 'Target', fill: '#ffa726', fontSize: 9 }} />}
                  {current.avgExit != null && <ReferenceLine y={current.avgExit} stroke="#A19AD3" strokeDasharray="4 4" label={{ value: 'Exit', fill: '#A19AD3', fontSize: 9 }} />}
                </ComposedChart>
              </ResponsiveContainer>
            ) : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Chart data unavailable</div>}
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-secondary/20 p-4">
              <h3 className="mb-3 text-sm font-semibold">Plan</h3>
              <dl className="space-y-2 text-xs">
                <div><dt className="text-muted-foreground">Thesis</dt><dd className="mt-1 leading-relaxed">{current.thesis}</dd></div>
                <div><dt className="text-muted-foreground">Invalidation</dt><dd className="mt-1 leading-relaxed">{current.invalidation}</dd></div>
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <div><dt className="text-muted-foreground">Entry</dt><dd className="font-mono">{money(current.plannedEntry)}</dd></div>
                  <div><dt className="text-muted-foreground">Stop</dt><dd className="font-mono">{money(current.plannedStop)}</dd></div>
                  <div><dt className="text-muted-foreground">Target</dt><dd className="font-mono">{money(current.plannedTarget)}</dd></div>
                </div>
              </dl>
            </div>
            <div className="rounded-lg border border-border bg-secondary/20 p-4">
              <h3 className="mb-3 text-sm font-semibold">Execution quality</h3>
              <dl className="grid grid-cols-2 gap-3 text-xs">
                {[
                  ['MFE', metric(current.mfeR, 'R')],
                  ['MAE', metric(current.maeR, 'R')],
                  ['Exit efficiency', metric(current.exitEfficiency, '%')],
                  ['Process grade', current.rating ? `${current.rating}/5` : '—'],
                ].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 font-mono font-semibold">{value}</dd></div>)}
              </dl>
            </div>
          </section>

          {current.status === 'OPEN' && (
            <section className="rounded-lg border border-border p-4">
              <h3 className="mb-3 text-sm font-semibold">Manage position</h3>
              <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <input type="number" min="0" step="0.01" value={workingStop} onChange={(event) => setWorkingStop(event.target.value)} placeholder="Working stop" className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm" />
                <input type="number" min="0" step="0.01" value={workingTarget} onChange={(event) => setWorkingTarget(event.target.value)} placeholder="Working target" className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm" />
                <button onClick={() => void saveLevels()} disabled={saving} className="inline-flex items-center justify-center gap-1 rounded-md border border-border px-3 py-2 text-xs hover:bg-secondary"><Save className="h-3.5 w-3.5" /> Save levels</button>
              </div>
              <div className="grid gap-2 sm:grid-cols-[110px_1fr_1fr_auto_auto]">
                <select value={fillKind} onChange={(event) => setFillKind(event.target.value as 'ADD' | 'REDUCE')} className="rounded-md border border-border bg-background px-2 py-2 text-sm">
                  <option value="ADD">Add</option>
                  <option value="REDUCE">Reduce</option>
                </select>
                <input type="number" min="0" step="1" value={fillQty} onChange={(event) => setFillQty(event.target.value)} placeholder="Quantity" className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm" />
                <input type="number" min="0" step="0.01" value={fillPrice} onChange={(event) => setFillPrice(event.target.value)} placeholder="Price" className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm" />
                <button onClick={() => void addFill()} disabled={saving} className="inline-flex items-center justify-center gap-1 rounded-md border border-border px-3 py-2 text-xs hover:bg-secondary"><Plus className="h-3.5 w-3.5" /> Fill</button>
                <button onClick={() => void closeTrade()} disabled={saving} className="rounded-md bg-[#ff1744] px-3 py-2 text-xs font-semibold text-white hover:opacity-90">Exit all</button>
              </div>
            </section>
          )}

          <section className="rounded-lg border border-border p-4">
            <h3 className="mb-3 text-sm font-semibold">Post-trade review</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-muted-foreground">
                Followed the plan?
                <select value={planFollowed == null ? '' : String(planFollowed)} onChange={(event) => setPlanFollowed(event.target.value === '' ? null : event.target.value === 'true')} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
                  <option value="">Not reviewed</option><option value="true">Yes</option><option value="false">No</option>
                </select>
              </label>
              <label className="text-xs text-muted-foreground">
                Process rating
                <select value={rating} onChange={(event) => setRating(event.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
                  <option value="">Not rated</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} / 5</option>)}
                </select>
              </label>
            </div>

            <div className="mt-3">
              <p className="mb-1.5 text-xs text-muted-foreground">Emotions</p>
              <div className="flex flex-wrap gap-1.5">{EMOTIONS.map((tag) => <button key={tag} onClick={() => toggleTag(tag, emotionTags, setEmotionTags)} className={`rounded-full border px-2 py-1 text-[10px] capitalize ${emotionTags.includes(tag) ? 'border-[#60B5FF]/40 bg-[#60B5FF]/10 text-[#60B5FF]' : 'border-border text-muted-foreground'}`}>{tag}</button>)}</div>
            </div>
            <div className="mt-3">
              <p className="mb-1.5 text-xs text-muted-foreground">Mistakes</p>
              <div className="flex flex-wrap gap-1.5">{MISTAKES.map((tag) => <button key={tag} onClick={() => toggleTag(tag, mistakeTags, setMistakeTags)} className={`rounded-full border px-2 py-1 text-[10px] capitalize ${mistakeTags.includes(tag) ? 'border-[#ff1744]/40 bg-[#ff1744]/10 text-[#ff1744]' : 'border-border text-muted-foreground'}`}>{tag.replace(/_/g, ' ')}</button>)}</div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-muted-foreground">Management notes<textarea value={managementNotes} onChange={(event) => setManagementNotes(event.target.value)} rows={3} className="mt-1 w-full resize-none rounded-md border border-border bg-background p-2 text-sm text-foreground" /></label>
              <label className="text-xs text-muted-foreground">Lesson / post-trade notes<textarea value={postNotes} onChange={(event) => setPostNotes(event.target.value)} rows={3} className="mt-1 w-full resize-none rounded-md border border-border bg-background p-2 text-sm text-foreground" /></label>
            </div>
            <button onClick={() => void saveReview()} disabled={saving} className="mt-3 inline-flex items-center gap-2 rounded-md bg-[#00c853] px-4 py-2 text-xs font-semibold text-black disabled:opacity-50">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save review
            </button>
          </section>

          <section className="rounded-lg border border-border p-4">
            <h3 className="mb-3 text-sm font-semibold">Fill timeline</h3>
            {(current.fills?.length ?? 0) === 0 ? <p className="text-xs text-muted-foreground">No fills recorded.</p> : (
              <div className="space-y-2">{current.fills?.map((fill) => (
                <div key={fill.id} className="flex items-center justify-between rounded-md bg-secondary/30 px-3 py-2 text-xs">
                  <span><span className={fill.action === 'BUY' ? 'text-[#00c853]' : 'text-[#ff1744]'}>{fill.action}</span> {fill.qty} · {fill.kind}</span>
                  <span className="font-mono">{money(fill.price)} · {new Date(fill.filledAt).toLocaleString()}</span>
                </div>
              ))}</div>
            )}
          </section>

          {error && <div className="rounded-md border border-[#ff1744]/30 bg-[#ff1744]/10 px-3 py-2 text-xs text-[#ff1744]">{error}</div>}
        </div>
      </aside>
    </div>
  );
}
