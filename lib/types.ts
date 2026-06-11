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

export interface FullTickerData {
  ticker: TickerData;
  analyst: AnalystData;
  sentiment: SentimentData;
  risk: RiskData;
  technicals: TechnicalData;
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
