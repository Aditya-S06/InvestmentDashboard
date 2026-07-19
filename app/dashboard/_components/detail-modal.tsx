'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { X, Star, AlertTriangle, TrendingUp, TrendingDown, Loader2, Shield, Target, BarChart3, Newspaper, Sparkles, ExternalLink, Info, BrainCircuit, Gauge, NotebookPen } from 'lucide-react';
import type { FullTickerData, NewsItem, ExitSignal } from '@/lib/types';
import { PriceChart } from './price-chart';
import { RsiGauge } from './rsi-gauge';
import { MacdChart } from './macd-chart';

interface DetailModalProps {
  symbol: string;
  onClose: () => void;
  isWatchlisted: boolean;
  onToggleWatchlist: () => void;
}

function formatPrice(n: number | null | undefined): string {
  if (!n || isNaN(n)) return '—';
  return '$' + n.toFixed(2);
}

function formatMetric(n: number | null | undefined, digits = 2, suffix = ''): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}${suffix}`;
}

function humanize(value: string | null | undefined): string {
  return value ? value.replace(/_/g, ' ') : 'Unavailable';
}

function CredibilityBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    High: 'bg-[#00c853]/10 text-[#00c853] border-[#00c853]/20',
    Medium: 'bg-[#ffa726]/10 text-[#ffa726] border-[#ffa726]/20',
    Low: 'bg-[#ff1744]/10 text-[#ff1744] border-[#ff1744]/20',
  };
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded border font-medium ${colors?.[level] ?? colors.Low}`}>
      {level}
    </span>
  );
}

