import type { FullTickerData, MacroData, WatchlistItem } from '@/lib/types';

export type InsightConfidence = 'high' | 'medium' | 'low';

export interface InsightPick {
  symbol: string;
  thesis: string;
  confidence: InsightConfidence;
  signals: string[];
  inWatchlist: boolean;
  sources?: string[];
}

export interface InsightFinalOutput {
  summary: string;
  picks: InsightPick[];
}

export interface InsightCitation {
  url: string;
  title?: string;
  content?: string;
}

export interface InsightToolTrace {
  name: string;
  args: Record<string, unknown>;
}

export interface InsightImageAttachment {
  /** data:image/...;base64,... URL for OpenRouter vision */
  url: string;
  mimeType?: string;
  name?: string;
}

export interface InsightChatMetadata {
  picks?: InsightPick[];
  citations?: InsightCitation[];
  toolTrace?: InsightToolTrace[];
  modelUsed?: string;
  images?: InsightImageAttachment[];
}

export interface InsightStoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: InsightChatMetadata | null;
  createdAt: string;
}

export interface InsightSessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface InsightContext {
  watchlist: WatchlistItem[];
  groupedWatchlist: { sector: string; tickers: string[] }[];
  macro: MacroData | null;
  watchlistSnapshot: {
    symbol: string;
    name: string;
    price: number;
    changePercent: number;
    sentiment?: string;
    risk?: number;
  }[];
}

export type AppToolResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
};

export interface InsightToolExecutionContext {
  userId: string;
  context: InsightContext;
  finalOutput?: InsightFinalOutput;
}

export type MarketFullResult = FullTickerData | { error?: string };

