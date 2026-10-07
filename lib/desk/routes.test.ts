import fs from 'fs';
import os from 'os';
import path from 'path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Integrated route/process cases live in acceptance.test.ts; retain fast input
// rejection and legacy archive coverage that the new-run fixture cannot replace.
const mocks = vi.hoisted(() => ({ auth: vi.fn(), findFirst: vi.fn(), create: vi.fn(), rate: vi.fn(), start: vi.fn(), reap: vi.fn() }));
vi.mock('@/lib/desk/access', () => ({ requireDeskAccess: mocks.auth }));
vi.mock('@/lib/desk/rate-limit', () => ({ consumeDeskRateLimit: mocks.rate }));
vi.mock('@/lib/desk/runner', async importOriginal => ({ ...await importOriginal<typeof import('./runner')>(),
  startDeskRun: mocks.start, reapOrphanDeskRuns: mocks.reap,
  withDeskCheckpointControl: async (_user: string, work: any) => work(async () => ({})) }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  deskRun: { findFirst: mocks.findFirst, findUnique: mocks.findFirst, create: mocks.create },
} }));
import { POST as launch } from '../../app/api/desk/runs/route';
import { GET as download } from '../../app/api/desk/runs/[id]/download/route';
import { DESK_LAUNCH_MAX_BYTES, DESK_RAW_ANALYST_MAX } from './limits';
import { DESK_ANALYSTS, DESK_DEPTHS } from './types';
import { emptyDeskResults, packDeskResults } from './report';

