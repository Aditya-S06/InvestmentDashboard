import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { packDeskResults, emptyDeskResults } from './report';
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, toggle: vi.fn(), push: vi.fn() }));
// A small hook harness exercises the real component callbacks without a DOM/browser.
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useId: () => 'offline-report-tabs',
  useMemo: (fn: () => unknown) => fn(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (next: unknown) => { hooks.values[index] = next; }];
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: hooks.push }) }));
vi.mock('../../app/dashboard/_components/watchlist-provider', () => ({ useWatchlist: () => ({ watchlist: [], toggleWatchlist: hooks.toggle }) }));
vi.mock('../../app/dashboard/insights/_components/insight-markdown', () => ({ InsightMarkdown: () => null }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { DeskReport } from '../../app/dashboard/desk/_components/desk-report';

const props = { runId: 'run-one', tickers: ['AAPL', 'MSFT'], asOf: '2026-10-04', depth: 'standard',
  analysts: ['market'] as ['market'], assetType: 'stock', checkpoint: false, status: 'cancelled', signal: null,
  params: null, finalState: packDeskResults(emptyDeskResults(['AAPL', 'MSFT']).map(result => ({ ...result,
    status: 'completed', signal: 'Buy', finalState: { company_of_interest: result.ticker, market_report: `${result.ticker} memo` } }))) };
function render() { hooks.cursor = 0; return DeskReport(props); }
function elements(node: any): any[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object') return [];
  return [node, ...elements(node.props?.children)];
}
const button = (tree: unknown, label: string) => elements(tree).find(node => node.type === 'button' && JSON.stringify(node.props.children).includes(label));

beforeEach(() => {
  hooks.values = []; hooks.cursor = 0; vi.clearAllMocks();
  vi.stubGlobal('React', React);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sessionId: 'session-one', id: 'new-run' }),
    blob: async () => new Blob(['offline']), headers: new Headers() }));
  vi.stubGlobal('document', { createElement: () => ({ click: vi.fn(), remove: vi.fn() }), body: { appendChild: vi.fn() } });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:offline');
  vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('ticker selection drives watchlist, markdown and Insights while rerun keeps the full run', async () => {
  const selector = elements(render()).find(node => node.type === 'select');
  selector.props.onChange({ target: { value: 'MSFT' } });
  let tree = render();
  button(tree, 'Add MSFT').props.onClick();
  await vi.waitFor(() => expect(hooks.toggle).toHaveBeenCalledWith('MSFT'));
  tree = render(); button(tree, 'Send to Insights').props.onClick();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/desk/runs/run-one/insights?ticker=MSFT', { method: 'POST' }));
  await vi.waitFor(() => expect(hooks.push).toHaveBeenCalledWith('/dashboard/insights?session=session-one'));
  tree = render(); button(tree, 'Markdown').props.onClick();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/desk/runs/run-one/download?format=md&ticker=MSFT'));
  tree = render(); button(tree, 'ZIP').props.onClick();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/desk/runs/run-one/download?format=zip&ticker=MSFT'));
  tree = render(); button(tree, 'Re-run all tickers').props.onClick();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/desk/runs', expect.objectContaining({
    body: JSON.stringify({ tickers: ['AAPL', 'MSFT'], asOf: props.asOf, depth: 'standard', analysts: ['market'], assetType: 'stock', checkpoint: false }),
  })));
});

it('report tabs expose one selected tab, linked panel and wrapping arrow/Home/End focus callbacks', () => {
  const tabs = () => elements(render()).filter(node => node.props?.role === 'tab');
  const selected = (index: number) => {
    const nodes = tabs();
    expect(nodes.filter(node => node.props['aria-selected'])).toEqual([nodes[index]]);
    expect(nodes.map(node => node.props.tabIndex)).toEqual(nodes.map((_, i) => i === index ? 0 : -1));
    const panel = elements(render()).find(node => node.props?.role === 'tabpanel');
    expect(panel.props['aria-labelledby']).toBe(nodes[index].props.id);
    expect(nodes[index].props['aria-controls']).toBe(panel.props.id);
    expect(panel.props.tabIndex).toBe(0);
  };
  selected(0);
  const focus = tabs().map(() => ({ focus: vi.fn() }));
  const key = (index: number, value: string, destination: number | null) => {
    const preventDefault = vi.fn();
    tabs()[index].props.onKeyDown({ key: value, preventDefault, currentTarget: {
      parentElement: { querySelectorAll: () => focus },
    } });
    if (destination === null) expect(preventDefault).not.toHaveBeenCalled();
    else { expect(preventDefault).toHaveBeenCalledOnce(); expect(focus[destination].focus).toHaveBeenCalled(); selected(destination); }
  };
  key(0, 'ArrowLeft', 5); key(5, 'ArrowRight', 0); key(0, 'End', 5); key(5, 'Home', 0);
  key(0, 'ArrowRight', 1); key(1, 'Tab', null); key(1, 'ArrowDown', null);
  tabs()[3].props.onClick(); selected(3);
  elements(render()).find(node => node.type === 'select').props.onChange({ target: { value: 'MSFT' } });
  selected(0);
});
