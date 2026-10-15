import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(), readChannelsConfig: vi.fn(), listYoutubeSummaries: vi.fn(),
  query: vi.fn(), runPython: vi.fn(), logServerError: vi.fn(),
}));
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/youtube/channels', () => ({
  readChannelsConfig: mocks.readChannelsConfig, writeChannelsConfig: vi.fn(), youtubeApiConfigured: () => true,
}));
vi.mock('@/lib/youtube/db', () => ({ listYoutubeSummaries: mocks.listYoutubeSummaries }));
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: mocks.query } }));
vi.mock('@/lib/python-runner', () => ({ runPython: mocks.runPython }));
vi.mock('@/lib/http/errors', () => ({ logServerError: mocks.logServerError, serverError: vi.fn() }));
vi.mock('@/lib/webull/config', () => ({
  getWebullEnvironment: () => 'sandbox', isTradingEnabled: () => false, isWebullConfigured: () => false,
}));

import { GET as channels } from '@/app/api/youtube/channels/route';
import { GET as summaries } from '@/app/api/youtube/summaries/route';
import { GET as health } from '@/app/api/health/route';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAdmin.mockResolvedValue({ ok: true, userId: 'operator', email: 'operator@example.test', role: 'admin' });
  mocks.readChannelsConfig.mockReturnValue({ channels: ['private-channel'] });
  mocks.listYoutubeSummaries.mockResolvedValue([{ id: 'private-summary' }]);
  mocks.query.mockResolvedValue([{ value: 1 }]);
  mocks.runPython.mockResolvedValue({ price: 100 });
});

describe('operator containment', () => {
  it.each([401, 403])('denies protected reads with %i before accessing data or providers', async status => {
    mocks.requireAdmin.mockImplementation(async () => ({ error: NextResponse.json({ error: 'Denied' }, { status }) }));
    for (const response of [await channels(), await summaries(new NextRequest('http://localhost/api/youtube/summaries')), await health()]) {
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: 'Denied' });
    }
    expect(mocks.readChannelsConfig).not.toHaveBeenCalled();
    expect(mocks.listYoutubeSummaries).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.runPython).not.toHaveBeenCalled();
  });
  it('preserves admin access to channels and summaries', async () => {
    expect((await (await channels()).json()).channels).toEqual(['private-channel']);
    const response = await summaries(new NextRequest('http://localhost/api/youtube/summaries?channel=private-channel&limit=3'));
    expect(await response.json()).toEqual({ items: [{ id: 'private-summary' }], count: 1 });
    expect(mocks.listYoutubeSummaries).toHaveBeenCalledWith(expect.objectContaining({ channel: 'private-channel', limit: 3 }));
  });
  it('keeps database and Python diagnostic details out of health responses', async () => {
    const dbError = new Error('postgresql://secret@private-host/internal');
    const pythonError = new Error('private-path/provider-secret');
    mocks.query.mockRejectedValue(dbError);
    mocks.runPython.mockRejectedValue(pythonError);
    const response = await health();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.checks).toEqual(expect.arrayContaining([
      { name: 'database', ok: false, detail: 'Database unavailable' },
      { name: 'python', ok: false, detail: 'Market data check failed' },
    ]));
    expect(JSON.stringify(body)).not.toMatch(/private|secret|postgresql/);
    expect(mocks.logServerError).toHaveBeenCalledWith('health/database', dbError);
    expect(mocks.logServerError).toHaveBeenCalledWith('health/python', pythonError);
  });
  it('preserves healthy admin health responses', async () => {
    const response = await health();
    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
  });
});
