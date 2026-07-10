export interface TickerData {
  symbol: string;
  name: string;
  price: number;
  previousClose: number;
  open: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  avgVolume: number;
  marketCap: number;
  beta: number;
  debtToEquity: number;
  trailingPE: number;
  forwardPE: number;
  dividendYield: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  sector: string;
  industry: string;
  currency: string;
  change: number;
  changePercent: number;
  error?: string;
}

export interface SentimentData {
  score: number;
  label: string;
  components: {
    momentum: number;
    volumeChange: number;
    volatility: number;
    newsSentiment: number;
  };
}

export interface RiskData {
  score: number;
  components: {
    beta: number;
    betaScore: number;
    ivRank: number;
    debtToEquity: number;
    deScore: number;
  };
}

export interface TechnicalData {
  rsi: number;
  macd: number;
  macdSignal: number;
  macdHist: number;
  macdHistory: { value: number }[];
  signals: { type: string; message: string }[];
}

export interface PositionData {
  kellyPercent: number;
  suggestedPercent: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
}

export interface NewsItem {
  title: string;
  publisher: string;
  link: string;
  publishedAt: string;
  credibility: 'High' | 'Medium' | 'Low';
}

export interface AnalystData {
  targetMeanPrice: number;
  targetHighPrice: number;
  targetLowPrice: number;
  targetMedianPrice: number;
  numberOfAnalysts: number;
  recommendationKey: string;
  recommendationMean: number;
  recentRecs: {
    date: string;
    firm: string;
    toGrade: string;
    fromGrade: string;
    action: string;
  }[];
}

export interface ExitSignal {
  type: string;
  severity: string;
  message: string;
}

export interface MacroData {
  vix: { value: number; change: number };
  sp500: { value: number; change: number };
  treasury10y: { value: number; change: number };
  fedFunds: { value: number; label: string };
  marketStatus: string;
}

export interface QuantIndicators {
  rsi_14: number | null;
  macd_histogram: number | null;
  bollinger_pct_b: number | null;
  above_sma50: boolean | null;
}

export interface RiskMetrics {
  ann_vol_pct: number | null;
  max_drawdown_pct: number | null;
  hist_var_95_pct: number | null;
}

export interface PredictiveForecast {
  expected_return_pct: number | null;
  std_err_pct: number | null;
  method: string;
  horizon_days?: number;
}

export interface StrategySignals {
  regime: 'mean_reversion' | 'momentum' | 'trend_following' | 'insufficient_data';
  primary_signal: 'long' | 'short' | 'neutral';
  atr_value: number | null;
  suggested_risk_pct: number;
  correlation_filter_active: boolean;
  notes: string;
}

export interface DataSources {
  quote: 'webull' | 'yahoo' | 'yahoo_fallback';
  history: 'webull' | 'yahoo' | 'yahoo_fallback';
  news: 'yahoo';
  sentiment: 'yahoo';
  fundamentals: 'yahoo';
}

export interface WebullQuote {
  bid: number;
  ask: number;
  last: number;
  volume: number;
  asOf: string;
}

export interface WebullAccount {
  accountId: string;
  accountType: string;
  accountNumber?: string;
  accountClass?: string;
  label?: string;
  userId?: string;
  currency?: string;
}

export interface WebullPosition {
  symbol: string;
  quantity: number;
  avgCost: number;
  marketValue: number;
  unrealizedPnl: number;
  lastPrice?: number;
}

export interface WebullBalance {
  accountId: string;
  totalCash: number;
  buyingPower: number;
  totalMarketValue: number;
  netLiquidation: number;
  currency: string;
}

export interface FullTickerData {
  ticker: TickerData;
  analyst: AnalystData;
  sentiment: SentimentData;
  risk: RiskData;
  technicals: TechnicalData;
  quant_indicators?: QuantIndicators;
  risk_metrics?: RiskMetrics;
  predictive?: PredictiveForecast;
  strategy_signals?: StrategySignals;
  data_sources?: DataSources;
  webull_quote?: WebullQuote;
  position: PositionData;
  exit: { alerts: ExitSignal[]; technicals?: TechnicalData };
  news: NewsItem[];
  trends: { topic: string; mentions: number }[];
}

export interface TickerCardData {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  sentiment?: SentimentData;
  risk?: RiskData;
  isWatchlisted?: boolean;
  loading?: boolean;
}

export interface WatchlistItem {
  id: string;
  ticker: string;
  sector?: string | null;
  createdAt: string;
}
