import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelDeskRun, finalizeDeskRun as coalescedFinalize, hydrateDeskRun, startDeskRun, validateDeskArtifactPaths } from './runner';
import { DESK_RECONCILE_FRESH_MS } from './limits';
import { deskRunResults, emptyDeskResults, packDeskResults } from './report';
import { NextRequest } from 'next/server';
import { GET as detail } from '../../app/api/desk/runs/[id]/route';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), auth: vi.fn() }));
vi.mock('@/lib/desk/access', () => ({ requireDeskAccess: mocks.auth }));
vi.mock('child_process', () => ({ spawn: mocks.spawn }));
vi.mock('@/lib/prisma', () => ({ prisma: { deskRun: { findFirst: mocks.findFirst, findMany: mocks.findMany, updateMany: mocks.updateMany } } }));
let root: string;
let row: any;
let snapshot: any;
let clock = 0;
// Existing lifecycle scenarios explicitly observe the next freshness window.
const finalizeDeskRun = (id: string, user: string) => {
  clock += DESK_RECONCILE_FRESH_MS;
  return coalescedFinalize(id, user);
};
const input = { id: 'run-one', userId: 'user-one', tickers: ['AAPL', 'MSFT', 'NVDA'], asOf: '2026-10-04',
  depth: 'fast', analysts: ['market'], assetType: 'stock', checkpoint: false, openRouterKey: 'sentinel-key' };
const dir = () => path.join(root, input.userId, input.id);