export function DetailModal({ symbol, onClose, isWatchlisted, onToggleWatchlist }: DetailModalProps) {
  const router = useRouter();
  const [data, setData] = useState<FullTickerData | null>(null);
  const [historical, setHistorical] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('6mo');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/market/full?symbol=${symbol}`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`/api/market/historical?symbol=${symbol}&period=${period}`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([fullData, histData]) => {
      setData(fullData);
      setHistorical(histData ?? []);
      setLoading(false);
    });
  }, [symbol, period]);

  const ticker = data?.ticker;
  const analyst = data?.analyst;
  const sentiment = data?.sentiment;
  const risk = data?.risk;
  const technicals = data?.technicals;
  const position = data?.position;
  const exitData = data?.exit;
  const quantIndicators = data?.quant_indicators;
  const riskMetrics = data?.risk_metrics;
  const predictive = data?.predictive;
  const strategySignals = data?.strategy_signals;
  const news = data?.news ?? [];
  const trends = data?.trends ?? [];
  const isPositive = (ticker?.change ?? 0) >= 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm overflow-y-auto" onClick={onClose}>
      <div
        className="max-w-5xl mx-auto my-4 bg-card border border-border rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-card rounded-t-lg border-b border-border px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="font-mono font-bold text-lg text-[#00c853]">{symbol}</h2>
            {ticker?.name && <span className="text-sm text-muted-foreground">{ticker.name}</span>}
            <button onClick={onToggleWatchlist} className="p-1">
              <Star className={`w-4 h-4 ${isWatchlisted ? 'fill-[#ffa726] text-[#ffa726]' : 'text-muted-foreground hover:text-[#ffa726]'}`} />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.push(`/dashboard/journal?new=1&symbol=${encodeURIComponent(symbol)}`)}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#00c853] px-3 py-1.5 text-xs font-semibold text-black transition-opacity hover:opacity-90"
            >
              <NotebookPen className="h-3.5 w-3.5" />
              Plan paper trade
            </button>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-secondary text-muted-foreground">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-96">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-[#00c853]" />
              <p className="text-sm text-muted-foreground">Loading {symbol} data...</p>
            </div>
          </div>
        ) : (
          <div className="p-5 space-y-5">
            {/* Exit Alerts */}
            {(exitData?.alerts?.length ?? 0) > 0 && (
              <div className="space-y-2">
                {(exitData?.alerts ?? []).map((alert: ExitSignal, i: number) => (
                  <div key={i} className={`flex items-start gap-2 p-3 rounded-md border ${
                    alert?.severity === 'high'
                      ? 'bg-[#ff1744]/10 border-[#ff1744]/30 text-[#ff1744]'
                      : 'bg-[#ffa726]/10 border-[#ffa726]/30 text-[#ffa726]'
                  }`}>
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold">EXIT SIGNAL</p>
                      <p className="text-xs opacity-90 mt-0.5">{alert?.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Price + Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <div className="flex items-baseline gap-3 mb-1">
                  <span className="font-mono text-3xl font-bold">{formatPrice(ticker?.price)}</span>
                  <span className={`font-mono text-lg font-medium ${isPositive ? 'text-[#00c853]' : 'text-[#ff1744]'}`}>
                    {isPositive ? '+' : ''}{ticker?.change?.toFixed?.(2)} ({isPositive ? '+' : ''}{ticker?.changePercent?.toFixed?.(2)}%)
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Open: <span className="text-foreground font-mono">{formatPrice(ticker?.open)}</span></span>
                  <span>High: <span className="text-foreground font-mono">{formatPrice(ticker?.dayHigh)}</span></span>
                  <span>Low: <span className="text-foreground font-mono">{formatPrice(ticker?.dayLow)}</span></span>
                  <span>Vol: <span className="text-foreground font-mono">{ticker?.volume ? (ticker.volume / 1e6).toFixed(1) + 'M' : '—'}</span></span>
                  <span>Mkt Cap: <span className="text-foreground font-mono">{ticker?.marketCap ? (ticker.marketCap >= 1e12 ? (ticker.marketCap/1e12).toFixed(1)+'T' : (ticker.marketCap/1e9).toFixed(1)+'B') : '—'}</span></span>
                  <span>P/E: <span className="text-foreground font-mono">{ticker?.trailingPE?.toFixed?.(1) ?? '—'}</span></span>
                  <span>Beta: <span className="text-foreground font-mono">{ticker?.beta?.toFixed?.(2) ?? '—'}</span></span>
                </div>
              </div>

              {/* Sentiment + Risk summary */}
              <div className="flex gap-4 items-center">
                {sentiment && (
                  <div className="flex-1">
                    <p className="text-[10px] text-muted-foreground mb-1">Sentiment</p>
                    <div className="text-center">
                      <span className="font-mono text-2xl font-bold" style={{
                        color: sentiment.score >= 55 ? '#00c853' : sentiment.score >= 45 ? '#ffa726' : '#ff1744'
                      }}>{sentiment.score}</span>
                      <p className="text-[10px] font-medium" style={{
                        color: sentiment.score >= 55 ? '#00c853' : sentiment.score >= 45 ? '#ffa726' : '#ff1744'
                      }}>{sentiment.label}</p>
                    </div>
                  </div>
                )}
                {risk && (
                  <div className="flex-1">
                    <p className="text-[10px] text-muted-foreground mb-1">Risk</p>
                    <div className="text-center">
                      <span className="font-mono text-2xl font-bold" style={{
                        color: risk.score < 33 ? '#00c853' : risk.score < 66 ? '#ffa726' : '#ff1744'
                      }}>{risk.score}</span>
                      <p className="text-[10px] font-medium" style={{
                        color: risk.score < 33 ? '#00c853' : risk.score < 66 ? '#ffa726' : '#ff1744'
                      }}>{risk.score < 33 ? 'Low' : risk.score < 66 ? 'Medium' : 'High'}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Quant strategy layer */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded-lg border border-[#00c853]/20 bg-[#00c853]/5 p-4 lg:col-span-1">
                <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold font-display">
                  <BrainCircuit className="h-4 w-4 text-[#00c853]" /> Strategy Signal
                </h3>
                {strategySignals ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full border border-[#60B5FF]/30 bg-[#60B5FF]/10 px-2 py-1 text-[10px] font-semibold capitalize text-[#60B5FF]">
                        {humanize(strategySignals.regime)}
                      </span>
                      <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase ${
                        strategySignals.primary_signal === 'long'
                          ? 'border-[#00c853]/30 bg-[#00c853]/10 text-[#00c853]'
                          : strategySignals.primary_signal === 'short'
                            ? 'border-[#ff1744]/30 bg-[#ff1744]/10 text-[#ff1744]'
                            : 'border-[#ffa726]/30 bg-[#ffa726]/10 text-[#ffa726]'
                      }`}>
                        {strategySignals.primary_signal}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-md bg-secondary/50 p-2">
                        <p className="text-[9px] text-muted-foreground">ATR</p>
                        <p className="font-mono text-sm font-semibold">{formatPrice(strategySignals.atr_value)}</p>
                      </div>
                      <div className="rounded-md bg-secondary/50 p-2">
                        <p className="text-[9px] text-muted-foreground">Risk per trade</p>
                        <p className="font-mono text-sm font-semibold">{formatMetric(strategySignals.suggested_risk_pct * 100, 1, '%')}</p>
                      </div>
                    </div>
                    <p className="text-[10px] leading-relaxed text-muted-foreground">{strategySignals.notes}</p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Strategy signals are unavailable for this symbol.</p>
                )}
              </div>

              <div className="rounded-lg border border-border/50 bg-secondary/30 p-4 lg:col-span-2">
                <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold font-display">
                  <Gauge className="h-4 w-4 text-[#60B5FF]" /> Quant &amp; Risk Snapshot
                </h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { label: 'RSI 14', value: formatMetric(quantIndicators?.rsi_14, 1) },
                    { label: 'MACD histogram', value: formatMetric(quantIndicators?.macd_histogram, 3) },
                    { label: 'Bollinger %B', value: formatMetric(quantIndicators?.bollinger_pct_b, 2) },
                    { label: 'Above SMA 50', value: quantIndicators?.above_sma50 == null ? '—' : quantIndicators.above_sma50 ? 'Yes' : 'No' },
                    { label: 'Annualized vol', value: formatMetric(riskMetrics?.ann_vol_pct, 1, '%') },
                    { label: 'Max drawdown', value: formatMetric(riskMetrics?.max_drawdown_pct, 1, '%') },
                    { label: 'Historical VaR 95%', value: formatMetric(riskMetrics?.hist_var_95_pct, 2, '%') },
                    { label: `${predictive?.horizon_days ?? 5}d historical mean`, value: formatMetric(predictive?.expected_return_pct, 2, '%') },
                  ].map((item) => (
                    <div key={item.label} className="rounded-md border border-border/40 bg-background/40 p-2">
                      <p className="text-[9px] text-muted-foreground">{item.label}</p>
                      <p className="mt-0.5 font-mono text-xs font-semibold">{item.value}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[9px] leading-relaxed text-muted-foreground">
                  Forecast: {predictive ? `${formatMetric(predictive.expected_return_pct, 2, '%')} ± ${formatMetric(predictive.std_err_pct, 2, '%')} (${humanize(predictive.method)})` : 'unavailable'}.
                  Historical-mean forecasts describe past behavior and are not a predictive edge or trading recommendation.
                </p>
              </div>
            </div>

            {/* Price Chart */}
            <div className="bg-secondary/30 rounded-lg p-4 border border-border/50">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-display font-semibold flex items-center gap-1.5">
                  <BarChart3 className="w-4 h-4 text-[#00c853]" /> Price Chart
                </h3>
                <div className="flex gap-1">
                  {['1mo', '3mo', '6mo', '1y'].map(p => (
                    <button
                      key={p}
                      onClick={() => setPeriod(p)}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium transition-colors ${
                        period === p ? 'bg-[#00c853] text-white' : 'bg-secondary text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {p.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-64">
                <PriceChart data={historical} isPositive={isPositive} />
              </div>
            </div>

            {/* Technical Indicators + Risk Meter row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Technicals */}
              <div className="bg-secondary/30 rounded-lg p-4 border border-border/50">
                <h3 className="text-sm font-display font-semibold flex items-center gap-1.5 mb-3">
                  <Target className="w-4 h-4 text-[#60B5FF]" /> Technical Indicators
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <RsiGauge value={technicals?.rsi ?? 50} />
                  <MacdChart data={technicals} />
                </div>
                {(technicals?.signals?.length ?? 0) > 0 && (
                  <div className="mt-3 space-y-1">
                    {(technicals?.signals ?? []).map((sig: any, i: number) => (
                      <div key={i} className={`flex items-start gap-1.5 text-[10px] ${
                        sig?.type === 'warning' ? 'text-[#ffa726]' : 'text-[#60B5FF]'
                      }`}>
                        <Info className="w-3 h-3 mt-0.5 shrink-0" />
                        <span>{sig?.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Risk Meter */}
              <div className="bg-secondary/30 rounded-lg p-4 border border-border/50">
                <h3 className="text-sm font-display font-semibold flex items-center gap-1.5 mb-3">
                  <Shield className="w-4 h-4 text-[#ffa726]" /> Risk Assessment
                </h3>
                {risk && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-center">
                      <div className="w-20 h-20 rounded-full flex items-center justify-center border-4" style={{
                        borderColor: risk.score < 33 ? '#00c853' : risk.score < 66 ? '#ffa726' : '#ff1744',
                        color: risk.score < 33 ? '#00c853' : risk.score < 66 ? '#ffa726' : '#ff1744',
                      }}>
                        <span className="font-mono text-2xl font-bold">{risk.score}</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {[
                        { label: 'Beta', value: risk?.components?.beta?.toFixed?.(2) ?? '—', score: risk?.components?.betaScore ?? 0, weight: '40%' },
                        { label: 'IV Rank', value: (risk?.components?.ivRank?.toFixed?.(0) ?? '0') + '%', score: risk?.components?.ivRank ?? 0, weight: '35%' },
                        { label: 'D/E Ratio', value: risk?.components?.debtToEquity?.toFixed?.(0) ?? '—', score: risk?.components?.deScore ?? 0, weight: '25%' },
                      ].map((item, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground w-16">{item.label}</span>
                          <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{
                              width: `${Math.min(100, item.score)}%`,
                              backgroundColor: item.score < 33 ? '#00c853' : item.score < 66 ? '#ffa726' : '#ff1744',
                            }} />
                          </div>
                          <span className="font-mono text-foreground w-12 text-right">{item.value}</span>
                          <span className="text-muted-foreground text-[10px] w-8">{item.weight}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Analyst + Position Sizing row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Analyst Consensus */}
              <div className="bg-secondary/30 rounded-lg p-4 border border-border/50">
                <h3 className="text-sm font-display font-semibold flex items-center gap-1.5 mb-3">
                  <TrendingUp className="w-4 h-4 text-[#00c853]" /> Analyst Consensus
                </h3>
                {analyst && (
                  <div className="space-y-3">
                    {/* Recommendation */}
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-1 rounded font-medium ${
                        analyst?.recommendationKey === 'buy' || analyst?.recommendationKey === 'strong_buy'
                          ? 'bg-[#00c853]/10 text-[#00c853]'
                          : analyst?.recommendationKey === 'sell' || analyst?.recommendationKey === 'strong_sell'
                          ? 'bg-[#ff1744]/10 text-[#ff1744]'
                          : 'bg-[#ffa726]/10 text-[#ffa726]'
                      }`}>
                        {analyst?.recommendationKey?.toUpperCase?.()?.replace?.('_', ' ') ?? 'N/A'}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{analyst?.numberOfAnalysts ? `${analyst.numberOfAnalysts} analysts` : ''}</span>
                    </div>

                    {/* Price Targets */}
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <p className="text-[9px] text-muted-foreground">Low</p>
                        <p className="font-mono text-xs font-medium text-[#ff1744]">{formatPrice(analyst?.targetLowPrice)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-muted-foreground">Mean</p>
                        <p className="font-mono text-xs font-medium text-foreground">{formatPrice(analyst?.targetMeanPrice)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-muted-foreground">High</p>
                        <p className="font-mono text-xs font-medium text-[#00c853]">{formatPrice(analyst?.targetHighPrice)}</p>
                      </div>
                    </div>

                    {/* Target bar */}
                    {analyst?.targetLowPrice && analyst?.targetHighPrice && ticker?.price ? (
                      <div className="relative">
                        <div className="h-2 bg-gradient-to-r from-[#ff1744] via-[#ffa726] to-[#00c853] rounded-full" />
                        <div
                          className="absolute top-0 w-0.5 h-4 bg-white -translate-y-1"
                          style={{
                            left: `${Math.min(100, Math.max(0, ((ticker.price - analyst.targetLowPrice) / (analyst.targetHighPrice - analyst.targetLowPrice)) * 100))}%`,
                          }}
                        />
                        <p className="text-[9px] text-muted-foreground mt-1 text-center">Current price position relative to analyst targets</p>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              {/* Position Sizing */}
              <div className="bg-secondary/30 rounded-lg p-4 border border-border/50">
                <h3 className="text-sm font-display font-semibold flex items-center gap-1.5 mb-3">
                  <Target className="w-4 h-4 text-[#A19AD3]" /> Position Sizing (Kelly Criterion)
                </h3>
                {position && (
                  <div className="space-y-3">
                    <div className="text-center">
                      <p className="text-[10px] text-muted-foreground">Suggested Position Size (Half-Kelly)</p>
                      <p className="font-mono text-3xl font-bold text-[#60B5FF] mt-1">{position?.suggestedPercent?.toFixed?.(1) ?? '0'}%</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">of portfolio capital</p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-secondary/50 rounded p-2">
                        <p className="text-[9px] text-muted-foreground">Full Kelly</p>
                        <p className="font-mono font-medium">{position?.kellyPercent?.toFixed?.(1) ?? '0'}%</p>
                      </div>
                      <div className="bg-secondary/50 rounded p-2">
                        <p className="text-[9px] text-muted-foreground">Historical Win Rate</p>
                        <p className="font-mono font-medium">{position?.winRate?.toFixed?.(1) ?? '0'}%</p>
                      </div>
                      <div className="bg-secondary/50 rounded p-2">
                        <p className="text-[9px] text-muted-foreground">Avg Win</p>
                        <p className="font-mono font-medium text-[#00c853]">+{position?.avgWin?.toFixed?.(3) ?? '0'}%</p>
                      </div>
                      <div className="bg-secondary/50 rounded p-2">
                        <p className="text-[9px] text-muted-foreground">Avg Loss</p>
                        <p className="font-mono font-medium text-[#ff1744]">-{position?.avgLoss?.toFixed?.(3) ?? '0'}%</p>
                      </div>
                    </div>

                    <p className="text-[9px] text-muted-foreground italic">
                      Based on historical daily returns. Not financial advice — indicator only.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* News + Trends row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* News */}
              <div className="md:col-span-2 bg-secondary/30 rounded-lg p-4 border border-border/50">
                <h3 className="text-sm font-display font-semibold flex items-center gap-1.5 mb-3">
                  <Newspaper className="w-4 h-4 text-[#60B5FF]" /> Recent News
                </h3>
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {(news?.length ?? 0) === 0 ? (
                    <p className="text-xs text-muted-foreground">No recent news available.</p>
                  ) : (
                    (news ?? []).map((item: NewsItem, i: number) => (
                      <a
                        key={i}
                        href={item?.link || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-start gap-2 p-2 rounded hover:bg-secondary/50 transition-colors group"
                      >
                        <ExternalLink className="w-3 h-3 mt-1 text-muted-foreground group-hover:text-[#60B5FF] shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-foreground group-hover:text-[#60B5FF] line-clamp-2">{item?.title}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[9px] text-muted-foreground">{item?.publisher}</span>
                            <CredibilityBadge level={item?.credibility ?? 'Low'} />
                          </div>
                        </div>
                      </a>
                    ))
                  )}
                </div>
              </div>

              {/* Trends */}
              <div className="bg-secondary/30 rounded-lg p-4 border border-border/50">
                <h3 className="text-sm font-display font-semibold flex items-center gap-1.5 mb-3">
                  <Sparkles className="w-4 h-4 text-[#ffa726]" /> Emerging Trends
                </h3>
                {(trends?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground">No trending topics detected in recent news.</p>
                ) : (
                  <div className="space-y-2">
                    {(trends ?? []).map((trend: any, i: number) => (
                      <div key={i} className="flex items-center gap-2">
                        <div className="flex-1">
                          <p className="text-xs font-medium text-foreground">{trend?.topic}</p>
                          <div className="h-1 bg-secondary rounded-full mt-1 overflow-hidden">
                            <div className="h-full bg-[#ffa726] rounded-full" style={{ width: `${Math.min(100, (trend?.mentions ?? 0) * 25)}%` }} />
                          </div>
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground">{trend?.mentions ?? 0}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Disclaimer */}
            <p className="text-[9px] text-muted-foreground text-center opacity-60">
              All data provided for informational purposes only. Indicators and signals are historically correlated patterns, not guarantees. Not financial advice.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
