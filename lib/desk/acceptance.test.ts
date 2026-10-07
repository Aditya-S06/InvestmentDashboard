/** Offline acceptance: actual HTTP handlers, Node runner, Python control/supervisor,
 * JSONL/SSE client and exports. Only auth/DB and the graph executable are substituted.
 * No production fixture switch, provider, database, browser or broker is involved.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ChildProcess } from 'child_process';
import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { connectDeskStream, readDeskEventStream } from './stream-client';
import { emptyDeskLiveState, reduceDeskStream } from './stream-state';
import { deskResumeInput } from './types';
import { deskRunResults } from './report';
import { runtimeEnv } from '@/lib/subprocess-env';
import { OwnedChildren, CHILD_EXIT_MS } from '../../test/desk-owned-children';

const seam = vi.hoisted(() => ({ spawn: vi.fn(), auth: vi.fn(), rows: new Map<string, any>(),
  session: vi.fn(), message: vi.fn(), db: vi.fn() }));
vi.mock('child_process', () => ({ spawn: seam.spawn }));
vi.mock('@/lib/desk/access', () => ({ requireDeskAccess: seam.auth }));
// Deliberately enforce each supplied filter, including CAS; do not hand every request the owner row.
function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (value instanceof Date) return row[key]?.getTime() === value.getTime();
    if (value && typeof value === 'object') {
      if (value.in) return value.in.includes(row[key]);
      if (value.has) return row[key].includes(value.has);
      if (value.hasSome) return value.hasSome.some((ticker: string) => row[key].includes(ticker));
      throw new Error(`Unsupported fixture filter: ${key}`);
    }
    return row[key] === value;
  });
}
vi.mock('@/lib/prisma', () => ({ prisma: {
  deskRun: {
    findFirst: async ({ where }: any) => { seam.db(where); return structuredClone([...seam.rows.values()].find(row => matches(row, where)) ?? null); },
    findUnique: async ({ where }: any) => { seam.db(where); return structuredClone(seam.rows.get(where.id) ?? null); },
    findMany: async ({ where }: any) => { seam.db(where); return structuredClone([...seam.rows.values()].filter(row => matches(row, where))); },
    create: async ({ data }: any) => {
      seam.db(data);
      const row = { activeTicker: null, signal: null, error: null, finishedAt: null, createdAt: new Date(), updatedAt: new Date(), ...data };
      seam.rows.set(row.id, row); return structuredClone(row);
    },
    updateMany: async ({ where, data }: any) => {
      seam.db(where);
      const row = seam.rows.get(where.id);
      if (!row || !matches(row, where)) return { count: 0 };
      seam.rows.set(row.id, { ...row, ...structuredClone(data) }); return { count: 1 };
    },
  },
  $transaction: async (fn: any) => fn({ insightSession: { create: seam.session }, insightMessage: { create: seam.message } }),
} }));

import { GET as list, POST as launch } from '../../app/api/desk/runs/route';
import { GET as detail, DELETE as cancel } from '../../app/api/desk/runs/[id]/route';
import { GET as stream } from '../../app/api/desk/runs/[id]/stream/route';
import { GET as download } from '../../app/api/desk/runs/[id]/download/route';
import { POST as insights } from '../../app/api/desk/runs/[id]/insights/route';
import { GET as checkpoints, DELETE as clear } from '../../app/api/desk/checkpoints/route';

let root: string;
let modes: Record<string, string>;
let budget: number;
let owner: string;
let children: ChildProcess[];
let owned: OwnedChildren;
let controllers: AbortController[];
const input = { tickers: ['AAPL', 'MSFT'], asOf: '2026-10-01', depth: 'fast', analysts: ['market'], assetType: 'stock', checkpoint: false };
const context = (id: string) => ({ params: { id } });
const request = (url: string, method = 'GET', body?: unknown, signal?: AbortSignal) => new NextRequest(`http://localhost${url}`, {
  method, signal, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
});
const dir = (id: string, user = owner) => path.join(root, user, id);
const state = (id: string) => JSON.parse(fs.readFileSync(path.join(dir(id), 'state.json'), 'utf8'));
const terminal = (status: string) => ['completed', 'review', 'failed', 'cancelled'].includes(status);
async function until<T>(read: () => T | Promise<T>, accept: (value: T) => boolean, timeout = 12000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 35));
  }
  throw new Error('Offline acceptance condition timed out');
}
async function exited(child: ChildProcess) {
  await owned.wait(child, 'exit', CHILD_EXIT_MS);
}
async function start(body: unknown = input) {
  const response = await launch(request('/api/desk/runs', 'POST', body));
  const run = await response.json();
  expect(response.status, JSON.stringify(run)).toBe(201);
  return run.id as string;
}
async function get(id: string) {
  const response = await detail(request(`/api/desk/runs/${id}`), context(id));
  expect(response.status).toBe(200); return response.json();
}
function unzip(buffer: Buffer) {
  const files: Record<string, string> = {};
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18), length = buffer.readUInt16LE(offset + 26), extra = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + length).toString();
    const start = offset + 30 + length + extra;
    files[name] = buffer.subarray(start, start + size).toString(); offset = start + size;
  }
  expect(buffer.readUInt32LE(offset)).toBe(0x02014b50);
  return files;
}

beforeEach(async () => {
  vi.clearAllMocks(); seam.rows.clear(); children = []; owned = new OwnedChildren(); controllers = [];
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'desk12-')); owner = `owner-${path.basename(root)}`;
  vi.stubEnv('DESK_DATA_ROOT', root); vi.stubEnv('DESK_RATE_LIMIT_PER_HOUR', '100');
  vi.stubEnv('FRED_API_KEY', 'fixture-fred-secret');
  modes = { AAPL: 'wait:review', MSFT: 'wait:success' }; budget = 20;
  seam.auth.mockImplementation(async () => ({ userId: owner, key: { key: 'fixture-router-secret' } }));
  seam.session.mockResolvedValue({ id: 'fixture-session', title: 'fixture' });
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  seam.spawn.mockImplementation((exe, args, options) => {
    // Fail closed: only the run command can be redirected; control/checkpoint helpers are real.
    const script = path.basename(args[0]);
    if (script === 'desk_supervisor.py' && args[1] === 'run') {
      fs.writeFileSync(path.join(args[2], 'fixture.json'), JSON.stringify(modes));
      args = [path.join(process.cwd(), 'test/desk_fixture_supervisor.py'), args[2], String(budget)];
    } else if (!['desk_supervisor.py', 'desk_checkpoint.py'].includes(script)) {
      throw new Error(`Unexpected process boundary: ${script}`);
    }
    const child = owned.track(actual.spawn(exe, args, options), script === 'desk_supervisor.py' ? 'supervisor/control' : 'checkpoint-control'); children.push(child); return child;
  });
});
async function cleanupOwned() {
  controllers.forEach(controller => controller.abort());
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  const python = path.join(process.cwd(), 'TradingAgents/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  // Register every control before waiting; one failure cannot skip others.
  const controls = [...seam.rows.values()].filter(row => fs.existsSync(path.join(dir(row.id, row.userId), 'manifest.json')))
    .map(row => owned.track(actual.spawn(python, ['scripts/desk_supervisor.py', 'cancel', dir(row.id, row.userId)],
      { env: runtimeEnv(), windowsHide: true, stdio: 'pipe' }), 'cleanup-control'));
  const outcomes = await Promise.allSettled(controls.map(async child => {
    await exited(child);
    if (child.exitCode !== 0) throw new Error(`Cleanup control failed: ${owned.diagnostics(child)}`);
  }));
  const retirement = await Promise.allSettled([owned.retire()]);
  const failures = [...outcomes, ...retirement].filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failures.length) throw new Error(`Offline acceptance cleanup failed:\n${failures.map(r => String(r.reason)).join('\n')}`);
}
afterEach(async () => {
  try {
    await cleanupOwned();
  } finally {
    vi.unstubAllEnvs();
    // Retain artifacts on incomplete retirement; never delete beneath a live child.
    if (owned.allClosed) {
      expect(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)).toBe(true);
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
}, 40000);

it('launch → real supervisor → dropped/reconnected SSE → per-ticker REVIEW reports and selected exports', async () => {
  const id = await start({ ...input, tickers: [' aapl ', 'AAPL', 'msft'], userId: 'forged-owner' });
  await until(() => fs.existsSync(path.join(dir(id), 'seen-AAPL.json')), Boolean);
  expect(fs.existsSync(path.join(root, 'forged-owner'))).toBe(false);
  expect(fs.existsSync(path.join(dir(id), 'seen-MSFT.json'))).toBe(false);
  const originalDeadline = state(id).deadline;
  let live = emptyDeskLiveState();
  const ids: string[] = [], snapshots: any[] = [], urls: string[] = [], errors: string[] = [];
  const controller = new AbortController(); controllers.push(controller);
  let dropped = false;
  const connection = connectDeskStream({ runId: id, signal: controller.signal,
    onRun: run => snapshots.push(run), onError: error => errors.push(error),
    onEvent: event => { ids.push(event.id); live = reduceDeskStream(live, event, input.tickers); },
    fetch: (async (url: string, options: RequestInit) => {
      urls.push(url);
      if (!url.includes('/stream')) return detail(request(url, 'GET', undefined, options.signal!), context(id));
      const response = await stream(request(url, 'GET', undefined, options.signal!), context(id));
      if (dropped) return response;
      dropped = true;
      const reader = response.body!.getReader();
      // Deliver one genuine persisted frame, then drop the transport.
      const first = await reader.read(); await reader.cancel();
      return new Response(new ReadableStream({ start(c) { c.enqueue(first.value!); c.close(); } }), { headers: response.headers });
    }) as typeof fetch,
  });
  await until(() => urls.filter(url => url.includes('/stream')).length, count => count >= 2);
  expect(urls.find(url => url.includes('?after='))).toContain(encodeURIComponent(ids[0]));
  expect(state(id).deadline).toBe(originalDeadline);
  expect(state(id).status).toBe('running'); // disconnect never cancels Python
  vi.resetModules();
  const restarted = await import('../../app/api/desk/runs/[id]/route');
  expect((await restarted.GET(request(`/api/desk/runs/${id}`), context(id))).status).toBe(200);
  expect(state(id).deadline).toBe(originalDeadline);
  fs.writeFileSync(path.join(dir(id), 'release-AAPL'), '');
  await until(() => fs.existsSync(path.join(dir(id), 'seen-MSFT.json')), Boolean);
  await until(() => live.tickers.MSFT?.memoText, Boolean);
  expect(live.tickers.AAPL).toMatchObject({ done: true, memoText: 'AAPL café distinct memo', agentStatus: { market: 'done' } });
  expect(live.tickers.MSFT).toMatchObject({ done: false, memoText: 'MSFT café distinct memo', agentStatus: { market: 'running' } });
  // The file stream can lead desk-16's documented two-second DB reconciliation
  // cache. Observe that bounded publication, without relaunching/retrying work.
  const partial = await until(() => get(id), value => deskRunResults(value)[0]?.signal === 'REVIEW', 5000);
  expect(partial.status).toBe('running'); expect(deskRunResults(partial)[0].signal).toBe('REVIEW');
  fs.writeFileSync(path.join(dir(id), 'release-MSFT'), '');
  await connection;
  expect(errors).toEqual([]); expect(new Set(ids).size).toBe(ids.length);
  const run = snapshots.at(-1);
  expect(run).toMatchObject({ status: 'review', signal: 'REVIEW', tickers: ['AAPL', 'MSFT'] });
  expect(deskRunResults(run).map(row => row.signal)).toEqual(['REVIEW', 'Sell']);
  expect(deskRunResults(run)[0].finishedAt! <= deskRunResults(run)[1].startedAt!).toBe(true);
  expect(seam.session).not.toHaveBeenCalled(); // no implicit Insights writes
  const markdown = await download(request(`/api/desk/runs/${id}/download?ticker=MSFT`), context(id));
  expect(markdown.headers.get('Content-Disposition')).toContain('MSFT');
  const text = await markdown.text(); expect(text).toContain('MSFT distinct memo'); expect(text).not.toContain('AAPL');
  expect((await insights(request(`/api/desk/runs/${id}/insights?ticker=MSFT`, 'POST'), context(id))).status).toBe(200);
  expect(seam.session.mock.calls[0][0].data).toMatchObject({ userId: owner, title: 'Desk · MSFT · Sell' });
  expect(seam.message.mock.calls[0][0].data).toMatchObject({ role: 'user', content: expect.stringContaining('MSFT fixture thesis') });
  expect(seam.message.mock.calls[0][0].data.content).not.toContain('AAPL');
  fs.writeFileSync(path.join(dir(id), 'private.md'), 'NEVER_EXPORT');
  const zip = await download(request(`/api/desk/runs/${id}/download?format=zip&ticker=MSFT`), context(id));
  const files = unzip(Buffer.from(await zip.arrayBuffer()));
  expect(Object.keys(files)).toEqual(['AAPL-desk-report.md', 'out-AAPL.json', 'MSFT-desk-report.md', 'out-MSFT.json']);
  expect(files['AAPL-desk-report.md']).toContain('REVIEW'); expect(files['MSFT-desk-report.md']).toContain('MSFT distinct memo');
  expect(JSON.stringify(files)).not.toMatch(/NEVER_EXPORT|FORBIDDEN_|fixture-router-secret|fixture-fred-secret/);
  expect((await cancel(request(`/api/desk/runs/${id}`, 'DELETE'), context(id))).status).toBe(200);
  expect(await get(id)).toEqual(run);
  const foreignCursor = ids[0].replace(/v1\.[^.]+/, `v1.${'0'.repeat(24)}`);
  expect((await stream(request(`/api/desk/runs/${id}/stream?after=${foreignCursor}`), context(id))).status).toBe(400);
}, 45000);

it('later corrupt/abrupt/error/timeout/cancel outcomes keep the first report through detail, stream and exports', async () => {
  for (const mode of ['corrupt', 'crash', 'error', 'timeout', 'cancel']) {
    modes = { AAPL: 'success', MSFT: ['timeout', 'cancel'].includes(mode) ? 'stall' : mode, NVDA: 'success' };
    budget = mode === 'timeout' ? 1.5 : 15;
    const id = await start({ ...input, tickers: Object.keys(modes), checkpoint: true });
    if (mode === 'cancel') {
      await until(() => fs.existsSync(path.join(dir(id), 'heartbeat-MSFT')), Boolean);
      const responses = await Promise.all([cancel(request(`/api/desk/runs/${id}`, 'DELETE'), context(id)), get(id)]);
      expect((responses[0] as Response).status).toBe(200);
    }
    const run = await until(() => get(id), value => terminal(value.status));
    expect(run.status).toBe(mode === 'cancel' ? 'cancelled' : 'failed'); expect(run.signal).toBeNull();
    expect(deskRunResults(run).map(row => row.status)).toEqual(['completed', mode === 'cancel' ? 'cancelled' : 'failed', 'skipped']);
    expect(fs.existsSync(path.join(dir(id), 'seen-NVDA.json'))).toBe(false);
    if (mode === 'timeout') expect(run.error).toMatch(/timed out.*MSFT/);
    const events: any[] = [];
    const controller = new AbortController(); controllers.push(controller);
    await readDeskEventStream(await stream(request(`/api/desk/runs/${id}/stream`), context(id)), controller.signal, event => events.push(event));
    expect(events.some(event => event.name === 'desk_done' && event.data.ticker === 'AAPL')).toBe(true);
    expect(events.some(event => String(event.data.text).includes('unfinished'))).toBe(false);
    const md = await download(request(`/api/desk/runs/${id}/download?ticker=AAPL`), context(id));
    expect(await md.text()).toContain('AAPL distinct memo');
    for (const [ticker, status] of [['MSFT', 409], ['NVDA', 409], ['OTHER', 404]] as const) {
      expect((await download(request(`/api/desk/runs/${id}/download?ticker=${ticker}`), context(id))).status).toBe(status);
      expect((await insights(request(`/api/desk/runs/${id}/insights?ticker=${ticker}`, 'POST'), context(id))).status).toBe(status);
    }
    expect((await insights(request(`/api/desk/runs/${id}/insights?ticker=AAPL`, 'POST'), context(id))).status).toBe(200);
    const zip = await download(request(`/api/desk/runs/${id}/download?format=zip&ticker=MSFT`), context(id));
    expect(Object.keys(unzip(Buffer.from(await zip.arrayBuffer())))).toEqual(['AAPL-desk-report.md', 'out-AAPL.json']);
    await cancel(request(`/api/desk/runs/${id}`, 'DELETE'), context(id));
    expect(await get(id)).toEqual(run); // terminal reconciliation is irreversible
  }
}, 60000);

it('every route gates auth; two owners cannot read/cancel/export/resume/clear each other’s actual artifacts', async () => {
  const id = await start();
  await until(() => fs.existsSync(path.join(dir(id), 'seen-AAPL.json')), Boolean);
  const victim = owner, before = fs.readFileSync(path.join(dir(id), 'state.json'), 'utf8');
  owner = `${victim}-other`;
  for (const handler of [detail, cancel, stream, download, insights]) {
    expect((await handler(request(`/api/desk/runs/${id}?ticker=AAPL`), context(id))).status).toBe(404);
  }
  expect(await (await list()).json()).toEqual([]);
  expect(fs.readFileSync(path.join(dir(id, victim), 'state.json'), 'utf8')).toBe(before);
  expect(seam.session).not.toHaveBeenCalled();
  expect(seam.spawn.mock.calls.every(call => !call[1].includes(dir(id, victim)) || call[1][1] === 'run')).toBe(true);
  const routes = [() => list(), () => launch(request('/api/desk/runs', 'POST', input)),
    ...[detail, cancel, stream, download, insights].map(handler => () => handler(request(`/api/desk/runs/${id}`), context(id))),
    () => checkpoints(request('/api/desk/checkpoints?tickers=AAPL')),
    () => clear(request('/api/desk/checkpoints', 'DELETE', { ticker: 'AAPL' }))];
  for (const status of [401, 403]) {
    seam.auth.mockResolvedValue(NextResponse.json({ error: 'Access denied' }, { status }));
    const processes = seam.spawn.mock.calls.length, queries = seam.db.mock.calls.length;
    for (const route of routes) expect((await route()).status).toBe(status);
    expect(seam.spawn).toHaveBeenCalledTimes(processes); expect(seam.db).toHaveBeenCalledTimes(queries);
  }
  seam.auth.mockImplementation(async () => ({ userId: owner, key: { key: 'fresh-fixture-key' } }));
  owner = victim;
  await cancel(request(`/api/desk/runs/${id}`, 'DELETE'), context(id));
  for (const child of children) await exited(child);
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  const python = path.join(process.cwd(), 'TradingAgents/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const fixture = owned.track(actual.spawn(python, ['test/desk_fixture_checkpoint.py', path.join(root, victim)],
    { env: runtimeEnv(), windowsHide: true, stdio: 'pipe' }), 'checkpoint-seed');
  await owned.checkpoint(fixture);
  const listing = await (await checkpoints(request('/api/desk/checkpoints?tickers=AAPL'))).json();
  expect(listing.tickers, JSON.stringify(listing)).toEqual(['AAPL']);
  const saved = listing.checkpoints[0].checkpoints[0];
  const resume = deskResumeInput(saved);
  const checkpointFile = path.join(root, victim, 'cache/checkpoints/AAPL.db');
  const original = fs.readFileSync(checkpointFile);
  owner = `${victim}-other`;
  expect((await (await checkpoints(request(`/api/desk/checkpoints?tickers=AAPL&userId=${victim}`))).json()).tickers).toEqual([]);
  expect((await launch(request('/api/desk/runs', 'POST', resume))).status).toBe(404);
  expect((await clear(request('/api/desk/checkpoints', 'DELETE', { ticker: 'AAPL', userId: victim }))).status).toBe(200);
  expect(fs.readFileSync(checkpointFile)).toEqual(original);
  owner = victim;
  for (const patch of [{ asOf: '2026-10-02' }, { depth: 'deep' }, { analysts: ['news'] }, { assetType: 'crypto' },
    { resume: { ...resume.resume!, checkpointId: 'stale' } }]) {
    const count = seam.rows.size;
    expect((await launch(request('/api/desk/runs', 'POST', { ...resume, ...patch }))).status).toBe(409);
    expect(seam.rows.size).toBe(count);
  }
  modes = { AAPL: 'wait:review' };
  const resumedId = await start(resume);
  await until(() => fs.existsSync(path.join(dir(resumedId), 'seen-AAPL.json')), Boolean);
  expect(JSON.parse(fs.readFileSync(path.join(dir(resumedId), 'manifest.json'), 'utf8')).resume).toEqual(resume.resume);
  expect((await clear(request('/api/desk/checkpoints', 'DELETE', { ticker: 'AAPL' }))).status).toBe(409);
  expect((await (await checkpoints(request('/api/desk/checkpoints?tickers=AAPL'))).json()).tickers).toEqual([]);
  expect(fs.readFileSync(checkpointFile)).toEqual(original);
  fs.writeFileSync(path.join(dir(resumedId), 'release-AAPL'), '');
  await until(() => get(resumedId), value => terminal(value.status));
  for (const child of children) await exited(child);
  expect((await clear(request('/api/desk/checkpoints', 'DELETE', { ticker: 'AAPL' }))).status).toBe(200);
  expect(fs.existsSync(checkpointFile)).toBe(false);
}, 90000);

it('controlled checkpoint failure retains safe diagnostics and retires all children and graph descendants', async () => {
  modes = { AAPL: 'stall' }; budget = 60;
  const id = await start({ ...input, tickers: ['AAPL'] });
  const heartbeat = path.join(dir(id), 'heartbeat-AAPL');
  await until(() => fs.existsSync(heartbeat), Boolean);
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  const python = path.join(process.cwd(), 'TradingAgents/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const fixture = owned.track(actual.spawn(python, ['test/desk_fixture_checkpoint.py', root, 'fail-after-ready'],
    { env: runtimeEnv(), windowsHide: true, stdio: 'pipe' }), 'controlled-checkpoint');
  await expect(owned.checkpoint(fixture, 200)).rejects.toThrow(/exit budget exceeded/);
  const diagnostic = owned.diagnostics(fixture);
  expect(diagnostic.length).toBeLessThan(512);
  expect(diagnostic).not.toMatch(/fixture-router-secret|xxxxx/);
  expect(JSON.parse(diagnostic)).toMatchObject({ ready: true, closed: false });
  expect(JSON.parse(diagnostic).stderrBytes).toBeGreaterThan(262144);
  // The original timeout above is observed once; cleanup releases the pipe
  // lease and never relaunches the fixture or changes that failed result.
  await cleanupOwned();
  expect(owned.allClosed).toBe(true);
  expect(fixture.exitCode !== null || fixture.signalCode !== null).toBe(true);
  expect(state(id).status).toBe('cancelled');
  const last = fs.readFileSync(heartbeat, 'utf8');
  await new Promise(resolve => setTimeout(resolve, 250));
  expect(fs.readFileSync(heartbeat, 'utf8')).toBe(last);
}, 80000);

it('owned fixture startup failure is observed without exposing raw errors or skipping siblings', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  const missing = owned.track(actual.spawn(path.join(root, 'missing-fixture'), [],
    { env: runtimeEnv(), windowsHide: true, stdio: 'pipe' }), 'missing-child');
  const early = owned.track(actual.spawn(process.execPath, ['-e', 'process.exit(7)'],
    { env: runtimeEnv(), windowsHide: true, stdio: 'pipe' }), 'early-exit');
  await expect(owned.checkpoint(missing)).rejects.toThrow('Fixture spawn failed');
  await expect(owned.checkpoint(early)).rejects.toThrow('ready closed early');
  await until(() => owned.allClosed, Boolean);
  await owned.retire();
});

it('checkpoint fixture exits when its parent pipe lease closes', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  const python = path.join(process.cwd(), 'TradingAgents/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const fixture = owned.track(actual.spawn(python, ['test/desk_fixture_checkpoint.py', root, 'fail-after-ready'],
    { env: runtimeEnv(), windowsHide: true, stdio: 'pipe' }), 'checkpoint-parent-lease');
  await owned.wait(fixture, 'ready', 45_000);
  fixture.stdin!.end();
  await exited(fixture);
  expect(fixture.exitCode).toBe(75);
}, 65000);
