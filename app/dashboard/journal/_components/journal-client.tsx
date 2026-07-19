'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  BarChart3,
  BookOpenCheck,
  CalendarDays,
  Download,
  History,
  LayoutDashboard,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Target,
  WalletCards,
} from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { JournalAnalytics, JournalReview, PaperAccount, PaperTrade } from './journal-types';
import { TradeDetailDrawer } from './trade-detail-drawer';
import { TradePlanModal } from './trade-plan-modal';

type Tab = 'overview' | 'positions' | 'trades' | 'analytics' | 'calendar' | 'reviews';

const TABS: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'positions', label: 'Positions', icon: WalletCards },
  { id: 'trades', label: 'Trades', icon: History },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'reviews', label: 'Reviews', icon: BookOpenCheck },
];

const EMPTY_ANALYTICS: JournalAnalytics = {
  summary: {
    netPnl: 0,
    winRate: 0,
    profitFactor: 0,
    expectancy: 0,
    avgR: 0,
    planAdherencePct: 0,
    maxDrawdown: 0,
    currentDrawdown: 0,
    totalTrades: 0,
  },
  equityCurve: [],
  calendar: [],
  breakdowns: {},
};

function numeric(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function money(value: unknown, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(numeric(value));
}

function signedMoney(value: unknown, currency = 'USD') {
  const number = numeric(value);
  return `${number > 0 ? '+' : ''}${money(number, currency)}`;
}

function percent(value: unknown) {
  return `${numeric(value).toFixed(1)}%`;
}

function normalizeTrade(raw: any): PaperTrade {
  const trade = raw?.trade ?? raw;
  return {
    ...trade,
    plannedEntry: trade?.plannedEntry == null ? null : numeric(trade.plannedEntry),
    plannedStop: trade?.plannedStop == null ? null : numeric(trade.plannedStop),
    plannedTarget: trade?.plannedTarget == null ? null : numeric(trade.plannedTarget),
    plannedRisk: trade?.plannedRisk == null ? null : numeric(trade.plannedRisk),
    plannedRiskPct: trade?.plannedRiskPct == null ? null : numeric(trade.plannedRiskPct),
    plannedShares: trade?.plannedShares == null ? null : numeric(trade.plannedShares),
    qty: numeric(trade?.qty),
    avgEntry: trade?.avgEntry == null ? null : numeric(trade.avgEntry),
    avgExit: trade?.avgExit == null ? null : numeric(trade.avgExit),
    currentPrice: trade?.currentPrice == null && trade?.mark == null ? null : numeric(trade.currentPrice ?? trade.mark),
    unrealizedPnl: trade?.unrealizedPnl == null ? null : numeric(trade.unrealizedPnl),
    unrealizedR: (() => {
      if (trade?.unrealizedR != null) return numeric(trade.unrealizedR);
      const initialRisk = numeric(trade?.plannedRisk) || Math.abs(numeric(trade?.avgEntry) - numeric(trade?.stop)) * numeric(trade?.qty);
      return initialRisk > 0 && trade?.unrealizedPnl != null ? numeric(trade.unrealizedPnl) / initialRisk : null;
    })(),
    realizedPnl: trade?.realizedPnl == null ? null : numeric(trade.realizedPnl),
    realizedR: trade?.realizedR == null ? null : numeric(trade.realizedR),
    stopPrice: trade?.stopPrice == null && trade?.stop == null ? null : numeric(trade.stopPrice ?? trade.stop),
    targetPrice: trade?.targetPrice == null && trade?.target == null ? null : numeric(trade.targetPrice ?? trade.target),
    mfe: trade?.mfe == null ? null : numeric(trade.mfe),
    mae: trade?.mae == null ? null : numeric(trade.mae),
    mfeR: trade?.mfeR == null
      ? numeric(trade?.plannedRisk) > 0 && trade?.mfe != null ? numeric(trade.mfe) / numeric(trade.plannedRisk) : null
      : numeric(trade.mfeR),
    maeR: trade?.maeR == null
      ? numeric(trade?.plannedRisk) > 0 && trade?.mae != null ? numeric(trade.mae) / numeric(trade.plannedRisk) : null
      : numeric(trade.maeR),
    exitEfficiency: trade?.exitEfficiency == null ? null : numeric(trade.exitEfficiency),
    fills: Array.isArray(trade?.fills) ? trade.fills.map((fill: any) => ({
      ...fill,
      action: fill.action ?? fill.side,
      kind: fill.kind ?? fill.type,
      qty: numeric(fill.qty),
      price: numeric(fill.price),
    })) : [],
  };
}

function normalizeAccount(raw: any): PaperAccount {
  const account = raw?.account ?? raw;
  return {
    ...account,
    startingEquity: numeric(account?.startingEquity),
    cash: numeric(account?.cash),
    equity: account?.equity == null ? undefined : numeric(account.equity),
    marketValue: account?.marketValue == null && account?.grossExposure == null ? undefined : numeric(account.marketValue ?? account.grossExposure),
    unrealizedPnl: account?.unrealizedPnl == null ? undefined : numeric(account.unrealizedPnl),
    openRisk: account?.openRisk == null ? undefined : numeric(account.openRisk),
  };
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'Request failed.');
  return data;
}

