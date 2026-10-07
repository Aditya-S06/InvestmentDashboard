import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runPython, runWebull, runYoutube } from './python-runner';
import { runtimeEnv } from './subprocess-env';

vi.mock('child_process', () => ({ execFile: vi.fn() }));

const originalEnv = process.env;
const stdin = { write: vi.fn(), end: vi.fn() };

beforeEach(() => {
  process.env = {
    NODE_ENV: 'test',
    PATH: 'sentinel-path', SystemRoot: 'C:\\Windows', TEMP: 'sentinel-temp',
    DATABASE_URL: 'sentinel-db', DIRECT_URL: 'sentinel-direct', NEXTAUTH_SECRET: 'sentinel-auth',
    OPENAI_API_KEY: 'sentinel-openai', ANTHROPIC_API_KEY: 'sentinel-anthropic',
    AWS_SECRET_ACCESS_KEY: 'sentinel-aws', FUTURE_SECRET: 'sentinel-future',
    WEBULL_APP_KEY: 'sentinel-generic-key', WEBULL_APP_SECRET: 'sentinel-generic-secret',
    WEBULL_APP_KEY_SANDBOX: 'sentinel-sandbox-key', WEBULL_APP_SECRET_SANDBOX: 'sentinel-sandbox-secret',
    WEBULL_APP_KEY_PROD: 'sentinel-prod-key', WEBULL_APP_SECRET_PROD: 'sentinel-prod-secret',
    WEBULL_REGION_ID: 'us', WEBULL_ENVIRONMENT: 'sandbox', WEBULL_RATE_LIMIT_PER_MIN: '24',
    WEBULL_TOKEN_DIR: 'sentinel-token-dir', WEBULL_TRADING_ENABLED: 'false', WEBULL_LIVE_TRADING_ENABLED: 'false',
    WEBULL_MAX_QTY: '17', WEBULL_MAX_NOTIONAL_USD: '1700',
    YOUTUBE_API_KEY: 'sentinel-youtube', OPENROUTER_API_KEY: 'sentinel-router',
    YOUTUBE_CACHE_DIR: 'sentinel-cache', YOUTUBE_CHANNELS_FILE: 'sentinel-channels',
    YOUTUBE_POLL_SINCE_DAYS: '3', YOUTUBE_RATE_LIMIT_PER_MIN: '23', YOUTUBE_SUMMARY_MODEL: 'sentinel-model',
    FRED_API_KEY: 'sentinel-fred', DESK_DEEP_MODEL: 'sentinel-desk',
    PYTHONPATH: 'sentinel-untrusted',
  };
  vi.spyOn(fs, 'existsSync').mockReturnValue(true);
  vi.mocked(execFile).mockImplementation((...args: any[]) => {
    args[3](null, '{"ok":true}', '');
    return { stdin } as any;
  });
});

afterEach(() => {
  process.env = originalEnv;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function lastCall() {
  const [python, args, options] = vi.mocked(execFile).mock.calls.at(-1)!;
  return { python, args: args as string[], options: options as { env: NodeJS.ProcessEnv; timeout: number } };
}

describe('actual execFile boundaries (mocked, no Python or broker execution)', () => {
  it.each(['ticker', 'historical', 'full', 'cards', 'macro', 'search', 'risk', 'sentiment'])(
    'gives market action %s only runtime variables', async (action) => {
      await runPython([action, 'TEST']);
      const { args, options } = lastCall();
      expect(args).toEqual([path.join(process.cwd(), 'scripts', 'market_data.py'), action, 'TEST']);
      expect(options.env).toEqual(runtimeEnv());
      expect(options.timeout).toBe(action === 'cards' ? 120000 : 30000);
    },
  );

  it.each(['sandbox', 'uat', 'test', 'prod', 'production', 'live', '', 'unexpected', ' SANDBOX '])(
    'preserves Python credential selection for environment %j', async (environment) => {
      process.env.WEBULL_ENVIRONMENT = environment;
      await runWebull(['accounts']);
      const { args, options } = lastCall();
      const sandbox = ['sandbox', 'uat', 'test'].includes(environment.trim().toLowerCase());
      const suffix = sandbox ? 'SANDBOX' : 'PROD';
      expect(args[0]).toBe(path.join(process.cwd(), 'scripts', 'webull_client.py'));
      expect(options.env).toEqual({
        ...runtimeEnv(),
        [`WEBULL_APP_KEY_${suffix}`]: sandbox ? 'sentinel-sandbox-key' : 'sentinel-prod-key',
        [`WEBULL_APP_SECRET_${suffix}`]: sandbox ? 'sentinel-sandbox-secret' : 'sentinel-prod-secret',
        WEBULL_REGION_ID: 'us', WEBULL_ENVIRONMENT: environment, WEBULL_RATE_LIMIT_PER_MIN: '24',
        WEBULL_TOKEN_DIR: 'sentinel-token-dir', WEBULL_TRADING_ENABLED: 'false', WEBULL_LIVE_TRADING_ENABLED: 'false',
      });
    },
  );

  it('keeps per-field credential fallback, defaults, stdin and timeout behavior', async () => {
    delete process.env.WEBULL_ENVIRONMENT;
    process.env.WEBULL_APP_KEY_SANDBOX = '  ';
    delete process.env.WEBULL_APP_SECRET_SANDBOX;
    for (const key of ['WEBULL_TOKEN_DIR', 'WEBULL_RATE_LIMIT_PER_MIN', 'WEBULL_REGION_ID',
      'WEBULL_TRADING_ENABLED', 'WEBULL_LIVE_TRADING_ENABLED']) delete process.env[key];
    await runWebull(['accounts'], { stdinJson: { sentinel: true }, timeoutMs: 12345 });
    expect(lastCall().options).toMatchObject({ timeout: 12345, env: {
      WEBULL_ENVIRONMENT: 'sandbox', WEBULL_APP_KEY_SANDBOX: 'sentinel-generic-key',
      WEBULL_APP_SECRET_SANDBOX: 'sentinel-generic-secret', WEBULL_REGION_ID: 'us',
      WEBULL_TOKEN_DIR: path.join(process.cwd(), 'conf'), WEBULL_RATE_LIMIT_PER_MIN: '30',
      WEBULL_TRADING_ENABLED: 'false', WEBULL_LIVE_TRADING_ENABLED: 'false',
    } });
    expect(stdin.write).toHaveBeenCalledWith('{"sentinel":true}');
    expect(stdin.end).toHaveBeenCalledOnce();
  });

  it.each([false, true])('isolates YouTube keys, including legacy routing=%s', async (legacy) => {
    if (legacy) await runPython(['youtube', 'video', 'test-video']);
    else await runYoutube(['video', 'test-video']);
    const { args, options } = lastCall();
    expect(args).toEqual([path.join(process.cwd(), 'scripts', 'youtube_ingest.py'), 'video', 'test-video']);
    expect(options.env).toEqual({
      ...runtimeEnv(), YOUTUBE_API_KEY: 'sentinel-youtube', OPENROUTER_API_KEY: 'sentinel-router',
      YOUTUBE_CACHE_DIR: 'sentinel-cache', YOUTUBE_CHANNELS_FILE: 'sentinel-channels',
      YOUTUBE_POLL_SINCE_DAYS: '3', YOUTUBE_RATE_LIMIT_PER_MIN: '23', YOUTUBE_SUMMARY_MODEL: 'sentinel-model',
    });
    expect(options.timeout).toBe(180000);
  });
});
