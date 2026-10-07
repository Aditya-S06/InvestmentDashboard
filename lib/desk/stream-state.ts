import type { DeskStreamEvent } from './stream-protocol';
import { deskStreamTerminal } from './stream-protocol';
import type { DeskRunStatus } from './types';

export type DeskTickerLive = {
  phase: string | null;
  agentStatus: Record<string, 'idle' | 'running' | 'done'>;
  debateRound: number | null; debateSide: string | null;
  memoAgent: string | null; memoText: string; done: boolean;
};
export const emptyDeskTickerLive = (): DeskTickerLive => ({
  phase: null, agentStatus: {}, debateRound: null, debateSide: null, memoAgent: null, memoText: '', done: false,
});
// Presentation only: 300 short summaries keep the live pane useful without
// growing its array/DOM for the lifetime of a run. Durable events are untouched.
export const DESK_DISPLAY_EVENT_LIMIT = 300;
export type DeskLiveState = {
  activeTicker: string | null; // Ordered replay attribution, never set by polling.
  displayTicker: string | null;
  tickers: Record<string, DeskTickerLive>; log: string[]; omitted: number;
};
export const emptyDeskLiveState = (): DeskLiveState => ({ activeTicker: null, displayTicker: null, tickers: {}, log: [], omitted: 0 });

type RunProgress = { id: string; tickers: string[]; activeTicker: string | null; status: string };

/** Sequential durable snapshots cannot move backwards; terminal outcomes are irreversible. */
export function mergeDeskRunSnapshot<T extends RunProgress>(current: T | null, incoming: T): T {
  if (!current || current.id !== incoming.id) return incoming;
  if (deskStreamTerminal(current.status) && current.status !== incoming.status) return current;
  if (!deskStreamTerminal(incoming.status) && (current.status === 'running' && incoming.status === 'queued'
    || current.tickers.indexOf(incoming.activeTicker ?? '') < current.tickers.indexOf(current.activeTicker ?? ''))) return current;
  // A terminal response may have no active ticker; retain the observed progress.
  return current.tickers.indexOf(incoming.activeTicker ?? '') < current.tickers.indexOf(current.activeTicker ?? '')
    ? { ...incoming, activeTicker: current.activeTicker } : incoming;
}

/** Visible progress may lead replay, but must never change its memo attribution. */
export function deskDisplayedProgress(run: RunProgress, live: DeskLiveState, status: DeskRunStatus) {
  const index = Math.max(0, run.tickers.indexOf(run.activeTicker ?? ''), run.tickers.indexOf(live.displayTicker ?? ''));
  const ticker = run.tickers[index];
  const tickerLive = live.tickers[ticker] ?? emptyDeskTickerLive();
  const runStatus = !deskStreamTerminal(status) && tickerLive.done ? 'completed' : status;
  return { ticker, tickerLive, runStatus: runStatus as DeskRunStatus };
}

/** Ticker attribution follows the log, never a newer polling snapshot or a React effect. */
export function reduceDeskStream(state: DeskLiveState, event: DeskStreamEvent, tickers: string[]): DeskLiveState {
  const { name, data } = event;
  const ticker = typeof data.ticker === 'string' ? data.ticker : state.activeTicker ?? tickers[0];
  if (!ticker || !tickers.includes(ticker)) return state;
  const current = state.tickers[ticker] ?? emptyDeskTickerLive();
  const next = { ...current };
  let text = name.slice(5);
  switch (name) {
    case 'desk_phase':
      if (typeof data.phase === 'string') next.phase = data.phase;
      text += ` ${next.phase ?? ''}`;
      break;
    case 'desk_agent':
      if (typeof data.agent === 'string' && ['start', 'done'].includes(String(data.status))) {
        next.agentStatus = { ...current.agentStatus, [data.agent]: data.status === 'start' ? 'running' : 'done' };
      }
      text += ` ${data.agent ?? ''} ${data.status ?? ''}`;
      break;
    case 'desk_memo':
      next.memoAgent = typeof data.agent === 'string' ? data.agent : null;
      next.memoText = typeof data.text === 'string' ? data.text : '';
      text += ` ${next.memoAgent ?? ''}`;
      break;
    case 'desk_debate':
      next.debateRound = typeof data.round === 'number' ? data.round : null;
      next.debateSide = typeof data.side === 'string' ? data.side : null;
      next.memoAgent = next.debateSide;
      next.memoText = typeof data.text === 'string' ? data.text : '';
      text += ` r${next.debateRound ?? '?'} ${next.debateSide ?? ''}`;
      break;
    case 'desk_done': next.done = true; break;
    case 'desk_decision': text += ` ${data.signal ?? ''}`; break;
    case 'desk_error': text += ` ${data.message ?? ''}`; break;
  }
  const overflow = Math.max(0, state.log.length + 1 - DESK_DISPLAY_EVENT_LIMIT);
  return {
    activeTicker: ticker,
    displayTicker: tickers.indexOf(ticker) > tickers.indexOf(state.displayTicker ?? '') ? ticker : state.displayTicker,
    tickers: { ...state.tickers, [ticker]: next },
    log: [...state.log.slice(overflow), `${ticker} · ${text}`], omitted: state.omitted + overflow,
  };
}
