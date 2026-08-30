'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  BookOpen,
  History,
  Loader2,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import type { PersonalAnalytics, PersonalReview, PersonalTrade } from './personal-types';

type Tab = 'trades' | 'analytics' | 'reviews';

const EMPTY_ANALYTICS: PersonalAnalytics = {
  summary: { netPnl: 0, winRate: 0, profitFactor: 0, expectancy: 0, totalTrades: 0 },
  equityCurve: [],
  calendar: [],
};

function numeric(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function money(value: unknown) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(numeric(value));
}

function signedMoney(value: unknown) {
  const number = numeric(value);
  return `${number > 0 ? '+' : ''}${money(number)}`;
}

function normalizeTrade(raw: any): PersonalTrade {
  const trade = raw?.trade ?? raw;
  return {
    ...trade,
    entryPrice: numeric(trade.entryPrice),
    exitPrice: trade.exitPrice == null ? null : numeric(trade.exitPrice),
    stop: trade.stop == null ? null : numeric(trade.stop),
    target: trade.target == null ? null : numeric(trade.target),
    qty: numeric(trade.qty),
    fees: trade.fees == null ? null : numeric(trade.fees),
    realizedPnl: trade.realizedPnl == null ? null : numeric(trade.realizedPnl),
    rating: trade.rating == null ? null : numeric(trade.rating),
  };
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'Request failed.');
  return data;
}

const emptyForm = {
  symbol: '',
  side: 'LONG' as 'LONG' | 'SHORT',
  broker: '',
  entryPrice: '',
  exitPrice: '',
  qty: '',
  stop: '',
  target: '',
  fees: '0',
  openedAt: new Date().toISOString().slice(0, 10),
  closedAt: '',
  thesis: '',
  invalidation: '',
  setupTag: '',
  strategyTag: '',
  preNotes: '',
  postNotes: '',
  status: 'OPEN' as 'OPEN' | 'CLOSED',
};

