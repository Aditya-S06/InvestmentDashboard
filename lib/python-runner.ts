import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

const MARKET_SCRIPT = path.join(process.cwd(), 'scripts', 'market_data.py');
const WEBULL_SCRIPT = path.join(process.cwd(), 'scripts', 'webull_client.py');

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
    WEBULL_REGION_ID: process.env.WEBULL_REGION_ID ?? 'us',
    WEBULL_ENVIRONMENT: process.env.WEBULL_ENVIRONMENT ?? 'prod',
    WEBULL_RATE_LIMIT_PER_MIN: process.env.WEBULL_RATE_LIMIT_PER_MIN ?? '30',
    WEBULL_TOKEN_DIR: process.env.WEBULL_TOKEN_DIR ?? path.join(process.cwd(), 'conf'),
  };
}

function runScript(scriptPath: string, args: string[], env?: NodeJS.ProcessEnv): Promise<any> {
  const python = getPythonExecutable();

  return new Promise((resolve, reject) => {
    execFile(
      python,
      [scriptPath, ...args],
      { timeout: 30000, maxBuffer: 1024 * 1024 * 5, env: env ?? process.env },
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
          resolve({ raw: stdout });
        }
      },
    );
  });
}

export function runPython(args: string[]): Promise<any> {
  return runScript(MARKET_SCRIPT, args, webullEnv());
}

export function runWebull(args: string[]): Promise<any> {
  return runScript(WEBULL_SCRIPT, args, webullEnv());
}
