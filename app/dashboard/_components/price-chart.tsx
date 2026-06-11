'use client';

import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, Bar, BarChart, ComposedChart } from 'recharts';

interface PriceChartProps {
  data: any[];
  isPositive: boolean;
}

export function PriceChart({ data, isPositive }: PriceChartProps) {
  const chartData = (data ?? []).map((d: any) => ({
    date: d?.date ?? '',
    close: d?.close ?? 0,
    volume: d?.volume ?? 0,
    high: d?.high ?? 0,
    low: d?.low ?? 0,
  }));

  if ((chartData?.length ?? 0) === 0) {
    return <div className="flex items-center justify-center h-full text-sm text-muted-foreground">No chart data available</div>;
  }

  const color = isPositive ? '#00c853' : '#ff1744';
  const minPrice = Math.min(...chartData.map((d: any) => d?.close ?? 0).filter((v: number) => v > 0)) * 0.995;
  const maxPrice = Math.max(...chartData.map((d: any) => d?.close ?? 0)) * 1.005;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
        <defs>
          <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          tickLine={false}
          tick={{ fontSize: 9, fill: '#666' }}
          interval="preserveStartEnd"
          tickFormatter={(v: string) => {
            if (!v) return '';
            const parts = v?.split?.('-') ?? [];
            return parts?.length >= 2 ? `${parts[1]}/${parts[2]?.substring?.(0, 2) ?? ''}` : v;
          }}
        />
        <YAxis
          domain={[minPrice, maxPrice]}
          tickLine={false}
          tick={{ fontSize: 9, fill: '#666' }}
          tickFormatter={(v: number) => `$${v?.toFixed?.(0) ?? '0'}`}
          width={50}
        />
        <Tooltip
          contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #2a2a3e', borderRadius: '6px', fontSize: 11 }}
          labelFormatter={(v: string) => v}
          formatter={(value: any, name: string) => {
            if (name === 'close') return [`$${Number(value)?.toFixed?.(2) ?? '0'}`, 'Price'];
            if (name === 'volume') return [(Number(value) / 1e6)?.toFixed?.(1) + 'M', 'Volume'];
            return [value, name];
          }}
        />
        <Bar dataKey="volume" fill="#ffffff08" yAxisId="right" />
        <Area
          type="monotone"
          dataKey="close"
          stroke={color}
          strokeWidth={1.5}
          fill="url(#priceGradient)"
          dot={false}
          animationDuration={500}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tickLine={false}
          tick={false}
          width={0}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
