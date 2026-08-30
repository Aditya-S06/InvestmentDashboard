export type PersonalSide = 'LONG' | 'SHORT';
export type PersonalStatus = 'OPEN' | 'CLOSED';

export interface PersonalTrade {
  id: string;
  symbol: string;
  side: PersonalSide;
  status: PersonalStatus;
  broker?: string | null;
  source?: string | null;
  webullClientOrderId?: string | null;
  brokerOrderId?: string | null;
  thesis?: string | null;
  invalidation?: string | null;
  entryPrice: number;
  exitPrice?: number | null;
  stop?: number | null;
  target?: number | null;
  qty: number;
  openedAt: string;
  closedAt?: string | null;
  fees?: number | null;
  realizedPnl?: number | null;
  setupTag?: string | null;
  strategyTag?: string | null;
  planFollowed?: boolean | null;
  emotionTags?: string[];
  mistakeTags?: string[];
  rating?: number | null;
  preNotes?: string | null;
  managementNotes?: string | null;
  postNotes?: string | null;
}

export interface PersonalReview {
  id: string;
  periodType: 'DAY' | 'WEEK';
  periodStart: string;
  grade?: number | null;
  whatWentWell?: string | null;
  whatToImprove?: string | null;
  focusNext?: string | null;
  netPnl?: number | null;
  tradeCount?: number | null;
}

export interface PersonalAnalytics {
  summary: {
    netPnl: number;
    winRate: number;
    profitFactor: number;
    expectancy: number;
    totalTrades: number;
    openPositions?: number;
    closedTrades?: number;
    planAdherencePct?: number;
  };
  equityCurve: Array<{ date: string; equity: number; pnl?: number }>;
  calendar: Array<{ date: string; pnl: number; trades: number }>;
}
