import fs from 'fs';
import os from 'os';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deskCursorScope, followDeskJsonl, validateDeskCursor } from './stream-file';
import { parseDeskCursor } from './stream-protocol';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), find: vi.fn(), finalize: vi.fn(), reap: vi.fn(), cancel: vi.fn(), spawn: vi.fn() }));
vi.mock('@/lib/desk/access', () => ({ requireDeskAccess: mocks.auth }));
vi.mock('@/lib/prisma', () => ({ prisma: { deskRun: { findFirst: mocks.find } } }));
vi.mock('child_process', () => ({ spawn: mocks.spawn }));
vi.mock('./runner', async original => ({ ...await original<typeof import('./runner')>(),
  finalizeDeskRun: mocks.finalize, reapOrphanDeskRuns: mocks.reap, cancelDeskRun: mocks.cancel }));
import { GET } from '../../app/api/desk/runs/[id]/stream/route';

let root: string;
let file: string;
let run: { id: string; userId: string; status: string };
const scope = deskCursorScope('user-one', 'run-one');
const line = (data: object) => Buffer.from(`${JSON.stringify(data)}\n`);
const collect = async (options: Partial<Parameters<typeof followDeskJsonl>[1]> = {}) => {
  const records = [];
  for await (const record of followDeskJsonl(file, { scope, isFinished: async () => true, ...options })) records.push(record);
  return records;
};
const request = (query = '', headers?: HeadersInit, signal?: AbortSignal) => new NextRequest(
  `http://localhost/api/desk/runs/run-one/stream${query}`, { headers, signal },
);
const get = (req = request()) => GET(req, { params: { id: 'run-one' } });

