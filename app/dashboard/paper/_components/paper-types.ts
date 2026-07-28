export type TradeSide = 'LONG' | 'SHORT';
export type TradeStatus = 'PLANNED' | 'OPEN' | 'CLOSED' | 'CANCELLED';

export interface PaperAccount {
  id: string;
  name: string;
  startingEquity: number;
  cash: number;
  currency: string;
  equity?: number;
  marketValue?: number;
  unrealizedPnl?: number;
  openRisk?: number;
}

export interface TradeFill {
  id: string;
  action: 'BUY' | 'SELL';
  kind: 'ENTRY' | 'ADD' | 'REDUCE' | 'EXIT';
  qty: number;
  price: number;
  filledAt: string;
  note?: string | null;
}

export interface PaperTrade {
  id: string;
  symbol: string;
  side: TradeSide;
  status: TradeStatus;
  thesis: string;
  invalidation: string;
  plannedEntry?: number | null;
  plannedStop?: number | null;
  plannedTarget?: number | null;
  plannedRisk?: number | null;
  plannedRiskPct?: number | null;
  plannedShares?: number | null;
  setupTag?: string | null;
  strategyTag?: string | null;
  qty: number;
  avgEntry?: number | null;
  avgExit?: number | null;
  currentPrice?: number | null;
  marketValue?: number | null;
  unrealizedPnl?: number | null;
  unrealizedR?: number | null;
  openedAt?: string | null;
  closedAt?: string | null;
  stopPrice?: number | null;
  targetPrice?: number | null;
  regimeSnapshot?: Record<string, unknown> | null;
  quantSnapshot?: Record<string, unknown> | null;
  realizedPnl?: number | null;
  realizedR?: number | null;
  fees?: number | null;
  mfePct?: number | null;
  maePct?: number | null;
  mfe?: number | null;
  mae?: number | null;
  mfeR?: number | null;
  maeR?: number | null;
  exitEfficiency?: number | null;
  planFollowed?: boolean | null;
  emotionTags?: string[];
  mistakeTags?: string[];
  rating?: number | null;
  preNotes?: string | null;
  managementNotes?: string | null;
  postNotes?: string | null;
  fills?: TradeFill[];
  createdAt?: string;
  updatedAt?: string;
}

export interface JournalReview {
  id: string;
  periodType: 'DAY' | 'WEEK';
  periodStart: string;
  grade?: number | null;
  whatWentWell?: string | null;
  whatToImprove?: string | null;
  focusNext?: string | null;
  ruleAdherencePct?: number | null;
  netPnl?: number | null;
  tradeCount?: number | null;
  createdAt?: string;
}

export interface AnalyticsBreakdown {
  key: string;
  trades: number;
  winRate: number;
  netPnl: number;
  avgR: number;
  expectancy?: number;
}

export interface JournalAnalytics {
  summary: {
    netPnl: number;
    realizedPnl?: number;
    unrealizedPnl?: number;
    winRate: number;
    profitFactor: number;
    expectancy: number;
    avgR: number;
    planAdherencePct: number;
    maxDrawdown: number;
    currentDrawdown: number;
    totalTrades: number;
    openPositions?: number;
    equity?: number;
  };
  equityCurve: Array<{ date: string; equity: number; pnl?: number }>;
  calendar: Array<{ date: string; pnl: number; r?: number; trades: number }>;
  breakdowns: {
    setup?: AnalyticsBreakdown[];
    strategy?: AnalyticsBreakdown[];
    regime?: AnalyticsBreakdown[];
    weekday?: AnalyticsBreakdown[];
    holdingTime?: AnalyticsBreakdown[];
    side?: AnalyticsBreakdown[];
    emotion?: AnalyticsBreakdown[];
    planAdherence?: AnalyticsBreakdown[];
  };
}

export interface MarketPrefill {
  symbol: string;
  price: number;
  atr: number | null;
  suggestedRiskPct: number;
  strategySignals?: Record<string, unknown> | null;
  quantSnapshot?: Record<string, unknown> | null;
}
