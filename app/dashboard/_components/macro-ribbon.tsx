'use client';

import { TrendingUp, TrendingDown, Activity, DollarSign, Landmark, BarChart3, Circle } from 'lucide-react';
import type { MacroData } from '@/lib/types';

function formatNum(n: number | null | undefined, decimals: number = 2): string {
  if (n === null || n === undefined || isNaN(n)) return '—';
  if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(decimals) + 'T';
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(decimals) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(decimals) + 'M';
  return n?.toFixed?.(decimals) ?? '—';
}

export function MacroRibbon({ data }: { data: MacroData | null }) {
  const items = [
    {
      label: 'S&P 500',
      value: data?.sp500?.value ? formatNum(data.sp500.value, 0) : '—',
      change: data?.sp500?.change ?? 0,
      icon: BarChart3,
    },
    {
      label: 'VIX',
      value: data?.vix?.value ? formatNum(data.vix.value, 2) : '—',
      change: data?.vix?.change ?? 0,
      icon: Activity,
    },
    {
      label: '10Y Treasury',
      value: data?.treasury10y?.value ? formatNum(data.treasury10y.value, 2) + '%' : '—',
      change: data?.treasury10y?.change ?? 0,
      icon: DollarSign,
    },
    {
      label: 'Fed Funds',
      value: data?.fedFunds?.value ? data.fedFunds.value.toFixed(2) + '%' : '—',
      change: 0,
      icon: Landmark,
    },
  ];

  const marketStatus = data?.marketStatus;
  const statusLabel =
    marketStatus === 'Open' ? 'MARKET OPEN' : marketStatus === 'Closed' ? 'MARKET CLOSED' : 'MARKET —';
  const statusColor =
    marketStatus === 'Open' ? 'text-[#00c853]' : marketStatus === 'Closed' ? 'text-[#ff1744]' : 'text-[#ffa726]';

  return (
    <div className="flex items-center gap-1 px-4 py-1.5 bg-secondary/50 text-xs overflow-x-auto scrollbar-hide">
      {/* Market Status */}
      <div className="flex items-center gap-1.5 pr-3 border-r border-border/50 shrink-0">
        <Circle className={`w-2 h-2 fill-current ${statusColor}`} />
        <span className={`font-mono font-medium ${statusColor}`}>{statusLabel}</span>
      </div>

      {items.map((item, i) => {
        const Icon = item.icon;
        const isPositive = (item?.change ?? 0) >= 0;
        return (
          <div key={i} className="flex items-center gap-1.5 px-3 border-r border-border/50 last:border-r-0 shrink-0">
            <Icon className="w-3 h-3 text-muted-foreground" />
            <span className="text-muted-foreground font-medium">{item.label}</span>
            <span className="font-mono font-semibold text-foreground">{item.value}</span>
            {item.change !== 0 && (
              <span className={`font-mono flex items-center gap-0.5 ${isPositive ? 'text-[#00c853]' : 'text-[#ff1744]'}`}>
                {isPositive ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                {isPositive ? '+' : ''}{item.change?.toFixed?.(2) ?? '0'}%
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