export function JournalClient() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>('overview');
  const [account, setAccount] = useState<PaperAccount | null>(null);
  const [trades, setTrades] = useState<PaperTrade[]>([]);
  const [positions, setPositions] = useState<PaperTrade[]>([]);
  const [analytics, setAnalytics] = useState<JournalAnalytics>(EMPTY_ANALYTICS);
  const [reviews, setReviews] = useState<JournalReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [draftSymbol, setDraftSymbol] = useState('');
  const [draftThesis, setDraftThesis] = useState('');
  const [selectedTrade, setSelectedTrade] = useState<PaperTrade | null>(null);
  const [tradeFilter, setTradeFilter] = useState<'ALL' | PaperTrade['status']>('ALL');
  const [symbolFilter, setSymbolFilter] = useState('');
  const [reviewForm, setReviewForm] = useState({
    periodType: 'DAY' as 'DAY' | 'WEEK',
    periodStart: new Date().toISOString().slice(0, 10),
    grade: '4',
    whatWentWell: '',
    whatToImprove: '',
    focusNext: '',
  });
  const [savingReview, setSavingReview] = useState(false);

  const loadData = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const [accountResponse, tradesResponse, positionsResponse, analyticsResponse, reviewsResponse] = await Promise.all([
        fetch('/api/paper/account', { cache: 'no-store' }),
        fetch('/api/paper/trades', { cache: 'no-store' }),
        fetch('/api/paper/positions', { cache: 'no-store' }),
        fetch('/api/paper/analytics', { cache: 'no-store' }),
        fetch('/api/paper/reviews', { cache: 'no-store' }),
      ]);
      const [accountData, tradesData, positionsData, analyticsData, reviewsData] = await Promise.all([
        readJson(accountResponse),
        readJson(tradesResponse),
        readJson(positionsResponse),
        readJson(analyticsResponse),
        readJson(reviewsResponse),
      ]);

      const nextAccount = normalizeAccount(accountData);
      const tradeItems = Array.isArray(tradesData) ? tradesData : tradesData?.items ?? tradesData?.trades ?? [];
      const positionItems = Array.isArray(positionsData) ? positionsData : positionsData?.items ?? positionsData?.positions ?? [];
      setAccount(normalizeAccount({
        ...nextAccount,
        ...(positionsData?.account ?? {}),
        ...(positionsData?.summary ?? {}),
      }));
      setTrades(tradeItems.map(normalizeTrade));
      setPositions(positionItems.map(normalizeTrade));
      setAnalytics(normalizeAnalytics(analyticsData, nextAccount));
      const reviewItems = Array.isArray(reviewsData) ? reviewsData : reviewsData?.items ?? reviewsData?.reviews ?? [];
      setReviews(reviewItems.map((review: any) => ({
        ...review,
        periodType: review.periodType ?? review.reviewType,
        grade: review.grade == null ? null : numeric(review.grade),
        whatWentWell: review.whatWentWell ?? null,
        whatToImprove: review.whatToImprove ?? null,
        focusNext: review.focusNext ?? null,
        ruleAdherencePct: review.ruleAdherencePct == null
          ? review.adherenceSnapshot?.percent == null ? null : numeric(review.adherenceSnapshot.percent)
          : numeric(review.ruleAdherencePct),
        netPnl: review.netPnl == null ? null : numeric(review.netPnl),
      })));
    } catch (loadError: any) {
      setError(loadError?.message || 'Could not load the paper journal.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    const querySymbol = searchParams.get('symbol') ?? '';
    let thesis = '';
    try {
      const stored = JSON.parse(sessionStorage.getItem('oracle.paperTradeDraft') ?? '{}');
      thesis = typeof stored?.thesis === 'string' ? stored.thesis : '';
      if (!querySymbol && typeof stored?.symbol === 'string') setDraftSymbol(stored.symbol);
      sessionStorage.removeItem('oracle.paperTradeDraft');
    } catch {
      // Ignore malformed local draft state.
    }
    if (querySymbol) setDraftSymbol(querySymbol.toUpperCase());
    setDraftThesis(thesis);
    setPlanOpen(true);
  }, [searchParams]);

  const filteredTrades = useMemo(() => trades.filter((trade) => {
    if (tradeFilter !== 'ALL' && trade.status !== tradeFilter) return false;
    return !symbolFilter || trade.symbol.includes(symbolFilter.toUpperCase());
  }), [trades, tradeFilter, symbolFilter]);

  const openPlan = () => {
    setDraftSymbol('');
    setDraftThesis('');
    setPlanOpen(true);
  };

  const resetAccount = async () => {
    if (!window.confirm('Reset the paper account to its starting equity? This permanently deletes all paper trades and reviews.')) return;
    const startingEquityInput = window.prompt('Starting paper equity', String(account?.startingEquity ?? 100000));
    if (startingEquityInput == null) return;
    const startingEquity = Number(startingEquityInput);
    if (!Number.isFinite(startingEquity) || startingEquity <= 0) {
      setError('Starting equity must be positive.');
      return;
    }
    try {
      const response = await fetch('/api/paper/account/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startingEquity }),
      });
      await readJson(response);
      await loadData(true);
    } catch (resetError: any) {
      setError(resetError?.message || 'Could not reset the account.');
    }
  };

  const saveReview = async () => {
    setSavingReview(true);
    setError(null);
    try {
      const response = await fetch('/api/paper/reviews', {
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
  const currency = account?.currency ?? 'USD';

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="flex h-9 w-9 items-center justify-center rounded-md border border-[#00c853]/30 bg-[#00c853]/10">
              <BookOpenCheck className="h-4 w-4 text-[#00c853]" />
            </div>
            <div>
              <h1 className="font-display text-base font-semibold tracking-tight">Paper Portfolio &amp; Journal</h1>
              <p className="text-xs text-muted-foreground">Plan → enter → manage → review</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => void loadData(true)} disabled={refreshing} className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" title="Refresh">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <a href="/api/paper/export" className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" title="Export CSV">
              <Download className="h-4 w-4" />
            </a>
            <button onClick={() => void resetAccount()} className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" title="Reset paper account">
              <RotateCcw className="h-4 w-4" />
            </button>
            <button onClick={openPlan} className="ml-1 inline-flex items-center gap-1.5 rounded-md bg-[#00c853] px-3 py-2 text-xs font-semibold text-black hover:opacity-90">
              <Plus className="h-3.5 w-3.5" /> New trade
            </button>
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto px-4">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${tab === id ? 'border-[#00c853] text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
      </header>

      <div className="border-b border-[#ffa726]/20 bg-[#ffa726]/5 px-4 py-2 text-center text-[10px] text-[#ffa726]">
        PAPER / SIMULATION ONLY — no brokerage orders are placed.
      </div>

      <main className="mx-auto max-w-7xl p-4 sm:p-6">
        {error && <div className="mb-4 rounded-md border border-[#ff1744]/30 bg-[#ff1744]/10 px-4 py-3 text-xs text-[#ff1744]">{error}</div>}

        {loading ? (
          <div className="flex min-h-[420px] items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-[#00c853]" /> Loading your paper book...
          </div>
        ) : (
          <>
            {tab === 'overview' && (
              <OverviewTab account={account} analytics={analytics} currency={currency} positions={positions} onSelectTrade={setSelectedTrade} onNewTrade={openPlan} />
            )}
            {tab === 'positions' && (
              <PositionsTab positions={positions} currency={currency} onSelectTrade={setSelectedTrade} onNewTrade={openPlan} />
            )}
            {tab === 'trades' && (
              <TradesTab trades={filteredTrades} currency={currency} tradeFilter={tradeFilter} setTradeFilter={setTradeFilter} symbolFilter={symbolFilter} setSymbolFilter={setSymbolFilter} onSelectTrade={setSelectedTrade} />
            )}
            {tab === 'analytics' && <AnalyticsTab analytics={analytics} currency={currency} />}
            {tab === 'calendar' && <CalendarTab analytics={analytics} currency={currency} />}
            {tab === 'reviews' && (
              <ReviewsTab reviews={reviews} form={reviewForm} setForm={setReviewForm} saving={savingReview} onSave={() => void saveReview()} currency={currency} />
            )}
          </>
        )}
      </main>

      <TradePlanModal
        open={planOpen}
        initialSymbol={draftSymbol}
        initialThesis={draftThesis}
        onClose={() => setPlanOpen(false)}
        onSaved={() => void loadData(true)}
      />
      <TradeDetailDrawer trade={selectedTrade} onClose={() => setSelectedTrade(null)} onChanged={() => void loadData(true)} />
    </div>
  );
}

function OverviewTab({ account, analytics, currency, positions, onSelectTrade, onNewTrade }: {
  account: PaperAccount | null;
  analytics: JournalAnalytics;
  currency: string;
  positions: PaperTrade[];
  onSelectTrade: (trade: PaperTrade) => void;
  onNewTrade: () => void;
}) {
  const summary = analytics.summary;
  const equity = account?.equity ?? summary.equity ?? account?.cash ?? account?.startingEquity ?? 0;
  const pnl = account?.equity == null ? summary.netPnl : equity - numeric(account.startingEquity);
  const stats = [
    { label: 'Paper equity', value: money(equity, currency), tone: 'text-foreground' },
    { label: 'Net P&L', value: signedMoney(pnl, currency), tone: pnl >= 0 ? 'text-[#00c853]' : 'text-[#ff1744]' },
    { label: 'Expectancy', value: `${summary.expectancy.toFixed(2)}R`, tone: summary.expectancy >= 0 ? 'text-[#00c853]' : 'text-[#ff1744]' },
    { label: 'Profit factor', value: summary.profitFactor.toFixed(2), tone: 'text-[#60B5FF]' },
    { label: 'Win rate', value: percent(summary.winRate), tone: 'text-foreground' },
    { label: 'Plan adherence', value: percent(summary.planAdherencePct), tone: 'text-[#A19AD3]' },
    { label: 'Current drawdown', value: percent(summary.currentDrawdown), tone: 'text-[#ffa726]' },
    { label: 'Open risk', value: money(account?.openRisk ?? 0, currency), tone: 'text-[#ffa726]' },
  ];

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border border-border bg-card p-4">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{stat.label}</p>
            <p className={`mt-1 font-mono text-xl font-bold ${stat.tone}`}>{stat.value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div><h2 className="font-display text-sm font-semibold">Equity curve</h2><p className="text-[10px] text-muted-foreground">Closed-trade equity over time</p></div>
            <span className="font-mono text-xs text-muted-foreground">{summary.totalTrades} closed trades</span>
          </div>
          <div className="h-72">
            {analytics.equityCurve.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={analytics.equityCurve}>
                  <defs><linearGradient id="journalEquity" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#00c853" stopOpacity={0.3} /><stop offset="95%" stopColor="#00c853" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid stroke="#ffffff0a" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#777' }} />
                  <YAxis tick={{ fontSize: 9, fill: '#777' }} width={65} tickFormatter={(value) => `$${Math.round(value / 1000)}k`} />
                  <Tooltip contentStyle={{ background: '#171720', border: '1px solid #2a2a35', borderRadius: 8, fontSize: 11 }} formatter={(value: number) => [money(value, currency), 'Equity']} />
                  <Area type="monotone" dataKey="equity" stroke="#00c853" fill="url(#journalEquity)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <EmptyState title="Your equity curve starts after the first closed trade." action="Plan a paper trade" onAction={onNewTrade} />}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-4 flex items-center justify-between"><h2 className="font-display text-sm font-semibold">Open positions</h2><span className="rounded-full bg-secondary px-2 py-0.5 text-[10px]">{positions.length}</span></div>
          {positions.length === 0 ? <EmptyState title="No open paper positions." action="New trade" onAction={onNewTrade} compact /> : (
            <div className="space-y-2">{positions.slice(0, 6).map((trade) => (
              <button key={trade.id} onClick={() => onSelectTrade(trade)} className="flex w-full items-center justify-between rounded-md border border-border/60 bg-secondary/20 px-3 py-2 text-left hover:bg-secondary/40">
                <div><p className="font-mono text-sm font-semibold">{trade.symbol}</p><p className="text-[9px] text-muted-foreground">{trade.side} · {numeric(trade.qty)} shares</p></div>
                <div className="text-right"><p className={`font-mono text-xs font-semibold ${numeric(trade.unrealizedPnl) >= 0 ? 'text-[#00c853]' : 'text-[#ff1744]'}`}>{signedMoney(trade.unrealizedPnl, currency)}</p><p className="text-[9px] text-muted-foreground">{numeric(trade.unrealizedR).toFixed(2)}R</p></div>
              </button>
            ))}</div>
          )}
        </div>
      </section>
    </div>
  );
}

function PositionsTab({ positions, currency, onSelectTrade, onNewTrade }: { positions: PaperTrade[]; currency: string; onSelectTrade: (trade: PaperTrade) => void; onNewTrade: () => void }) {
  if (positions.length === 0) return <EmptyState title="No open positions yet. Start with a plan, not an impulse." action="Plan a paper trade" onAction={onNewTrade} />;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-border bg-secondary/30 text-[10px] uppercase text-muted-foreground"><tr>{['Symbol', 'Side', 'Qty', 'Avg entry', 'Last', 'Unrealized', 'R', 'Stop', 'Target', 'Regime'].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
          <tbody>{positions.map((trade) => (
            <tr key={trade.id} onClick={() => onSelectTrade(trade)} className="cursor-pointer border-b border-border/50 hover:bg-secondary/20">
              <td className="px-4 py-3 font-mono font-bold text-[#00c853]">{trade.symbol}</td>
              <td className={`px-4 py-3 font-semibold ${trade.side === 'LONG' ? 'text-[#00c853]' : 'text-[#ff1744]'}`}>{trade.side}</td>
              <td className="px-4 py-3 font-mono">{numeric(trade.qty)}</td>
              <td className="px-4 py-3 font-mono">{money(trade.avgEntry, currency)}</td>
              <td className="px-4 py-3 font-mono">{money(trade.currentPrice, currency)}</td>
              <td className={`px-4 py-3 font-mono font-semibold ${numeric(trade.unrealizedPnl) >= 0 ? 'text-[#00c853]' : 'text-[#ff1744]'}`}>{signedMoney(trade.unrealizedPnl, currency)}</td>
              <td className="px-4 py-3 font-mono">{numeric(trade.unrealizedR).toFixed(2)}R</td>
              <td className="px-4 py-3 font-mono">{money(trade.stopPrice, currency)}</td>
              <td className="px-4 py-3 font-mono">{money(trade.targetPrice, currency)}</td>
              <td className="px-4 py-3 capitalize text-muted-foreground">{String((trade.regimeSnapshot as any)?.regime ?? '—').replace(/_/g, ' ')}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

function TradesTab({ trades, currency, tradeFilter, setTradeFilter, symbolFilter, setSymbolFilter, onSelectTrade }: {
  trades: PaperTrade[];
  currency: string;
  tradeFilter: 'ALL' | PaperTrade['status'];
  setTradeFilter: (value: 'ALL' | PaperTrade['status']) => void;
  symbolFilter: string;
  setSymbolFilter: (value: string) => void;
  onSelectTrade: (trade: PaperTrade) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input value={symbolFilter} onChange={(event) => setSymbolFilter(event.target.value.toUpperCase())} placeholder="Filter symbol" className="rounded-md border border-border bg-card px-3 py-2 font-mono text-xs uppercase outline-none focus:border-[#00c853]" />
        <select value={tradeFilter} onChange={(event) => setTradeFilter(event.target.value as any)} className="rounded-md border border-border bg-card px-3 py-2 text-xs outline-none">
          {['ALL', 'PLANNED', 'OPEN', 'CLOSED', 'CANCELLED'].map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {trades.length === 0 ? <EmptyState title="No trades match these filters." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-secondary/30 text-[10px] uppercase text-muted-foreground"><tr>{['Date', 'Symbol', 'Status', 'Setup', 'Side', 'P&L', 'R', 'Plan', 'Rating'].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
              <tbody>{trades.map((trade) => (
                <tr key={trade.id} onClick={() => onSelectTrade(trade)} className="cursor-pointer border-b border-border/50 hover:bg-secondary/20">
                  <td className="px-4 py-3 text-muted-foreground">{new Date(trade.closedAt ?? trade.openedAt ?? trade.createdAt ?? Date.now()).toLocaleDateString()}</td>
                  <td className="px-4 py-3 font-mono font-bold text-[#00c853]">{trade.symbol}</td>
                  <td className="px-4 py-3"><span className="rounded-full border border-border px-2 py-0.5 text-[9px]">{trade.status}</span></td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">{(trade.setupTag ?? '—').replace(/_/g, ' ')}</td>
                  <td className={`px-4 py-3 ${trade.side === 'LONG' ? 'text-[#00c853]' : 'text-[#ff1744]'}`}>{trade.side}</td>
                  <td className={`px-4 py-3 font-mono font-semibold ${numeric(trade.realizedPnl ?? trade.unrealizedPnl) >= 0 ? 'text-[#00c853]' : 'text-[#ff1744]'}`}>{signedMoney(trade.realizedPnl ?? trade.unrealizedPnl, currency)}</td>
                  <td className="px-4 py-3 font-mono">{numeric(trade.realizedR ?? trade.unrealizedR).toFixed(2)}R</td>
                  <td className="px-4 py-3">{trade.planFollowed == null ? '—' : trade.planFollowed ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-3">{trade.rating ? `${trade.rating}/5` : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function AnalyticsTab({ analytics, currency }: { analytics: JournalAnalytics; currency: string }) {
  const groups: Array<[string, keyof JournalAnalytics['breakdowns']]> = [
    ['Setup edge', 'setup'], ['Strategy edge', 'strategy'], ['Regime edge', 'regime'], ['Rules followed vs broken', 'planAdherence'], ['Emotion impact', 'emotion'], ['Long vs short', 'side'],
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {groups.map(([title, key]) => {
        const items = analytics.breakdowns[key] ?? [];
        return (
          <section key={key} className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 font-display text-sm font-semibold">{title}</h2>
            {items.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">More closed trades are needed for this breakdown.</p> : (
              <div className="space-y-2">{items.map((item) => (
                <div key={item.key} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 rounded-md bg-secondary/25 px-3 py-2 text-xs">
                  <span className="truncate capitalize">{item.key.replace(/_/g, ' ')}</span>
                  <span className="text-muted-foreground">{item.trades} trades</span>
                  <span className={`font-mono ${item.avgR >= 0 ? 'text-[#00c853]' : 'text-[#ff1744]'}`}>{item.avgR.toFixed(2)}R</span>
                  <span className="font-mono">{signedMoney(item.netPnl, currency)}</span>
                </div>
              ))}</div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function CalendarTab({ analytics, currency }: { analytics: JournalAnalytics; currency: string }) {
  const days = [...analytics.calendar].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-4"><h2 className="font-display text-sm font-semibold">P&amp;L calendar</h2><p className="text-[10px] text-muted-foreground">Daily closed-trade results. Click into Trades for the full review.</p></div>
      {days.length === 0 ? <EmptyState title="Calendar results appear when trades close." /> : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-7">
          {days.map((day) => {
            const positive = day.pnl >= 0;
            return (
              <div key={day.date} className={`min-h-24 rounded-md border p-3 ${positive ? 'border-[#00c853]/20 bg-[#00c853]/5' : 'border-[#ff1744]/20 bg-[#ff1744]/5'}`}>
                <p className="text-[10px] text-muted-foreground">{new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p>
                <p className={`mt-2 font-mono text-sm font-bold ${positive ? 'text-[#00c853]' : 'text-[#ff1744]'}`}>{signedMoney(day.pnl, currency)}</p>
                <p className="mt-1 text-[9px] text-muted-foreground">{day.trades} trade{day.trades === 1 ? '' : 's'}{day.r != null ? ` · ${day.r.toFixed(2)}R` : ''}</p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ReviewsTab({ reviews, form, setForm, saving, onSave, currency }: {
  reviews: JournalReview[];
  form: { periodType: 'DAY' | 'WEEK'; periodStart: string; grade: string; whatWentWell: string; whatToImprove: string; focusNext: string };
  setForm: (value: any) => void;
  saving: boolean;
  onSave: () => void;
  currency: string;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <section className="rounded-lg border border-border bg-card p-4 lg:col-span-2">
        <h2 className="font-display text-sm font-semibold">Session report card</h2>
        <p className="mt-1 text-[10px] text-muted-foreground">Grade your process, not whether the trade happened to win.</p>
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <select value={form.periodType} onChange={(event) => setForm({ ...form, periodType: event.target.value })} className="rounded-md border border-border bg-background px-2 py-2 text-xs"><option value="DAY">Daily</option><option value="WEEK">Weekly</option></select>
            <input type="date" value={form.periodStart} onChange={(event) => setForm({ ...form, periodStart: event.target.value })} className="rounded-md border border-border bg-background px-2 py-2 text-xs" />
            <select value={form.grade} onChange={(event) => setForm({ ...form, grade: event.target.value })} className="rounded-md border border-border bg-background px-2 py-2 text-xs">{[1, 2, 3, 4, 5].map((grade) => <option key={grade} value={grade}>{grade}/5</option>)}</select>
          </div>
          {[
            ['What went well?', 'whatWentWell'],
            ['What needs improvement?', 'whatToImprove'],
            ['One focus for next session', 'focusNext'],
          ].map(([label, key]) => (
            <label key={key} className="block text-xs text-muted-foreground">{label}<textarea rows={3} value={(form as any)[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} className="mt-1 w-full resize-none rounded-md border border-border bg-background p-2 text-sm text-foreground" /></label>
          ))}
          <button onClick={onSave} disabled={saving || !form.whatWentWell.trim() || !form.whatToImprove.trim() || !form.focusNext.trim()} className="w-full rounded-md bg-[#00c853] px-4 py-2 text-xs font-semibold text-black disabled:opacity-40">{saving ? 'Saving...' : 'Save report card'}</button>
        </div>
      </section>
      <section className="space-y-3 lg:col-span-3">
        {reviews.length === 0 ? <EmptyState title="No reviews yet. End each session with one lesson." /> : reviews.map((review) => (
          <article key={review.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs font-semibold">{review.periodType === 'DAY' ? 'Daily' : 'Weekly'} review · {new Date(review.periodStart).toLocaleDateString()}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{review.tradeCount ?? 0} trades · {signedMoney(review.netPnl, currency)} · {review.ruleAdherencePct == null ? '—' : percent(review.ruleAdherencePct)} adherence</p></div>
              <span className="rounded-md bg-[#A19AD3]/10 px-2 py-1 font-mono text-xs font-bold text-[#A19AD3]">{review.grade ?? '—'}/5</span>
            </div>
            <div className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
              <div><p className="text-[9px] uppercase text-[#00c853]">Worked</p><p className="mt-1 leading-relaxed">{review.whatWentWell || '—'}</p></div>
              <div><p className="text-[9px] uppercase text-[#ff1744]">Improve</p><p className="mt-1 leading-relaxed">{review.whatToImprove || '—'}</p></div>
              <div><p className="text-[9px] uppercase text-[#60B5FF]">Next focus</p><p className="mt-1 leading-relaxed">{review.focusNext || '—'}</p></div>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function EmptyState({ title, action, onAction, compact = false }: { title: string; action?: string; onAction?: () => void; compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-10' : 'min-h-[320px] py-12'}`}>
      <Target className="mb-3 h-7 w-7 text-muted-foreground/50" />
      <p className="max-w-sm text-sm text-muted-foreground">{title}</p>
      {action && onAction && <button onClick={onAction} className="mt-4 rounded-md border border-[#00c853]/30 bg-[#00c853]/10 px-3 py-2 text-xs font-semibold text-[#00c853]">{action}</button>}
    </div>
  );
}

function normalizeAnalytics(raw: any, account: PaperAccount): JournalAnalytics {
  const source = raw?.analytics ?? raw ?? {};
  const summarySource = source?.summary ?? source?.overview ?? source;
  const lastCurvePoint = Array.isArray(source?.equityCurve) ? source.equityCurve.at(-1) : null;
  const summary = {
    ...EMPTY_ANALYTICS.summary,
    ...summarySource,
    netPnl: numeric(summarySource?.netPnl ?? summarySource?.totalPnl),
    realizedPnl: numeric(summarySource?.realizedPnl),
    unrealizedPnl: numeric(summarySource?.unrealizedPnl),
    winRate: numeric(summarySource?.winRate),
    profitFactor: numeric(summarySource?.profitFactor),
    expectancy: numeric(summarySource?.averageR ?? summarySource?.expectancyR ?? summarySource?.expectancy),
    avgR: numeric(summarySource?.averageR ?? summarySource?.avgR),
    planAdherencePct: numeric(summarySource?.planAdherencePct ?? summarySource?.planAdherence),
    maxDrawdown: numeric(summarySource?.maximumDrawdownPct ?? summarySource?.maxDrawdown ?? summarySource?.maxDrawdownPct),
    currentDrawdown: numeric(summarySource?.currentDrawdown ?? summarySource?.currentDrawdownPct ?? lastCurvePoint?.drawdownPct),
    totalTrades: numeric(summarySource?.totalTrades ?? summarySource?.tradeCount),
    openPositions: numeric(summarySource?.openPositions ?? summarySource?.openTradeCount),
    equity: numeric(summarySource?.equity ?? account.equity ?? account.cash),
  };
  const normalizeBreakdown = (items: any) => Array.isArray(items) ? items.map((item) => ({
    key: String(item?.key ?? item?.name ?? item?.label ?? 'unknown'),
    trades: numeric(item?.trades ?? item?.count ?? item?.tradeCount),
    winRate: numeric(item?.winRate),
    netPnl: numeric(item?.netPnl ?? item?.pnl),
    avgR: numeric(item?.averageR ?? item?.avgR ?? item?.expectancyR),
    expectancy: numeric(item?.expectancy),
  })) : [];
  const breakdownSource = source?.breakdowns ?? {};
  return {
    summary,
    equityCurve: (source?.equityCurve ?? []).map((point: any) => ({ date: point.date, equity: numeric(point.equity), pnl: numeric(point.pnl ?? point.cumulativePnl) })),
    calendar: (source?.calendar ?? source?.daily ?? []).map((point: any) => ({
      date: point.date,
      pnl: numeric(point.pnl ?? point.netPnl),
      r: point.r == null && point.averageR == null ? undefined : numeric(point.r ?? point.averageR),
      trades: numeric(point.trades ?? point.count ?? point.tradeCount),
    })),
    breakdowns: {
      setup: normalizeBreakdown(breakdownSource.setup ?? source?.bySetup),
      strategy: normalizeBreakdown(breakdownSource.strategy ?? source?.byStrategy),
      regime: normalizeBreakdown(breakdownSource.regime ?? source?.byRegime),
      weekday: normalizeBreakdown(breakdownSource.weekday ?? source?.byWeekday),
      holdingTime: normalizeBreakdown(breakdownSource.holdingTime ?? source?.byHoldingTime),
      side: normalizeBreakdown(breakdownSource.side ?? source?.bySide),
      emotion: normalizeBreakdown(breakdownSource.emotion ?? source?.byEmotion),
      planAdherence: normalizeBreakdown(breakdownSource.planAdherence ?? source?.byPlanAdherence),
    },
  };
}
