import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Offline hook/element harness: real page handlers and state, no DOM or browser proof.
const harness = vi.hoisted(() => ({
  slots: [] as any[], cursor: 0, effects: [] as (() => void)[], id: 'run-one', connections: [] as any[],
}));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: any) => {
    const i = harness.cursor++;
    if (!(i in harness.slots)) harness.slots[i] = typeof initial === 'function' ? initial() : initial;
    return [harness.slots[i], (next: any) => { harness.slots[i] = typeof next === 'function' ? next(harness.slots[i]) : next; }];
  },
  useRef: (value: unknown) => {
    const i = harness.cursor++;
    return harness.slots[i] ??= { current: value };
  },
  useMemo: (fn: () => unknown) => fn(),
  useEffect: (fn: () => void | (() => void), deps: unknown[]) => {
    const i = harness.cursor++;
    const previous = harness.slots[i];
    if (!previous || deps.some((value, index) => value !== previous.deps[index])) {
      harness.effects.push(() => { previous?.cleanup?.(); harness.slots[i] = { deps, cleanup: fn() }; });
    }
  },
}));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: harness.id }) }));
vi.mock('./stream-client', () => ({ connectDeskStream: vi.fn(async options => { harness.connections.push(options); }) }));
vi.mock('../../app/dashboard/desk/_components/desk-report', () => ({ DeskReport: () => null }));
import DeskRunPage from '../../app/dashboard/desk/runs/[id]/page';
import { DeskRunTimeline } from '../../app/dashboard/desk/_components/desk-run-timeline';
import { DeskMemoPane } from '../../app/dashboard/desk/_components/desk-memo-pane';
import { DeskEventLog } from '../../app/dashboard/desk/_components/desk-event-log';