beforeEach(() => {
  vi.resetAllMocks();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-stream-'));
  vi.stubEnv('DESK_DATA_ROOT', root);
  file = path.join(root, 'user-one', 'run-one', 'events.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  run = { id: 'run-one', userId: 'user-one', status: 'completed' };
  mocks.auth.mockResolvedValue({ userId: 'user-one' });
  mocks.find.mockImplementation(async ({ where }) => where.id === run.id && where.userId === run.userId ? { ...run } : null);
});
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('file-backed Desk replay', () => {
  it('preserves split UTF-8 and partial lines and keeps per-ticker done/error nonterminal', async () => {
    const memo = line({ event: 'memo', text: 'café 🚀 東京' });
    const split = memo.indexOf(Buffer.from('🚀')) + 2;
    fs.writeFileSync(file, memo.subarray(0, split));
    let polls = 0;
    const records = await collect({ isFinished: async () => {
      polls++;
      if (polls === 1) fs.appendFileSync(file, memo.subarray(split, memo.length - 1));
      if (polls === 2) fs.appendFileSync(file, Buffer.concat([Buffer.from('\n'),
        line({ event: 'done', ticker: 'AAPL' }), line({ event: 'error', message: 'ticker failure' }),
        line({ event: 'phase', ticker: 'MSFT', phase: 'analysts' })]));
      return polls === 3;
    } });
    expect(records.map(r => r.data.event)).toEqual(['memo', 'done', 'error', 'phase']);
    expect(records[0].data.text).toBe('café 🚀 東京');
    expect(parseDeskCursor(records[0].id)?.offset).toBe(memo.length);
    expect(polls).toBe(3);
  });

  it('IDs survive a fresh reader/module; resumes only after complete records and ignores unfinished tails', async () => {
    fs.writeFileSync(file, Buffer.concat([line({ event: 'phase', ticker: 'AAPL' }), Buffer.from('not json\n'),
      line({ event: 'memo', text: 'first' }), line({ event: 'done' }), Buffer.from('{"event":"memo"')]));
    const first = await collect();
    vi.resetModules();
    const restarted = await import('./stream-file');
    const replay = [];
    for await (const event of restarted.followDeskJsonl(file, { scope, isFinished: async () => true })) replay.push(event);
    expect(replay).toEqual(first);
    expect(await collect({ after: first[0].id })).toEqual(first.slice(1));
    expect(await collect({ after: first.at(-1)!.id })).toEqual([]);
    fs.appendFileSync(file, ',"text":"finished later"}\n');
    expect((await collect({ after: first.at(-1)!.id }))[0].data.text).toBe('finished later');
  });

  it('handles a record crossing the 64 KiB read boundary and validates it', async () => {
    fs.writeFileSync(file, line({ event: 'memo', text: 'é'.repeat(70_000) }));
    const [record] = await collect();
    expect(record.data.text).toHaveLength(70_000);
    expect(validateDeskCursor(file, scope, record.id)).toBe(fs.statSync(file).size);
  });

  it('rejects malformed, unsafe, mid-line, out-of-range, changed-file and other-scope cursors', async () => {
    fs.writeFileSync(file, line({ event: 'memo', text: 'first' }));
    const [record] = await collect();
    const cursor = parseDeskCursor(record.id)!;
    for (const invalid of ['', '../other', record.id.replace(`.${cursor.offset}.`, '.1.'),
      record.id.replace(`.${cursor.offset}.`, '.999999.'), record.id.replace(`.${cursor.offset}.`, '.9007199254740992.'),
      record.id.replace(scope, deskCursorScope('user-two', 'run-one')),
      record.id.replace(scope, deskCursorScope('user-one', 'run-two'))]) {
      expect(() => validateDeskCursor(file, scope, invalid)).toThrow(/cursor/);
    }
    fs.writeFileSync(file, line({ event: 'memo', text: 'other' }));
    expect(() => validateDeskCursor(file, scope, record.id)).toThrow(/cursor/);
    fs.unlinkSync(file);
    expect(() => validateDeskCursor(file, scope, record.id)).toThrow(/cursor/);
    expect(await collect()).toEqual([]);
  });
});

describe('authenticated SSE route', () => {
  it.each(['body', 'request'])('does not read an unread replay; a slow %s consumer abort releases the file', async kind => {
    fs.writeFileSync(file, Buffer.concat(Array.from({ length: 10_000 }, (_, i) => line({ event: 'memo', text: `東京-${i}` }))));
    const read = vi.spyOn(fs, 'readSync'); const close = vi.spyOn(fs, 'closeSync');
    const abort = new AbortController();
    const response = await get(request('', undefined, abort.signal));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(read).not.toHaveBeenCalled();
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('東京-0');
    expect(read).toHaveBeenCalledTimes(1);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(read).toHaveBeenCalledTimes(1); expect(mocks.finalize).not.toHaveBeenCalled();
    if (kind === 'body') await reader.cancel(); else abort.abort();
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect((await reader.read()).done).toBe(true);
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it('drains the complete backlog before terminal status and preserves all cursors', async () => {
    fs.writeFileSync(file, Buffer.concat(Array.from({ length: 2000 }, (_, i) => line({ event: 'memo', text: `café 🚀 ${i}` }))));
    const expected = await collect();
    const body = await (await get()).text();
    expect([...body.matchAll(/^id: (.+)$/gm)].map(match => match[1])).toEqual(expected.map(row => row.id));
    expect(body.indexOf('café 🚀 1999')).toBeLessThan(body.indexOf('event: desk_status'));
  });
  it('tails files every 400 ms but checks ownership/reconciliation at two-second intervals', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    run.status = 'running';
    const open = vi.spyOn(fs, 'openSync');
    const response = await get(); const reader = response.body!.getReader();
    const pending = reader.read();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1999);
    expect(mocks.finalize).toHaveBeenCalledTimes(1);
    expect(mocks.find).toHaveBeenCalledTimes(2); // route ownership + first status read
    expect(open.mock.calls.filter(call => call[0] === file)).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.finalize).toHaveBeenCalledTimes(2);
    expect(mocks.find).toHaveBeenCalledTimes(3);
    await reader.cancel(); expect((await pending).done).toBe(true);
  });
  it('emits stable IDs, honors query/header cursors and returns aggregate terminal control after replay', async () => {
    fs.writeFileSync(file, Buffer.concat([line({ event: 'done', ticker: 'AAPL' }), line({ event: 'phase', ticker: 'MSFT' })]));
    const [first, second] = await collect();
    const response = await get();
    expect(response.headers.get('Content-Type')).toContain('text/event-stream');
    const body = await response.text();
    expect(body).toContain(`id: ${first.id}`);
    expect(body).toContain(`id: ${second.id}`);
    expect(body).toContain('event: desk_status\ndata: {"status":"completed"}');
    for (const req of [request(`?after=${first.id}`), request('', { 'Last-Event-ID': first.id })]) {
      const replay = await (await get(req)).text();
      expect(replay).not.toContain(`id: ${first.id}`);
      expect(replay).toContain(`id: ${second.id}`);
    }
    expect(mocks.finalize).toHaveBeenCalledWith('run-one', 'user-one');
  });

  it.each(['failed', 'cancelled', 'review'])('reconciles %s without requiring any terminal JSONL event', async status => {
    run.status = 'running';
    mocks.finalize.mockImplementation(async () => { run.status = status; });
    const body = await (await get()).text();
    expect(body).toContain(`"status":"${status}"`);
  });

  it('authenticates and checks ownership before cursor validation or artifact access', async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await get(request('?after=invalid'))).status).toBe(401);
    expect(mocks.find).not.toHaveBeenCalled();
    mocks.auth.mockResolvedValue({ userId: 'other-user' });
    expect((await get(request('?after=invalid'))).status).toBe(404);
    expect(mocks.finalize).not.toHaveBeenCalled();
  });

  it('invalid, foreign-run and conflicting cursors fail before starting the stream', async () => {
    fs.writeFileSync(file, line({ event: 'done' }));
    const [record] = await collect();
    for (const req of [request('?after='), request('?after=garbage'),
      request(`?after=${record.id.replace(scope, deskCursorScope('user-one', 'other-run'))}`),
      request(`?after=${record.id}&after=${record.id}`), request(`?after=${record.id}`, { 'Last-Event-ID': 'different' })]) {
      expect((await get(req)).status).toBe(400);
    }
    expect(mocks.finalize).not.toHaveBeenCalled();
  });

  it.each(['body', 'request'])('a dropped %s stops file following without cancelling or signalling Python', async kind => {
    run.status = 'running';
    fs.writeFileSync(file, line({ event: 'phase', ticker: 'AAPL' }));
    const abort = new AbortController();
    const response = await get(request('', undefined, abort.signal));
    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    if (kind === 'body') await reader.cancel(); else abort.abort();
    await new Promise(resolve => setTimeout(resolve, 20));
    const count = mocks.finalize.mock.calls.length;
    await new Promise(resolve => setTimeout(resolve, 450));
    expect(mocks.finalize).toHaveBeenCalledTimes(count);
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    await reader.cancel();
  });
});