let root: string;
let run: any;
const context = { params: { id: 'run-one' } };
const req = (suffix: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost/api/desk/runs/run-one${suffix}`, {
  method, ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
});
const input = { tickers: ['AAPL', 'MSFT'], asOf: '2026-10-04', depth: 'standard', analysts: ['market'], assetType: 'stock', checkpoint: false };

beforeEach(() => {
  vi.resetAllMocks();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-routes-')); vi.stubEnv('DESK_DATA_ROOT', root);
  mocks.auth.mockResolvedValue({ userId: 'user-one', key: { key: 'sentinel-key' } });
  run = { ...input, id: 'run-one', userId: 'user-one', status: 'failed', activeTicker: 'MSFT', signal: null, finalState: null };
  mocks.findFirst.mockImplementation(async ({ where }) => where.id === run.id && (!where.userId || where.userId === run.userId) ? run : null);
  mocks.rate.mockReturnValue({ allowed: true });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

function unzipStored(buffer: Buffer): Record<string, string> {
  const files: Record<string, string> = {}; let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18), names = buffer.readUInt16LE(offset + 26), extra = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + names).toString();
    const start = offset + 30 + names + extra;
    files[name] = buffer.subarray(start, start + size).toString(); offset = start + size;
  }
  return files;
}
describe('authenticated report actions', () => {
  it('streams complete large Unicode reports without concatenating archive copies', async () => {
    const text = 'café 東京 🚀'.repeat(30_000);
    run.finalState = packDeskResults(emptyDeskResults(input.tickers).map(row => ({ ...row, status: 'completed', signal: 'Buy',
      finalState: { company_of_interest: row.ticker, market_report: text + row.ticker } })));
    const concat = vi.spyOn(Buffer, 'concat');
    const response = await download(req('/download?format=zip'), context);
    expect(concat).not.toHaveBeenCalled();
    concat.mockRestore();
    const buffer = Buffer.from(await response.arrayBuffer());
    const files = unzipStored(buffer);
    expect(Object.keys(files)).toHaveLength(4);
    for (const ticker of input.tickers) {
      expect(JSON.parse(files[`out-${ticker}.json`]).finalState.market_report).toBe(text + ticker);
      expect(files[`${ticker}-desk-report.md`]).toContain(text + ticker);
    }
    // Verify end directory sizes/offsets, including every local entry and its CRC.
    const end = buffer.length - 22;
    expect(buffer.readUInt32LE(end)).toBe(0x06054b50);
    expect(buffer.readUInt16LE(end + 10)).toBe(4);
    let central = buffer.readUInt32LE(end + 16);
    expect(central + buffer.readUInt32LE(end + 12)).toBe(end);
    for (let i = 0; i < 4; i++) {
      expect(buffer.readUInt32LE(central)).toBe(0x02014b50);
      const local = buffer.readUInt32LE(central + 42);
      expect(buffer.readUInt32LE(local)).toBe(0x04034b50);
      expect(buffer.readUInt32LE(local + 14)).toBe(buffer.readUInt32LE(central + 16));
      central += 46 + buffer.readUInt16LE(central + 28);
    }
    expect(central).toBe(end);
  });
  it('legacy out-TICKER.json and out.json become complete safe ZIP entries', async () => {
    run.finalState = { company_of_interest: 'MSFT', market_report: 'legacy last' }; run.signal = 'Sell';
    const dir = path.join(root, run.userId, run.id); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'out-AAPL.json'), JSON.stringify({ signal: 'Buy', finalState: { company_of_interest: 'AAPL', market_report: 'legacy first' }, privateKey: 'never' }));
    fs.writeFileSync(path.join(dir, 'out.json'), JSON.stringify({ signal: 'Sell', finalState: run.finalState }));
    const response = await download(req('/download?format=zip'), context);
    const files = unzipStored(Buffer.from(await response.arrayBuffer()));
    expect(Object.keys(files)).toHaveLength(4); expect(files['out-AAPL.json']).toContain('legacy first');
    expect(files['out-MSFT.json']).toContain('legacy last'); expect(JSON.stringify(files)).not.toContain('privateKey');
  });
});

describe('launch validation before charge or spawn', () => {
  it.each([undefined, '1', String(DESK_LAUNCH_MAX_BYTES + 1)])('rejects oversized streamed input with Content-Length %s', async length => {
    const cancel = vi.fn(); let chunks = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { chunks++; controller.enqueue(new Uint8Array(1024)); }, cancel,
    }, { highWaterMark: 0 });
    const request = new NextRequest('http://localhost/api/desk/runs', { method: 'POST', body,
      headers: length ? { 'Content-Length': length } : {}, duplex: 'half' } as ConstructorParameters<typeof NextRequest>[1]);
    const response = await launch(request);
    expect(response.status).toBe(413); expect((await response.json()).error).toContain('16384 bytes');
    expect(chunks).toBeLessThanOrEqual(17); expect(cancel).toHaveBeenCalledTimes(1);
    expect(mocks.rate).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it('counts UTF-8 bytes, rejects malformed JSON and caps raw analysts before deduplication', async () => {
    for (const body of ['{broken', JSON.stringify({ ...input, extra: 'é'.repeat(DESK_LAUNCH_MAX_BYTES / 2) })]) {
      const response = await launch(new NextRequest('http://localhost/api/desk/runs', { method: 'POST', body }));
      expect(response.status).toBe(body === '{broken' ? 400 : 413);
    }
    const response = await launch(req('', 'POST', { ...input, analysts: Array(DESK_RAW_ANALYST_MAX + 1).fill('market') }));
    expect(response.status).toBe(400); expect((await response.json()).error).toContain('16 raw analyst');
    expect(mocks.rate).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  });
  // Each matrix row gets an independent bounded case; retain all 132 launches
  // without putting their cumulative filesystem work under one 5-second clock.
  it.each(['stock', 'crypto'].flatMap(assetType => DESK_DEPTHS.flatMap(depth =>
    [false, true].map(checkpoint => ({ assetType, depth, checkpoint })))))
  ('keeps valid form combinations and charges for %j', async ({ assetType, depth, checkpoint }) => {
    mocks.create.mockImplementation(async ({ data }) => ({ ...data }));
      const allowed = assetType === 'stock' ? DESK_ANALYSTS : DESK_ANALYSTS.slice(0, 3);
      for (let mask = 1; mask < 2 ** allowed.length; mask++) {
        const analysts = allowed.filter((_, index) => mask & (1 << index));
        const response = await launch(req('', 'POST', { ...input, depth, assetType, checkpoint, analysts: [...analysts].reverse() }));
        expect(response.status).toBe(201);
        expect((await response.json()).analysts).toEqual(analysts);
        expect(mocks.rate).toHaveBeenLastCalledWith('user-one', depth);
      }
    expect(mocks.rate.mock.calls.length).toBe(mocks.create.mock.calls.length);
  });
  it('canonicalizes duplicate analysts without changing per-run charges', async () => {
    mocks.create.mockImplementation(async ({ data }) => ({ ...data }));
    const response = await launch(req('', 'POST', { ...input, analysts: Array(DESK_RAW_ANALYST_MAX).fill('news') }));
    expect(response.status).toBe(201); expect((await response.json()).analysts).toEqual(['news']);
    expect(mocks.rate.mock.calls.length).toBe(mocks.create.mock.calls.length);
  });
  it.each([{ tickers: ['../escape'] }, { tickers: ['NUL'] }, { tickers: ['--help'] }, { tickers: ['A\\B'] },
    { asOf: '2026-02-30' }, { asOf: '2026-04-31' }])('rejects invalid input %j', async patch => {
    expect((await launch(req('', 'POST', { ...input, ...patch }))).status).toBe(400);
    expect(mocks.rate).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  });
  it('rejects escaping owner artifact paths before charging', async () => {
    mocks.auth.mockResolvedValue({ userId: '../other', key: { key: 'sentinel-key' } });
    expect((await launch(req('', 'POST', input))).status).toBe(400);
    expect(mocks.rate).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  });
});
