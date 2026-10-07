import fs from 'fs';
import os from 'os';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deskResumeInput, type DeskSavedCheckpoint } from './types';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), first: vi.fn(), many: vi.fn(), create: vi.fn(),
  start: vi.fn(), rate: vi.fn(), command: vi.fn(), users: [] as string[], inLock: false }));
vi.mock('@/lib/desk/access', () => ({ requireDeskAccess: mocks.auth }));
vi.mock('@/lib/desk/rate-limit', () => ({ consumeDeskRateLimit: mocks.rate }));
vi.mock('@/lib/prisma', () => ({ prisma: { deskRun: { findFirst: mocks.first, findMany: mocks.many,
  create: mocks.create, findUnique: vi.fn().mockResolvedValue(null) } } }));
vi.mock('@/lib/desk/runner', async importOriginal => ({ ...await importOriginal<typeof import('./runner')>(),
  startDeskRun: mocks.start, reapOrphanDeskRuns: vi.fn(),
  withDeskCheckpointControl: async (user: string, work: any) => {
    mocks.users.push(user); mocks.inLock = true;
    try { return await work(mocks.command); } finally { mocks.inLock = false; }
  },
}));
import { GET, DELETE } from '../../app/api/desk/checkpoints/route';
import { POST } from '../../app/api/desk/runs/route';
import { DeskCheckpointConflict } from './runner';

let root: string;
const saved: DeskSavedCheckpoint = { ticker: 'AAPL', asOf: '2026-10-01', depth: 'deep',
  analysts: ['market', 'news'], assetType: 'crypto', threadId: '0123456789abcdef', checkpointId: 'checkpoint-one', step: 3 };
const req = (method: string, body?: unknown, query = '') => new NextRequest(`http://localhost/api/desk/checkpoints${query}`, {
  method, ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
});

beforeEach(() => {
  vi.clearAllMocks(); mocks.users.length = 0; mocks.inLock = false;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'desk10-routes-')); vi.stubEnv('DESK_DATA_ROOT', root);
  mocks.auth.mockResolvedValue({ userId: 'user-one', key: { key: 'fresh-auth-key' } });
  mocks.first.mockResolvedValue(null); mocks.many.mockResolvedValue([]);
  mocks.rate.mockReturnValue({ allowed: true });
  mocks.create.mockImplementation(async ({ data }) => {
    expect(mocks.inLock).toBe(true); return { ...data, id: 'run-one' };
  });
  mocks.command.mockImplementation(async ({ command }) => {
    expect(mocks.inLock).toBe(true);
    if (command === 'list') return [{ ticker: 'AAPL', exists: true, reason: null, checkpoints: [saved] }];
    return { deleted: true };
  });
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

