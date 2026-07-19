'use client';

import { useEffect, useMemo, useState } from 'react';
import { Calculator, Loader2, ShieldCheck, X } from 'lucide-react';
import type { MarketPrefill, PaperAccount, PaperTrade, TradeSide } from './journal-types';

interface TradePlanModalProps {
  open: boolean;
  initialSymbol?: string;
  initialThesis?: string;
  onClose: () => void;
  onSaved: (trade: PaperTrade) => void;
}

const SETUPS = ['breakout', 'pullback', 'mean_reversion', 'earnings_drift', 'trend_following', 'other'];
const STRATEGIES = ['regime_atr', 'quality_momentum', 'catalyst', 'discretionary'];

function unwrap<T>(value: any, key: string): T {
  return (value?.[key] ?? value) as T;
}

function numberOrZero(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function TradePlanModal({ open, initialSymbol = '', initialThesis = '', onClose, onSaved }: TradePlanModalProps) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [side, setSide] = useState<TradeSide>('LONG');
  const [thesis, setThesis] = useState(initialThesis);
  const [invalidation, setInvalidation] = useState('');
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');
  const [riskPct, setRiskPct] = useState('1');
  const [setupTag, setSetupTag] = useState('breakout');
  const [strategyTag, setStrategyTag] = useState('regime_atr');
  const [preNotes, setPreNotes] = useState('');
  const [account, setAccount] = useState<PaperAccount | null>(null);
  const [prefill, setPrefill] = useState<MarketPrefill | null>(null);
  const [loadingMarket, setLoadingMarket] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSymbol(initialSymbol.toUpperCase());
    setThesis(initialThesis);
    setError(null);
    void fetch('/api/paper/account', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => data && setAccount(unwrap<PaperAccount>(data, 'account')));
  }, [open, initialSymbol, initialThesis]);

  useEffect(() => {
    const ticker = symbol.trim().toUpperCase();
    if (!open || ticker.length < 1) return;
    const timer = window.setTimeout(async () => {
      setLoadingMarket(true);
      try {
        const response = await fetch(`/api/market/full?symbol=${encodeURIComponent(ticker)}`, { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        const price = numberOrZero(data?.ticker?.price);
        const atr = data?.strategy_signals?.atr_value == null ? null : numberOrZero(data.strategy_signals.atr_value);
        const suggestedRiskPct = numberOrZero(data?.strategy_signals?.suggested_risk_pct) || 0.01;
        setPrefill({
          symbol: ticker,
          price,
          atr,
          suggestedRiskPct,
          strategySignals: data?.strategy_signals ?? null,
          quantSnapshot: {
            quant_indicators: data?.quant_indicators ?? null,
            risk_metrics: data?.risk_metrics ?? null,
            predictive: data?.predictive ?? null,
          },
        });
        if (price > 0) {
          setEntry((current) => current || price.toFixed(2));
          const riskDistance = atr && atr > 0 ? atr * 1.5 : price * 0.03;
          setStop((current) => current || (side === 'LONG' ? price - riskDistance : price + riskDistance).toFixed(2));
          setTarget((current) => current || (side === 'LONG' ? price + riskDistance * 2 : price - riskDistance * 2).toFixed(2));
          setRiskPct((current) => current || (suggestedRiskPct * 100).toFixed(1));
        }
      } finally {
        setLoadingMarket(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [open, symbol, side]);

  const sizing = useMemo(() => {
    const accountEquity = numberOrZero(account?.equity ?? account?.startingEquity);
    const entryPrice = numberOrZero(entry);
    const stopPrice = numberOrZero(stop);
    const percentage = numberOrZero(riskPct);
    const riskPerShare = Math.abs(entryPrice - stopPrice);
    const riskDollars = accountEquity * (percentage / 100);
    const shares = riskPerShare > 0 ? Math.floor(riskDollars / riskPerShare) : 0;
    const rewardPerShare = Math.abs(numberOrZero(target) - entryPrice);
    return {
      equity: accountEquity,
      riskPerShare,
      riskDollars,
      shares,
      rewardRisk: riskPerShare > 0 ? rewardPerShare / riskPerShare : 0,
      buyingPowerRequired: shares * entryPrice,
    };
  }, [account, entry, stop, target, riskPct]);

  const submit = async (enterNow: boolean) => {
    setError(null);
    const ticker = symbol.trim().toUpperCase();
    const entryPrice = numberOrZero(entry);
    const stopPrice = numberOrZero(stop);
    const targetPrice = numberOrZero(target);
    const risk = numberOrZero(riskPct);

    if (!ticker || !thesis.trim() || !invalidation.trim()) {
      setError('Symbol, thesis, and invalidation are required.');
      return;
    }
    if (entryPrice <= 0 || stopPrice <= 0 || targetPrice <= 0 || sizing.shares < 1) {
      setError('Enter a valid entry, stop, target, and position size.');
      return;
    }
    if (risk <= 0 || risk > 1.5) {
      setError('Risk per trade must be between 0% and 1.5%.');
      return;
    }
    if ((side === 'LONG' && stopPrice >= entryPrice) || (side === 'SHORT' && stopPrice <= entryPrice)) {
      setError(`${side === 'LONG' ? 'Long' : 'Short'} stops must be ${side === 'LONG' ? 'below' : 'above'} entry.`);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/paper/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: ticker,
          side,
          thesis: thesis.trim(),
          invalidation: invalidation.trim(),
          plannedEntry: entryPrice,
          plannedStop: stopPrice,
          plannedTarget: targetPrice,
          plannedRiskPct: risk / 100,
          plannedShares: sizing.shares,
          stopPrice,
          targetPrice,
          setupTag,
          strategyTag,
          preNotes: preNotes.trim() || null,
          regimeSnapshot: prefill?.strategySignals ?? null,
          quantSnapshot: prefill?.quantSnapshot ?? null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Could not save the trade plan.');
      let trade = unwrap<PaperTrade>(data, 'trade');

      if (enterNow) {
        const fillResponse = await fetch(`/api/paper/trades/${trade.id}/fills`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'ENTRY',
            side: side === 'LONG' ? 'BUY' : 'SELL',
            qty: sizing.shares,
            price: entryPrice,
            filledAt: new Date().toISOString(),
          }),
        });
        const fillData = await fillResponse.json().catch(() => ({}));
        if (!fillResponse.ok) throw new Error(fillData?.error || 'Plan saved, but the paper fill failed.');
        trade = unwrap<PaperTrade>(fillData, 'trade');
      }

      onSaved(trade);
      onClose();
    } catch (submitError: any) {
      setError(submitError?.message || 'Could not save the trade plan.');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-black/75 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="mx-auto my-4 max-w-3xl rounded-xl border border-border bg-card shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold">Paper trade plan</h2>
            <p className="text-xs text-muted-foreground">Define the risk before you simulate the outcome.</p>
          </div>
          <button onClick={onClose} className="rounded-md p-2 text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>

        <div className="grid gap-5 p-5 md:grid-cols-5">
          <div className="space-y-4 md:col-span-3">
            <div className="grid grid-cols-3 gap-3">
              <label className="col-span-2 text-xs text-muted-foreground">
                Symbol
                <input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm uppercase outline-none focus:border-[#00c853]" placeholder="AAPL" />
              </label>
              <label className="text-xs text-muted-foreground">
                Side
                <select value={side} onChange={(event) => { setSide(event.target.value as TradeSide); setStop(''); setTarget(''); }} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none">
                  <option value="LONG">Long</option>
                  <option value="SHORT">Short</option>
                </select>
              </label>
            </div>

            <label className="block text-xs text-muted-foreground">
              Thesis
              <textarea value={thesis} onChange={(event) => setThesis(event.target.value)} rows={3} className="mt-1 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[#00c853]" placeholder="Why this setup should work..." />
            </label>
            <label className="block text-xs text-muted-foreground">
              Invalidation
              <textarea value={invalidation} onChange={(event) => setInvalidation(event.target.value)} rows={2} className="mt-1 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[#00c853]" placeholder="What would prove the thesis wrong?" />
            </label>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Entry', value: entry, setter: setEntry },
                { label: 'Stop', value: stop, setter: setStop },
                { label: 'Target', value: target, setter: setTarget },
              ].map((field) => (
                <label key={field.label} className="text-xs text-muted-foreground">
                  {field.label}
                  <input type="number" min="0" step="0.01" value={field.value} onChange={(event) => field.setter(event.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-[#00c853]" />
                </label>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <label className="text-xs text-muted-foreground">
                Risk %
                <input type="number" min="0.1" max="1.5" step="0.1" value={riskPct} onChange={(event) => setRiskPct(event.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none" />
              </label>
              <label className="text-xs text-muted-foreground">
                Setup
                <select value={setupTag} onChange={(event) => setSetupTag(event.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm">
                  {SETUPS.map((value) => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
                </select>
              </label>
              <label className="text-xs text-muted-foreground">
                Strategy
                <select value={strategyTag} onChange={(event) => setStrategyTag(event.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm">
                  {STRATEGIES.map((value) => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
                </select>
              </label>
            </div>

            <label className="block text-xs text-muted-foreground">
              Pre-trade notes
              <textarea value={preNotes} onChange={(event) => setPreNotes(event.target.value)} rows={2} className="mt-1 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none" placeholder="Catalyst, market context, execution checklist..." />
            </label>
          </div>

          <aside className="space-y-3 md:col-span-2">
            <div className="rounded-lg border border-[#00c853]/25 bg-[#00c853]/5 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Calculator className="h-4 w-4 text-[#00c853]" />
                <h3 className="text-sm font-semibold">Risk sizing</h3>
              </div>
              <dl className="space-y-2 text-xs">
                {[
                  ['Paper equity', `$${sizing.equity.toLocaleString(undefined, { maximumFractionDigits: 2 })}`],
                  ['$ risk', `$${sizing.riskDollars.toFixed(2)}`],
                  ['Risk / share', `$${sizing.riskPerShare.toFixed(2)}`],
                  ['Suggested shares', sizing.shares.toLocaleString()],
                  ['Buying power', `$${sizing.buyingPowerRequired.toLocaleString(undefined, { maximumFractionDigits: 2 })}`],
                  ['Reward : risk', `${sizing.rewardRisk.toFixed(2)}R`],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-mono font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="rounded-lg border border-border bg-secondary/30 p-4 text-xs">
              <div className="mb-2 flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-[#60B5FF]" /> Market snapshot</div>
              {loadingMarket ? (
                <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading {symbol || 'symbol'}...</p>
              ) : prefill ? (
                <div className="space-y-1 text-muted-foreground">
                  <p>Last: <span className="font-mono text-foreground">${prefill.price.toFixed(2)}</span></p>
                  <p>ATR: <span className="font-mono text-foreground">{prefill.atr ? `$${prefill.atr.toFixed(2)}` : '—'}</span></p>
                  <p>Regime: <span className="capitalize text-foreground">{String(prefill.strategySignals?.regime ?? 'unavailable').replace(/_/g, ' ')}</span></p>
                  <p>Signal: <span className="uppercase text-foreground">{String(prefill.strategySignals?.primary_signal ?? '—')}</span></p>
                </div>
              ) : <p className="text-muted-foreground">Enter a symbol to load its quant snapshot.</p>}
            </div>

            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Paper simulation only. Position sizing is a practice constraint, not financial advice.
            </p>
          </aside>
        </div>

        {error && <div className="mx-5 mb-3 rounded-md border border-[#ff1744]/30 bg-[#ff1744]/10 px-3 py-2 text-xs text-[#ff1744]">{error}</div>}

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <button onClick={onClose} disabled={saving} className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-secondary">Cancel</button>
          <button onClick={() => void submit(false)} disabled={saving} className="rounded-md border border-[#00c853]/30 bg-[#00c853]/10 px-4 py-2 text-sm font-medium text-[#00c853] hover:bg-[#00c853]/15 disabled:opacity-50">Save plan</button>
          <button onClick={() => void submit(true)} disabled={saving} className="inline-flex items-center gap-2 rounded-md bg-[#00c853] px-4 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Enter now
          </button>
        </div>
      </div>
    </div>
  );
}
