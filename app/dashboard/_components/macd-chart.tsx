'use client';

import type { TechnicalData } from '@/lib/types';

export function MacdChart({ data }: { data: TechnicalData | null | undefined }) {
  const macdHist = data?.macdHistory ?? [];
  const maxVal = Math.max(...(macdHist ?? []).map((d: any) => Math.abs(d?.value ?? 0)), 0.01);

  return (
    <div className="flex flex-col items-center">
      <p className="text-[10px] text-muted-foreground mb-1">MACD (12,26,9)</p>
      <div className="flex items-end gap-px h-12 w-full max-w-[120px]">
        {(macdHist ?? []).slice(-20).map((d: any, i: number) => {
          const val = d?.value ?? 0;
          const height = Math.max(2, (Math.abs(val) / maxVal) * 24);
          return (
            <div
              key={i}
              className="flex-1 min-w-0 rounded-sm"
              style={{
                height: `${height}px`,
                backgroundColor: val >= 0 ? '#00c853' : '#ff1744',
                alignSelf: 'flex-end',
                opacity: 0.6 + (i / 20) * 0.4,
              }}
            />
          );
        })}
      </div>
      <div className="flex items-center gap-2 mt-1.5 text-[9px] font-mono">
        <span className="text-muted-foreground">MACD: <span className="text-foreground">{data?.macd?.toFixed?.(2) ?? '0'}</span></span>
        <span className="text-muted-foreground">Sig: <span className="text-foreground">{data?.macdSignal?.toFixed?.(2) ?? '0'}</span></span>
      </div>
    </div>
  );
}
