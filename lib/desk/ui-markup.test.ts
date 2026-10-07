import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../app/dashboard/_components/watchlist-provider', () => ({ useWatchlist: () => ({ watchlist: [], toggleWatchlist: vi.fn() }) }));
vi.mock('../../app/dashboard/insights/_components/insight-markdown', () => ({ InsightMarkdown: () => null }));
import { DeskLaunchForm } from '../../app/dashboard/desk/_components/desk-launch-form';
import { DeskReport } from '../../app/dashboard/desk/_components/desk-report';
import { DeskEventLog } from '../../app/dashboard/desk/_components/desk-event-log';
import { DeskRunTimeline } from '../../app/dashboard/desk/_components/desk-run-timeline';
import { DESK_DISPLAY_EVENT_LIMIT, emptyDeskLiveState, reduceDeskStream } from './stream-state';

// Real server-rendered markup contracts; no browser, DOM interaction or accessibility-tree claim.
beforeEach(() => { vi.stubGlobal('React', React); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden'); })); });
afterEach(() => vi.unstubAllGlobals());

it('the launch ticker input has a programmatic name', () => {
  const html = renderToStaticMarkup(React.createElement(DeskLaunchForm));
  expect(html).toMatch(/<input[^>]*aria-label="Tickers"[^>]*placeholder="AAPL"/);
  expect(fetch).not.toHaveBeenCalled();
});

it('the report emits named tabs, selection, roving tab stops and a linked focusable panel', () => {
  const html = renderToStaticMarkup(React.createElement(DeskReport, {
    runId: 'offline', tickers: ['AAPL'], asOf: '2026-10-06', depth: 'standard', analysts: ['market'],
    assetType: 'stock', checkpoint: false, status: 'completed', signal: 'Buy', params: null,
    finalState: { market_report: 'Apple' },
  }));
  expect(html).toContain('role="tablist" aria-label="Report sections"');
  expect(html.match(/role="tab"/g)).toHaveLength(6);
  expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
  expect(html.match(/aria-selected="false"/g)).toHaveLength(5);
  expect(html.match(/tabindex="-1"/g)).toHaveLength(5);
  const selectedId = html.match(/role="tab" id="([^"]+)" aria-selected="true"/)![1];
  expect(html).toContain(`aria-labelledby="${selectedId}" tabindex="0"`);
});

it('the rendered log honestly marks omitted entries and retains exactly the recent display window', () => {
  let state = emptyDeskLiveState();
  for (let i = 0; i < 325; i++) state = reduceDeskStream(state, { id: String(i), name: 'desk_decision', data: { signal: `row-${i}` } }, ['AAPL']);
  const html = renderToStaticMarkup(React.createElement(DeskEventLog, { lines: state.log, omitted: state.omitted }));
  expect(html).toContain('25 older displayed entries omitted. Complete run logs are retained.');
  expect(html.match(/AAPL · decision row-/g)).toHaveLength(DESK_DISPLAY_EVENT_LIMIT);
  expect(html).not.toContain('row-24<'); expect(html).toContain('row-25<'); expect(html).toContain('row-324<');
  const empty = renderToStaticMarkup(React.createElement(DeskEventLog, { lines: [] }));
  expect(empty).toContain('No events yet.'); expect(empty).not.toContain('omitted');
});

it.each(['failed', 'cancelled'] as const)('timeline marks an interrupted phase as %s instead of completed', runStatus => {
  const html = renderToStaticMarkup(React.createElement(DeskRunTimeline, {
    analysts: ['market'], phase: 'analysts', agentStatus: {}, debateRound: null, debateSide: null, runStatus,
  }));
  expect(html).toContain(`Analysts · ${runStatus}`);
});
