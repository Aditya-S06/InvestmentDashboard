'use client';

import { useCallback, useEffect, useState } from 'react';
import { Briefcase, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import type { WebullAccount, WebullBalance, WebullPosition } from '@/lib/types';

export function BrokerPanel() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<WebullAccount[]>([]);
  const [accountId, setAccountId] = useState('');
  const [balance, setBalance] = useState<WebullBalance | null>(null);
  const [positions, setPositions] = useState<WebullPosition[]>([]);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/broker/status', { cache: 'no-store' });
      if (res.status === 403 || res.status === 401) {
        setConfigured(false);
        return;
      }
      if (!res.ok) {
        setConfigured(false);
        return;
      }
      const data = await res.json();
      setConfigured(Boolean(data?.configured));
    } catch {
      setConfigured(false);
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/broker/accounts', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? 'Failed to load accounts');
        setAccounts([]);
        return;
      }
      const list: WebullAccount[] = Array.isArray(data?.accounts) ? data.accounts : [];
      setAccounts(list);
      if (list.length > 0 && !accountId) {
        setAccountId(list[0].accountId);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load accounts');
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  const loadAccountData = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [posRes, balRes] = await Promise.all([
        fetch(`/api/broker/positions?accountId=${encodeURIComponent(id)}`, { cache: 'no-store' }),
        fetch(`/api/broker/balance?accountId=${encodeURIComponent(id)}`, { cache: 'no-store' }),
      ]);
      const posData = await posRes.json();
      const balData = await balRes.json();
      if (!posRes.ok) setError(posData?.error ?? 'Positions failed');
      if (!balRes.ok && !posData?.error) setError(balData?.error ?? 'Balance failed');
      setPositions(Array.isArray(posData?.positions) ? posData.positions : []);
      setBalance(balData?.error ? null : balData);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load broker data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (configured) loadAccounts();
  }, [configured, loadAccounts]);

  useEffect(() => {
    if (accountId) loadAccountData(accountId);
  }, [accountId, loadAccountData]);

  if (configured === null) return null;
  if (configured === false) {
    return (
      <div className="mx-4 mb-3 rounded-lg border border-dashed border-border bg-card/40 px-3 py-2 text-xs text-muted-foreground">
        Webull broker panel: not configured (set WEBULL_APP_KEY / WEBULL_APP_SECRET) or admin-only.
      </div>
    );
  }

  return (
    <div className="mx-4 mb-3 rounded-lg border border-border bg-card/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-secondary/40 transition-colors"
      >
        <span className="flex items-center gap-2 font-medium">
          <Briefcase className="w-4 h-4 text-[#00c853]" />
          Webull Positions
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
              onChange={(e) => setAccountId(e.target.value)}
              className="flex-1 text-xs bg-background border border-border rounded-md px-2 py-1.5"
            >
              {accounts.length === 0 && <option value="">No accounts</option>}
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
                    <td className="py-1.5 pr-2 font-medium text-[#00c853]">{p.symbol}</td>
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
