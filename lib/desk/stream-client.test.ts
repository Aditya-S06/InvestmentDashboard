import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectDeskStream, readDeskEventStream } from './stream-client';
import { DESK_DISPLAY_EVENT_LIMIT, emptyDeskLiveState, reduceDeskStream } from './stream-state';
import type { DeskStreamEvent } from './stream-protocol';

const id = (offset: number) => `v1.${'a'.repeat(64)}.${offset}.${'b'.repeat(64)}`;
const event = (offset: number, name: string, data: Record<string, unknown>): DeskStreamEvent => ({ id: id(offset), name, data });
const frame = (e: DeskStreamEvent) => `id: ${e.id}\nevent: ${e.name}\ndata: ${JSON.stringify(e.data)}\n\n`;
const sse = (text: string) => new Response(text, { headers: { 'Content-Type': 'text/event-stream' } });
const run = (status = 'running') => ({ id: 'run-one', status, tickers: ['AAPL', 'MSFT'], finalState: null as unknown });
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('fetch SSE decoding', () => {
  it('preserves UTF-8, split CRLF and multiline data; never dispatches an incomplete final frame', async () => {
    const raw = `id: ${id(1)}\r\nevent: desk_memo\r\ndata: {"text":\r\ndata: "café 🚀 東京"}\r\n\r\n`
      + frame(event(2, 'desk_done', {})).trimEnd();
    const bytes = new TextEncoder().encode(raw);
    const response = new Response(new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } }));
    const seen: DeskStreamEvent[] = [];
    await readDeskEventStream(response, new AbortController().signal, e => seen.push(e));
    expect(seen).toEqual([event(1, 'desk_memo', { text: 'café 🚀 東京' })]);
  });

  it('aborting a pending read cancels/releases the reader and drops its partial frame', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(frame(event(1, 'desk_memo', { text: 'partial' })).slice(0, -1)));
    }, cancel }));
    const abort = new AbortController();
    const seen = vi.fn();
    const reading = readDeskEventStream(response, abort.signal, seen);
    await flush(); abort.abort(); await reading;
    expect(cancel).toHaveBeenCalledOnce(); expect(seen).not.toHaveBeenCalled();
    expect(response.body!.locked).toBe(false);
  });
});