const run = (status = 'running', activeTicker: string | null = 'AAPL', id = harness.id) => ({
  id, tickers: ['AAPL', 'MSFT'], activeTicker, status, analysts: ['market'], asOf: '2026-10-06', depth: 'standard',
  assetType: 'stock', checkpoint: false, signal: null, params: null, finalState: null, error: null,
  createdAt: '2026-10-06T12:00:00Z', finishedAt: null,
});
function elements(node: any): any[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object') return [];
  return [node, ...elements(node.props?.children)];
}
function render() {
  harness.cursor = 0;
  const tree = DeskRunPage();
  harness.effects.splice(0).forEach(effect => effect());
  return elements(tree);
}
const connection = () => harness.connections.at(-1)!;
const button = () => render().find(node => node.type === 'button');
const alerts = () => render().filter(node => node.props?.role === 'alert').map(node => node.props.children);
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const emit = (name: string, data: Record<string, unknown>) => connection().onEvent({ name, data, id: 'offline' });
function unmount() { harness.slots.forEach(slot => slot?.cleanup?.()); }
beforeEach(() => {
  harness.slots = []; harness.cursor = 0; harness.effects = []; harness.connections = []; harness.id = 'run-one';
  vi.useFakeTimers(); vi.stubGlobal('React', React); vi.stubGlobal('fetch', vi.fn());
  render(); connection().onRun(run());
});
afterEach(() => { unmount(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('wires startup delay, durable advancement and distinct delayed memos into the displayed components', () => {
  expect(render().find(node => node.type === DeskRunTimeline).props).toMatchObject({ phase: null, runStatus: 'running' });
  emit('desk_phase', { ticker: 'AAPL', phase: 'portfolio_manager' }); emit('desk_done', {});
  connection().onRun(run('running', 'MSFT'));
  emit('desk_memo', { text: 'Apple late' });
  connection().onRun(run('queued', 'AAPL'));
  let tree = render();
  expect(tree.some(node => node.props?.children === 'MSFT 2/2')).toBe(true);
  expect(tree.find(node => node.type === DeskRunTimeline).props).toMatchObject({ phase: null, runStatus: 'running' });
  expect(tree.find(node => node.type === DeskMemoPane).props.text).toBe('');
  emit('desk_memo', { ticker: 'MSFT', text: 'Microsoft' });
  tree = render();
  expect(tree.find(node => node.type === DeskMemoPane).props.text).toBe('Microsoft');
  expect(tree.find(node => node.type === DeskEventLog).props.lines).toContain('AAPL · memo ');
});

it.each(['failed', 'cancelled'])('keeps %s authoritative after AAPL done, without an MSFT phase', status => {
  emit('desk_done', { ticker: 'AAPL' });
  connection().onRun(run(status, 'MSFT'));
  emit('desk_done', { ticker: 'MSFT' });
  connection().onRun(run('running', 'AAPL'));
  connection().onRun(run('completed', 'MSFT'));
  expect(render().find(node => node.type === DeskRunTimeline).props).toMatchObject({ phase: null, runStatus: status });
});

it.each([
  ['409', () => new Response('sensitive raw failure', { status: 409 })],
  ['500', () => Response.json({ error: 'sensitive raw failure' }, { status: 500 })],
  ['invalid JSON', () => new Response('invalid-json')],
  ['null body', () => Response.json(null)],
  ['incomplete body', () => Response.json({ status: 'cancelled' })],
  ['wrong run', () => Response.json(run('cancelled', 'MSFT', 'other-run'))],
  ['invalid fields', () => Response.json({ ...run('cancelled'), tickers: 'AAPL' })],
  ['still running', () => Response.json(run())],
  ['network', () => { throw new Error('sensitive network failure'); }],
] as const)('cancellation %s releases pending state and retains safe feedback through normal polling', async (_name, response) => {
  vi.mocked(fetch).mockImplementation(async () => response());
  button().props.onClick();
  expect(button().props.disabled).toBe(true);
  await flush();
  expect(button().props.disabled).toBe(false);
  expect(alerts()).toEqual(['Could not confirm cancellation. Check the run status and try Cancel again if it is still running.']);
  connection().onRun(run('running', 'MSFT'));
  expect(alerts()).toHaveLength(1);
  expect(render().find(node => node.type === DeskRunTimeline).props.runStatus).toBe('running');
});

it('successful retry clears the action error, keeps reports and rejects a poll that was already in flight', async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(Response.json({
    ...run('cancelled', 'MSFT'), finalState: { deskResults: [{ ticker: 'AAPL', finalState: { market_report: 'retained' } }] },
  }));
  button().props.onClick(); await flush(); expect(alerts()).toHaveLength(1);
  button().props.onClick(); await flush();
  connection().onRun(run('running', 'AAPL'));
  expect(alerts()).toHaveLength(0); expect(button()).toBeUndefined();
  expect(render().find(node => node.type === DeskRunTimeline).props.runStatus).toBe('cancelled');
  expect(render().find(node => node.props?.runId === 'run-one').props.finalState)
    .toEqual({ deskResults: [{ ticker: 'AAPL', finalState: { market_report: 'retained' } }] });
});

it.each(['resolve', 'reject'] as const)('aborting/unmounting an in-flight cancellation ignores late %s on the next page', async outcome => {
  let resolve!: (value: Response) => void; let reject!: (error: Error) => void;
  vi.mocked(fetch).mockImplementation(() => new Promise((ok, fail) => { resolve = ok; reject = fail; }));
  const old = connection();
  button().props.onClick();
  const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
  harness.id = 'run-two'; render(); connection().onRun(run());
  expect(signal?.aborted).toBe(true);
  if (outcome === 'resolve') resolve(Response.json(run('cancelled', 'AAPL', 'run-one')));
  else reject(new Error('AbortError'));
  old.onRun(run('failed', 'MSFT', 'run-one')); old.onError('old error'); old.onEvent({ name: 'desk_done', data: { ticker: 'AAPL' } });
  await flush();
  expect(alerts()).toHaveLength(0); expect(button().props.disabled).toBe(false);
  expect(render().find(node => node.type === DeskRunTimeline).props.runStatus).toBe('running');
  unmount(); expect(connection().signal.aborted).toBe(true);
});

it('unmount during JSON decoding drops the response and a pending action cannot be submitted twice', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: () => new Promise(ok => { resolve = ok; }) } as Response);
  button().props.onClick(); button().props.onClick();
  await flush(); expect(fetch).toHaveBeenCalledTimes(1);
  unmount();
  const before = [...harness.slots];
  resolve(run('cancelled')); await flush();
  expect(harness.slots).toEqual(before);
});

it('a successful cancellation request that lost the completion race preserves the actual completed outcome', async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json(run('completed', 'MSFT')));
  button().props.onClick(); await flush();
  expect(alerts()).toHaveLength(0);
  expect(render().find(node => node.type === DeskRunTimeline).props.runStatus).toBe('completed');
  expect(button()).toBeUndefined();
});
