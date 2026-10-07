import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PRIVATE_FILES, checkPrivate, provisionPrivate } from '../scripts/provision-private.mjs';

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Explicit intended additions only: no recursive workspace copy or ignored files.
export const additions = [
  'SECURITY.md', 'lib/auth/admin.ts', 'lib/auth/admin.test.ts',
  'scripts/provision-private.mjs', 'test/setup.test.mjs',
  'lib/subprocess-env.ts', 'lib/subprocess-env.test.ts', 'lib/python-runner.test.ts',
  'lib/desk/runner.test.ts', 'scripts/subprocess_env.py', 'test/test_subprocess_env.py',
  'lib/desk/report.test.ts', 'lib/desk/multi-runner.test.ts', 'lib/desk/routes.test.ts',
  'lib/desk/report-actions.test.ts',
  'lib/desk/stream-state.test.ts', 'lib/desk/run-page.test.ts', 'lib/desk/ui-markup.test.ts',
  'lib/desk/stream-protocol.ts', 'lib/desk/stream-file.ts', 'lib/desk/stream-client.ts', 'lib/desk/stream-state.ts',
  'lib/desk/stream.test.ts', 'lib/desk/stream-client.test.ts',
  'scripts/desk_process.py', 'scripts/desk_graph_host.py', 'scripts/desk_supervisor.py',
  'scripts/desk_checkpoint.py', 'test/test_desk_checkpoints.py', 'lib/desk/checkpoints.test.ts',
  'test/desk_fixture_graph.py', 'test/desk_fixture_supervisor.py', 'test/test_desk_lifecycle.py',
  'lib/desk/acceptance.test.ts', 'test/desk_fixture_checkpoint.py', 'test/desk-owned-children.ts',
  'scripts/desk_tool_safety.py', 'scripts/desk_memory.py',
  'test/desk_fixture_safety.py', 'test/test_desk_safety.py',
  'lib/desk/python-safety.test.ts',
  'lib/desk/limits.ts', 'test/test_desk_efficiency.py',
];
export function write(root, name, body) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}
export function gitFiles(root) {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
}
export function fixtureBundle(bundle) {
  for (const file of PRIVATE_FILES) {
    if (file.endsWith('.md')) { write(bundle, file, 'TEST ONLY: sentinel prompt, never production.'); continue; }
    const example = file.replace(/\.ts$/, '.example.ts');
    let body = fs.readFileSync(path.join(repo, example), 'utf8')
      .replace(/\/\*\*[\s\S]*?\*\//g, '')
      .replace(/^.*\/\/ TODO:.*$/gm, '');
    // Deliberately fail closed. No real research output or access is provided.
    if (file.endsWith('/orchestrator.ts')) body = body.slice(0, body.indexOf('export async function runInsightChat')) +
      'export async function runInsightChat(_input: RunInsightChatInput): Promise<RunInsightChatResult> { throw new Error("TEST ONLY private research sentinel"); }\n';
    write(bundle, file, body);
  }
  write(bundle, 'lib/insights/harness/skills/sentinel.md', 'TEST ONLY private skill');
  write(bundle, '.env', 'DO_NOT_COPY=sentinel');
  write(bundle, 'conf/token.txt', 'DO_NOT_COPY');
}

// Release verification reuses the exact source inventory and private provisioning.
// Importing these helpers must not also start the integration suite.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) test('tracked-files setup with explicit private sentinels; no DB/provider/real dotenv', { timeout: 360000 }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-desk7-'));
  const checkout = path.join(temp, 'checkout');
  const bundle = path.join(temp, 'private-bundle');
  fs.mkdirSync(checkout); fs.mkdirSync(bundle);
  try {
    for (const file of new Set([...gitFiles(repo), ...additions])) {
      if (file === 'TradingAgents') continue;
      assert(!PRIVATE_FILES.includes(file), `private file is tracked: ${file}`);
      assert(!/^\.env(?:\.|$)/.test(file) || file === '.env.example');
      write(checkout, file, fs.readFileSync(path.join(repo, file)));
    }
    assert(!fs.existsSync(path.join(checkout, '.env')));
    assert.throws(() => checkPrivate(checkout));
    assert.throws(() => provisionPrivate(checkout, bundle));
    fixtureBundle(bundle);
    // An unfinished public template is explicitly rejected.
    const original = fs.readFileSync(path.join(bundle, 'lib/insights/access.ts'));
    write(bundle, 'lib/insights/access.ts', fs.readFileSync(path.join(repo, 'lib/insights/access.example.ts')));
    assert.throws(() => provisionPrivate(checkout, bundle), /Unfinished template/);
    assert(!fs.existsSync(path.join(checkout, 'lib/insights/access.ts')));
    write(bundle, 'lib/insights/access.ts', original);
    provisionPrivate(checkout, bundle);
    assert.equal(checkPrivate(checkout).length, PRIVATE_FILES.length + 1);
    assert(!fs.existsSync(path.join(checkout, '.env')));
    assert(!fs.existsSync(path.join(checkout, 'conf/token.txt')));
    write(checkout, 'lib/insights/access.ts', `${original}\n// existing operator edit sentinel\n`);
    assert.throws(() => provisionPrivate(checkout, bundle), /Refusing to overwrite/);
    assert.match(fs.readFileSync(path.join(checkout, 'lib/insights/access.ts'), 'utf8'), /existing operator edit sentinel/);
    const second = path.join(temp, 'symlink-target');
    fs.mkdirSync(second);
    fs.symlinkSync(path.join(bundle, 'lib'), path.join(second, 'lib'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => provisionPrivate(second, bundle), /Symlink destination/);
    fs.unlinkSync(path.join(second, 'lib'));

    // Installed dependencies/generated client are documented prerequisites, not source.
    fs.symlinkSync(path.join(repo, 'node_modules'), path.join(checkout, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    // Reuse only the installed interpreter/dependencies for the real keyless
    // checkpoint lease test. No upstream dotenv or workspace artifacts copied.
    fs.mkdirSync(path.join(checkout, 'TradingAgents'), { recursive: true });
    fs.symlinkSync(path.join(repo, 'TradingAgents', '.venv'), path.join(checkout, 'TradingAgents', '.venv'), process.platform === 'win32' ? 'junction' : 'dir');
    write(checkout, 'next-env.d.ts', '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n');
    const env = {};
    for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) {
      const found = Object.keys(process.env).find(name => name.toLowerCase() === key.toLowerCase());
      if (found) env[key] = process.env[found];
    }
    Object.assign(env, { PYTHONDONTWRITEBYTECODE: '1', PYTHON_DOTENV_DISABLED: '1',
      DATABASE_URL: 'postgresql://sentinel:sentinel@127.0.0.1:1/sentinel',
      DIRECT_URL: 'postgresql://sentinel:sentinel@127.0.0.1:1/sentinel',
      NEXTAUTH_SECRET: 'offline-setup-sentinel-never-a-real-secret', NEXTAUTH_URL: 'http://localhost:3000' });
    const run = (exe, args) => {
      // Let the bounded acceptance cases finish their own failure cleanup before
      // the outer watchdog. Other individual checks retain their 90-second cap.
      const timeout = args[0] === 'node_modules/vitest/vitest.mjs' ? 180000 : 90000;
      const started = performance.now();
      const result = spawnSync(exe, args, { cwd: checkout, env, encoding: 'utf8', timeout });
      assert.equal(result.status, 0, `${path.basename(exe)} failed: ${result.error?.code ?? ''}\n${result.stdout}\n${result.stderr}`);
      for (const line of `${result.stdout}\n${result.stderr}`.replace(/\x1b\[[0-9;]*m/g, '').split('\n')) {
        if (/Test Files|Tests\s+\d|Ran \d+ tests|"workload"/.test(line)) console.log(line.trim());
      }
      console.log(`PASS ${path.basename(exe)} ${args[0]} (${Math.round(performance.now() - started)} ms)`);
      return result.stdout;
    };
    // Acceptance routes inspect real pinned SQLite state, so tracked upstream
    // sources must be exported before Vitest (never upstream dotenv or artifacts).
    for (const file of gitFiles(path.join(repo, 'TradingAgents'))) {
      assert(!/^\.env(?:\.|$)/.test(file) || file.includes('example'));
      write(checkout, `TradingAgents/${file}`, fs.readFileSync(path.join(repo, 'TradingAgents', file)));
    }
    run(process.execPath, ['scripts/provision-private.mjs', '--check']);
    run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false']);
    run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run']);

    const python = root => path.join(repo, root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    run(python(''), ['-m', 'unittest', 'discover', '-s', 'test', '-p', 'test_subprocess_env.py', '-v']);
    run(python(''), ['-m', 'unittest', 'discover', '-s', 'test', '-p', 'test_desk_lifecycle.py', '-v']);
    run(python(''), ['-m', 'unittest', 'discover', '-s', 'test', '-p', 'test_desk_efficiency.py', '-v']);
    run(python('TradingAgents'), ['-m', 'unittest', 'discover', '-s', 'test', '-p', 'test_desk_checkpoints.py', '-v']);
    run(python('TradingAgents'), ['-m', 'unittest', 'discover', '-s', 'test', '-p', 'test_desk_safety.py', '-v']);
    run(python(''), ['-c', 'import yfinance, pytz, pandas, httpx, googleapiclient, youtube_transcript_api, yt_dlp; from webull.core.client import ApiClient; print("app dependencies imported")']);
    // The real runner blocks upstream dotenv before graph imports. --help never propagates.
    write(checkout, '.env', 'FORBIDDEN_DOTENV_SENTINEL=loaded');
    write(checkout, 'TradingAgents/.env', 'FORBIDDEN_DOTENV_SENTINEL=loaded');
    write(checkout, 'TradingAgents/.env.enterprise', 'FORBIDDEN_DOTENV_SENTINEL=loaded');
    run(python('TradingAgents'), ['-c', `
import os, pathlib, runpy, socket, sys
def audit(event, args):
    if event == 'open' and isinstance(args[0], (str, bytes)):
        name = pathlib.Path(os.fsdecode(args[0])).name
        if name == '.env' or name.startswith('.env.'):
            raise AssertionError('dotenv read forbidden during Desk imports')
def offline(*args, **kwargs):
    raise AssertionError('network forbidden during setup imports')
sys.addaudithook(audit)
socket.create_connection = offline
socket.socket.connect = offline
sys.argv = ['scripts/trading_desk_runner.py', '--help']
try:
    runpy.run_path(sys.argv[0], run_name='__main__')
except SystemExit as exc:
    assert exc.code == 0
import tradingagents
assert pathlib.Path(tradingagents.__file__).resolve().is_relative_to(pathlib.Path.cwd() / 'TradingAgents')
assert 'FORBIDDEN_DOTENV_SENTINEL' not in os.environ
`]);
    console.log('PASS: tracked source + explicit private sentinels; TypeScript, Vitest, Python boundaries, app dependencies, real Desk graph imports/--help. No build or live behavior implied.');
  } finally {
    // Remove junction first; never traverse installed dependencies during cleanup.
    const modules = path.join(checkout, 'node_modules');
    if (fs.existsSync(modules)) fs.unlinkSync(modules);
    const deskVenv = path.join(checkout, 'TradingAgents', '.venv');
    if (fs.existsSync(deskVenv)) fs.unlinkSync(deskVenv);
    assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
