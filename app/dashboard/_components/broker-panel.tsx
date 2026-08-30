'use client';

import { useCallback, useEffect, useState } from 'react';
import { Briefcase, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { WebullAccount, WebullBalance, WebullPosition } from '@/lib/types';
import { useTradeTicketOptional } from './trade-ticket-provider';
import { useBrokerAccess } from './use-broker-access';

export function BrokerPanel() {
  const broker = useBrokerAccess();
  const configured = broker.loading ? null : broker.available;
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<WebullAccount[]>([]);
  const [accountId, setAccountId] = useState('');
  const [balance, setBalance] = useState<WebullBalance | null>(null);
  const [positions, setPositions] = useState<WebullPosition[]>([]);
  const [env, setEnv] = useState('');
  const [killSwitch, setKillSwitch] = useState(false);
  const [tradingOn, setTradingOn] = useState(false);
  const [openOrders, setOpenOrders] = useState<any[]>([]);
  const trade = useTradeTicketOptional();

  const loadTradingStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/broker/trading-status', { cache: 'no-store' });
      if (!res.ok) return;
      const status = await res.json();
      setKillSwitch(Boolean(status?.killSwitch));
      setTradingOn(Boolean(status?.tradingEnabled));
      if (status?.environment) setEnv(status.environment);
    } catch {
      /* status badge stays neutral */
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/broker/accounts', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (data?.error || !res.ok) {
        setError(data?.error ?? 'Failed to load accounts');
        setAccounts([]);
        return;
      }
      if (!Array.isArray(data?.accounts)) {
        setError('Invalid accounts response');
        setAccounts([]);
        return;
      }
      const list: WebullAccount[] = data.accounts.filter(
        (row: WebullAccount) => typeof row?.accountId === 'string' && row.accountId.trim(),
      );
      setAccounts(list);
      setAccountId((current) => {
        const stored = window.localStorage.getItem('oracle.webullAccountId');
        const preferred =
          list.find((a) => a.accountId === current) ??
          list.find((a) => a.accountId === stored) ??
          list[0];
        if (preferred) {
          window.localStorage.setItem('oracle.webullAccountId', preferred.accountId);
          return preferred.accountId;
        }
        return current;
      });
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load accounts');
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAccountData = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [posRes, balRes] = await Promise.all([
        fetch(`/api/broker/positions?accountId=${encodeURIComponent(id)}`, { cache: 'no-store' }),
        fetch(`/api/broker/balance?accountId=${encodeURIComponent(id)}`, { cache: 'no-store' }),
      ]);
      const posData = await posRes.json().catch(() => ({}));
      const balData = await balRes.json().catch(() => ({}));
      if (posData?.error || !posRes.ok) setError(posData?.error ?? 'Positions failed');
      else if (balData?.error || !balRes.ok) setError(balData?.error ?? 'Balance failed');
      setPositions(Array.isArray(posData?.positions) ? posData.positions : []);
      setBalance(balData?.error || !balRes.ok ? null : balData);
      const ordersRes = await fetch(`/api/broker/orders?accountId=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const ordersData = await ordersRes.json().catch(() => ({}));
      const open = Array.isArray(ordersData?.open) ? ordersData.open : [];
      setOpenOrders(open);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load broker data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!configured) return;
    setEnv(broker.environment);
    loadTradingStatus();
    loadAccounts();
  }, [configured, broker.environment, loadTradingStatus, loadAccounts]);

  useEffect(() => {
    if (accountId) loadAccountData(accountId);
  }, [accountId, loadAccountData]);

  if (!configured) return null;

  return (
    <div className="mb-3 rounded-lg border border-border bg-card/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-secondary/40 transition-colors"
      >
        <span className="flex items-center gap-2 font-medium">
          <Briefcase className="w-4 h-4 text-[#00c853]" />
          Webull Positions
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            !tradingOn || killSwitch
              ? 'bg-secondary text-muted-foreground'
              : env === 'sandbox'
                ? 'bg-amber-500/15 text-amber-200'
                : 'bg-red-500/15 text-red-300'
          }`}>
            {killSwitch || !tradingOn ? 'TRADING OFF' : env === 'sandbox' ? 'SANDBOX' : 'LIVE'}
          </span>
        </span>
        <span className="flex items-center gap-2 text-muted-foreground">
          {loading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-border">
          <div className="flex items-center gap-2 pt-2">
            <label className="text-xs text-muted-foreground shrink-0">Account</label>
            <select
              value={accountId}
              onChange={(e) => {
                const next = e.target.value;
                setAccountId(next);
                if (next) window.localStorage.setItem('oracle.webullAccountId', next);
              }}
              className="flex-1 text-xs bg-background border border-border rounded-md px-2 py-1.5"
            >
              {accounts.length === 0 && (
                <option value="">{error ? 'Unavailable' : 'No accounts'}</option>
              )}
              {accounts.map((a) => (
                <option key={a.accountId} value={a.accountId}>
                  {[a.accountType || a.label || 'Account', a.accountNumber || a.accountId.slice(0, 10)]
                    .filter(Boolean)
                    .join(' · ')}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => accountId && loadAccountData(accountId)}
              className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          {balance && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <Metric label="Net liq" value={balance.netLiquidation} />
              <Metric label="Cash" value={balance.totalCash} />
              <Metric label="Buying power" value={balance.buyingPower} />
              <Metric label="Mkt value" value={balance.totalMarketValue} />
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground text-left border-b border-border">
                  <th className="py-1.5 pr-2 font-medium">Symbol</th>
                  <th className="py-1.5 pr-2 font-medium text-right">Qty</th>
                  <th className="py-1.5 pr-2 font-medium text-right">Avg</th>
                  <th className="py-1.5 pr-2 font-medium text-right">Value</th>
                  <th className="py-1.5 font-medium text-right">P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {positions.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-3 text-center text-muted-foreground">
                      No positions
                    </td>
                  </tr>
                )}
                {positions.map((p) => (
                  <tr key={p.symbol + String(p.quantity)} className="border-b border-border/50">
                    <td className="py-1.5 pr-2 font-medium text-[#00c853]">
                      <button
                        type="button"
                        className="hover:underline"
                        onClick={() =>
                          trade?.openTradeTicket({
                            symbol: p.symbol,
                            side: 'SELL',
                            source: 'broker',
                            suggestedQty: p.quantity,
                            lastPrice: p.lastPrice,
                          })
                        }
                      >
                        {p.symbol}
                      </button>
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{fmt(p.quantity, 4)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{fmt(p.avgCost)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{fmt(p.marketValue)}</td>
                    <td
                      className={`py-1.5 text-right tabular-nums ${
                        p.unrealizedPnl >= 0 ? 'text-[#00c853]' : 'text-red-400'
                      }`}
                    >
                      {fmt(p.unrealizedPnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {openOrders.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Open orders</p>
              {openOrders.slice(0, 8).map((o: any, i: number) => {
                const id = o.clientOrderId || o.client_order_id || String(i);
                return (
                  <div key={id} className="flex items-center justify-between text-[11px]">
                    <span className="font-mono">
                      {o.symbol} {o.side} {o.quantity ?? o.qty} {o.status}
                    </span>
                    <button
                      type="button"
                      className="rounded border border-border px-1.5 py-0.5"
                      onClick={async () => {
                        const res = await fetch(`/api/broker/orders/${id}/cancel`, { method: 'POST' });
                        if (res.ok) toast.success(`Cancel sent for ${o.symbol}`);
                        else toast.error('Cancel failed');
                        if (accountId) loadAccountData(accountId);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              className="text-[11px] text-muted-foreground hover:text-foreground"
              onClick={async () => {
                const res = await fetch('/api/broker/kill-switch', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ enabled: !killSwitch }),
                });
                const data = await res.json();
                setKillSwitch(Boolean(data.killSwitch));
                toast[data.killSwitch ? 'error' : 'success'](
                  data.killSwitch ? 'Kill switch ON — new orders blocked' : 'Kill switch cleared',
                );
              }}
            >
              {killSwitch ? 'Clear kill switch' : 'Panic: kill switch'}
            </button>
            <a href="/dashboard/webull" className="text-[11px] text-[#00c853] hover:underline">
              Blotter
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-background/60 border border-border px-2 py-1.5">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums">{fmt(value)}</div>
    </div>
  );
}

function fmt(n: number, digits = 2) {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}
