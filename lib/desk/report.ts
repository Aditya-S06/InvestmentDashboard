import {
  DESK_ANALYSTS,
  DESK_ASSET_TYPES,
  DESK_DEPTHS,
  type CreateDeskRunInput,
  type DeskAnalyst,
  type DeskAssetType,
  type DeskDepth,
  type DeskSignal,
} from './types';

export type DeskReportTab = 'overview' | 'analysts' | 'debate' | 'trader' | 'risk' | 'decision';

export const DESK_REPORT_TABS: { id: DeskReportTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'analysts', label: 'Analysts' },
  { id: 'debate', label: 'Debate' },
  { id: 'trader', label: 'Trader' },
  { id: 'risk', label: 'Risk' },
  { id: 'decision', label: 'Decision' },
];

/** Keys confirmed on `.data/desk/_smoke/out.json` (and log alias where noted). */
export type DeskParsedReport = {
  ticker: string;
  tradeDate: string;
  rating: DeskSignal | null;
  executiveSummary: string;
  thesis: string;
  horizon: string;
  entry: string;
  stop: string;
  sizing: string;
  bullExcerpt: string;
  bearExcerpt: string;
  marketReport: string;
  sentimentReport: string;
  newsReport: string;
  fundamentalsReport: string;
  bullHistory: string;
  bearHistory: string;
  researchPlan: string;
  traderPlan: string;
  aggressiveHistory: string;
  conservativeHistory: string;
  neutralHistory: string;
  riskJudge: string;
  finalDecision: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return items.length > 0 ? items : null;
}

/** Never maps unknown text to Hold. REVIEW stays REVIEW. */
export function parseDeskSignalText(value: string | null | undefined): DeskSignal | null {
  if (!value) return null;
  const trimmed = value.trim();
  switch (trimmed) {
    case 'Buy':
    case 'Overweight':
    case 'Hold':
    case 'Underweight':
    case 'Sell':
    case 'REVIEW':
      return trimmed;
    default:
      break;
  }
  switch (trimmed.toUpperCase()) {
    case 'BUY':
      return 'Buy';
    case 'OVERWEIGHT':
      return 'Overweight';
    case 'HOLD':
      return 'Hold';
    case 'UNDERWEIGHT':
      return 'Underweight';
    case 'SELL':
      return 'Sell';
    case 'REVIEW':
      return 'REVIEW';
    default:
      return null;
  }
}

function labeledFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  if (!text) return fields;
  const matches = [...text.matchAll(/\*\*([^*]+)\*\*\s*:\s*/g)];
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const key = match[1].trim().toLowerCase();
    const start = (match.index ?? 0) + match[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
    const value = text.slice(start, end).trim();
    if (key && value) fields.set(key, value);
  }
  return fields;
}

function pickField(fields: Map<string, string>, names: string[]): string {
  for (const name of names) {
    const value = fields.get(name.toLowerCase());
    if (value) return value;
  }
  return '';
}

function excerpt(text: string, max = 480): string {
  const cleaned = text.replace(/^\s*(Bull Analyst|Bear Analyst)\s*:\s*/i, '').trim();
  if (!cleaned) return '';
  if (cleaned.length <= max) return cleaned;
  const cut = cleaned.slice(0, max);
  const breakAt = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '));
  const clipped = (breakAt > 160 ? cut.slice(0, breakAt + 1) : cut).trim();
  return `${clipped}…`;
}

export function parseDeskReport(finalState: unknown, fallbackTicker: string): DeskParsedReport {
  const state = isRecord(finalState) ? finalState : {};
  const debate = isRecord(state.investment_debate_state) ? state.investment_debate_state : {};
  const risk = isRecord(state.risk_debate_state) ? state.risk_debate_state : {};
  const traderPlan = asString(state.trader_investment_plan) || asString(state.trader_investment_decision);
  const finalDecision = asString(state.final_trade_decision) || asString(risk.judge_decision);
  const researchPlan =
    asString(state.investment_plan) || asString(debate.judge_decision) || asString(debate.current_response);
  const pmFields = labeledFields(finalDecision);
  const traderFields = labeledFields(traderPlan);
  const researchFields = labeledFields(researchPlan);
  const rating =
    parseDeskSignalText(pickField(pmFields, ['rating', 'recommendation', 'action'])) ??
    parseDeskSignalText(pickField(traderFields, ['action', 'rating', 'recommendation'])) ??
    parseDeskSignalText(pickField(researchFields, ['recommendation', 'rating', 'action']));

  return {
    ticker: asString(state.company_of_interest) || fallbackTicker,
    tradeDate: asString(state.trade_date),
    rating,
    executiveSummary: pickField(pmFields, ['executive summary']),
    thesis: pickField(pmFields, ['investment thesis']) || pickField(researchFields, ['rationale']),
    horizon: pickField(pmFields, ['time horizon', 'horizon']),
    entry:
      pickField(pmFields, ['entry', 'entry price', 'entry zone']) ||
      pickField(traderFields, ['entry', 'entry price', 'entry zone']),
    stop: pickField(traderFields, ['stop loss', 'stop']) || pickField(pmFields, ['stop loss', 'stop']),
    sizing:
      pickField(traderFields, ['position sizing', 'sizing']) || pickField(pmFields, ['position sizing', 'sizing']),
    bullExcerpt: excerpt(asString(debate.bull_history)),
    bearExcerpt: excerpt(asString(debate.bear_history)),
    marketReport: asString(state.market_report),
    sentimentReport: asString(state.sentiment_report),
    newsReport: asString(state.news_report),
    fundamentalsReport: asString(state.fundamentals_report),
    bullHistory: asString(debate.bull_history),
    bearHistory: asString(debate.bear_history),
    researchPlan,
    traderPlan,
    aggressiveHistory: asString(risk.aggressive_history),
    conservativeHistory: asString(risk.conservative_history),
    neutralHistory: asString(risk.neutral_history),
    riskJudge: asString(risk.judge_decision),
    finalDecision,
  };
}