describe('scoped checkpoint routes and restored launch', () => {
  it('restores every form choice and the exact checkpoint reference', () => {
    expect(deskResumeInput(saved)).toEqual({ tickers: ['AAPL'], asOf: saved.asOf, depth: 'deep',
      analysts: ['market', 'news'], assetType: 'crypto', checkpoint: true,
      resume: { ticker: 'AAPL', threadId: saved.threadId, checkpointId: saved.checkpointId } });
  });
  it('hides resume for DB-queued state and preserves explanatory reasons for non-resumable DBs', async () => {
    mocks.many.mockResolvedValue([{ tickers: ['AAPL'] }]);
    expect(await (await GET(req('GET', undefined, '?tickers=AAPL'))).json()).toMatchObject({ tickers: [], checkpoints: [{ checkpoints: [], reason: expect.stringContaining('queued/running') }] });
    mocks.many.mockResolvedValue([]);
    mocks.command.mockResolvedValue([{ ticker: 'AAPL', exists: true, checkpoints: [], reason: 'Completed rows removed' }]);
    expect(await (await GET(req('GET', undefined, '?tickers=AAPL'))).json()).toMatchObject({ tickers: [] });
  });
  it.each(['queued', 'running'])('Clear rejects %s under the launch lock', async status => {
    mocks.first.mockImplementation(async ({ where }) => {
      expect(mocks.inLock).toBe(true);
      expect(where).toEqual({ userId: 'user-one', status: { in: ['queued', 'running'] }, tickers: { has: 'AAPL' } });
      return { id: 'active', status };
    });
    expect((await DELETE(req('DELETE', { ticker: 'AAPL' }))).status).toBe(409);
    expect(mocks.command).not.toHaveBeenCalled();
  });
  it('durable supervisor or concurrent-launch conflicts become 409 without deleting', async () => {
    mocks.command.mockRejectedValue(new DeskCheckpointConflict('Owned supervisor still retiring'));
    expect((await DELETE(req('DELETE', { ticker: 'AAPL' }))).status).toBe(409);
  });
  it('Resume stays rate limited, verifies actual state before insert, and uses a fresh key', async () => {
    const input = deskResumeInput(saved);
    const response = await POST(req('POST', input));
    expect(response.status).toBe(201);
    expect(mocks.rate).toHaveBeenCalledWith('user-one', 'deep');
    expect(mocks.command.mock.calls.map(c => c[0].command)).toEqual(['restore', 'reserve']);
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ ...input, userId: 'user-one', openRouterKey: 'fresh-auth-key' }));
    expect(JSON.stringify(mocks.create.mock.calls)).not.toContain('fresh-auth-key');
  });
  it('rate rejection and auth rejection do not acquire checkpoint ownership', async () => {
    mocks.rate.mockReturnValue({ allowed: false, bucket: 'desk', remaining: 0, resetAt: Date.now(), retryAfterSec: 5 });
    expect((await POST(req('POST', deskResumeInput(saved)))).status).toBe(429);
    mocks.auth.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    expect((await GET(req('GET'))).status).toBe(401);
    expect((await DELETE(req('DELETE', { ticker: 'AAPL' }))).status).toBe(401);
    expect((await POST(req('POST', deskResumeInput(saved)))).status).toBe(401);
    expect(mocks.users).toEqual([]);
  });
  it.each(['../AAPL', 'CON', 'AAPL.'])('rejects unsafe ticker %s before coordination', async ticker => {
    expect((await DELETE(req('DELETE', { ticker }))).status).toBe(400);
    expect((await GET(req('GET', undefined, `?tickers=${encodeURIComponent(ticker)}`))).status).toBe(400);
    expect(mocks.users).toEqual([]);
  });
  it('rejects linked checkpoint directories before inspection or deletion', async () => {
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'AAPL.db'), 'untouched');
    const cache = path.join(root, 'user-one', 'cache'); fs.mkdirSync(cache, { recursive: true });
    fs.symlinkSync(outside, path.join(cache, 'checkpoints'), process.platform === 'win32' ? 'junction' : 'dir');
    expect((await GET(req('GET', undefined, '?tickers=AAPL'))).status).toBe(503);
    expect((await DELETE(req('DELETE', { ticker: 'AAPL' }))).status).toBe(503);
    expect(mocks.users).toEqual([]);
    expect(fs.readFileSync(path.join(outside, 'AAPL.db'), 'utf8')).toBe('untouched');
  });
});

describe('real keyless checkpoint lease bridge', () => {
  it('holds the OS lock across an async callback, rejects a rival clear, and releases it', async () => {
    const actual = await vi.importActual<typeof import('./runner')>('./runner');
    vi.stubEnv('OPENROUTER_API_KEY', 'sentinel-do-not-forward');
    await actual.withDeskCheckpointControl('user-one', async control => {
      await control({ command: 'reserve', tickers: ['AAPL'] });
      await expect(actual.withDeskCheckpointControl('user-one', async rival => rival({ command: 'clear', ticker: 'AAPL' }))).rejects.toThrow(/busy/);
    });
    const result = await actual.withDeskCheckpointControl('user-one', async control => control({ command: 'clear', ticker: 'AAPL' }));
    expect(result).toEqual({ ticker: 'AAPL', deleted: false });
  }, 15000);
});
