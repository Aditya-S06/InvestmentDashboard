'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { TradeTicketDraft } from './trade-ticket-provider';
import type { WebullAccount, WebullBalance } from '@/lib/types';

type TradingStatus = {
  configured?: boolean;
  environment?: string;
  tradingEnabled?: boolean;
  liveEnabled?: boolean;
  killSwitch?: boolean;
  maxNotionalUsd?: number;
  maxQty?: number;
  error?: string;
};

type OrderType = 'MARKET' | 'LIMIT' | 'STOP_LOSS' | 'STOP_LOSS_LIMIT';

export function TradeTicket({ draft, onClose }: { draft: TradeTicketDraft; onClose: () => void }) {
  const router = useRouter();
  const [status, setStatus] = useState<TradingStatus | null>(null);
  const [accounts, setAccounts] = useState<WebullAccount[]>([]);
  const [accountId, setAccountId] = useState('');
  const [balance, setBalance] = useState<WebullBalance | null>(null);
  const [symbol, setSymbol] = useState(draft.symbol);
  const [side, setSide] = useState(draft.side);
  const [orderType, setOrderType] = useState<OrderType>('LIMIT');
  const [qty, setQty] = useState(String(draft.suggestedQty ?? 1));
  const [limitPrice, setLimitPrice] = useState(draft.lastPrice ? String(draft.lastPrice) : '');
  const [stopPrice, setStopPrice] = useState(draft.suggestedStop ? String(draft.suggestedStop) : '');
  const [targetPrice, setTargetPrice] = useState(draft.suggestedTarget ? String(draft.suggestedTarget) : '');
  const [session, setSession] = useState('CORE');
  const [tif, setTif] = useState('DAY');
  const [thesis, setThesis] = useState(draft.thesis ?? '');
  const [invalidation, setInvalidation] = useState(draft.invalidation ?? '');
  const [preNotes, setPreNotes] = useState(draft.preNotes ?? '');
  const [comboLegs, setComboLegs] = useState(false);
  const [instrumentType, setInstrumentType] = useState<'EQUITY' | 'OPTION'>('EQUITY');
  const [liveConfirm, setLiveConfirm] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [working, setWorking] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placeArmed, setPlaceArmed] = useState(false);

  const env = status?.environment === 'sandbox' ? 'sandbox' : 'prod';
  const live = env === 'prod';
  const disabled = !status?.tradingEnabled || status?.killSwitch;

  useEffect(() => {
    fetch('/api/broker/trading-status', { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json();
        if (res.status === 403 || res.status === 401) {
          setStatus({ configured: false, tradingEnabled: false, error: 'Admin only' });
          return;
        }
        setStatus(data);
      })
      .catch(() => setStatus({ configured: false, tradingEnabled: false, error: 'Status failed' }));
  }, []);

  useEffect(() => {
    if (!status?.configured) return;
    fetch('/api/broker/accounts', { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json();
        if (data?.error) {
          setError(data.error);
          return;
        }
        const list: WebullAccount[] = Array.isArray(data?.accounts) ? data.accounts : [];
        setAccounts(list);
        const stored = window.localStorage.getItem('oracle.webullAccountId');
        const preferred = list.find((a) => a.accountId === stored) ?? list[0];
        if (preferred) setAccountId(preferred.accountId);
      })
      .catch((e) => setError(e.message));
  }, [status?.configured]);

  useEffect(() => {
    if (!accountId) return;
    fetch(`/api/broker/balance?accountId=${encodeURIComponent(accountId)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data?.error) setError(data.error);
        else setBalance(data);
      })
      .catch(() => undefined);
  }, [accountId]);

  const qtyNum = Number(qty);
  const limitNum = Number(limitPrice);
  const notional = useMemo(() => {
    const px = orderType === 'MARKET' ? draft.lastPrice || 0 : limitNum;
    return (Number.isFinite(qtyNum) ? qtyNum : 0) * (Number.isFinite(px) ? px : 0);
  }, [qtyNum, limitNum, orderType, draft.lastPrice]);

  const payload = useCallback(
    () => ({
      accountId,
      symbol: symbol.trim().toUpperCase(),
      side,
      orderType,
      qty: qtyNum,
      limitPrice: limitPrice ? Number(limitPrice) : null,
      stopPrice: stopPrice ? Number(stopPrice) : null,
      targetPrice: targetPrice ? Number(targetPrice) : null,
      session,
      tif,
      lastPrice: draft.lastPrice ?? null,
      source: draft.source,
      thesis,
      invalidation,
      preNotes,
      setupTag: draft.setupTag,
      strategyTag: draft.strategyTag,
      sourceUrl: draft.sourceUrl,
      liveConfirm: live ? liveConfirm : undefined,
      comboLegs,
      instrumentType,
      previewId,
    }),
    [
      accountId,
      symbol,
      side,
      orderType,
      qtyNum,
      limitPrice,
      stopPrice,
      targetPrice,
      session,
      tif,
      draft,
      thesis,
      invalidation,
      preNotes,
      live,
      liveConfirm,
      comboLegs,
      instrumentType,
      previewId,
    ],
  );

  const runPreview = async () => {
    setBusy(true);
    setError(null);
    setPlaceArmed(false);
    try {
      const res = await fetch('/api/broker/orders/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        setError(data?.error ?? 'Preview failed');
        toast.error(data?.error ?? 'Preview failed');
        return;
      }
      setPreviewId(data.previewId);
      setPreview(data.preview);
      toast.success(`Preview ready for ${side} ${qty} ${symbol}`);
      setTimeout(() => setPlaceArmed(true), 3000);
    } catch (e: any) {
      setError(e?.message ?? 'Preview failed');
    } finally {
      setBusy(false);
    }
  };

  const runPlace = async () => {
    if (!previewId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/broker/orders/place', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload(), previewId }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        setError(data?.error ?? 'Place failed');
        toast.error(data?.error ?? 'Place failed');
        return;
      }
      setWorking(data.order);
      toast.success(`${live ? 'LIVE' : 'Sandbox'} order sent: ${side} ${qty} ${symbol}`);
    } catch (e: any) {
      setError(e?.message ?? 'Place failed');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!working?.clientOrderId || working.terminal) return;
    let cancelled = false;
    let delay = 2000;
    const started = Date.now();
    const tick = async () => {
      if (cancelled) return;
      const res = await fetch(`/api/broker/orders/${working.clientOrderId}`, { cache: 'no-store' });
      const data = await res.json();
      if (data?.journalTradeId) {
        toast.success(`${data.order?.symbol ?? 'Live'} fill written to your journal`, {
          action: { label: 'Open journal', onClick: () => router.push('/dashboard/journal') },
        });
      }
      if (data?.order) {
        setWorking(data.order);
        if (data.order.terminal) return;
      }
      if (Date.now() - started > 30_000) delay = 10_000;
      setTimeout(tick, delay);
    };
    const t = setTimeout(tick, delay);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [working?.clientOrderId, working?.terminal, router]);

  const banner =
    disabled || !status?.configured
      ? 'bg-secondary text-muted-foreground'
      : live
        ? 'bg-red-950/80 text-red-200'
        : 'bg-amber-950/80 text-amber-100';

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/50" onClick={onClose}>
      <aside
        className="h-full w-full max-w-[420px] overflow-y-auto border-l border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`px-4 py-3 text-xs font-semibold ${banner}`}>
          {disabled || !status?.configured
            ? 'TRADING OFF'
            : live
              ? 'LIVE · real money'
              : 'WEBULL PAPER · sandbox'}
          <div className="mt-1 font-normal opacity-80">
            {live
              ? 'You are about to send a LIVE order to Webull.'
              : 'This is Webull paper trading, not the local simulator, not real money.'}
          </div>
        </div>

        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Trade {symbol}</h2>
          <button type="button" onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4 text-xs">
          {error && <p className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-red-300">{error}</p>}

          <label className="block">
            <span className="text-muted-foreground">Account</span>
            <select
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                window.localStorage.setItem('oracle.webullAccountId', e.target.value);
              }}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5"
            >
              {accounts.map((a) => (
                <option key={a.accountId} value={a.accountId}>
                  {[a.accountType || a.label || 'Account', a.accountNumber || a.accountId.slice(0, 8)].join(' · ')}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-muted-foreground">Symbol</span>
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono"
              />
            </label>
            <label className="block">
              <span className="text-muted-foreground">Instrument</span>
              <select
                value={instrumentType}
                onChange={(e) => setInstrumentType(e.target.value as 'EQUITY' | 'OPTION')}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5"
              >
                <option value="EQUITY">Equity</option>
                <option value="OPTION">Option (LIMIT)</option>
              </select>
            </label>
          </div>

          <div className="flex gap-1">
            {(['BUY', 'SELL', 'SHORT'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                className={`flex-1 rounded-md border px-2 py-1.5 font-semibold ${
                  side === s
                    ? s === 'BUY'
                      ? 'border-[#00c853]/40 bg-[#00c853]/15 text-[#00c853]'
                      : 'border-red-500/40 bg-red-500/15 text-red-300'
                    : 'border-border text-muted-foreground'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-muted-foreground">Type</span>
              <select
                value={orderType}
                onChange={(e) => setOrderType(e.target.value as OrderType)}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5"
              >
                <option>MARKET</option>
                <option>LIMIT</option>
                <option>STOP_LOSS</option>
                <option>STOP_LOSS_LIMIT</option>
              </select>
            </label>
            <label className="block">
              <span className="text-muted-foreground">Qty</span>
              <input
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono"
              />
            </label>
          </div>

          {(orderType === 'LIMIT' || orderType === 'STOP_LOSS_LIMIT') && (
            <label className="block">
              <span className="text-muted-foreground">Limit</span>
              <input
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono"
              />
            </label>
          )}
          {(orderType === 'STOP_LOSS' || orderType === 'STOP_LOSS_LIMIT' || comboLegs) && (
            <label className="block">
              <span className="text-muted-foreground">Stop</span>
              <input
                value={stopPrice}
                onChange={(e) => setStopPrice(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono"
              />
            </label>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-muted-foreground">Session</span>
              <select
                value={session}
                onChange={(e) => setSession(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5"
              >
                <option>CORE</option>
                <option>ALL</option>
                <option>NIGHT</option>
              </select>
            </label>
            <label className="block">
              <span className="text-muted-foreground">TIF</span>
              <select
                value={tif}
                onChange={(e) => setTif(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5"
              >
                <option>DAY</option>
                <option>GTC</option>
              </select>
            </label>
          </div>

          <label className="flex items-center gap-2 text-muted-foreground">
            <input type="checkbox" checked={comboLegs} onChange={(e) => setComboLegs(e.target.checked)} />
            Broker OTOCO legs (stop + target)
          </label>
          {comboLegs && (
            <label className="block">
              <span className="text-muted-foreground">Target</span>
              <input
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono"
              />
            </label>
          )}

          <div className="rounded-md border border-border bg-background/60 px-2 py-1.5">
            Notional ~ ${notional.toFixed(2)}
            {balance ? ` · BP ${balance.buyingPower?.toLocaleString?.() ?? balance.buyingPower}` : ''}
          </div>

          <label className="block">
            <span className="text-muted-foreground">Thesis</span>
            <textarea
              value={thesis}
              onChange={(e) => setThesis(e.target.value)}
              className="mt-1 min-h-[64px] w-full rounded-md border border-border bg-background px-2 py-1.5"
            />
          </label>
          <label className="block">
            <span className="text-muted-foreground">Invalidation</span>
            <textarea
              value={invalidation}
              onChange={(e) => setInvalidation(e.target.value)}
              className="mt-1 min-h-[48px] w-full rounded-md border border-border bg-background px-2 py-1.5"
            />
          </label>
          <label className="block">
            <span className="text-muted-foreground">Notes</span>
            <textarea
              value={preNotes}
              onChange={(e) => setPreNotes(e.target.value)}
              className="mt-1 min-h-[48px] w-full rounded-md border border-border bg-background px-2 py-1.5"
            />
          </label>

          {live && (
            <label className="block">
              <span className="text-red-300">Type LIVE to confirm</span>
              <input
                value={liveConfirm}
                onChange={(e) => setLiveConfirm(e.target.value)}
                className="mt-1 w-full rounded-md border border-red-500/40 bg-background px-2 py-1.5 font-mono"
              />
            </label>
          )}

          {preview && (
            <pre className="max-h-32 overflow-auto rounded-md bg-background p-2 text-[10px] text-muted-foreground">
              {JSON.stringify(preview, null, 2)}
            </pre>
          )}

          {working && (
            <div className="rounded-md border border-border px-2 py-2">
              <div className="font-medium">
                {working.status} · filled {working.filledQty}/{working.qty}
              </div>
              {working.environment === 'prod' && working.status === 'FILLED' && (
                <p className="mt-1 text-[#00c853]">Filled — journal updated</p>
              )}
              {working.environment === 'sandbox' && working.terminal && (
                <p className="mt-1 text-amber-200">Sandbox fill recorded (not in personal journal).</p>
              )}
              {['SUBMITTED', 'PARTIAL', 'SENDING', 'PREVIEWED'].includes(working.status) && (
                <button
                  type="button"
                  className="mt-2 rounded-md border border-border px-2 py-1"
                  onClick={async () => {
                    const res = await fetch(`/api/broker/orders/${working.clientOrderId}/cancel`, {
                      method: 'POST',
                    });
                    if (res.ok) toast.success(`Cancel sent for ${working.symbol ?? symbol}`);
                    else toast.error('Cancel failed');
                  }}
                >
                  Cancel order
                </button>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              disabled={busy || disabled}
              onClick={runPreview}
              className="flex-1 rounded-md border border-[#00c853]/40 bg-[#00c853]/10 px-3 py-2 font-semibold text-[#00c853] disabled:opacity-40"
            >
              {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Preview'}
            </button>
            <button
              type="button"
              disabled={busy || disabled || !previewId || (live && liveConfirm !== 'LIVE') || (live && !placeArmed)}
              onClick={runPlace}
              className="flex-1 rounded-md bg-[#00c853] px-3 py-2 font-semibold text-black disabled:opacity-40"
            >
              Place
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
