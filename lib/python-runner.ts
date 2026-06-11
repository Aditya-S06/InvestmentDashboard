import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

const SCRIPT_PATH = path.join(process.cwd(), 'scripts', 'market_data.py');

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

export function runPython(args: string[]): Promise<any> {
  const python = getPythonExecutable();

  return new Promise((resolve, reject) => {
    execFile(python, [SCRIPT_PATH, ...args], { timeout: 30000, maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => {
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
    });
  });
}
