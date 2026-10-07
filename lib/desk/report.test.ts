import { describe, expect, it } from 'vitest';
import { aggregateDeskResults, createInputFromDeskRun, deskInsightsDigest, deskReportMarkdown, deskRunResults,
  emptyDeskResults, packDeskResults, reportForDeskResult, selectDeskResult } from './report';
import { isDeskDate, isDeskTicker } from './types';

const run = { tickers: ['AAPL', 'MSFT'], activeTicker: 'MSFT', asOf: '2026-10-04', status: 'completed', signal: 'REVIEW',
  depth: 'standard', analysts: ['market'], assetType: 'stock', checkpoint: false, finalState: null as unknown };
const results = emptyDeskResults(run.tickers).map((result, index) => ({ ...result, status: 'completed' as const,
  signal: index === 0 ? 'Buy' as const : 'Sell' as const, finalState: { company_of_interest: result.ticker,
    market_report: index === 0 ? 'Apple memo' : 'Microsoft memo', final_trade_decision: `**Investment thesis**: ${result.ticker} thesis` } }));

describe('ordered reports and compatibility', () => {
  it('retains both results and latest report fields without recursive envelopes', () => {
    const packed = packDeskResults(results);
    expect(packed.company_of_interest).toBe('MSFT');
    expect(deskRunResults({ ...run, finalState: packed }).map(result => result.ticker)).toEqual(['AAPL', 'MSFT']);
    expect(results[0].finalState).not.toHaveProperty('deskResults');
  });
  it('selected ticker governs report, digest and watchlist symbol despite stale model identity', () => {
    const selected = selectDeskResult({ ...run, finalState: packDeskResults(results) }, ' msft ')!;
    const { report, rating } = reportForDeskResult({ ...selected, finalState: { ...selected.finalState, company_of_interest: 'AAPL' } }, run.asOf);
    expect(report.ticker).toBe('MSFT');
    expect(rating).toBe('Sell');
    expect(deskReportMarkdown(report, rating)).toContain('Microsoft memo');
    expect(deskInsightsDigest(report, rating)).toContain('MSFT thesis');
    expect(deskInsightsDigest(report, rating)).not.toContain('AAPL');
  });
  it('rejects unknown and path-like selections', () => {
    for (const ticker of ['NVDA', '../AAPL', '']) expect(selectDeskResult({ ...run, finalState: packDeskResults(results) }, ticker)).toBeNull();
  });
  it('legacy single report remains readable; legacy multi does not label the last result as the first', () => {
    const legacy = { ...run, finalState: results[1].finalState, signal: 'Sell' };
    expect(deskRunResults(legacy).map(result => result.status)).toEqual(['unavailable', 'completed']);
    expect(selectDeskResult(legacy)?.ticker).toBe('MSFT');
    expect(selectDeskResult({ ...legacy, tickers: ['MSFT'], activeTicker: null, finalState: { market_report: 'old' } })?.ticker).toBe('MSFT');
  });
  it('REVIEW is explicit and mixed ratings do not become the last ticker rating', () => {
    expect(aggregateDeskResults(results)).toEqual({ status: 'completed', signal: 'REVIEW' });
    expect(aggregateDeskResults([results[0], { ...results[1], status: 'review', signal: 'REVIEW' }])).toEqual({ status: 'review', signal: 'REVIEW' });
    expect(reportForDeskResult({ ...results[0], status: 'review', signal: 'Hold' }, run.asOf).rating).toBe('REVIEW');
  });
  it('rerun retains original multi-ticker parameters', () => {
    expect(createInputFromDeskRun({ ...run, tickers: ['AAPL', 'MSFT'] }, run)?.tickers).toEqual(['AAPL', 'MSFT']);
  });
});

describe('portable input validation', () => {
  it('accepts leap days and rejects normalized overflow dates', () => {
    expect(isDeskDate('2024-02-29')).toBe(true);
    for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-10-00', '2026-1-01']) expect(isDeskDate(date)).toBe(false);
  });
  it('supports market symbols without accepting paths, CLI options or Windows device names', () => {
    for (const ticker of ['AAPL', '^GSPC', 'BTC-USD', 'BRK.B', 'EURUSD=X']) expect(isDeskTicker(ticker)).toBe(true);
    for (const ticker of ['../AAPL', '..', 'A/B', 'A\\B', 'A:ADS', 'CON', 'NUL.US', '--HELP', 'A.', 'MS FT']) expect(isDeskTicker(ticker)).toBe(false);
  });
});
