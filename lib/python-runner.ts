import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

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
  return {
    ...process.env,
    WEBULL_APP_KEY: process.env.WEBULL_APP_KEY ?? '',
    WEBULL_APP_SECRET: process.env.WEBULL_APP_SECRET ?? '',
    WEBULL_APP_KEY_SANDBOX: process.env.WEBULL_APP_KEY_SANDBOX ?? '',
    WEBULL_APP_SECRET_SANDBOX: process.env.WEBULL_APP_SECRET_SANDBOX ?? '',
    WEBULL_APP_KEY_PROD: process.env.WEBULL_APP_KEY_PROD ?? '',
    WEBULL_APP_SECRET_PROD: process.env.WEBULL_APP_SECRET_PROD ?? '',
    WEBULL_REGION_ID: process.env.WEBULL_REGION_ID ?? 'us',
    WEBULL_ENVIRONMENT: process.env.WEBULL_ENVIRONMENT ?? 'sandbox',
    WEBULL_RATE_LIMIT_PER_MIN: process.env.WEBULL_RATE_LIMIT_PER_MIN ?? '30',
    WEBULL_TOKEN_DIR: process.env.WEBULL_TOKEN_DIR ?? path.join(process.cwd(), 'conf'),
    WEBULL_TRADING_ENABLED: process.env.WEBULL_TRADING_ENABLED ?? 'false',
    WEBULL_LIVE_TRADING_ENABLED: process.env.WEBULL_LIVE_TRADING_ENABLED ?? 'false',
  };
}

function youtubeEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY ?? '',
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? '',
    YOUTUBE_CACHE_DIR: process.env.YOUTUBE_CACHE_DIR ?? path.join(process.cwd(), 'data'),
    YOUTUBE_CHANNELS_FILE: process.env.YOUTUBE_CHANNELS_FILE ?? path.join(process.cwd(), 'conf', 'youtube_channels.json'),
    YOUTUBE_POLL_SINCE_DAYS: process.env.YOUTUBE_POLL_SINCE_DAYS ?? '2',
    YOUTUBE_RATE_LIMIT_PER_MIN: process.env.YOUTUBE_RATE_LIMIT_PER_MIN ?? '30',
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
  env?: NodeJS.ProcessEnv,
  timeoutMs = 30000,
  options?: RunScriptOptions,
): Promise<any> {
  const python = getPythonExecutable();

  return new Promise((resolve, reject) => {
    const child = execFile(
      python,
      [scriptPath, ...args],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 10, env: env ?? process.env, encoding: 'utf8' },
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
  // YouTube passthrough and multi-symbol card batches outlast a single quote.
  youtube: 180000,
  cards: 120000,
};

export function runPython(args: string[]): Promise<any> {
  return runScript(MARKET_SCRIPT, args, webullEnv(), MARKET_TIMEOUTS_MS[args[0]] ?? 30000);
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
