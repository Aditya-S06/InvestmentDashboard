import { describe, expect, it } from 'vitest';
import { DESK_DISPLAY_EVENT_LIMIT, deskDisplayedProgress, emptyDeskLiveState, mergeDeskRunSnapshot, reduceDeskStream } from './stream-state';

const tickers = ['AAPL', 'MSFT'];
const snapshot = (status = 'running', activeTicker: string | null = 'AAPL') => ({ id: 'run', tickers, status, activeTicker });
const event = (name: string, data: Record<string, unknown>) => ({ id: 'test-only', name, data });

describe('display progress versus ordered replay', () => {
  it('shows startup pending, then MSFT pending before its first event without moving memo attribution', () => {
    let live = emptyDeskLiveState();
    expect(deskDisplayedProgress(snapshot('queued', null), live, 'queued')).toMatchObject({
      ticker: 'AAPL', runStatus: 'queued', tickerLive: { phase: null, done: false },
    });
    live = reduceDeskStream(live, event('desk_phase', { ticker: 'AAPL', phase: 'analysts' }), tickers);
    live = reduceDeskStream(live, event('desk_done', {}), tickers);
    const run = mergeDeskRunSnapshot(snapshot(), snapshot('running', 'MSFT'));
    live = reduceDeskStream(live, event('desk_memo', { text: 'Apple late replay' }), tickers);
    expect(deskDisplayedProgress(run, live, 'running')).toMatchObject({
      ticker: 'MSFT', runStatus: 'running', tickerLive: { phase: null, memoText: '', done: false },
    });
    expect(live.tickers.AAPL.memoText).toBe('Apple late replay');
    expect(mergeDeskRunSnapshot(run, snapshot())).toBe(run);
    expect(mergeDeskRunSnapshot(run, snapshot('queued', null))).toBe(run);
    live = reduceDeskStream(live, event('desk_memo', { ticker: 'MSFT', text: 'Microsoft distinct' }), tickers);
    expect(live.tickers.AAPL.memoText).toBe('Apple late replay');
    expect(deskDisplayedProgress(run, live, 'running').tickerLive.memoText).toBe('Microsoft distinct');
  });

  it.each(['failed', 'cancelled'] as const)('%s before the second phase overrides the first done and any delayed replay', status => {
    let live = reduceDeskStream(emptyDeskLiveState(), event('desk_done', { ticker: 'AAPL' }), tickers);
    const run = mergeDeskRunSnapshot(snapshot(), snapshot(status, 'MSFT'));
    expect(deskDisplayedProgress(run, live, status)).toMatchObject({ ticker: 'MSFT', runStatus: status, tickerLive: { phase: null } });
    live = reduceDeskStream(live, event('desk_done', { ticker: 'MSFT' }), tickers);
    live = reduceDeskStream(live, event('desk_phase', { ticker: 'AAPL', phase: 'analysts' }), tickers);
    expect(deskDisplayedProgress(run, live, status)).toMatchObject({ ticker: 'MSFT', runStatus: status });
    for (const stale of [snapshot(), snapshot('queued'), snapshot('completed', 'MSFT')]) {
      expect(mergeDeskRunSnapshot(run, stale)).toBe(run);
    }
  });

  it('replay ahead of polling remains visible through older tagged events and polling', () => {
    let live = reduceDeskStream(emptyDeskLiveState(), event('desk_phase', { ticker: 'MSFT', phase: 'risk' }), tickers);
    live = reduceDeskStream(live, event('desk_memo', { ticker: 'AAPL', text: 'Apple' }), tickers);
    live = reduceDeskStream(live, event('desk_memo', { text: 'Still Apple' }), tickers);
    expect(live.activeTicker).toBe('AAPL');
    expect(deskDisplayedProgress(snapshot(), live, 'running')).toMatchObject({ ticker: 'MSFT', tickerLive: { phase: 'risk' } });
    expect(live.tickers.AAPL.memoText).toBe('Still Apple');
  });

  it('bounds only display summaries while retaining latest memo, done, phase and all ticker state', () => {
    let live = reduceDeskStream(emptyDeskLiveState(), event('desk_memo', { ticker: 'AAPL', text: 'Keep Apple' }), tickers);
    live = reduceDeskStream(live, event('desk_done', {}), tickers);
    live = reduceDeskStream(live, event('desk_phase', { ticker: 'MSFT', phase: 'risk' }), tickers);
    live = reduceDeskStream(live, event('desk_memo', { text: 'Keep Microsoft' }), tickers);
    for (let index = 0; index < 1200; index++) live = reduceDeskStream(live, event('desk_decision', { signal: `entry ${index}` }), tickers);
    expect(live.log).toHaveLength(DESK_DISPLAY_EVENT_LIMIT);
    expect(live.omitted).toBe(1204 - DESK_DISPLAY_EVENT_LIMIT);
    expect(live.log[0]).toContain('entry 900');
    expect(live.log.at(-1)).toContain('entry 1199');
    expect(live.tickers.AAPL).toMatchObject({ memoText: 'Keep Apple', done: true });
    expect(live.tickers.MSFT).toMatchObject({ memoText: 'Keep Microsoft', phase: 'risk', done: false });
    const agentStatus = live.tickers.MSFT.agentStatus;
    live = reduceDeskStream(live, event('desk_memo', { text: 'Updated Microsoft' }), tickers);
    expect(live.tickers.MSFT.agentStatus).toBe(agentStatus);
  });
});