export function resolveDeskRating(
  signal: DeskSignal | null,
  report: DeskParsedReport,
  status: 'completed' | 'review',
): DeskSignal | null {
  if (signal) return signal;
  if (report.rating) return report.rating;
  return status === 'review' ? 'REVIEW' : null;
}

export function deskReportMarkdown(report: DeskParsedReport, rating: DeskSignal | null): string {
  const lines: string[] = [`# ${report.ticker} desk report`, ''];
  if (rating) lines.push(`**Rating:** ${rating}`, '');
  if (report.tradeDate) lines.push(`**As of:** ${report.tradeDate}`, '');
  if (report.horizon) lines.push(`**Horizon:** ${report.horizon}`);
  if (report.entry) lines.push(`**Entry:** ${report.entry}`);
  if (report.stop) lines.push(`**Stop:** ${report.stop}`);
  if (report.sizing) lines.push(`**Sizing:** ${report.sizing}`);
  if (report.horizon || report.entry || report.stop || report.sizing) lines.push('');
  if (report.executiveSummary) {
    lines.push('## Executive summary', '', report.executiveSummary, '');
  }
  if (report.thesis) lines.push('## Thesis', '', report.thesis, '');
  if (report.marketReport) lines.push('## Market', '', report.marketReport, '');
  if (report.sentimentReport) lines.push('## Social', '', report.sentimentReport, '');
  if (report.newsReport) lines.push('## News', '', report.newsReport, '');
  if (report.fundamentalsReport) lines.push('## Fundamentals', '', report.fundamentalsReport, '');
  if (report.bullHistory) lines.push('## Bull', '', report.bullHistory, '');
  if (report.bearHistory) lines.push('## Bear', '', report.bearHistory, '');
  if (report.researchPlan) lines.push('## Research plan', '', report.researchPlan, '');
  if (report.traderPlan) lines.push('## Trader', '', report.traderPlan, '');
  if (report.aggressiveHistory) lines.push('## Risk — aggressive', '', report.aggressiveHistory, '');
  if (report.conservativeHistory) lines.push('## Risk — conservative', '', report.conservativeHistory, '');
  if (report.neutralHistory) lines.push('## Risk — neutral', '', report.neutralHistory, '');
  if (report.riskJudge) lines.push('## Risk — judge', '', report.riskJudge, '');
  if (report.finalDecision) lines.push('## Decision', '', report.finalDecision, '');
  return lines.join('\n').trim() + '\n';
}

export function deskInsightsDigest(report: DeskParsedReport, rating: DeskSignal | null): string {
  const shown = rating ?? 'REVIEW';
  const thesis = report.executiveSummary || report.thesis || report.finalDecision || 'No thesis in this run.';
  return [
    `# Desk report: ${report.ticker}`,
    '',
    `**Ticker:** ${report.ticker}`,
    `**Rating:** ${shown}`,
    report.tradeDate ? `**As of:** ${report.tradeDate}` : '',
    '',
    '## Thesis',
    '',
    thesis,
  ]
    .filter((line, index, all) => line !== '' || all[index - 1] !== '')
    .join('\n')
    .trim();
}

function parseDepth(value: unknown): DeskDepth | null {
  return typeof value === 'string' && (DESK_DEPTHS as readonly string[]).includes(value)
    ? (value as DeskDepth)
    : null;
}

function parseAsset(value: unknown): DeskAssetType | null {
  return typeof value === 'string' && (DESK_ASSET_TYPES as readonly string[]).includes(value)
    ? (value as DeskAssetType)
    : null;
}

function parseAnalysts(value: unknown): DeskAnalyst[] | null {
  const items = asStringArray(value);
  if (!items) return null;
  const analysts = items.filter((item): item is DeskAnalyst =>
    (DESK_ANALYSTS as readonly string[]).includes(item),
  );
  return analysts.length > 0 ? analysts : null;
}

export function createInputFromDeskRun(
  params: unknown,
  run: {
    tickers: string[];
    asOf: string;
    depth: string;
    analysts: string[];
    assetType: string;
    checkpoint: boolean;
  },
): CreateDeskRunInput | null {
  const source = isRecord(params) ? params : {};
  const tickers = (asStringArray(source.tickers) ?? run.tickers).map((ticker) => ticker.trim().toUpperCase());
  const unique = [...new Set(tickers.filter(Boolean))].slice(0, 3);
  const asOf = typeof source.asOf === 'string' ? source.asOf : run.asOf;
  const depth = parseDepth(source.depth) ?? parseDepth(run.depth);
  const analysts = parseAnalysts(source.analysts) ?? parseAnalysts(run.analysts);
  const assetType = parseAsset(source.assetType) ?? parseAsset(run.assetType);
  const checkpoint = typeof source.checkpoint === 'boolean' ? source.checkpoint : run.checkpoint;
  if (!depth || !analysts || !assetType || unique.length < 1) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return null;
  if (assetType === 'crypto') {
    const withoutFundamentals = analysts.filter((analyst) => analyst !== 'fundamentals');
    if (withoutFundamentals.length === 0) return null;
    return { tickers: unique, asOf, depth, analysts: withoutFundamentals, assetType, checkpoint };
  }
  return { tickers: unique, asOf, depth, analysts, assetType, checkpoint };
}
