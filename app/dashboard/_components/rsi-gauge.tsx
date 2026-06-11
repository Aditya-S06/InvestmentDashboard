'use client';

export function RsiGauge({ value }: { value: number }) {
  const rsi = Math.max(0, Math.min(100, value ?? 50));
  const color = rsi > 70 ? '#ff1744' : rsi < 30 ? '#00c853' : '#ffa726';
  const label = rsi > 70 ? 'Overbought' : rsi < 30 ? 'Oversold' : 'Neutral';

  // Arc calculation for the gauge
  const radius = 35;
  const circumference = Math.PI * radius; // half circle
  const progress = (rsi / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <p className="text-[10px] text-muted-foreground mb-1">RSI (14)</p>
      <svg width="90" height="55" viewBox="0 0 90 55">
        {/* Background arc */}
        <path
          d="M 10 50 A 35 35 0 0 1 80 50"
          fill="none"
          stroke="#2a2a3e"
          strokeWidth="6"
          strokeLinecap="round"
        />
        {/* Progress arc */}
        <path
          d="M 10 50 A 35 35 0 0 1 80 50"
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${progress} ${circumference}`}
        />
        {/* Value text */}
        <text x="45" y="42" textAnchor="middle" fill={color} fontSize="16" fontWeight="bold" fontFamily="monospace">
          {rsi?.toFixed?.(0) ?? '50'}
        </text>
      </svg>
      <p className="text-[9px] font-medium" style={{ color }}>{label}</p>
    </div>
  );
}
