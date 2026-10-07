// Offline release checkout/build driver. Never run Next in the user's checkout.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { repo, additions, gitFiles, fixtureBundle, write } from './setup.test.mjs';
import { PRIVATE_FILES, checkPrivate, provisionPrivate } from '../scripts/provision-private.mjs';

const [mode, destination] = process.argv.slice(2);
assert(destination, 'Usage: node test/desk-release.mjs prepare|build <new isolated directory>');
assert(['prepare', 'build'].includes(mode), 'Unknown mode');
const root = path.resolve(destination);
assert(root !== repo && !root.startsWith(repo + path.sep), 'Use an isolated directory outside the application');
const checkout = path.join(root, 'checkout');
const intended = new Set([
  '.env.example', 'README.md', 'lib/auth/require-admin.ts', 'lib/desk/access.ts',
  'lib/desk/config.test.ts', 'lib/desk/config.ts', 'lib/desk/report.ts', 'lib/desk/runner.ts', 'lib/desk/types.ts',
  'lib/insights/access.example.ts', 'lib/insights/orchestrator.example.ts',
  'lib/python-runner.ts', 'scripts/trading_desk_runner.py', 'scripts/youtube_ingest.py',
  'scripts/youtube_poll_cron.ps1', 'scripts/youtube_poll_cron.sh', 'vitest.config.ts',
  'app/api/desk/checkpoints/route.ts', 'app/api/desk/runs/route.ts',
  'app/api/desk/runs/[id]/download/route.ts', 'app/api/desk/runs/[id]/insights/route.ts',
  'app/api/desk/runs/[id]/route.ts', 'app/api/desk/runs/[id]/stream/route.ts',
  'app/dashboard/desk/_components/desk-launch-form.tsx', 'app/dashboard/desk/_components/desk-report.tsx',
  'app/dashboard/desk/_components/desk-event-log.tsx', 'app/dashboard/desk/_components/desk-memo-pane.tsx',
  'app/dashboard/desk/_components/desk-run-timeline.tsx',
  'app/dashboard/desk/runs/[id]/page.tsx',
]);
export function releaseEnv() {
  const env = {};
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) {
    const found = Object.keys(process.env).find(name => name.toLowerCase() === key.toLowerCase());
    if (found) env[key] = process.env[found];
  }
  return Object.assign(env, {
    DATABASE_URL: 'postgresql://sentinel:sentinel@127.0.0.1:1/sentinel',
    DIRECT_URL: 'postgresql://sentinel:sentinel@127.0.0.1:1/sentinel',
    NEXTAUTH_SECRET: 'desk13-isolated-offline-sentinel-not-a-real-secret',
    NEXTAUTH_URL: 'http://127.0.0.1:3213', NEXT_TELEMETRY_DISABLED: '1',
    PYTHONDONTWRITEBYTECODE: '1', PYTHON_DOTENV_DISABLED: '1',
    NEXT_FONT_GOOGLE_MOCKED_RESPONSES: path.join(root, 'fonts.cjs'),
    NODE_OPTIONS: `--require "${path.join(root, 'guard.cjs').replaceAll('\\', '/')}"`,
    DESK13_CHECKOUT: checkout,
  });
}
if (mode === 'prepare') {
  assert(!fs.existsSync(root), 'Refusing to overwrite a verification directory');
  fs.mkdirSync(checkout, { recursive: true });
  const dirty = execFileSync('git', ['diff', '--name-only', '-z'], { cwd: repo, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const file of dirty) assert(file === '.gitignore' || intended.has(file), `Unreviewed tracked edit: ${file}`);
  const manifest = [];
  for (const file of new Set([...gitFiles(repo), ...additions, 'test/desk-release.mjs'])) {
    if (file === 'TradingAgents') continue;
    assert(!PRIVATE_FILES.includes(file), `Private implementation in source export: ${file}`);
    assert(!/^\.env(?:\.|$)/.test(file) || file === '.env.example', 'Secret file in export');
    assert(fs.lstatSync(path.join(repo, file)).isFile(), `Source must be a regular file: ${file}`);
    const body = file === '.gitignore'
      ? Buffer.from(execFileSync('git', ['show', 'HEAD:.gitignore'], { cwd: repo, encoding: 'utf8' }) + '\n!/SECURITY.md\n')
      : fs.readFileSync(path.join(repo, file));
    write(checkout, file, body);
    manifest.push({ file, source: file === '.gitignore' ? 'HEAD + desk-7 SECURITY exception only' : 'working tree', sha256: crypto.createHash('sha256').update(body).digest('hex') });
  }
  const pin = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(repo, 'TradingAgents'), encoding: 'utf8' }).trim();
  assert(execFileSync('git', ['ls-files', '-s', 'TradingAgents'], { cwd: repo, encoding: 'utf8' }).includes(pin));
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: path.join(repo, 'TradingAgents'), encoding: 'utf8' }).trim(), '');
  for (const file of gitFiles(path.join(repo, 'TradingAgents'))) {
    assert(!/^\.env(?:\.|$)/.test(file) || file.includes('example'));
    write(checkout, `TradingAgents/${file}`, fs.readFileSync(path.join(repo, 'TradingAgents', file)));
  }
  const bundle = path.join(root, 'private-bundle'); fs.mkdirSync(bundle);
  fixtureBundle(bundle); provisionPrivate(checkout, bundle);
  assert.equal(checkPrivate(checkout).length, PRIVATE_FILES.length + 1);
  assert(!fs.existsSync(path.join(checkout, '.env')));
  assert(!fs.existsSync(path.join(checkout, 'conf/token.txt')));
  write(root, 'source-manifest.json', JSON.stringify({ pin, files: manifest, private: 'explicit test sentinel bundle; not operator research compatibility' }, null, 2));
  fs.symlinkSync(path.join(repo, 'node_modules'), path.join(checkout, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.symlinkSync(path.join(repo, 'TradingAgents/.venv'), path.join(checkout, 'TradingAgents/.venv'), process.platform === 'win32' ? 'junction' : 'dir');
  write(checkout, 'next-env.d.ts', '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n');
  write(root, 'fonts.cjs', 'module.exports = new Proxy({}, { get: () => "@font-face { font-family: OfflineSentinel; src: local(Arial); font-weight: 100 900; }" });\n');
  write(root, 'guard.cjs', `
const fs = require('node:fs'), path = require('node:path'), net = require('node:net');
function check(file) {
  if (typeof file !== 'string' && !(file instanceof URL)) return;
  const resolved = path.resolve(file instanceof URL ? require('node:url').fileURLToPath(file) : file);
  const name = path.basename(resolved);
  if ((name === '.env' || name.startsWith('.env.')) && name !== '.env.example') throw Error('RELEASE GUARD: dotenv read forbidden');
}
for (const name of ['readFileSync','readFile','openSync','open']) {
  const original = fs[name]; fs[name] = function(file, ...args) { check(file); return original.call(this, file, ...args); };
}
for (const name of ['readFile','open']) {
  const original = fs.promises[name]; fs.promises[name] = function(file, ...args) { check(file); return original.call(this, file, ...args); };
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
  const arg = args[0];
  if (arg && typeof arg === 'object' && arg.path) return connect.apply(this, args);
  throw Error('RELEASE GUARD: network connection forbidden');
};
globalThis.fetch = async () => { throw Error('RELEASE GUARD: network fetch forbidden'); };
require('node:module').syncBuiltinESMExports();
`);
  console.log(JSON.stringify({ checkout, sourceFiles: manifest.length, pin, privatePrerequisites: 'test sentinels provisioned', dependencies: 'installed node_modules/generated Prisma and TradingAgents venv reused' }));
} else if (mode === 'build') {
  assert(fs.existsSync(path.join(root, 'source-manifest.json')));
  // Fail closed if protection regresses; probes never open a secret or connect.
  const probe = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    assert.throws(() => require('node:fs').readFileSync('.env'), /dotenv read forbidden/);
    assert.throws(() => require('node:net').connect({host:'127.0.0.1',port:1}), /network connection forbidden/);
    fetch('https://offline.invalid').then(() => { throw Error('Guard did not block fetch'); }, e => assert.match(e.message, /network fetch forbidden/));
    console.log('PASS: dotenv, socket and fetch guards');
  `], { cwd: checkout, env: releaseEnv(), encoding: 'utf8', windowsHide: true });
  write(root, 'guard-self-test.log', probe.stdout + probe.stderr);
  assert.equal(probe.status, 0, 'Build guard self-test failed');
  const log = fs.createWriteStream(path.join(root, 'production-build.log'));
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'build'], { cwd: checkout, env: releaseEnv(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log.write(data); process.stdout.write(data); });
  child.on('exit', code => { log.end(); write(root, 'build-result.json', JSON.stringify({ command: 'node node_modules/next/dist/bin/next build', exitCode: code, fontFixture: true, database: 'sentinel unreachable; no DB operations authorized' }, null, 2)); process.exitCode = code ?? 1; });
} else throw Error('Unknown mode');