describe('reconnect and ticker state', () => {
  it('display eviction does not truncate delivery or reset the reconnect cursor', async () => {
    const rows = Array.from({ length: 650 }, (_, index) => event(index + 1, 'desk_memo', { text: `memo ${index}` }));
    let streams = 0;
    let live = emptyDeskLiveState();
    const received: string[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => {
      if (!String(url).includes('/stream')) return Response.json(run(streams > 1 ? 'completed' : 'running'));
      if (++streams === 1) return sse(rows.map(frame).join(''));
      expect(String(url)).toContain(`after=${encodeURIComponent(id(650))}`);
      return sse(frame(rows[649]) + frame(event(651, 'desk_done', {})));
    });
    const work = connectDeskStream({ runId: 'run-one', signal: new AbortController().signal, fetch: fetcher,
      onRun: vi.fn(), onError: vi.fn(), onEvent: row => {
        received.push(row.id); live = reduceDeskStream(live, row, ['AAPL']);
      } });
    await flush(); await vi.advanceTimersByTimeAsync(500); await work;
    expect(received).toEqual(Array.from({ length: 651 }, (_, index) => id(index + 1)));
    expect(live.log).toHaveLength(DESK_DISPLAY_EVENT_LIMIT);
    expect(live.omitted).toBe(651 - DESK_DISPLAY_EVENT_LIMIT);
    expect(live.tickers.AAPL).toMatchObject({ memoText: 'memo 649', done: true });
  });

  it('replays unseen events only, attributes untagged memos by log order and reconciles both terminal reports', async () => {
    const rows = [
      event(1, 'desk_phase', { ticker: 'AAPL', phase: 'analysts' }),
      event(2, 'desk_agent', { agent: 'market', status: 'done' }),
      event(3, 'desk_memo', { agent: 'market', text: 'Apple café' }),
      event(4, 'desk_done', { ticker: 'AAPL' }),
      event(5, 'desk_phase', { ticker: 'MSFT', phase: 'analysts' }),
      event(6, 'desk_agent', { agent: 'market', status: 'start' }),
      event(7, 'desk_memo', { agent: 'market', text: 'Microsoft 🚀' }),
      event(8, 'desk_done', { ticker: 'MSFT' }),
    ];
    let aggregate = run();
    let streams = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => {
      if (!String(url).includes('/stream')) return Response.json(aggregate);
      if (++streams === 1) return sse(rows.slice(0, 6).map(frame).join('') + frame(rows[6]).slice(0, -1));
      expect(String(url)).toContain(`after=${encodeURIComponent(id(6))}`);
      aggregate = { ...run('completed'), finalState: { deskResults: [
        { ticker: 'AAPL', finalState: { market_report: 'Apple café' } },
        { ticker: 'MSFT', finalState: { market_report: 'Microsoft 🚀' } },
      ] } };
      return sse(rows.slice(4).map(frame).join(''));
    });
    let live = emptyDeskLiveState();
    const onRun = vi.fn(); const onError = vi.fn();
    const work = connectDeskStream({ runId: 'run-one', signal: new AbortController().signal, fetch: fetcher,
      onRun, onError, onEvent: row => { live = reduceDeskStream(live, row, aggregate.tickers); } });
    await flush();
    expect(streams).toBe(1);
    expect(live.tickers.AAPL).toMatchObject({ done: true, memoText: 'Apple café' });
    expect(live.tickers.MSFT).toMatchObject({ done: false, memoText: '', agentStatus: { market: 'running' } });
    expect(onRun.mock.lastCall?.[0].status).toBe('running');
    await vi.advanceTimersByTimeAsync(500); await work;
    expect(streams).toBe(2); expect(live.log).toHaveLength(8);
    expect(live.tickers.AAPL.memoText).toBe('Apple café');
    expect(live.tickers.MSFT.memoText).toBe('Microsoft 🚀');
    expect(onRun.mock.lastCall?.[0]).toEqual(aggregate);
    expect(onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['completed', 'review', 'failed', 'cancelled'])('refreshes aggregate %s after EOF even without a terminal event', async status => {
    let streams = 0;
    const latest = { ...run(status), error: status === 'failed' ? 'timed out' : null,
      finalState: { deskResults: [{ ticker: 'AAPL', status: 'completed', finalState: { market_report: 'retained' } }] } };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => {
      if (String(url).includes('/stream')) { streams++; return sse(frame(event(1, 'desk_done', { ticker: 'AAPL' }))); }
      return Response.json(streams ? latest : run());
    });
    const onRun = vi.fn();
    await connectDeskStream({ runId: 'run-one', signal: new AbortController().signal, fetch: fetcher,
      onRun, onEvent: vi.fn(), onError: vi.fn() });
    expect(onRun.mock.lastCall?.[0]).toEqual(latest);
    expect(streams).toBe(1); expect(vi.getTimerCount()).toBe(0);
  });

  it('a ticker error does not overwrite the aggregate or stop reconnect before supervisor reconciliation', async () => {
    let streams = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => {
      if (String(url).includes('/stream')) {
        streams++;
        return sse(streams === 1 ? frame(event(1, 'desk_error', { message: 'ticker failed' })) : '');
      }
      return Response.json(run(streams < 2 ? 'running' : 'failed'));
    });
    const onRun = vi.fn(); const onEvent = vi.fn();
    const work = connectDeskStream({ runId: 'run-one', signal: new AbortController().signal, fetch: fetcher,
      onRun, onEvent, onError: vi.fn() });
    await flush();
    expect(onEvent).toHaveBeenCalledOnce(); expect(onRun.mock.lastCall?.[0].status).toBe('running');
    await vi.advanceTimersByTimeAsync(500); await work;
    expect(streams).toBe(2); expect(onRun.mock.lastCall?.[0].status).toBe('failed');
  });

  it('an already-terminal page still replays once, then stops', async () => {
    const seen = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => String(url).includes('/stream')
      ? sse(frame(event(1, 'desk_memo', { text: 'history' }))) : Response.json(run('completed')));
    await connectDeskStream({ runId: 'run-one', signal: new AbortController().signal, fetch: fetcher,
      onRun: vi.fn(), onEvent: seen, onError: vi.fn() });
    expect(seen).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

describe('retry ownership and failure classification', () => {
  it.each([400, 401, 403, 404, 410])('permanent stream HTTP %s stops without retry', async status => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => String(url).includes('/stream')
      ? new Response(null, { status }) : Response.json(run()));
    const onError = vi.fn();
    await connectDeskStream({ runId: 'run-one', signal: new AbortController().signal, fetch: fetcher,
      onRun: vi.fn(), onEvent: vi.fn(), onError });
    expect(fetcher).toHaveBeenCalledTimes(2); expect(onError).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('initial detail auth failure never opens a stream', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
    const onError = vi.fn();
    await connectDeskStream({ runId: 'run-one', signal: new AbortController().signal, fetch: fetcher,
      onRun: vi.fn(), onEvent: vi.fn(), onError });
    expect(fetcher).toHaveBeenCalledOnce(); expect(onError).toHaveBeenCalledOnce();
  });

  it('retries network/408/429/503/EOF with exponential delay capped at ten seconds', async () => {
    const abort = new AbortController(); const attempts: number[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => {
      if (!String(url).includes('/stream')) return Response.json(run());
      attempts.push(Date.now());
      if (attempts.length === 9) abort.abort();
      if (attempts.length === 1) throw new TypeError('network disconnected');
      if (attempts.length === 2) return sse('');
      return new Response(null, { status: [408, 429, 503][attempts.length % 3] });
    });
    const onError = vi.fn();
    const work = connectDeskStream({ runId: 'run-one', signal: abort.signal, fetch: fetcher,
      onRun: vi.fn(), onEvent: vi.fn(), onError });
    await vi.advanceTimersByTimeAsync(50_000); await work;
    expect(attempts.slice(1).map((time, i) => time - attempts[i])).toEqual([500, 1000, 2000, 4000, 8000, 10000, 10000, 10000]);
    expect(onError).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('unmount during backoff makes no further request', async () => {
    const abort = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => String(url).includes('/stream')
      ? sse('') : Response.json(run()));
    const work = connectDeskStream({ runId: 'run-one', signal: abort.signal, fetch: fetcher,
      onRun: vi.fn(), onEvent: vi.fn(), onError: vi.fn() });
    await flush(); const calls = fetcher.mock.calls.length;
    abort.abort(); await work; await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledTimes(calls); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['unmount', 'terminal', 'auth'])('%s stops a stalled stream and all polling', async reason => {
    const abort = new AbortController(); const cancel = vi.fn(); let reads = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => {
      if (String(url).includes('/stream')) return new Response(new ReadableStream({ cancel }),
        { headers: { 'Content-Type': 'text/event-stream' } });
      reads++;
      if (reads > 1 && reason === 'auth') return new Response(null, { status: 403 });
      return Response.json(run(reads > 1 && reason === 'terminal' ? 'cancelled' : 'running'));
    });
    const onError = vi.fn(); const onRun = vi.fn();
    const work = connectDeskStream({ runId: 'run-one', signal: abort.signal, fetch: fetcher,
      onRun, onEvent: vi.fn(), onError });
    await flush();
    if (reason === 'unmount') abort.abort();
    else await vi.advanceTimersByTimeAsync(reason === 'terminal' ? 30_000 : 2000);
    await work;
    expect(cancel).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledTimes(reason === 'auth' ? 1 : 0);
    if (reason === 'terminal') expect(onRun.mock.lastCall?.[0].status).toBe('cancelled');
    const calls = fetcher.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledTimes(calls); expect(vi.getTimerCount()).toBe(0);
  });

  it('unmount aborts an in-flight aggregate refresh, preventing late state updates', async () => {
    const abort = new AbortController(); let reads = 0; const onRun = vi.fn(); let refreshSignal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
      if (String(url).includes('/stream')) return sse('');
      if (++reads === 1) return Response.json(run());
      refreshSignal = options?.signal as AbortSignal;
      return new Promise((_resolve, reject) => refreshSignal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    });
    const work = connectDeskStream({ runId: 'run-one', signal: abort.signal, fetch: fetcher,
      onRun, onEvent: vi.fn(), onError: vi.fn() });
    await flush(); abort.abort(); await work;
    expect(refreshSignal?.aborted).toBe(true); expect(onRun).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a silent live connection expires, then reconnects from its last event without any write request', async () => {
    let streams = 0; const cancel = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
      expect(options?.method).toBeUndefined();
      if (!String(url).includes('/stream')) return Response.json(run(streams > 1 ? 'completed' : 'running'));
      if (++streams > 1) {
        expect(String(url)).toContain(`after=${encodeURIComponent(id(1))}`);
        return sse(frame(event(2, 'desk_done', { ticker: 'MSFT' })));
      }
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(frame(event(1, 'desk_phase', { ticker: 'AAPL' }))));
      }, cancel }), { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const work = connectDeskStream({ runId: 'run-one', signal: new AbortController().signal, fetch: fetcher,
      onRun: vi.fn(), onEvent: vi.fn(), onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(30_500); await work;
    expect(streams).toBe(2); expect(cancel).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it('terminal polling does not truncate a replay that continues delivering history', async () => {
    let controller: ReadableStreamDefaultController<Uint8Array>;
    let reads = 0; const seen = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => {
      if (String(url).includes('/stream')) return new Response(new ReadableStream({ start(value) { controller = value; } }),
        { headers: { 'Content-Type': 'text/event-stream' } });
      return Response.json(run(++reads > 1 ? 'completed' : 'running'));
    });
    const work = connectDeskStream({ runId: 'run-one', signal: new AbortController().signal, fetch: fetcher,
      onRun: vi.fn(), onEvent: seen, onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(5000);
    controller!.enqueue(new TextEncoder().encode(frame(event(1, 'desk_memo', { text: 'late history' }))));
    controller!.close(); await work;
    expect(seen).toHaveBeenCalledWith(event(1, 'desk_memo', { text: 'late history' }));
    expect(vi.getTimerCount()).toBe(0);
  });
});
