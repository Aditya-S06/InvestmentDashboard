import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startDeskRun } from './runner';
import { runtimeEnv } from '../subprocess-env';
import { prisma } from '@/lib/prisma';

vi.mock('child_process', () => ({ spawn: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { deskRun: {
  findFirst: vi.fn().mockImplementation(async () => ({
    id: 'test-run', userId: 'test-user', tickers: ['TEST'], status: 'queued',
    finalState: null, signal: null, updatedAt: new Date(0), asOf: '2026-09-16',
  })),
  updateMany: vi.fn().mockResolvedValue({ count: 1 }),
} } }));

const originalEnv = process.env;

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(prisma.deskRun.findFirst).mockResolvedValue({
    id: 'test-run', userId: 'test-user', tickers: ['TEST'], status: 'queued',
    finalState: null, signal: null, updatedAt: new Date(0), asOf: '2026-09-16',
  } as any);
  vi.mocked(prisma.deskRun.updateMany).mockResolvedValue({ count: 1 });
  process.env = {
    NODE_ENV: 'test',
    PATH: 'sentinel-path', SystemRoot: 'C:\\Windows', TEMP: 'sentinel-temp',
    DATABASE_URL: 'sentinel-db', DIRECT_URL: 'sentinel-direct', NEXTAUTH_SECRET: 'sentinel-auth',
    WEBULL_APP_KEY_PROD: 'sentinel-broker-key', WEBULL_APP_SECRET_PROD: 'sentinel-broker-secret',
    YOUTUBE_API_KEY: 'sentinel-youtube', OPENAI_API_KEY: 'sentinel-openai',
    ANTHROPIC_API_KEY: 'sentinel-anthropic', ALPHA_VANTAGE_API_KEY: 'sentinel-unused-vendor',
    AWS_SECRET_ACCESS_KEY: 'sentinel-aws', FUTURE_SECRET: 'sentinel-future',
    OPENROUTER_API_KEY: 'sentinel-parent-router', OPENROUTER_BASE_URL: ' https://router.test/v1 ',
    DESK_DEEP_MODEL: ' sentinel-deep ', DESK_QUICK_MODEL: ' sentinel-quick ',
    DESK_DATA_ROOT: path.join(process.cwd(), 'sentinel-desk-root'), DESK_RATE_LIMIT_PER_HOUR: '9',
    TRADINGAGENTS_OUTPUT_LANGUAGE: 'English', TRADINGAGENTS_BENCHMARK_TICKER: 'TEST',
    TRADINGAGENTS_TEMPERATURE: '0.2', TRADINGAGENTS_LLM_MAX_RETRIES: '3', TRADINGAGENTS_MAX_TOKENS: '1024',
    TRADINGAGENTS_RESULTS_DIR: 'untrusted-results', TRADINGAGENTS_CACHE_DIR: 'untrusted-cache',
    TRADINGAGENTS_MEMORY_LOG_PATH: 'untrusted-memory', TRADINGAGENTS_CHECKPOINT_ENABLED: 'false',
    TRADINGAGENTS_LLM_PROVIDER: 'unrelated-provider', FRED_API_KEY: 'sentinel-fred',
    PYTHONPATH: 'untrusted-path', PYTHON_DOTENV_DISABLED: '0',
  };
  vi.spyOn(fs, 'existsSync').mockImplementation(file => !String(file).endsWith('manifest.json'));
  vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
  vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);
  vi.spyOn(fs, 'openSync').mockReturnValue(17);
  vi.spyOn(fs, 'closeSync').mockReturnValue(undefined);
  vi.spyOn(fs, 'fsyncSync').mockReturnValue(undefined);
  vi.spyOn(fs, 'renameSync').mockReturnValue(undefined);
  vi.spyOn(fs, 'unlinkSync').mockReturnValue(undefined);
  vi.mocked(spawn).mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { pid: 123, unref: vi.fn() });
    Promise.resolve().then(() => child.emit('spawn'));
    return child as any;
  });
});

afterEach(() => {
  process.env = originalEnv;
  vi.clearAllTimers();
  vi.useRealTimers();
  (globalThis as any).deskChildren?.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('Desk spawn environment', () => {
  it.each([false, true])('keeps required settings and per-user paths with checkpoint=%s', async (checkpoint) => {
    await startDeskRun({
      id: 'test-run', userId: 'test-user', tickers: ['TEST'], asOf: '2026-09-16', depth: 'fast',
      analysts: ['market', 'news'], assetType: 'stock', checkpoint, openRouterKey: 'sentinel-user-router',
    });
    const [python, args, options] = vi.mocked(spawn).mock.calls[0];
    const root = path.join(process.cwd(), 'sentinel-desk-root', 'test-user');
    expect(python).toContain(path.join('TradingAgents', '.venv'));
    expect(args).toContain(path.join(process.cwd(), 'scripts', 'desk_supervisor.py'));
    expect(args).toContain('run');
    expect(JSON.stringify(args)).not.toContain('sentinel-user-router');
    expect(options).toMatchObject({ detached: true, windowsHide: true, cwd: process.cwd() });
    expect(options?.env).toEqual({
      ...runtimeEnv(), OPENROUTER_API_KEY: 'sentinel-user-router', OPENROUTER_BASE_URL: 'https://router.test/v1',
      DESK_DEEP_MODEL: 'sentinel-deep', DESK_QUICK_MODEL: 'sentinel-quick',
      TRADINGAGENTS_OUTPUT_LANGUAGE: 'English', TRADINGAGENTS_BENCHMARK_TICKER: 'TEST',
      TRADINGAGENTS_TEMPERATURE: '0.2', TRADINGAGENTS_LLM_MAX_RETRIES: '3', TRADINGAGENTS_MAX_TOKENS: '1024',
      FRED_API_KEY: 'sentinel-fred', PYTHONPATH: path.join(process.cwd(), 'TradingAgents'),
      TRADINGAGENTS_RESULTS_DIR: path.join(root, 'test-run'), TRADINGAGENTS_CACHE_DIR: path.join(root, 'cache'),
      TRADINGAGENTS_MEMORY_LOG_PATH: path.join(root, 'trading_memory.md'),
      TRADINGAGENTS_CHECKPOINT_ENABLED: String(checkpoint),
    });
  });
});