export function PersonalJournalClient() {
  const [tab, setTab] = useState<Tab>('trades');
  const [trades, setTrades] = useState<PersonalTrade[]>([]);
  const [analytics, setAnalytics] = useState<PersonalAnalytics>(EMPTY_ANALYTICS);
  const [reviews, setReviews] = useState<PersonalReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [selected, setSelected] = useState<PersonalTrade | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN' | 'CLOSED'>('ALL');
  const [reviewForm, setReviewForm] = useState({
    periodType: 'DAY' as 'DAY' | 'WEEK',
    periodStart: new Date().toISOString().slice(0, 10),
    grade: '4',
    whatWentWell: '',
    whatToImprove: '',
    focusNext: '',
  });
  const [savingReview, setSavingReview] = useState(false);
  const [noteDraft, setNoteDraft] = useState({ preNotes: '', postNotes: '', rating: '', planFollowed: '' });

  const loadData = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const [tradesRes, analyticsRes, reviewsRes] = await Promise.all([
        fetch('/api/journal/trades?limit=100', { cache: 'no-store' }),
        fetch('/api/journal/analytics', { cache: 'no-store' }),
        fetch('/api/journal/reviews', { cache: 'no-store' }),
      ]);
      const [tradesData, analyticsData, reviewsData] = await Promise.all([
        readJson(tradesRes),
        readJson(analyticsRes),
        readJson(reviewsRes),
      ]);
      const items = Array.isArray(tradesData) ? tradesData : tradesData?.items ?? [];
      setTrades(items.map(normalizeTrade));
      setAnalytics(analyticsData?.summary ? analyticsData : EMPTY_ANALYTICS);
      const reviewItems = Array.isArray(reviewsData) ? reviewsData : reviewsData?.items ?? [];
      setReviews(reviewItems.map((review: any) => ({
        ...review,
        periodType: review.periodType ?? review.reviewType,
        netPnl: review.netPnl == null ? null : numeric(review.netPnl),
      })));
    } catch (loadError: any) {
      setError(loadError?.message || 'Could not load your trade journal.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!selected) return;
    setNoteDraft({
      preNotes: selected.preNotes ?? '',
      postNotes: selected.postNotes ?? '',
      rating: selected.rating == null ? '' : String(selected.rating),
      planFollowed: selected.planFollowed == null ? '' : selected.planFollowed ? 'yes' : 'no',
    });
  }, [selected]);

  const filtered = useMemo(
    () => trades.filter((trade) => statusFilter === 'ALL' || trade.status === statusFilter),
    [trades, statusFilter],
  );

  const saveTrade = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        symbol: form.symbol,
        side: form.side,
        status: form.status,
        broker: form.broker || undefined,
        entryPrice: form.entryPrice,
        exitPrice: form.exitPrice || undefined,
        qty: form.qty,
        stop: form.stop || undefined,
        target: form.target || undefined,
        fees: form.fees || 0,
        openedAt: form.openedAt,
        closedAt: form.closedAt || undefined,
        thesis: form.thesis || undefined,
        invalidation: form.invalidation || undefined,
        setupTag: form.setupTag || undefined,
        strategyTag: form.strategyTag || undefined,
        preNotes: form.preNotes || undefined,
        postNotes: form.postNotes || undefined,
      };
      const response = await fetch('/api/journal/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await readJson(response);
      setFormOpen(false);
      setForm(emptyForm);
      await loadData(true);
    } catch (saveError: any) {
      setError(saveError?.message || 'Could not save the trade.');
    } finally {
      setSaving(false);
    }
  };

  const saveNotes = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/journal/trades/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preNotes: noteDraft.preNotes,
          postNotes: noteDraft.postNotes,
          rating: noteDraft.rating === '' ? null : Number(noteDraft.rating),
          planFollowed:
            noteDraft.planFollowed === ''
              ? null
              : noteDraft.planFollowed === 'yes',
        }),
      });
      const data = await readJson(response);
      const next = normalizeTrade(data);
      setSelected(next);
      setTrades((current) => current.map((trade) => (trade.id === next.id ? next : trade)));
    } catch (saveError: any) {
      setError(saveError?.message || 'Could not save notes.');
    } finally {
      setSaving(false);
    }
  };

  const closeSelected = async () => {
    if (!selected || selected.status === 'CLOSED') return;
    const exitPrice = window.prompt('Exit price', selected.exitPrice == null ? '' : String(selected.exitPrice));
    if (exitPrice == null || !exitPrice.trim()) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/journal/trades/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CLOSED', exitPrice, closedAt: new Date().toISOString() }),
      });
      const data = await readJson(response);
      const next = normalizeTrade(data);
      setSelected(next);
      await loadData(true);
    } catch (closeError: any) {
      setError(closeError?.message || 'Could not close the trade.');
    } finally {
      setSaving(false);
    }
  };

  const deleteSelected = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete ${selected.symbol} journal entry?`)) return;
    const response = await fetch(`/api/journal/trades/${selected.id}`, { method: 'DELETE' });
    await readJson(response);
    setSelected(null);
    await loadData(true);
  };

  const saveReview = async () => {
    setSavingReview(true);
    setError(null);
    try {
      const response = await fetch('/api/journal/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewType: reviewForm.periodType,
          periodStart: reviewForm.periodStart,
          grade: Number(reviewForm.grade),
          whatWentWell: reviewForm.whatWentWell,
          whatToImprove: reviewForm.whatToImprove,
          focusNext: reviewForm.focusNext,
        }),
      });
      await readJson(response);
      setReviewForm((current) => ({ ...current, whatWentWell: '', whatToImprove: '', focusNext: '' }));
      await loadData(true);
    } catch (reviewError: any) {
      setError(reviewError?.message || 'Could not save the review.');
    } finally {
      setSavingReview(false);
    }
  };

  const summary = analytics.summary;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="flex h-9 w-9 items-center justify-center rounded-md border border-[#60B5FF]/30 bg-[#60B5FF]/10">
              <BookOpen className="h-4 w-4 text-[#60B5FF]" />
            </div>
            <div>
              <h1 className="font-display text-base font-semibold tracking-tight">Trade Journal</h1>
              <p className="text-xs text-muted-foreground">Personal / live trades — not paper simulation</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Link
              href="/dashboard/paper"
              className="rounded-md px-2.5 py-2 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              Open paper sim
            </Link>
            <button onClick={() => void loadData(true)} disabled={refreshing} className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" title="Refresh">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => {
                setForm(emptyForm);
                setFormOpen(true);
              }}
              className="ml-1 inline-flex items-center gap-1.5 rounded-md bg-[#60B5FF] px-3 py-2 text-xs font-semibold text-black hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" /> Log trade
            </button>
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto px-4">
          {([
            ['trades', 'Trades', History],
            ['analytics', 'Analytics', BookOpen],
            ['reviews', 'Reviews', BookOpen],
          ] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                tab === id ? 'border-[#60B5FF] text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
      </header>

      <div className="border-b border-[#60B5FF]/20 bg-[#60B5FF]/5 px-4 py-2 text-center text-[10px] text-[#60B5FF]">
        PERSONAL JOURNAL — log your real broker trades here. Paper simulation lives under Paper Portfolio.
      </div>

      <main className="mx-auto max-w-6xl p-4 sm:p-6">
        {error && <div className="mb-4 rounded-md border border-[#ff1744]/30 bg-[#ff1744]/10 px-4 py-3 text-xs text-[#ff1744]">{error}</div>}

        {loading ? (
          <div className="flex min-h-[420px] items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-[#60B5FF]" /> Loading journal...
          </div>
        ) : (
          <>
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Net P&amp;L" value={signedMoney(summary.netPnl)} tone={summary.netPnl >= 0 ? 'pos' : 'neg'} />
              <Stat label="Win rate" value={`${numeric(summary.winRate).toFixed(1)}%`} />
              <Stat label="Expectancy" value={signedMoney(summary.expectancy)} />
              <Stat label="Trades" value={String(summary.totalTrades)} />
            </div>

            {tab === 'trades' && (
              <section className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {(['ALL', 'OPEN', 'CLOSED'] as const).map((value) => (
                    <button
                      key={value}
                      onClick={() => setStatusFilter(value)}
                      className={`rounded-md px-2.5 py-1.5 text-[11px] ${statusFilter === value ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                {filtered.length === 0 ? (
                  <EmptyState onAdd={() => setFormOpen(true)} />
                ) : (
                  <div className="overflow-hidden rounded-md border border-border">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-secondary/40 text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">Symbol</th>
                          <th className="px-3 py-2 font-medium">Side</th>
                          <th className="px-3 py-2 font-medium">Status</th>
                          <th className="px-3 py-2 font-medium">Entry</th>
                          <th className="px-3 py-2 font-medium">Exit</th>
                          <th className="px-3 py-2 font-medium">P&amp;L</th>
                          <th className="px-3 py-2 font-medium">Opened</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((trade) => (
                          <tr
                            key={trade.id}
                            onClick={() => setSelected(trade)}
                            className="cursor-pointer border-t border-border hover:bg-secondary/30"
                          >
                            <td className="px-3 py-2 font-mono font-semibold">
                              {trade.symbol}
                              {trade.broker === 'webull' && (
                                <span className="ml-2 rounded-full border border-[#00c853]/30 px-1.5 py-0.5 text-[9px] font-sans font-medium text-[#00c853]">
                                  synced
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2">{trade.side}</td>
                            <td className="px-3 py-2">{trade.status}</td>
                            <td className="px-3 py-2 font-mono">{money(trade.entryPrice)}</td>
                            <td className="px-3 py-2 font-mono">{trade.exitPrice == null ? '—' : money(trade.exitPrice)}</td>
                            <td className={`px-3 py-2 font-mono ${numeric(trade.realizedPnl) >= 0 ? 'text-[#00c853]' : 'text-[#ff1744]'}`}>
                              {trade.realizedPnl == null ? '—' : signedMoney(trade.realizedPnl)}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{trade.openedAt.slice(0, 10)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {tab === 'analytics' && (
              <section className="space-y-4">
                <div className="rounded-md border border-border p-4">
                  <h2 className="mb-3 text-sm font-semibold">Closed-trade calendar</h2>
                  {analytics.calendar.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No closed personal trades yet.</p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {analytics.calendar.slice(-30).reverse().map((day) => (
                        <div key={day.date} className="rounded-md border border-border px-3 py-2 text-xs">
                          <div className="text-muted-foreground">{day.date}</div>
                          <div className={`font-mono ${day.pnl >= 0 ? 'text-[#00c853]' : 'text-[#ff1744]'}`}>{signedMoney(day.pnl)}</div>
                          <div className="text-muted-foreground">{day.trades} trade{day.trades === 1 ? '' : 's'}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}

            {tab === 'reviews' && (
              <section className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-md border border-border p-4">
                  <h2 className="mb-3 text-sm font-semibold">New review</h2>
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={reviewForm.periodType}
                        onChange={(e) => setReviewForm((c) => ({ ...c, periodType: e.target.value as 'DAY' | 'WEEK' }))}
                        className="rounded-md border border-border bg-background px-2 py-2 text-xs"
                      >
                        <option value="DAY">Day</option>
                        <option value="WEEK">Week</option>
                      </select>
                      <input
                        type="date"
                        value={reviewForm.periodStart}
                        onChange={(e) => setReviewForm((c) => ({ ...c, periodStart: e.target.value }))}
                        className="rounded-md border border-border bg-background px-2 py-2 text-xs"
                      />
                    </div>
                    <input
                      type="number"
                      min={1}
                      max={5}
                      value={reviewForm.grade}
                      onChange={(e) => setReviewForm((c) => ({ ...c, grade: e.target.value }))}
                      className="w-full rounded-md border border-border bg-background px-2 py-2 text-xs"
                      placeholder="Grade 1-5"
                    />
                    <textarea value={reviewForm.whatWentWell} onChange={(e) => setReviewForm((c) => ({ ...c, whatWentWell: e.target.value }))} className="min-h-20 w-full rounded-md border border-border bg-background px-2 py-2 text-xs" placeholder="What went well" />
                    <textarea value={reviewForm.whatToImprove} onChange={(e) => setReviewForm((c) => ({ ...c, whatToImprove: e.target.value }))} className="min-h-20 w-full rounded-md border border-border bg-background px-2 py-2 text-xs" placeholder="What to improve" />
                    <textarea value={reviewForm.focusNext} onChange={(e) => setReviewForm((c) => ({ ...c, focusNext: e.target.value }))} className="min-h-16 w-full rounded-md border border-border bg-background px-2 py-2 text-xs" placeholder="Focus next" />
                    <button onClick={() => void saveReview()} disabled={savingReview} className="rounded-md bg-[#60B5FF] px-3 py-2 text-xs font-semibold text-black hover:opacity-90 disabled:opacity-60">
                      {savingReview ? 'Saving...' : 'Save review'}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  {reviews.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No personal reviews yet.</p>
                  ) : (
                    reviews.map((review) => (
                      <div key={review.id} className="rounded-md border border-border p-3 text-xs">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="font-semibold">{review.periodType} · {review.periodStart.slice(0, 10)}</span>
                          <span className="text-muted-foreground">Grade {review.grade ?? '—'}</span>
                        </div>
                        <p className="text-muted-foreground">{review.whatWentWell || 'No notes'}</p>
                      </div>
                    ))
                  )}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      {formOpen && (
        <Modal title="Log personal trade" onClose={() => setFormOpen(false)}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Symbol"><input value={form.symbol} onChange={(e) => setForm((c) => ({ ...c, symbol: e.target.value.toUpperCase() }))} className="field" /></Field>
            <Field label="Side">
              <select value={form.side} onChange={(e) => setForm((c) => ({ ...c, side: e.target.value as 'LONG' | 'SHORT' }))} className="field">
                <option value="LONG">LONG</option>
                <option value="SHORT">SHORT</option>
              </select>
            </Field>
            <Field label="Status">
              <select value={form.status} onChange={(e) => setForm((c) => ({ ...c, status: e.target.value as 'OPEN' | 'CLOSED' }))} className="field">
                <option value="OPEN">OPEN</option>
                <option value="CLOSED">CLOSED</option>
              </select>
            </Field>
            <Field label="Broker"><input value={form.broker} onChange={(e) => setForm((c) => ({ ...c, broker: e.target.value }))} className="field" placeholder="Webull, Schwab..." /></Field>
            <Field label="Entry price"><input value={form.entryPrice} onChange={(e) => setForm((c) => ({ ...c, entryPrice: e.target.value }))} className="field" /></Field>
            <Field label="Exit price"><input value={form.exitPrice} onChange={(e) => setForm((c) => ({ ...c, exitPrice: e.target.value }))} className="field" placeholder="Required if closed" /></Field>
            <Field label="Qty"><input value={form.qty} onChange={(e) => setForm((c) => ({ ...c, qty: e.target.value }))} className="field" /></Field>
            <Field label="Fees"><input value={form.fees} onChange={(e) => setForm((c) => ({ ...c, fees: e.target.value }))} className="field" /></Field>
            <Field label="Opened"><input type="date" value={form.openedAt} onChange={(e) => setForm((c) => ({ ...c, openedAt: e.target.value }))} className="field" /></Field>
            <Field label="Closed"><input type="date" value={form.closedAt} onChange={(e) => setForm((c) => ({ ...c, closedAt: e.target.value }))} className="field" /></Field>
            <Field label="Stop"><input value={form.stop} onChange={(e) => setForm((c) => ({ ...c, stop: e.target.value }))} className="field" /></Field>
            <Field label="Target"><input value={form.target} onChange={(e) => setForm((c) => ({ ...c, target: e.target.value }))} className="field" /></Field>
          </div>
          <Field label="Thesis"><textarea value={form.thesis} onChange={(e) => setForm((c) => ({ ...c, thesis: e.target.value }))} className="field min-h-16" /></Field>
          <Field label="Invalidation"><textarea value={form.invalidation} onChange={(e) => setForm((c) => ({ ...c, invalidation: e.target.value }))} className="field min-h-16" /></Field>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setFormOpen(false)} className="rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-secondary">Cancel</button>
            <button onClick={() => void saveTrade()} disabled={saving} className="rounded-md bg-[#60B5FF] px-3 py-2 text-xs font-semibold text-black hover:opacity-90 disabled:opacity-60">
              {saving ? 'Saving...' : 'Save trade'}
            </button>
          </div>
        </Modal>
      )}

      {selected && (
        <Modal title={`${selected.symbol} · ${selected.side}`} onClose={() => setSelected(null)}>
          <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
            <div>Status: <span className="font-semibold">{selected.status}</span></div>
            <div>P&amp;L: <span className="font-mono">{selected.realizedPnl == null ? '—' : signedMoney(selected.realizedPnl)}</span></div>
            <div>Entry: <span className="font-mono">{money(selected.entryPrice)}</span></div>
            <div>Exit: <span className="font-mono">{selected.exitPrice == null ? '—' : money(selected.exitPrice)}</span></div>
          </div>
          <Field label="Pre notes"><textarea value={noteDraft.preNotes} onChange={(e) => setNoteDraft((c) => ({ ...c, preNotes: e.target.value }))} className="field min-h-16" /></Field>
          <Field label="Post notes"><textarea value={noteDraft.postNotes} onChange={(e) => setNoteDraft((c) => ({ ...c, postNotes: e.target.value }))} className="field min-h-16" /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Rating (1-5)"><input value={noteDraft.rating} onChange={(e) => setNoteDraft((c) => ({ ...c, rating: e.target.value }))} className="field" /></Field>
            <Field label="Plan followed">
              <select value={noteDraft.planFollowed} onChange={(e) => setNoteDraft((c) => ({ ...c, planFollowed: e.target.value }))} className="field">
                <option value="">—</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            {selected.status === 'OPEN' && (
              <button onClick={() => void closeSelected()} className="rounded-md border border-border px-3 py-2 text-xs hover:bg-secondary">Close trade</button>
            )}
            <button onClick={() => void deleteSelected()} className="rounded-md border border-[#ff1744]/30 px-3 py-2 text-xs text-[#ff1744] hover:bg-[#ff1744]/10">Delete</button>
            <button onClick={() => void saveNotes()} disabled={saving} className="rounded-md bg-[#60B5FF] px-3 py-2 text-xs font-semibold text-black hover:opacity-90 disabled:opacity-60">
              {saving ? 'Saving...' : 'Save notes'}
            </button>
          </div>
        </Modal>
      )}

      <style jsx global>{`
        .field {
          width: 100%;
          border-radius: 0.375rem;
          border: 1px solid hsl(var(--border));
          background: hsl(var(--background));
          padding: 0.5rem 0.625rem;
          font-size: 0.75rem;
        }
      `}</style>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-sm font-semibold ${tone === 'pos' ? 'text-[#00c853]' : tone === 'neg' ? 'text-[#ff1744]' : ''}`}>
        {value}
      </div>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-md border border-dashed border-border px-6 py-16 text-center">
      <p className="text-sm text-muted-foreground">No personal trades logged yet.</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Live Webull fills sync here automatically; sandbox orders do not.
      </p>
      <button onClick={onAdd} className="mt-3 rounded-md bg-[#60B5FF] px-3 py-2 text-xs font-semibold text-black">
        Log your first trade
      </button>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-lg border border-border bg-card p-4 sm:rounded-lg">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-[11px] text-muted-foreground">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}
