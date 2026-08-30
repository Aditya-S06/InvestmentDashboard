'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { BrokerPanel } from '../../_components/broker-panel';

type AuditEntry = {
  id: string;
  action: string;
  environment: string;
  clientOrderId: string | null;
  ip: string | null;
  createdAt: string;
};

const MAX_FILL_REFRESH = 5;

export function WebullBlotterClient() {
  const router = useRouter();
  const [orders, setOrders] = useState<any[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Refreshing a live working order is what triggers syncLiveFill server-side.
  const syncLiveFills = async (rows: any[]) => {
    const working = rows.filter((o) => o.environment === 'prod' && !o.terminal).slice(0, MAX_FILL_REFRESH);
    if (working.length === 0) return;
    const results = await Promise.all(
      working.map((o) =>
        fetch(`/api/broker/orders/${encodeURIComponent(o.clientOrderId)}`, { cache: 'no-store' })
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null),
      ),
    );

    const refreshed = new Map<string, any>();
    for (const result of results) {
      if (result?.order?.clientOrderId) refreshed.set(result.order.clientOrderId, result.order);
    }
    if (refreshed.size > 0) {
      setOrders((prev) => prev.map((o) => refreshed.get(o.clientOrderId) ?? o));
    }

    const journaled = results.filter((result) => result?.journalTradeId).length;
    if (journaled > 0) {
      toast.success(`${journaled} live fill${journaled > 1 ? 's' : ''} written to your journal`, {
        action: { label: 'Open journal', onClick: () => router.push('/dashboard/journal') },
      });
    }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [ordersRes, auditRes] = await Promise.all([
        fetch('/api/broker/orders', { cache: 'no-store' }),
        fetch('/api/broker/audit', { cache: 'no-store' }),
      ]);
      const data = await ordersRes.json();
      if (!ordersRes.ok || data?.error) {
        setError(data?.error ?? 'Failed to load blotter');
        setOrders([]);
        return;
      }
      const rows = Array.isArray(data.orders) ? data.orders : [];
      setOrders(rows);

      const auditData = auditRes.ok ? await auditRes.json() : null;
      setAudit(Array.isArray(auditData?.entries) ? auditData.entries : []);

      void syncLiveFills(rows);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load blotter');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-sm font-semibold">Webull blotter</h1>
          <span className="text-[10px] text-muted-foreground">Sandbox and live orders placed in Market Intel</span>
        </div>
        <button type="button" onClick={() => void load()} className="rounded-md p-1.5 hover:bg-secondary">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <BrokerPanel />
      {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Env</th>
              <th className="px-3 py-2">Symbol</th>
              <th className="px-3 py-2">Side</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Filled</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  No in-app Webull orders yet.
                </td>
              </tr>
            )}
            {orders.map((o) => (
              <tr key={o.id} className="border-b border-border/50">
                <td className="px-3 py-2 text-muted-foreground">{String(o.createdAt).slice(0, 19)}</td>
                <td className="px-3 py-2">{o.environment}</td>
                <td className="px-3 py-2 font-mono text-[#00c853]">{o.symbol}</td>
                <td className="px-3 py-2">{o.side}</td>
                <td className="px-3 py-2 tabular-nums">{o.qty}</td>
                <td className="px-3 py-2">{o.status}</td>
                <td className="px-3 py-2 tabular-nums">
                  {o.filledQty}
                  {o.avgFillPrice != null ? ` @ ${o.avgFillPrice}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mt-4">
        <h2 className="mb-2 text-xs font-semibold text-muted-foreground">Recent broker actions</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Env</th>
                <th className="px-3 py-2">Order</th>
                <th className="px-3 py-2">IP</th>
              </tr>
            </thead>
            <tbody>
              {audit.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    No broker actions recorded yet.
                  </td>
                </tr>
              )}
              {audit.map((entry) => (
                <tr key={entry.id} className="border-b border-border/50">
                  <td className="px-3 py-2 text-muted-foreground">{entry.createdAt.slice(0, 19)}</td>
                  <td className="px-3 py-2 font-medium">{entry.action}</td>
                  <td className="px-3 py-2">{entry.environment}</td>
                  <td className="px-3 py-2 font-mono text-[10px]">{entry.clientOrderId ?? '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{entry.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