beforeEach(() => {
  vi.resetAllMocks();
  clock = 0; vi.spyOn(performance, 'now').mockImplementation(() => clock);
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-multi-'));
  vi.stubEnv('DESK_DATA_ROOT', root);
  row = { ...input, status: 'queued', activeTicker: null, signal: null, error: null,
    finalState: packDeskResults(emptyDeskResults(input.tickers)), createdAt: new Date(0), updatedAt: new Date(), finishedAt: null };
  mocks.findFirst.mockImplementation(async ({ where }) => where.id === row.id && where.userId === row.userId ? structuredClone(row) : null);
  mocks.updateMany.mockImplementation(async ({ where, data }) => {
    if (where.id !== row.id || where.userId !== row.userId || where.status !== row.status
      || where.updatedAt.getTime() !== row.updatedAt.getTime()) return { count: 0 };
    row = { ...row, ...structuredClone(data) }; return { count: 1 };
  });
  const exists = fs.existsSync;
  vi.spyOn(fs, 'existsSync').mockImplementation(file => String(file).includes(`${path.sep}.venv${path.sep}`) || exists(file));
  vi.spyOn(process, 'kill').mockImplementation(() => { throw new Error('Must never signal a persisted PID'); });
  snapshot = { version: 1, jobId: 'a'.repeat(32), id: input.id, userId: input.userId, revision: 1,
    status: 'running', activeTicker: 'AAPL', error: null, finishedAt: null, results: emptyDeskResults(input.tickers) };
  mocks.spawn.mockImplementation((_exe, args) => {
    const child = Object.assign(new EventEmitter(), { pid: 999999, stdout: new PassThrough(), unref: vi.fn(), kill: vi.fn() });
    const response = JSON.stringify(snapshot);
    queueMicrotask(() => {
      child.emit('spawn');
      if (args[1] !== 'run') { child.stdout.end(response); child.emit('close', 0); }
    });
    return child;
  });
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
function complete(index: number, signal = 'Buy') {
  snapshot.results[index] = { ...snapshot.results[index], status: signal === 'REVIEW' ? 'review' : 'completed', signal,
    finalState: { company_of_interest: input.tickers[index], trade_date: input.asOf, market_report: `${input.tickers[index]} distinct memo` },
    startedAt: '2026-10-05T00:00:00.000Z', finishedAt: '2026-10-05T00:00:01.000Z' };
}

describe('durable reconciliation preserves desk-8 results', () => {
  it('measures synthetic concurrent viewers and detail reads', async () => {
    row.status = 'running';
    row.finalState.deskLifecycle = { jobId: snapshot.jobId, revision: snapshot.revision };
    await Promise.all(Array.from({ length: 10 }, () => coalescedFinalize(input.id, input.userId)));
    console.log('desk16 ten same-run concurrent readers', { helpers: mocks.spawn.mock.calls.length,
      dbReads: mocks.findFirst.mock.calls.length, writes: mocks.updateMany.mock.calls.length });
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.findFirst).toHaveBeenCalledTimes(2);
  });
  it('measures synthetic detail readers with three active runs', async () => {
    row.status = 'running'; row.finalState.deskLifecycle = { jobId: snapshot.jobId, revision: 1 };
    mocks.auth.mockResolvedValue({ userId: input.userId });
    const rows = ['run-one', 'run-two', 'run-three'].map(id => ({ ...row, id }));
    mocks.findMany.mockResolvedValue(rows);
    mocks.findFirst.mockImplementation(async ({ where }) => rows.find(r => r.id === where.id && r.userId === where.userId));
    mocks.spawn.mockImplementation((_exe, args) => {
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), kill: vi.fn() });
      const response = JSON.stringify({ ...snapshot, id: path.basename(args[2]) });
      queueMicrotask(() => { child.stdout.end(response); child.emit('close', 0); });
      return child;
    });
    await Promise.all(Array.from({ length: 10 }, () => detail(new NextRequest('http://localhost/api/desk/runs/run-one'), { params: { id: input.id } })));
    console.log('desk16 ten detail readers, three active runs', { helpers: mocks.spawn.mock.calls.length,
      dbReads: mocks.findFirst.mock.calls.length, dbLists: mocks.findMany.mock.calls.length });
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.findFirst).toHaveBeenCalledTimes(12);
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.spawn.mock.calls[0][1][2]).toBe(dir());
  });
  it('bounds freshness, isolates users/runs and retries errors without caching them', async () => {
    await coalescedFinalize(input.id, input.userId);
    clock = DESK_RECONCILE_FRESH_MS - 1;
    await coalescedFinalize(input.id, input.userId);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    await coalescedFinalize(input.id, 'other-user');
    await coalescedFinalize('other-run', input.userId);
    expect(mocks.findFirst).toHaveBeenCalledTimes(4);
    clock++;
    await coalescedFinalize(input.id, input.userId);
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    clock += DESK_RECONCILE_FRESH_MS;
    mocks.spawn.mockImplementationOnce(() => {
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), kill: vi.fn() });
      queueMicrotask(() => child.emit('error', new Error('synthetic'))); return child;
    });
    await expect(coalescedFinalize(input.id, input.userId)).rejects.toThrow();
    await coalescedFinalize(input.id, input.userId);
    expect(mocks.spawn).toHaveBeenCalledTimes(4);
  });
  it('a delayed active snapshot cannot overwrite uncached cancellation or renew its freshness', async () => {
    let release!: () => void;
    mocks.spawn.mockImplementationOnce(() => {
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), kill: vi.fn() });
      const response = JSON.stringify(snapshot);
      release = () => { child.stdout.end(response); child.emit('close', 0); };
      return child;
    });
    const stale = coalescedFinalize(input.id, input.userId);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    snapshot.status = 'cancelled'; snapshot.revision++; snapshot.finishedAt = '2026-10-05T00:00:02.000Z';
    await cancelDeskRun(input.id, input.userId);
    release(); await stale;
    const reads = mocks.findFirst.mock.calls.length;
    await coalescedFinalize(input.id, input.userId);
    expect(mocks.findFirst).toHaveBeenCalledTimes(reads + 1);
    expect(row.status).toBe('cancelled');
    expect(mocks.spawn.mock.calls.map(call => call[1][1])).toEqual(['snapshot', 'cancel']);
  });
  it('reconciles distinct results after module restart; duplicate reads do not write or launch', async () => {
    await startDeskRun(input);
    complete(0); snapshot.activeTicker = 'MSFT'; snapshot.results[1].status = 'running';
    await finalizeDeskRun(input.id, input.userId);
    expect(deskRunResults(row)[0]).toMatchObject({ status: 'completed', signal: 'Buy', startedAt: expect.any(String) });
    vi.resetModules();
    const restarted = await import('./runner');
    complete(1, 'REVIEW'); complete(2, 'Sell'); snapshot.revision = 2; snapshot.status = 'review'; snapshot.finishedAt = '2026-10-05T00:00:03.000Z';
    await restarted.finalizeDeskRun(input.id, input.userId);
    expect(row.status).toBe('review'); expect(row.signal).toBe('REVIEW');
    expect(deskRunResults(row).map(r => r.finalState?.market_report)).toEqual(['AAPL distinct memo', 'MSFT distinct memo', 'NVDA distinct memo']);
    const writes = mocks.updateMany.mock.calls.length;
    await Promise.all([restarted.finalizeDeskRun(input.id, input.userId), restarted.finalizeDeskRun(input.id, input.userId)]);
    expect(mocks.updateMany).toHaveBeenCalledTimes(writes);
    expect(mocks.spawn.mock.calls.filter(call => call[1][1] === 'run')).toHaveLength(1);
  });
  it('mixed successful signals keep completed status and aggregate REVIEW', async () => {
    row.tickers = ['AAPL', 'MSFT']; snapshot.results = snapshot.results.slice(0, 2);
    complete(0); complete(1, 'Sell'); snapshot.status = 'completed'; snapshot.finishedAt = '2026-10-05T00:00:02.000Z';
    await finalizeDeskRun(input.id, input.userId);
    expect(row.status).toBe('completed'); expect(row.signal).toBe('REVIEW');
  });
  it.each(['failed', 'cancelled'])('preserves previous reports on %s and ignores a late successful snapshot', async (status) => {
    await startDeskRun(input); complete(0);
    snapshot.activeTicker = 'MSFT'; snapshot.results[1].status = 'running';
    await finalizeDeskRun(input.id, input.userId);
    snapshot.revision++; snapshot.status = status; snapshot.error = status === 'failed' ? 'interrupted' : null;
    snapshot.results[1].status = status; snapshot.results[2].status = 'skipped'; snapshot.finishedAt = '2026-10-05T00:00:02.000Z';
    if (status === 'cancelled') await cancelDeskRun(input.id, input.userId);
    else await finalizeDeskRun(input.id, input.userId);
    complete(1); complete(2); snapshot.status = 'completed'; snapshot.revision++;
    await finalizeDeskRun(input.id, input.userId);
    expect(row.status).toBe(status);
    expect(deskRunResults(row).map(r => r.status)).toEqual(['completed', status, 'skipped']);
    expect(row.signal).toBeNull(); expect(process.kill).not.toHaveBeenCalled();
  });
  it('CAS retry cannot overwrite a concurrent cancellation and stale revisions cannot regress results', async () => {
    complete(0); await finalizeDeskRun(input.id, input.userId);
    snapshot.revision = 0; snapshot.results = emptyDeskResults(input.tickers);
    await finalizeDeskRun(input.id, input.userId);
    expect(deskRunResults(row)[0].status).toBe('completed');
    snapshot.revision = 2; complete(1);
    mocks.updateMany.mockImplementationOnce(async () => { row.status = 'cancelled'; return { count: 0 }; });
    await finalizeDeskRun(input.id, input.userId);
    expect(row.status).toBe('cancelled');
  });
  it('concurrent duplicate reconciliation is idempotent', async () => {
    complete(0);
    await Promise.all([finalizeDeskRun(input.id, input.userId), finalizeDeskRun(input.id, input.userId)]);
    expect(mocks.updateMany).toHaveBeenCalledTimes(1); // shared reconciliation performs one CAS
    const writes = mocks.updateMany.mock.calls.length;
    await finalizeDeskRun(input.id, input.userId);
    expect(mocks.updateMany).toHaveBeenCalledTimes(writes);
  });
  it('missing/corrupt supervision retains DB partial success and never trusts raw output', async () => {
    complete(0); await finalizeDeskRun(input.id, input.userId);
    snapshot = null;
    await finalizeDeskRun(input.id, input.userId);
    expect(row.status).toBe('failed'); expect(deskRunResults(row)[0].status).toBe('completed');
  });
  it('terminal corruption recovery is not suppressed by a clock rollback', async () => {
    snapshot.revision = 100; complete(0); await finalizeDeskRun(input.id, input.userId);
    snapshot.revision = 1; snapshot.status = 'failed'; snapshot.error = 'state corrupt';
    snapshot.results = emptyDeskResults(input.tickers);
    await finalizeDeskRun(input.id, input.userId);
    expect(row.status).toBe('failed'); expect(deskRunResults(row)[0].status).toBe('completed');
  });
  it('scope checks precede every control subprocess', async () => {
    await finalizeDeskRun(input.id, 'another-user');
    expect(await cancelDeskRun(input.id, 'another-user')).toBeNull();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it('keyless controls exclude provider/broker secrets and helper failure leaves DB retryable', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sentinel-router'); vi.stubEnv('FRED_API_KEY', 'sentinel-fred');
    vi.stubEnv('WEBULL_APP_SECRET_PROD', 'sentinel-broker');
    await finalizeDeskRun(input.id, input.userId);
    const env = mocks.spawn.mock.calls[0][2].env;
    expect(env.OPENROUTER_API_KEY).toBeUndefined(); expect(env.FRED_API_KEY).toBeUndefined();
    expect(env.WEBULL_APP_SECRET_PROD).toBeUndefined();
    mocks.spawn.mockImplementationOnce(() => {
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), kill: vi.fn() });
      queueMicrotask(() => child.emit('error', new Error('sentinel-router')));
      return child;
    });
    await expect(finalizeDeskRun(input.id, input.userId)).rejects.toThrow('control unavailable');
    expect(row.status).toBe('running');
  });
  it('deduplicates launches without resetting durable state; keys never enter manifests or argv', async () => {
    await startDeskRun(input);
    await startDeskRun(input);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    const manifest = fs.readFileSync(path.join(dir(), 'manifest.json'), 'utf8');
    expect(manifest).not.toContain(input.openRouterKey); expect(manifest).not.toContain('OPENROUTER');
    expect(JSON.stringify(mocks.spawn.mock.calls[0][1])).not.toContain(input.openRouterKey);
  });
  it('rejects invalid direct launches before filesystem or subprocess work', async () => {
    for (const value of [{ tickers: ['../bad'] }, { asOf: '2026-02-30' }, { userId: '../other' }]) {
      await expect(startDeskRun({ ...input, ...value })).rejects.toThrow();
    }
    expect(mocks.spawn).not.toHaveBeenCalled(); expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(fs.readdirSync(root)).toEqual([]);
  });
  it('legacy archive hydration keeps each ticker, rejects mismatches, never follows symlinks', () => {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(path.join(dir(), 'out-AAPL.json'), JSON.stringify({ signal: 'Buy', finalState: { company_of_interest: 'AAPL', market_report: 'legacy first' } }));
    fs.writeFileSync(path.join(dir(), 'out-MSFT.json'), JSON.stringify({ signal: 'Buy', finalState: { company_of_interest: 'OTHER', market_report: 'wrong ticker' } }));
    const legacy = hydrateDeskRun({ ...row, finalState: { company_of_interest: 'NVDA', market_report: 'last' }, signal: 'Sell', activeTicker: 'NVDA', status: 'completed' });
    expect(deskRunResults(legacy).map(result => result.status)).toEqual(['completed', 'unavailable', 'completed']);
    const outside = path.join(root, 'outside'); fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(root, 'linked-user'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => validateDeskArtifactPaths('linked-user')).toThrow(/Symlink/);
    fs.unlinkSync(path.join(root, 'linked-user'));
  });
});
