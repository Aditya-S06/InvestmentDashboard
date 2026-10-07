import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { runtimeEnv } from '@/lib/subprocess-env';

const MARKET_SCRIPT = path.join(process.cwd(), 'scripts', 'market_data.py');
const WEBULL_SCRIPT = path.join(process.cwd(), 'scripts', 'webull_client.py');
const YOUTUBE_SCRIPT = path.join(process.cwd(), 'scripts', 'youtube_ingest.py');

function getPythonExecutable(): string {
  const venvCandidates =
    process.platform === 'win32'
      ? [path.join(process.cwd(), '.venv', 'Scripts', 'python.exe')]
      : [path.join(process.cwd(), '.venv', 'bin', 'python3'), path.join(process.cwd(), '.venv', 'bin', 'python')];

  for (const candidate of venvCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return process.platform === 'win32' ? 'python' : 'python3';
}

function webullEnv(): NodeJS.ProcessEnv {
  // Match webull_client.py's environment aliases and per-field fallback exactly.
  const environment = process.env.WEBULL_ENVIRONMENT ?? 'sandbox';
  const sandbox = ['sandbox', 'uat', 'test'].includes((environment || 'prod').trim().toLowerCase());
  const suffix = sandbox ? 'SANDBOX' : 'PROD';
  const key = (process.env[`WEBULL_APP_KEY_${suffix}`] || '').trim() || (process.env.WEBULL_APP_KEY || '').trim();
  const secret = (process.env[`WEBULL_APP_SECRET_${suffix}`] || '').trim() || (process.env.WEBULL_APP_SECRET || '').trim();
  return {
    ...runtimeEnv(),
    [`WEBULL_APP_KEY_${suffix}`]: key,
    [`WEBULL_APP_SECRET_${suffix}`]: secret,
    WEBULL_REGION_ID: process.env.WEBULL_REGION_ID ?? 'us',
    WEBULL_ENVIRONMENT: environment,
    WEBULL_RATE_LIMIT_PER_MIN: process.env.WEBULL_RATE_LIMIT_PER_MIN ?? '30',
    WEBULL_TOKEN_DIR: process.env.WEBULL_TOKEN_DIR ?? path.join(process.cwd(), 'conf'),
    WEBULL_TRADING_ENABLED: process.env.WEBULL_TRADING_ENABLED ?? 'false',
    WEBULL_LIVE_TRADING_ENABLED: process.env.WEBULL_LIVE_TRADING_ENABLED ?? 'false',
  };
}

function youtubeEnv(): NodeJS.ProcessEnv {
  return {
    ...runtimeEnv(),
    YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY ?? '',
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? '',
    YOUTUBE_CACHE_DIR: process.env.YOUTUBE_CACHE_DIR ?? path.join(process.cwd(), 'data'),
    YOUTUBE_CHANNELS_FILE: process.env.YOUTUBE_CHANNELS_FILE ?? path.join(process.cwd(), 'conf', 'youtube_channels.json'),
    YOUTUBE_POLL_SINCE_DAYS: process.env.YOUTUBE_POLL_SINCE_DAYS ?? '2',
    YOUTUBE_RATE_LIMIT_PER_MIN: process.env.YOUTUBE_RATE_LIMIT_PER_MIN ?? '30',
    YOUTUBE_SUMMARY_MODEL: process.env.YOUTUBE_SUMMARY_MODEL ?? '',
  };
}

function snippet(text: string, max = 400): string {
  return (text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

type RunScriptOptions = {
  strictJson?: boolean;
  stdinJson?: unknown;
};

function runScript(
  scriptPath: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs = 30000,
  options?: RunScriptOptions,
): Promise<any> {
  const python = getPythonExecutable();

  return new Promise((resolve, reject) => {
    const child = execFile(
      python,
      [scriptPath, ...args],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 10, env, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) {
          console.error('Python error:', stderr);
          reject(new Error(stderr || error?.message || 'Python script failed'));
          return;
        }
        try {
          const result = JSON.parse(stdout?.trim() || '{}');
          resolve(result);
        } catch {
          if (options?.strictJson) {
            reject(
              new Error(
                `Python stdout was not JSON. stderr=${snippet(stderr)} stdout=${snippet(stdout)}`,
              ),
            );
            return;
          }
          resolve({ raw: stdout });
        }
      },
    );

    if (options?.stdinJson !== undefined) {
      child.stdin?.write(JSON.stringify(options.stdinJson));
      child.stdin?.end();
    }
  });
}

const MARKET_TIMEOUTS_MS: Record<string, number> = {
  // Multi-symbol card batches outlast a single quote.
  cards: 120000,
};

export function runPython(args: string[]): Promise<any> {
  // Legacy callers must use the YouTube boundary, never give its keys to market_data.py.
  if (args[0] === 'youtube') return runYoutube(args.slice(1));
  return runScript(MARKET_SCRIPT, args, runtimeEnv(), MARKET_TIMEOUTS_MS[args[0]] ?? 30000);
}

export function runWebull(
  args: string[],
  options?: { stdinJson?: unknown; timeoutMs?: number },
): Promise<any> {
  return runScript(WEBULL_SCRIPT, args, webullEnv(), options?.timeoutMs ?? 30000, {
    strictJson: true,
    stdinJson: options?.stdinJson,
  });
}

/** Direct YouTube ingest CLI — preferred for poll/ingest API routes (180s timeout). */
export function runYoutube(args: string[]): Promise<any> {
  return runScript(YOUTUBE_SCRIPT, args, youtubeEnv(), 180000);
}
